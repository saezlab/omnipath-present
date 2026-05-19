import { getPool } from "$lib/server/db/client";
import { getEntityByPublicId } from "$lib/server/queries/entity";
import {
  relationCategoryEqualsSql,
  relationPredicateNameSql,
} from "$lib/server/queries/sql-fragments";

const SEARCH_SCHEMA = () => process.env.OMNIPATH_PG_SCHEMA || "public";

type EntityAnnotationRow = {
  term: string;
  value: string | null;
  unit: string | null;
  scope: string;
  source: string | null;
};

export async function getEntityDetails(publicId: string) {
  const entity = await getEntityByPublicId(publicId);
  if (!entity) return null;

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const interactionCountResult = await client.query<{ count: string }>(
      `SELECT count(*) AS count
       FROM ${schema}.relation r
       WHERE ${relationCategoryEqualsSql(schema, "r", "interaction")}
         AND r.subject_entity_id = $1::uuid`,
      [entity.entityPk],
    );
    const annotationResult = await client.query<{ relation_pk: string | number; predicate: string }>(
      `SELECT r.relation_id AS relation_pk, ${relationPredicateNameSql(schema, "r")} AS predicate
       FROM ${schema}.relation r
         WHERE ${relationCategoryEqualsSql(schema, "r", "association")}
         AND r.subject_entity_id = $1::uuid
       ORDER BY r.relation_id
       LIMIT 100`,
      [entity.entityPk],
    );
    const attributeResult = await client.query<EntityAnnotationRow>(
      `SELECT DISTINCT term, value, unit, scope, source
       FROM (
         SELECT a.term, a.value, a.unit, 'entity'::text AS scope, ds.name AS source
         FROM ${schema}.entity_evidence_resolution eer
         JOIN ${schema}.entity_evidence_annotation eea
           ON eea.source_id = eer.source_id
          AND eea.entity_evidence_id = eer.entity_evidence_id
         JOIN ${schema}.annotation a ON a.annotation_key = eea.annotation_key
         JOIN ${schema}.entity_evidence ee
           ON ee.source_id = eer.source_id
          AND ee.entity_evidence_id = eer.entity_evidence_id
         JOIN ${schema}.data_source ds ON ds.source_id = ee.source_id
         WHERE eer.entity_id = $1::uuid
       ) annotations
       ORDER BY term, value NULLS LAST, source NULLS LAST
       LIMIT 500`,
      [entity.entityPk],
    );
    const attributes = attributeResult.rows.map((row) => ({
      term: row.term,
      value: row.value,
      unit: row.unit,
      scope: row.scope,
      source: row.source,
    }));
    const taxonomyId = entity.taxonomyId
      || attributes.find((attribute) => attribute.term.toLowerCase().includes("ncbi tax id") && attribute.value)?.value
      || entity.taxonomyId;

    return {
      entity: {
        ...entity,
        taxonomyId,
        entityAttributes: attributes,
      },
      summary: {
        interactionCount: Number(interactionCountResult.rows[0]?.count || 0),
      },
      annotations: annotationResult.rows.map((row) => ({
        relationPk: String(row.relation_pk),
        predicate: row.predicate,
      })),
    };
  } finally {
    client.release();
  }
}
