import { getPool } from "$lib/server/db/client";
import type { Entity, EntityIdentifier } from "$lib/drizzle";
import { normalizeStringValues } from "$lib/entity-public-id";
import { parsePublicEntityIds } from "$lib/server/entity-public-id";

export type EntityWithIdentifiers = Entity & { identifiers: EntityIdentifier[]; relationCount?: number };

const CV_TERM_ENTITY_TYPE = "Cv Term:OM:0012";
const SEARCH_SCHEMA = () => process.env.OMNIPATH_PG_SCHEMA || "minimal";

export type EntitySearchCursor = {
  relationCount: number;
  entityPk: number;
};

function toEntityRow(row: {
  entity_id: string | number;
  id: string;
  id_type: string;
  entity_type: string | null;
  taxonomy_id: string | null;
  sources?: string[] | null;
  relation_count?: string | number | null;
}): Entity & { relationCount?: number } {
  return {
    entityPk: Number(row.entity_id),
    canonicalIdentifier: row.id,
    canonicalIdentifierType: row.id_type,
    entityType: row.entity_type,
    taxonomyId: row.taxonomy_id,
    entityAttributes: null,
    sources: row.sources?.filter(Boolean) ?? [],
    relationCount: Number(row.relation_count || 0),
  };
}

function entitySourcesSql(schema: string, entityAlias = "e"): string {
  return `ARRAY(
    SELECT DISTINCT source_value
    FROM (
      SELECT ee.source AS source_value
      FROM ${schema}.entity_evidence_resolution eer
      JOIN ${schema}.entity_evidence ee ON ee.entity_evidence_id = eer.entity_evidence_id
      WHERE eer.entity_id = ${entityAlias}.entity_id
      UNION
      SELECT re.source AS source_value
      FROM ${schema}.relation_evidence re
      WHERE re.subject_entity_id = ${entityAlias}.entity_id
         OR re.object_entity_id = ${entityAlias}.entity_id
    ) entity_sources
    WHERE source_value IS NOT NULL AND source_value <> ''
    ORDER BY source_value
  )`;
}

function entityBaseSelect(schema: string, alias = "e"): string {
  return `${alias}.entity_id, ${alias}.id, ${alias}.id_type, ${alias}.entity_type, ${alias}.taxonomy_id, ${entitySourcesSql(schema, alias)} AS sources`;
}

function ontologyTermEntityPredicate(schema: string, placeholder: string, entityAlias = "e"): string {
  return `EXISTS (
    SELECT 1
    FROM ${schema}.relation r
    JOIN ${schema}.ontology_terms terms ON terms.term_entity_id = r.object_entity_id
    WHERE r.relation_category = 'association'
      AND r.subject_entity_id = ${entityAlias}.entity_id
      AND terms.term_id = ANY(${placeholder}::text[])
  )`;
}

async function getIdentifiersForEntityPks(schema: string, entityPks: number[]): Promise<Map<number, EntityIdentifier[]>> {
  if (entityPks.length === 0) return new Map();
  const client = await getPool().connect();
  try {
    const result = await client.query<{
      entity_id: string | number;
      identifier_id: string | number | null;
      identifier_type: string;
      identifier: string;
    }>(
      `SELECT DISTINCT
         eer.entity_id,
         i.identifier_id,
         i.type AS identifier_type,
         i.value AS identifier
       FROM ${schema}.entity_evidence_resolution eer
       JOIN ${schema}.entity_evidence_identifier eei ON eei.entity_evidence_id = eer.entity_evidence_id
       JOIN ${schema}.identifier i ON i.identifier_id = eei.identifier_id
       WHERE eer.entity_id = ANY($1::bigint[])
       UNION
       SELECT DISTINCT
         terms.term_entity_id AS entity_id,
         NULL::bigint AS identifier_id,
         'Name:OM:0200' AS identifier_type,
         terms.label AS identifier
       FROM ${schema}.ontology_terms terms
       WHERE terms.term_entity_id = ANY($1::bigint[])
         AND terms.label IS NOT NULL
         AND terms.label <> ''
       ORDER BY entity_id, identifier_type, identifier`,
      [entityPks],
    );

    const map = new Map<number, EntityIdentifier[]>();
    for (const row of result.rows) {
      const entityPk = Number(row.entity_id);
      const identifiers = map.get(entityPk) ?? [];
      const identifierId = row.identifier_id === null ? NaN : Number(row.identifier_id);
      identifiers.push({
        ...(Number.isFinite(identifierId) ? { id: identifierId } : {}),
        entityPk,
        identifier: row.identifier,
        identifierType: row.identifier_type,
      });
      map.set(entityPk, identifiers);
    }
    return map;
  } finally {
    client.release();
  }
}

async function hydrateEntities(schema: string, rows: Array<Entity & { relationCount?: number }>): Promise<EntityWithIdentifiers[]> {
  const identifiersByEntityPk = await getIdentifiersForEntityPks(schema, rows.map((row) => row.entityPk));
  return rows.map((row) => ({
    ...row,
    identifiers: identifiersByEntityPk.get(row.entityPk) ?? [],
  }));
}

export async function getEntityByPublicId(publicId: string): Promise<EntityWithIdentifiers | null> {
  const results = await getEntitiesByPublicIds([publicId]);
  return results[0] ?? null;
}

export async function getEntitiesByPublicIds(publicIds: string[]): Promise<EntityWithIdentifiers[]> {
  const parsed = parsePublicEntityIds(publicIds.map((id) => id.trim()).filter(Boolean));
  if (parsed.length === 0) return [];

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const whereParts: string[] = [];
    const params: unknown[] = [];
    for (const id of parsed) {
      params.push(id.canonicalIdentifierType, id.canonicalIdentifier);
      whereParts.push(`(e.id_type = $${params.length - 1} AND e.id = $${params.length})`);
    }

    const result = await client.query<{
      entity_id: string | number;
      id: string;
      id_type: string;
      entity_type: string | null;
      taxonomy_id: string | null;
      sources: string[] | null;
      relation_count: string | number | null;
    }>(
      `SELECT ${entityBaseSelect(schema)}, COALESCE(rc.relation_count, 0)::bigint AS relation_count
       FROM ${schema}.entity e
       LEFT JOIN ${schema}.entity_relation_counts rc ON rc.entity_id = e.entity_id
       WHERE ${whereParts.join(" OR ")}
       ORDER BY e.entity_id`,
      params,
    );

    return hydrateEntities(schema, result.rows.map(toEntityRow));
  } finally {
    client.release();
  }
}

export async function getEntitiesByPks(pks: number[]): Promise<EntityWithIdentifiers[]> {
  const normalized = Array.from(new Set(pks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const result = await client.query<{
      entity_id: string | number;
      id: string;
      id_type: string;
      entity_type: string | null;
      taxonomy_id: string | null;
      sources: string[] | null;
      relation_count: string | number | null;
    }>(
      `SELECT ${entityBaseSelect(schema)}, COALESCE(rc.relation_count, 0)::bigint AS relation_count
       FROM ${schema}.entity e
       LEFT JOIN ${schema}.entity_relation_counts rc ON rc.entity_id = e.entity_id
       WHERE e.entity_id = ANY($1::bigint[])
       ORDER BY e.entity_id`,
      [normalized],
    );
    return hydrateEntities(schema, result.rows.map(toEntityRow));
  } finally {
    client.release();
  }
}

export async function searchEntities({
  query = "",
  limit = 20,
  cursor,
  filters = {},
}: {
  query?: string;
  filters?: {
    entity_pks?: number[];
    annotation_term_ids?: string[];
    entity_types?: string[];
    sources?: string[];
    ncbi_tax_id?: string[];
    ontology_terms?: string[];
  };
  limit?: number;
  cursor?: EntitySearchCursor | null;
} = {}): Promise<{ entities: EntityWithIdentifiers[]; nextCursor: EntitySearchCursor | null }> {
  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();

  try {
    const whereParts: string[] = [`e.entity_type IS DISTINCT FROM '${CV_TERM_ENTITY_TYPE}'`];
    const params: unknown[] = [];
    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      const queryParam = pushParam(trimmedQuery.toLowerCase());
      whereParts.push(`(
        LOWER(e.id) = ${queryParam}
        OR e.entity_id IN (
          SELECT DISTINCT eer.entity_id
          FROM ${schema}.entity_evidence_resolution eer
          JOIN ${schema}.entity_evidence_identifier eei ON eei.entity_evidence_id = eer.entity_evidence_id
          JOIN ${schema}.identifier i ON i.identifier_id = eei.identifier_id
          WHERE LOWER(i.value) = ${queryParam}
        )
      )`);
    }

    const entityPks = filters.entity_pks?.filter(Number.isFinite) ?? [];
    const annotationTerms = normalizeStringValues(filters.annotation_term_ids || []);
    if (entityPks.length > 0 && annotationTerms.length > 0) {
      const ePkParam = pushParam(entityPks.map(String));
      const termParam = pushParam(annotationTerms);
      whereParts.push(`(e.entity_id = ANY(${ePkParam}::bigint[]) OR ${ontologyTermEntityPredicate(schema, termParam)})`);
    } else if (entityPks.length > 0) {
      const ePkParam = pushParam(entityPks.map(String));
      whereParts.push(`e.entity_id = ANY(${ePkParam}::bigint[])`);
    } else if (annotationTerms.length > 0) {
      const termParam = pushParam(annotationTerms);
      whereParts.push(ontologyTermEntityPredicate(schema, termParam));
    }

    const ontologyTerms = normalizeStringValues(filters.ontology_terms || []);
    if (ontologyTerms.length > 0) {
      const termParam = pushParam(ontologyTerms);
      whereParts.push(ontologyTermEntityPredicate(schema, termParam));
    }

    const entityTypes = normalizeStringValues(filters.entity_types || []);
    if (entityTypes.length > 0) {
      const param = pushParam(entityTypes);
      whereParts.push(`e.entity_type = ANY(${param}::text[])`);
    }

    const taxonomyIds = normalizeStringValues(filters.ncbi_tax_id || []);
    if (taxonomyIds.length > 0) {
      const param = pushParam(taxonomyIds);
      whereParts.push(`e.taxonomy_id = ANY(${param}::text[])`);
    }

    const sources = normalizeStringValues(filters.sources || []);
    if (sources.length > 0) {
      const param = pushParam(sources);
      whereParts.push(`EXISTS (
        SELECT 1
        FROM ${schema}.facet_entity_bitmap f
        WHERE f.facet_name = 'source'
          AND f.facet_value = ANY(${param}::text[])
          AND rb_cardinality(rb_and(f.entity_bitmap, rb_build(ARRAY[e.entity_id::integer]))) > 0
      )`);
    }

    const normalizedCursor = normalizeEntitySearchCursor(cursor);
    const pageParams = [...params];
    let pageCursorWhere = "";
    if (normalizedCursor) {
      const countParam = pushPageParam(pageParams, normalizedCursor.relationCount);
      const pkParam = pushPageParam(pageParams, normalizedCursor.entityPk);
      pageCursorWhere = `WHERE (m.relation_count < ${countParam} OR (m.relation_count = ${countParam} AND m.entity_id > ${pkParam}))`;
    }
    pageParams.push(limit);
    const limitParam = `$${pageParams.length}`;

    const result = await client.query<{
      entity_id: string | number;
      id: string;
      id_type: string;
      entity_type: string | null;
      taxonomy_id: string | null;
      sources: string[] | null;
      relation_count: string | number | null;
    }>(
      `WITH matched_entities AS MATERIALIZED (
         SELECT e.*
         FROM ${schema}.entity e
         WHERE ${whereParts.join(" AND ")}
       ),
       matched AS (
         SELECT me.*, ${entitySourcesSql(schema, "me")} AS sources, COALESCE(rc.relation_count, 0)::bigint AS relation_count
         FROM matched_entities me
         LEFT JOIN ${schema}.entity_relation_counts rc ON rc.entity_id = me.entity_id
       )
       SELECT m.*
       FROM matched m
       ${pageCursorWhere}
       ORDER BY m.relation_count DESC, m.entity_id ASC
       LIMIT ${limitParam}`,
      pageParams,
    );

    const rows = result.rows.map(toEntityRow);
    const nextCursor = rows.length === limit
      ? { relationCount: rows[rows.length - 1].relationCount || 0, entityPk: rows[rows.length - 1].entityPk }
      : null;

    return { entities: await hydrateEntities(schema, rows), nextCursor };
  } finally {
    client.release();
  }
}

function pushPageParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function normalizeEntitySearchCursor(cursor: EntitySearchCursor | null | undefined): EntitySearchCursor | null {
  if (!cursor) return null;
  const relationCount = Number(cursor.relationCount);
  const entityPk = Number(cursor.entityPk);
  if (!Number.isFinite(relationCount) || !Number.isFinite(entityPk)) {
    throw new Error("Invalid entity search cursor");
  }
  return { relationCount, entityPk };
}

let entityFilterOptionsCache:
  | { value: { entity_types: string[]; sources: string[]; taxonomy_ids: string[] }; expiresAt: number }
  | null = null;
let entityFilterOptionsInFlight: Promise<{ entity_types: string[]; sources: string[]; taxonomy_ids: string[] }> | null = null;

export async function getEntityFilterOptions(): Promise<{ entity_types: string[]; sources: string[]; taxonomy_ids: string[] }> {
  const now = Date.now();
  if (entityFilterOptionsCache && entityFilterOptionsCache.expiresAt > now) return entityFilterOptionsCache.value;
  if (entityFilterOptionsInFlight) return entityFilterOptionsInFlight;

  entityFilterOptionsInFlight = (async () => {
    const schema = SEARCH_SCHEMA();
    const client = await getPool().connect();
    try {
      const typeResult = await client.query<{ values: string[] | null }>(
        `SELECT array_agg(value ORDER BY value) AS values
         FROM (
           SELECT DISTINCT entity_type AS value
           FROM ${schema}.entity
           WHERE entity_type IS NOT NULL
             AND entity_type <> '${CV_TERM_ENTITY_TYPE}'
         ) t`,
      );
      const sourceResult = await client.query<{ values: string[] | null }>(
        `SELECT array_agg(facet_value ORDER BY facet_value) AS values
         FROM ${schema}.facet_entity_bitmap
         WHERE facet_name = 'source'`,
      );
      const taxonomyResult = await client.query<{ values: string[] | null }>(
        `SELECT array_agg(facet_value ORDER BY facet_value) AS values
         FROM ${schema}.facet_entity_bitmap
         WHERE facet_name = 'taxonomy_id'`,
      );

      const value = {
        entity_types: typeResult.rows[0]?.values?.filter(Boolean) ?? [],
        sources: sourceResult.rows[0]?.values?.filter(Boolean) ?? [],
        taxonomy_ids: taxonomyResult.rows[0]?.values?.filter(Boolean) ?? [],
      };

      entityFilterOptionsCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
      return value;
    } finally {
      client.release();
      entityFilterOptionsInFlight = null;
    }
  })();

  return entityFilterOptionsInFlight;
}

export type EntityFacetCount = {
  facetName: string;
  facetValue: string;
  scopedCount: number;
};

export async function getScopedEntityFacetCounts({
  entityPks = [],
  annotationTermIds = [],
  entityTypes = [],
  sources = [],
  ncbi_tax_id = [],
  query = "",
  facetLimit = 10,
}: {
  entityPks?: number[];
  annotationTermIds?: string[];
  entityTypes?: string[];
  sources?: string[];
  ncbi_tax_id?: string[];
  query?: string;
  facetLimit?: number;
}): Promise<EntityFacetCount[]> {
  const normalizedEntityPks = Array.from(new Set(entityPks.filter(Number.isFinite)));
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const normalizedEntityTypes = Array.from(new Set(entityTypes.map((v) => v.trim()).filter(Boolean)));
  const normalizedSources = Array.from(new Set(sources.map((v) => v.trim()).filter(Boolean)));
  const normalizedTaxonomyIds = Array.from(new Set(ncbi_tax_id.map((v) => v.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const normalizedFacetLimit = Math.max(1, Math.min(Math.floor(facetLimit), 100));

  const client = await getPool().connect();
  try {
    const schema = SEARCH_SCHEMA();
    const params: unknown[] = [];
    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const ctes: string[] = [];
    ctes.push(`non_cv_entity_bitmap AS MATERIALIZED (
      SELECT COALESCE(rb_or_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM ${schema}.facet_entity_bitmap
      WHERE facet_name = 'entity_type'
        AND facet_value <> '${CV_TERM_ENTITY_TYPE}'
    )`);

    const scopeParts: string[] = [];
    if (normalizedTermIds.length > 0) {
      const termParam = pushParam(normalizedTermIds);
      scopeParts.push(`SELECT b.entity_bitmap AS bitmap
        FROM ${schema}.ontology_terms terms
        JOIN ${schema}.annotation_term_entity_bitmap b ON b.term_entity_id = terms.term_entity_id
        WHERE terms.term_id = ANY(${termParam}::text[])`);
    }
    if (normalizedEntityPks.length > 0) {
      const maxPk = Math.max(...normalizedEntityPks);
      if (maxPk > 2147483647) throw new Error("Entity PK exceeds 32-bit range; bitmap path requires ordinal mapping");
      const ePkParam = pushParam(normalizedEntityPks);
      scopeParts.push(`SELECT rb_build(${ePkParam}::integer[]) AS bitmap`);
    }

    ctes.push(scopeParts.length > 0
      ? `scope_base AS MATERIALIZED (
          SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
          FROM (${scopeParts.join("\nUNION ALL\n")}) scope_parts
        )`
      : `scope_base AS MATERIALIZED (SELECT bitmap FROM non_cv_entity_bitmap)`);

    if (trimmedQuery) {
      const queryParam = pushParam(trimmedQuery.toLowerCase());
      ctes.push(`query_bitmap AS MATERIALIZED (
        SELECT rb_build_agg(e.entity_id::integer) AS bitmap
        FROM ${schema}.entity e
        WHERE LOWER(e.id) = ${queryParam}
           OR e.entity_id IN (
             SELECT DISTINCT eer.entity_id
             FROM ${schema}.entity_evidence_resolution eer
             JOIN ${schema}.entity_evidence_identifier eei ON eei.entity_evidence_id = eer.entity_evidence_id
             JOIN ${schema}.identifier i ON i.identifier_id = eei.identifier_id
             WHERE LOWER(i.value) = ${queryParam}
           )
      )`);
    }

    if (normalizedEntityTypes.length > 0) {
      const typeParam = pushParam(normalizedEntityTypes);
      ctes.push(`type_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_entity_bitmap
        WHERE facet_name = 'entity_type' AND facet_value = ANY(${typeParam}::text[])
      )`);
    }

    if (normalizedSources.length > 0) {
      const sourceParam = pushParam(normalizedSources);
      ctes.push(`source_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_entity_bitmap
        WHERE facet_name = 'source' AND facet_value = ANY(${sourceParam}::text[])
      )`);
    }

    if (normalizedTaxonomyIds.length > 0) {
      const taxonomyParam = pushParam(normalizedTaxonomyIds);
      ctes.push(`taxonomy_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_entity_bitmap
        WHERE facet_name = 'taxonomy_id' AND facet_value = ANY(${taxonomyParam}::text[])
      )`);
    }

    const chain = (parts: string[]): string => parts.slice(1).reduce((expr, part) => `rb_and(${expr}, ${part})`, parts[0]);
    const joins: string[] = ["CROSS JOIN scope_base", "CROSS JOIN non_cv_entity_bitmap"];
    if (trimmedQuery) joins.push("CROSS JOIN query_bitmap");
    if (normalizedEntityTypes.length > 0) joins.push("CROSS JOIN type_filter_bitmap");
    if (normalizedSources.length > 0) joins.push("CROSS JOIN source_filter_bitmap");
    if (normalizedTaxonomyIds.length > 0) joins.push("CROSS JOIN taxonomy_filter_bitmap");

    const typeScope = chain(["scope_base.bitmap", "non_cv_entity_bitmap.bitmap", ...(trimmedQuery ? ["query_bitmap.bitmap"] : []), ...(normalizedSources.length > 0 ? ["source_filter_bitmap.bitmap"] : []), ...(normalizedTaxonomyIds.length > 0 ? ["taxonomy_filter_bitmap.bitmap"] : [])]);
    const sourceScope = chain(["scope_base.bitmap", "non_cv_entity_bitmap.bitmap", ...(trimmedQuery ? ["query_bitmap.bitmap"] : []), ...(normalizedEntityTypes.length > 0 ? ["type_filter_bitmap.bitmap"] : []), ...(normalizedTaxonomyIds.length > 0 ? ["taxonomy_filter_bitmap.bitmap"] : [])]);
    const taxonomyScope = chain(["scope_base.bitmap", "non_cv_entity_bitmap.bitmap", ...(trimmedQuery ? ["query_bitmap.bitmap"] : []), ...(normalizedEntityTypes.length > 0 ? ["type_filter_bitmap.bitmap"] : []), ...(normalizedSources.length > 0 ? ["source_filter_bitmap.bitmap"] : [])]);

    const subqueries = [
      `SELECT 'entity_type' AS facet_name, f.facet_value, rb_cardinality(rb_and(f.entity_bitmap, ${typeScope})) AS scoped_count
       FROM ${schema}.facet_entity_bitmap f ${joins.join("\n")}
       WHERE f.facet_name = 'entity_type' AND f.facet_value <> '${CV_TERM_ENTITY_TYPE}' AND rb_cardinality(rb_and(f.entity_bitmap, ${typeScope})) > 0`,
      `SELECT 'source' AS facet_name, f.facet_value, rb_cardinality(rb_and(f.entity_bitmap, ${sourceScope})) AS scoped_count
       FROM ${schema}.facet_entity_bitmap f ${joins.join("\n")}
       WHERE f.facet_name = 'source' AND rb_cardinality(rb_and(f.entity_bitmap, ${sourceScope})) > 0`,
      `SELECT 'taxonomy_id' AS facet_name, f.facet_value, rb_cardinality(rb_and(f.entity_bitmap, ${taxonomyScope})) AS scoped_count
       FROM ${schema}.facet_entity_bitmap f ${joins.join("\n")}
       WHERE f.facet_name = 'taxonomy_id' AND rb_cardinality(rb_and(f.entity_bitmap, ${taxonomyScope})) > 0`,
    ];

    const facetLimitParam = pushParam(normalizedFacetLimit);
    const result = await client.query<{ facet_name: string; facet_value: string; scoped_count: string | number }>(
      `WITH ${ctes.join(",\n")},
       facet_counts AS MATERIALIZED (${subqueries.join("\nUNION ALL\n")}),
       ranked_facet_counts AS (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY facet_name ORDER BY scoped_count DESC, facet_value ASC) AS facet_rank
         FROM facet_counts
       )
       SELECT facet_name, facet_value, scoped_count
       FROM ranked_facet_counts
       WHERE facet_rank <= ${facetLimitParam}
       ORDER BY facet_name, scoped_count DESC`,
      params,
    );

    return result.rows.map((row) => ({
      facetName: row.facet_name,
      facetValue: row.facet_value,
      scopedCount: Number(row.scoped_count || 0),
    }));
  } finally {
    client.release();
  }
}

export async function rebuildAllBitmaps(): Promise<void> {
  throw new Error("Bitmap rebuilds are owned by omnipath_build/minimal, not the Svelte app");
}
