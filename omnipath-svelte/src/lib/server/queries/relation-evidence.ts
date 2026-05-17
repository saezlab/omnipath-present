import { getPool } from "$lib/server/db/client";
import type { EntityRelationEvidence } from "$lib/drizzle";

const SEARCH_SCHEMA = () => process.env.OMNIPATH_PG_SCHEMA || "public";

function annotationArraySql(fromSql: string, whereSql: string, scopeSql: string): string {
  return `COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'term', a.term,
        'value', a.value,
        'unit', a.unit,
        'scope', ${scopeSql}
      )
      ORDER BY a.annotation_key
    )
    FROM ${fromSql}
    WHERE ${whereSql}
  ), '[]'::jsonb)`;
}

async function getEvidenceByRelationPksInternal(relationPks: number[]): Promise<EntityRelationEvidence[]> {
  const normalized = Array.from(new Set(relationPks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const result = await client.query<{
      source: string;
      relation_evidence_id: string;
      relation_id: string | number;
      record_attributes: unknown;
      subject_attributes: unknown;
      object_attributes: unknown;
      evidence: unknown;
    }>(
      `SELECT
         ds.name AS source,
         re.relation_evidence_id,
         rer.relation_id,
         ${annotationArraySql(
           `${schema}.relation_evidence_annotation ann JOIN ${schema}.vocab_annotation_scope scope ON scope.annotation_scope_id = ann.annotation_scope_id JOIN ${schema}.annotation a ON a.annotation_key = ann.annotation_key`,
           "ann.source_id = re.source_id AND ann.relation_evidence_id = re.relation_evidence_id AND scope.name = 'relation'",
           "scope.name",
         )} AS record_attributes,
         ${annotationArraySql(
           `${schema}.entity_evidence_annotation ann JOIN ${schema}.annotation a ON a.annotation_key = ann.annotation_key`,
           "ann.source_id = re.source_id AND ann.entity_evidence_id = re.subject_entity_evidence_id",
           "'entity'",
         )} AS subject_attributes,
         ${annotationArraySql(
           `${schema}.entity_evidence_annotation ann JOIN ${schema}.annotation a ON a.annotation_key = ann.annotation_key`,
           "ann.source_id = re.source_id AND ann.entity_evidence_id = re.object_entity_evidence_id",
           "'entity'",
         )} AS object_attributes,
         ${annotationArraySql(
           `${schema}.relation_evidence_annotation ann JOIN ${schema}.vocab_annotation_scope scope ON scope.annotation_scope_id = ann.annotation_scope_id JOIN ${schema}.annotation a ON a.annotation_key = ann.annotation_key`,
           "ann.source_id = re.source_id AND ann.relation_evidence_id = re.relation_evidence_id AND scope.name <> 'relation'",
           "scope.name",
         )} AS evidence
       FROM ${schema}.relation_evidence_relation rer
       JOIN ${schema}.relation_evidence re
         ON re.source_id = rer.source_id
        AND re.relation_evidence_id = rer.relation_evidence_id
       JOIN ${schema}.data_source ds ON ds.source_id = re.source_id
       WHERE rer.relation_id = ANY($1::bigint[])
       ORDER BY rer.relation_id, ds.name, re.relation_evidence_id`,
      [normalized],
    );

    return result.rows.map((row) => ({
      source: row.source,
      relationEvidencePk: row.relation_evidence_id,
      relationPk: Number(row.relation_id),
      recordAttributes: row.record_attributes,
      subjectAttributes: row.subject_attributes,
      objectAttributes: row.object_attributes,
      evidence: row.evidence,
    }));
  } finally {
    client.release();
  }
}

export async function getEvidenceByRelationPk(relationPk: number): Promise<EntityRelationEvidence[]> {
  return getEvidenceByRelationPksInternal([relationPk]);
}

export async function getEvidenceByRelationPks(relationPks: number[]): Promise<EntityRelationEvidence[]> {
  return getEvidenceByRelationPksInternal(relationPks);
}
