import { getPool } from "$lib/server/db/client";
import type { Entity, EntityRelation } from "$lib/drizzle";
import { toPublicEntityId } from "$lib/entity-public-id";

const SEARCH_SCHEMA = () => process.env.OMNIPATH_PG_SCHEMA || "public";

export type RelationWithEntities = EntityRelation & {
  subjectEntity: Entity;
  objectEntity: Entity;
};

function toRelationRow(row: {
  relation_id: string | number;
  subject_entity_id: string | number;
  predicate: string;
  object_entity_id: string | number;
  relation_category: string | null;
  participant_types: string[] | null;
  evidence_count: string | number | null;
  sources: string[] | null;
}): EntityRelation {
  return {
    relationPk: Number(row.relation_id),
    subjectEntityPk: Number(row.subject_entity_id),
    predicate: row.predicate,
    objectEntityPk: Number(row.object_entity_id),
    relationCategory: row.relation_category,
    participantTypes: (row.participant_types || []).filter(Boolean),
    evidenceCount: Number(row.evidence_count || 0),
    sources: (row.sources || []).filter(Boolean),
  };
}

function toEntityRow(row: {
  entity_id: string | number;
  id: string;
  id_type: string;
  entity_type: string | null;
  taxonomy_id: string | null;
}): Entity {
  return {
    entityPk: Number(row.entity_id),
    canonicalIdentifier: row.id,
    canonicalIdentifierType: row.id_type,
    entityType: row.entity_type,
    taxonomyId: row.taxonomy_id,
    entityAttributes: null,
    sources: [],
  };
}

function relationSelect(schema: string, alias = "r"): string {
  return `${alias}.relation_id,
    ${alias}.subject_entity_id,
    ${alias}.predicate,
    ${alias}.object_entity_id,
    ${alias}.relation_category,
    ARRAY(
      SELECT DISTINCT entity_type
      FROM (
        SELECT subject.entity_type
        FROM ${schema}.entity subject
        WHERE subject.entity_id = ${alias}.subject_entity_id
        UNION
        SELECT object.entity_type
        FROM ${schema}.entity object
        WHERE object.entity_id = ${alias}.object_entity_id
      ) participant_types
      WHERE entity_type IS NOT NULL
      ORDER BY entity_type
    ) AS participant_types,
    (
      SELECT COUNT(*)::bigint
      FROM ${schema}.relation_evidence_relation rer
      WHERE rer.relation_id = ${alias}.relation_id
    ) AS evidence_count,
    ARRAY(
      SELECT DISTINCT re.source
      FROM ${schema}.relation_evidence_relation rer
      JOIN ${schema}.relation_evidence re ON re.relation_evidence_id = rer.relation_evidence_id
      WHERE rer.relation_id = ${alias}.relation_id
        AND re.source IS NOT NULL
        AND re.source <> ''
      ORDER BY re.source
    ) AS sources`;
}

export async function getRelationByPk(pk: number): Promise<RelationWithEntities | null> {
  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const result = await client.query<{
      relation_id: string | number;
      subject_entity_id: string | number;
      predicate: string;
      object_entity_id: string | number;
      relation_category: string | null;
      participant_types: string[] | null;
      evidence_count: string | number | null;
      sources: string[] | null;
      subject_id: string;
      subject_id_type: string;
      subject_entity_type: string | null;
      subject_taxonomy_id: string | null;
      object_id: string;
      object_id_type: string;
      object_entity_type: string | null;
      object_taxonomy_id: string | null;
    }>(
      `SELECT
         ${relationSelect(schema, "r")},
         subject.id AS subject_id,
         subject.id_type AS subject_id_type,
         subject.entity_type AS subject_entity_type,
         subject.taxonomy_id AS subject_taxonomy_id,
         object.id AS object_id,
         object.id_type AS object_id_type,
         object.entity_type AS object_entity_type,
         object.taxonomy_id AS object_taxonomy_id
       FROM ${schema}.relation r
       JOIN ${schema}.entity subject ON subject.entity_id = r.subject_entity_id
       JOIN ${schema}.entity object ON object.entity_id = r.object_entity_id
       WHERE r.relation_id = $1
       LIMIT 1`,
      [pk],
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      ...toRelationRow(row),
      subjectEntity: toEntityRow({
        entity_id: row.subject_entity_id,
        id: row.subject_id,
        id_type: row.subject_id_type,
        entity_type: row.subject_entity_type,
        taxonomy_id: row.subject_taxonomy_id,
      }),
      objectEntity: toEntityRow({
        entity_id: row.object_entity_id,
        id: row.object_id,
        id_type: row.object_id_type,
        entity_type: row.object_entity_type,
        taxonomy_id: row.object_taxonomy_id,
      }),
    };
  } finally {
    client.release();
  }
}

export async function getRelationsByPks(pks: number[]): Promise<EntityRelation[]> {
  const normalized = Array.from(new Set(pks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];
  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const result = await client.query<{
      relation_id: string | number;
      subject_entity_id: string | number;
      predicate: string;
      object_entity_id: string | number;
      relation_category: string | null;
      participant_types: string[] | null;
      evidence_count: string | number | null;
      sources: string[] | null;
    }>(
      `SELECT ${relationSelect(schema, "r")}
       FROM ${schema}.relation r
       WHERE r.relation_id = ANY($1::bigint[])
       ORDER BY r.relation_id`,
      [normalized],
    );
    return result.rows.map(toRelationRow);
  } finally {
    client.release();
  }
}

export interface RelationFilters {
  relationCategories?: string[];
  predicates?: string[];
  interactionTypes?: string[];
  subjectEntityPks?: number[];
  objectEntityPks?: number[];
  entityPks?: number[];
  sources?: string[];
  annotationTerms?: string[];
  scopeEntityPks?: number[];
  scopeAnnotationTerms?: string[];
}

function normalizeNumberValues(values: number[] | undefined): number[] {
  return Array.from(new Set((values || []).filter(Number.isFinite)));
}

function normalizeStringValues(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
}

function buildRelationSearchWhere(filters: RelationFilters, schema: string) {
  const whereParts: string[] = [];
  const params: unknown[] = [];
  const pushParam = (value: unknown, cast?: string): string => {
    params.push(value);
    const placeholder = `$${params.length}`;
    return cast ? `${placeholder}::${cast}` : placeholder;
  };

  const entityPkPredicate = (placeholder: string) =>
    `(r.subject_entity_id = ANY(${placeholder}) OR r.object_entity_id = ANY(${placeholder}))`;

  const annotationTermPredicate = (placeholder: string) => `r.relation_id IN (
    WITH term_entities AS (
      SELECT terms.term_entity_id
      FROM ${schema}.ontology_terms terms
      WHERE terms.term_id = ANY(${placeholder})
    ),
    annotated_entity_ids AS (
      SELECT DISTINCT association.subject_entity_id AS entity_id
      FROM ${schema}.relation association
      JOIN term_entities term_entity ON term_entity.term_entity_id = association.object_entity_id
      WHERE association.relation_category = 'association'
    ),
    directly_annotated_relation_ids AS (
      SELECT DISTINCT rea.relation_id
      FROM ${schema}.relation_evidence_annotation rea
      JOIN ${schema}.annotation a ON a.annotation_id = rea.annotation_id
      JOIN term_entities term_entity ON term_entity.term_entity_id = a.entity_id
    )
    SELECT relation_id FROM directly_annotated_relation_ids
    UNION
    SELECT subject_relation.relation_id
    FROM ${schema}.relation subject_relation
    JOIN annotated_entity_ids annotated_entity ON annotated_entity.entity_id = subject_relation.subject_entity_id
    UNION
    SELECT object_relation.relation_id
    FROM ${schema}.relation object_relation
    JOIN annotated_entity_ids annotated_entity ON annotated_entity.entity_id = object_relation.object_entity_id
  )`;

  const relationCategories = normalizeStringValues(filters.relationCategories);
  if (relationCategories.length) whereParts.push(`r.relation_category = ANY(${pushParam(relationCategories, "text[]")})`);

  const predicates = normalizeStringValues(filters.predicates);
  if (predicates.length) whereParts.push(`r.predicate = ANY(${pushParam(predicates, "text[]")})`);

  const interactionTypes = normalizeStringValues(filters.interactionTypes);
  if (interactionTypes.length) {
    whereParts.push(`EXISTS (
      SELECT 1
      FROM ${schema}.entity endpoint
      WHERE endpoint.entity_type = ANY(${pushParam(interactionTypes, "text[]")})
        AND endpoint.entity_id IN (r.subject_entity_id, r.object_entity_id)
    )`);
  }

  const subjectEntityPks = normalizeNumberValues(filters.subjectEntityPks);
  if (subjectEntityPks.length) whereParts.push(`r.subject_entity_id = ANY(${pushParam(subjectEntityPks, "bigint[]")})`);

  const objectEntityPks = normalizeNumberValues(filters.objectEntityPks);
  if (objectEntityPks.length) whereParts.push(`r.object_entity_id = ANY(${pushParam(objectEntityPks, "bigint[]")})`);

  const entityPks = normalizeNumberValues(filters.entityPks);
  if (entityPks.length) whereParts.push(entityPkPredicate(pushParam(entityPks, "bigint[]")));

  const sources = normalizeStringValues(filters.sources);
  if (sources.length) {
    whereParts.push(`EXISTS (
      SELECT 1
      FROM ${schema}.relation_evidence_relation rer
      JOIN ${schema}.relation_evidence re ON re.relation_evidence_id = rer.relation_evidence_id
      WHERE rer.relation_id = r.relation_id
        AND re.source = ANY(${pushParam(sources, "text[]")})
    )`);
  }

  const annotationTerms = normalizeStringValues(filters.annotationTerms);
  if (annotationTerms.length) whereParts.push(annotationTermPredicate(pushParam(annotationTerms, "text[]")));

  const scopeParts: string[] = [];
  const scopeEntityPks = normalizeNumberValues(filters.scopeEntityPks);
  if (scopeEntityPks.length) scopeParts.push(entityPkPredicate(pushParam(scopeEntityPks, "bigint[]")));
  const scopeAnnotationTerms = normalizeStringValues(filters.scopeAnnotationTerms);
  if (scopeAnnotationTerms.length) scopeParts.push(annotationTermPredicate(pushParam(scopeAnnotationTerms, "text[]")));
  if (scopeParts.length) whereParts.push(`(${scopeParts.join(" OR ")})`);

  return {
    whereClause: whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
    params,
  };
}

export async function searchRelations({
  filters = {},
  limit = 20,
  offset = 0,
}: {
  filters?: RelationFilters;
  limit?: number;
  offset?: number;
} = {}): Promise<{ relations: EntityRelation[] }> {
  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const { whereClause, params } = buildRelationSearchWhere(filters, schema);
    const pageParams = [...params, limit, offset];
    const result = await client.query<{
      relation_id: string | number;
      subject_entity_id: string | number;
      predicate: string;
      object_entity_id: string | number;
      relation_category: string | null;
      participant_types: string[] | null;
      evidence_count: string | number | null;
      sources: string[] | null;
    }>(
      `SELECT ${relationSelect(schema, "r")}
       FROM ${schema}.relation r
       ${whereClause}
       ORDER BY r.relation_id
       LIMIT $${pageParams.length - 1}
       OFFSET $${pageParams.length}`,
      pageParams,
    );

    return { relations: result.rows.map(toRelationRow) };
  } finally {
    client.release();
  }
}

export async function countRelations(filters: RelationFilters = {}): Promise<number> {
  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const { whereClause, params } = buildRelationSearchWhere(filters, schema);
    const result = await client.query<{ count: string }>(
      `SELECT count(*) AS count
       FROM ${schema}.relation r
       ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.count || 0);
  } finally {
    client.release();
  }
}

type RelationFilterOptions = {
  predicatesByCategory: Record<string, string[]>;
  sources: string[];
  interactionTypes: string[];
};

let relationFilterOptionsCache: { value: RelationFilterOptions; expiresAt: number } | null = null;
let relationFilterOptionsInFlight: Promise<RelationFilterOptions> | null = null;

export async function getRelationFilterOptions(): Promise<RelationFilterOptions> {
  const now = Date.now();
  if (relationFilterOptionsCache && relationFilterOptionsCache.expiresAt > now) return relationFilterOptionsCache.value;
  if (relationFilterOptionsInFlight) return relationFilterOptionsInFlight;

  relationFilterOptionsInFlight = (async () => {
    const schema = SEARCH_SCHEMA();
    const client = await getPool().connect();
    try {
      const [predicateResult, sourceResult, interactionTypeResult] = await Promise.all([
        client.query<{ category: string; predicates: string[] | null }>(
          `SELECT category, array_agg(predicate ORDER BY predicate) AS predicates
           FROM (
             SELECT DISTINCT r.relation_category AS category, r.predicate AS predicate
             FROM ${schema}.relation r
           ) t
           GROUP BY category
           ORDER BY category`,
        ),
        client.query<{ values: string[] | null }>(
          `SELECT array_agg(facet_value ORDER BY facet_value) AS values
           FROM ${schema}.facet_relation_bitmap
           WHERE facet_name = 'source'`,
        ),
        client.query<{ values: string[] | null }>(
          `SELECT array_agg(facet_value ORDER BY facet_value) AS values
           FROM ${schema}.facet_relation_bitmap
           WHERE facet_name = 'participant_type'`,
        ),
      ]);

      const value = {
        predicatesByCategory: Object.fromEntries(
          predicateResult.rows.map((row) => [row.category || "uncategorized", row.predicates?.filter(Boolean) ?? []]),
        ),
        sources: sourceResult.rows[0]?.values?.filter(Boolean) ?? [],
        interactionTypes: interactionTypeResult.rows[0]?.values?.filter(Boolean) ?? [],
      };

      relationFilterOptionsCache = { value, expiresAt: Date.now() + 30 * 60 * 1000 };
      return value;
    } finally {
      client.release();
      relationFilterOptionsInFlight = null;
    }
  })();

  return relationFilterOptionsInFlight;
}

export async function getAssociatedEntityIds(entityPks: number[]): Promise<string[]> {
  const normalized = Array.from(new Set(entityPks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const result = await client.query<{ id: string; id_type: string }>(
      `SELECT DISTINCT e.id, e.id_type
       FROM ${schema}.relation r
       JOIN ${schema}.entity e ON e.entity_id = r.subject_entity_id
       WHERE r.relation_category = 'association'
         AND r.object_entity_id = ANY($1::bigint[])
       ORDER BY e.id_type, e.id`,
      [normalized],
    );

    return result.rows.map((row) => toPublicEntityId(row));
  } finally {
    client.release();
  }
}

export type RelationFacetCount = {
  facetName: string;
  facetValue: string;
  facetCategory: string | null;
  scopedCount: number;
};

export async function getScopedRelationFacetCounts({
  entityPks = [],
  annotationTermIds = [],
  predicates = [],
  interactionTypes = [],
  sources = [],
}: {
  entityPks?: number[];
  annotationTermIds?: string[];
  predicates?: string[];
  interactionTypes?: string[];
  sources?: string[];
}): Promise<RelationFacetCount[]> {
  const normalizedEntityPks = Array.from(new Set(entityPks.filter(Number.isFinite)));
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const normalizedPredicates = Array.from(new Set(predicates.map((v) => v.trim()).filter(Boolean)));
  const normalizedInteractionTypes = Array.from(new Set(interactionTypes.map((v) => v.trim()).filter(Boolean)));
  const normalizedSources = Array.from(new Set(sources.map((v) => v.trim()).filter(Boolean)));

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const params: unknown[] = [];
    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const ctes: string[] = [];
    const scopeParts: string[] = [];
    if (normalizedTermIds.length > 0) {
      const termParam = pushParam(normalizedTermIds);
      scopeParts.push(`SELECT b.relation_bitmap AS bitmap
        FROM ${schema}.ontology_terms terms
        JOIN ${schema}.annotation_term_relation_bitmap b ON b.term_entity_id = terms.term_entity_id
        WHERE terms.term_id = ANY(${termParam}::text[])`);
    }
    if (normalizedEntityPks.length > 0) {
      const ePkParam = pushParam(normalizedEntityPks);
      scopeParts.push(`SELECT rb_build_agg(r.relation_id::integer) AS bitmap
        FROM ${schema}.relation r
        WHERE r.subject_entity_id = ANY(${ePkParam}::bigint[])
           OR r.object_entity_id = ANY(${ePkParam}::bigint[])`);
    }

    ctes.push(scopeParts.length > 0
      ? `scope_base AS MATERIALIZED (
          SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
          FROM (${scopeParts.join("\nUNION ALL\n")}) scope_parts
        )`
      : `scope_base AS MATERIALIZED (
          SELECT rb_or_agg(relation_bitmap) AS bitmap
          FROM ${schema}.facet_relation_bitmap
          WHERE facet_name = 'predicate'
        )`);

    if (normalizedPredicates.length > 0) {
      const predParam = pushParam(normalizedPredicates);
      ctes.push(`predicate_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_relation_bitmap
        WHERE facet_name = 'predicate' AND facet_value = ANY(${predParam}::text[])
      )`);
    }
    if (normalizedInteractionTypes.length > 0) {
      const typeParam = pushParam(normalizedInteractionTypes);
      ctes.push(`participant_type_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_relation_bitmap
        WHERE facet_name = 'participant_type' AND facet_value = ANY(${typeParam}::text[])
      )`);
    }
    if (normalizedSources.length > 0) {
      const sourceParam = pushParam(normalizedSources);
      ctes.push(`source_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_relation_bitmap
        WHERE facet_name = 'source' AND facet_value = ANY(${sourceParam}::text[])
      )`);
    }

    const scopeAnd = (extras: (string | null)[]): string => {
      const parts = ["scope_base.bitmap", ...extras.filter((e): e is string => e != null)];
      return parts.slice(1).reduce((acc, part) => `rb_and(${acc}, ${part})`, parts[0]);
    };
    const joins = ["CROSS JOIN scope_base"];
    if (normalizedPredicates.length > 0) joins.push("CROSS JOIN predicate_filter_bitmap");
    if (normalizedInteractionTypes.length > 0) joins.push("CROSS JOIN participant_type_filter_bitmap");
    if (normalizedSources.length > 0) joins.push("CROSS JOIN source_filter_bitmap");

    const subqueries = [
      `SELECT 'predicate' AS facet_name, f.facet_value, f.facet_category,
        rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedInteractionTypes.length > 0 ? "participant_type_filter_bitmap.bitmap" : null, normalizedSources.length > 0 ? "source_filter_bitmap.bitmap" : null])})) AS scoped_count
       FROM ${schema}.facet_relation_bitmap f ${joins.join("\n")}
       WHERE f.facet_name = 'predicate'
         AND rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedInteractionTypes.length > 0 ? "participant_type_filter_bitmap.bitmap" : null, normalizedSources.length > 0 ? "source_filter_bitmap.bitmap" : null])})) > 0`,
      `SELECT 'participant_type' AS facet_name, f.facet_value, f.facet_category,
        rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedPredicates.length > 0 ? "predicate_filter_bitmap.bitmap" : null, normalizedSources.length > 0 ? "source_filter_bitmap.bitmap" : null])})) AS scoped_count
       FROM ${schema}.facet_relation_bitmap f ${joins.join("\n")}
       WHERE f.facet_name = 'participant_type'
         AND rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedPredicates.length > 0 ? "predicate_filter_bitmap.bitmap" : null, normalizedSources.length > 0 ? "source_filter_bitmap.bitmap" : null])})) > 0`,
      `SELECT 'source' AS facet_name, f.facet_value, f.facet_category,
        rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedPredicates.length > 0 ? "predicate_filter_bitmap.bitmap" : null, normalizedInteractionTypes.length > 0 ? "participant_type_filter_bitmap.bitmap" : null])})) AS scoped_count
       FROM ${schema}.facet_relation_bitmap f ${joins.join("\n")}
       WHERE f.facet_name = 'source'
         AND rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedPredicates.length > 0 ? "predicate_filter_bitmap.bitmap" : null, normalizedInteractionTypes.length > 0 ? "participant_type_filter_bitmap.bitmap" : null])})) > 0`,
    ];

    const result = await client.query<{ facet_name: string; facet_value: string; facet_category: string | null; scoped_count: string | number }>(
      `WITH ${ctes.join(",\n")}
       ${subqueries.join("\nUNION ALL\n")}
       ORDER BY facet_name, scoped_count DESC`,
      params,
    );

    return result.rows.map((row) => ({
      facetName: row.facet_name,
      facetValue: row.facet_value,
      facetCategory: row.facet_category,
      scopedCount: Number(row.scoped_count || 0),
    }));
  } finally {
    client.release();
  }
}
