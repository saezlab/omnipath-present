import { getPool } from "$lib/server/db/client";
import type { Entity, EntityIdentifier } from "$lib/drizzle";
import { normalizeStringValues } from "$lib/entity-public-id";
import { parsePublicEntityIds } from "$lib/server/entity-public-id";
import {
  canonicalIdentifierTypeNameSql,
  entityTypeNameSql,
  relationCategoryEqualsSql,
} from "$lib/server/queries/sql-fragments";

export type EntityWithIdentifiers = Entity & { identifiers: EntityIdentifier[]; relationCount?: number };

const CV_TERM_ENTITY_TYPE = "Cv Term:OM:0012";
const SEARCH_SCHEMA = () => process.env.OMNIPATH_PG_SCHEMA || "public";

export type EntitySearchCursor = {
  relationCount: number;
  entityPk: string;
};

function normalizeIdValues(values: Array<string | number> | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => String(value).trim()).filter(Boolean)));
}

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
    entityPk: String(row.entity_id),
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
      SELECT ds.name AS source_value
      FROM ${schema}.entity_evidence_resolution eer
      JOIN ${schema}.entity_evidence ee
        ON ee.source_id = eer.source_id
       AND ee.entity_evidence_id = eer.entity_evidence_id
      JOIN ${schema}.data_source ds ON ds.source_id = ee.source_id
      WHERE eer.entity_id = ${entityAlias}.entity_id
      UNION
      SELECT ds.name AS source_value
      FROM ${schema}.relation r
      JOIN ${schema}.relation_evidence_relation rer ON rer.relation_id = r.relation_id
      JOIN ${schema}.relation_evidence re
        ON re.source_id = rer.source_id
       AND re.relation_evidence_id = rer.relation_evidence_id
      JOIN ${schema}.data_source ds ON ds.source_id = re.source_id
      WHERE r.subject_entity_id = ${entityAlias}.entity_id
         OR r.object_entity_id = ${entityAlias}.entity_id
    ) entity_sources
    WHERE source_value IS NOT NULL AND source_value <> ''
    ORDER BY source_value
  )`;
}

function entityTypeSql(schema: string, alias = "e"): string {
  return entityTypeNameSql(schema, alias);
}

function canonicalTypeSql(schema: string, alias = "e"): string {
  return canonicalIdentifierTypeNameSql(schema, alias);
}

function entityIdentifiersJsonSql(alias = "e"): string {
  return `CASE
    WHEN jsonb_typeof(${alias}.identifiers) = 'array' THEN ${alias}.identifiers
    WHEN jsonb_typeof(${alias}.identifiers) = 'object'
      AND jsonb_typeof(${alias}.identifiers -> 'evidence_identifiers') = 'array'
      THEN ${alias}.identifiers -> 'evidence_identifiers'
    ELSE '[]'::jsonb
  END`;
}

function entityBaseSelect(schema: string, alias = "e"): string {
  return `${alias}.entity_id, ${alias}.canonical_identifier AS id, ${canonicalTypeSql(schema, alias)} AS id_type, ${entityTypeSql(schema, alias)} AS entity_type, ${alias}.taxonomy_id, ARRAY[]::text[] AS sources`;
}

function ontologyTermEntityPredicate(schema: string, placeholder: string, entityAlias = "e"): string {
  return `EXISTS (
    SELECT 1
    FROM ${schema}.relation r
    JOIN ${schema}.ontology_terms terms ON terms.term_entity_id = r.object_entity_id
    WHERE ${relationCategoryEqualsSql(schema, "r", "association")}
      AND r.subject_entity_id = ${entityAlias}.entity_id
      AND terms.term_id = ANY(${placeholder}::text[])
  )`;
}

async function getIdentifiersForEntityPks(schema: string, entityPks: string[]): Promise<Map<string, EntityIdentifier[]>> {
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
         e.entity_id,
         NULL::uuid AS identifier_id,
         item.identifier_type,
         item.identifier
	       FROM ${schema}.entity e
	       CROSS JOIN LATERAL jsonb_to_recordset(${entityIdentifiersJsonSql("e")}) AS item(identifier text, identifier_type text)
       WHERE e.entity_id = ANY($1::uuid[])
         AND COALESCE(item.identifier, '') <> ''
       UNION
       SELECT DISTINCT
         terms.term_entity_id AS entity_id,
         NULL::uuid AS identifier_id,
         'Name:OM:0200' AS identifier_type,
         terms.label AS identifier
       FROM ${schema}.ontology_terms terms
       WHERE terms.term_entity_id = ANY($1::uuid[])
         AND terms.label IS NOT NULL
         AND terms.label <> ''
       ORDER BY entity_id, identifier_type, identifier`,
      [entityPks],
    );

    const map = new Map<string, EntityIdentifier[]>();
    for (const row of result.rows) {
      const entityPk = String(row.entity_id);
      const identifiers = map.get(entityPk) ?? [];
      identifiers.push({
        ...(row.identifier_id === null ? {} : { id: String(row.identifier_id) }),
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
      whereParts.push(`(${canonicalTypeSql(schema)} = $${params.length - 1} AND e.canonical_identifier = $${params.length})`);
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

export async function getEntitiesByPks(pks: Array<string | number>): Promise<EntityWithIdentifiers[]> {
  const normalized = normalizeIdValues(pks);
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
       WHERE e.entity_id = ANY($1::uuid[])
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
    entity_pks?: Array<string | number>;
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
  if (isUnfilteredEntitySearch(query, filters)) {
    return searchEntitiesByRelationCount({ schema, limit, cursor });
  }

  const client = await getPool().connect();

  try {
    const whereParts: string[] = [`${entityTypeSql(schema)} IS DISTINCT FROM '${CV_TERM_ENTITY_TYPE}'`];
    const params: unknown[] = [];
    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const filterCtes: string[] = [];
    const filterJoins: string[] = [];
    const filterBitmaps: string[] = [];
    const addFacetFilter = (cteName: string, facetName: string, values: string[]) => {
      if (values.length === 0) return;
      const param = pushParam(values);
      filterCtes.push(`${cteName} AS MATERIALIZED (
        SELECT COALESCE(rb_or_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_entity_bitmap
        WHERE facet_name = '${facetName}'
          AND facet_value = ANY(${param}::text[])
      )`);
      filterJoins.push(`CROSS JOIN ${cteName}`);
      filterBitmaps.push(`${cteName}.bitmap`);
    };
    const bitmapIntersection = (bitmaps: string[]) =>
      bitmaps.slice(1).reduce((expr, bitmap) => `rb_and(${expr}, ${bitmap})`, bitmaps[0]);

    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      const queryParam = pushParam(trimmedQuery.toLowerCase());
      whereParts.push(`(
        LOWER(e.canonical_identifier) = ${queryParam}
        OR EXISTS (
          SELECT 1
	          FROM jsonb_to_recordset(${entityIdentifiersJsonSql("e")}) AS item(identifier text)
          WHERE LOWER(item.identifier) = ${queryParam}
        )
      )`);
    }

    const entityPks = normalizeIdValues(filters.entity_pks);
    const annotationTerms = normalizeStringValues(filters.annotation_term_ids || []);
    if (entityPks.length > 0 && annotationTerms.length > 0) {
      const ePkParam = pushParam(entityPks.map(String));
      const termParam = pushParam(annotationTerms);
      whereParts.push(`(e.entity_id = ANY(${ePkParam}::uuid[]) OR ${ontologyTermEntityPredicate(schema, termParam)})`);
    } else if (entityPks.length > 0) {
      const ePkParam = pushParam(entityPks.map(String));
      whereParts.push(`e.entity_id = ANY(${ePkParam}::uuid[])`);
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
    addFacetFilter("entity_type_filter_bitmap", "entity_type", entityTypes);

    const taxonomyIds = normalizeStringValues(filters.ncbi_tax_id || []);
    addFacetFilter("taxonomy_filter_bitmap", "taxonomy_id", taxonomyIds);

    const sources = normalizeStringValues(filters.sources || []);
    addFacetFilter("source_filter_bitmap", "source", sources);

    if (filterBitmaps.length > 0) {
      whereParts.push(`rb_contains(${bitmapIntersection(filterBitmaps)}, entity_bitmap.bitmap_id)`);
    }

    const normalizedCursor = normalizeEntitySearchCursor(cursor);
    const pageParams = [...params];
    let pageCursorWhere = "";
    if (normalizedCursor) {
      const countParam = pushPageParam(pageParams, normalizedCursor.relationCount);
      const pkParam = pushPageParam(pageParams, normalizedCursor.entityPk);
      pageCursorWhere = `WHERE (m.relation_count < ${countParam} OR (m.relation_count = ${countParam} AND m.entity_id > ${pkParam}::uuid))`;
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
      `WITH ${filterCtes.length ? `${filterCtes.join(",\n")},` : ""}
       matched_entities AS MATERIALIZED (
         SELECT e.*
         FROM ${schema}.entity e
         ${filterBitmaps.length > 0 ? `JOIN ${schema}.entity_bitmap_id entity_bitmap ON entity_bitmap.entity_id = e.entity_id` : ""}
         ${filterJoins.join("\n")}
         WHERE ${whereParts.join(" AND ")}
       ),
       matched AS (
         SELECT me.*, COALESCE(rc.relation_count, 0)::bigint AS relation_count
         FROM matched_entities me
         LEFT JOIN ${schema}.entity_relation_counts rc ON rc.entity_id = me.entity_id
       ),
       page_entities AS MATERIALIZED (
         SELECT m.*
         FROM matched m
         ${pageCursorWhere}
         ORDER BY m.relation_count DESC, m.entity_id ASC
         LIMIT ${limitParam}
       )
	       SELECT
	         page.entity_id,
	         page.canonical_identifier AS id,
	         ${canonicalTypeSql(schema, "page")} AS id_type,
	         ${entityTypeSql(schema, "page")} AS entity_type,
	         page.taxonomy_id,
	         ${entitySourcesSql(schema, "page")} AS sources,
	         page.relation_count
	       FROM page_entities page
       ORDER BY page.relation_count DESC, page.entity_id ASC`,
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

function isUnfilteredEntitySearch(
  query: string,
  filters: {
    entity_pks?: Array<string | number>;
    annotation_term_ids?: string[];
    entity_types?: string[];
    sources?: string[];
    ncbi_tax_id?: string[];
    ontology_terms?: string[];
  },
): boolean {
  if (query.trim()) return false;
  if (normalizeIdValues(filters.entity_pks).length > 0) return false;
  if (normalizeStringValues(filters.annotation_term_ids || []).length > 0) return false;
  if (normalizeStringValues(filters.entity_types || []).length > 0) return false;
  if (normalizeStringValues(filters.sources || []).length > 0) return false;
  if (normalizeStringValues(filters.ncbi_tax_id || []).length > 0) return false;
  if (normalizeStringValues(filters.ontology_terms || []).length > 0) return false;
  return true;
}

async function searchEntitiesByRelationCount({
  schema,
  limit,
  cursor,
}: {
  schema: string;
  limit: number;
  cursor?: EntitySearchCursor | null;
}): Promise<{ entities: EntityWithIdentifiers[]; nextCursor: EntitySearchCursor | null }> {
  const normalizedCursor = normalizeEntitySearchCursor(cursor);
  const params: unknown[] = [];
  let cursorWhere = "";
  if (normalizedCursor) {
    params.push(normalizedCursor.relationCount, normalizedCursor.entityPk);
    cursorWhere = "AND (rc.relation_count < $1::bigint OR (rc.relation_count = $1::bigint AND rc.entity_id > $2::uuid))";
  }
  params.push(limit);
  const limitParam = `$${params.length}`;

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
      `SELECT
         e.entity_id,
         e.canonical_identifier AS id,
         it.name AS id_type,
         et.name AS entity_type,
         e.taxonomy_id,
         ARRAY[]::text[] AS sources,
         rc.relation_count
       FROM ${schema}.entity_relation_counts rc
       JOIN ${schema}.entity e ON e.entity_id = rc.entity_id
       JOIN ${schema}.vocab_entity_type et ON et.entity_type_id = e.entity_type_id
       LEFT JOIN ${schema}.vocab_identifier_type it ON it.identifier_type_id = e.canonical_identifier_type_id
       WHERE et.name IS DISTINCT FROM '${CV_TERM_ENTITY_TYPE}'
         ${cursorWhere}
       ORDER BY rc.relation_count DESC, rc.entity_id ASC
       LIMIT ${limitParam}`,
      params,
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
  const entityPk = String(cursor.entityPk || "").trim();
  if (!Number.isFinite(relationCount) || !entityPk) {
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
	           SELECT DISTINCT ${entityTypeSql(schema)} AS value
	           FROM ${schema}.entity e
	           WHERE ${entityTypeSql(schema)} IS NOT NULL
	             AND ${entityTypeSql(schema)} <> '${CV_TERM_ENTITY_TYPE}'
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
  entityPks?: Array<string | number>;
  annotationTermIds?: string[];
  entityTypes?: string[];
  sources?: string[];
  ncbi_tax_id?: string[];
  query?: string;
  facetLimit?: number;
}): Promise<EntityFacetCount[]> {
  const normalizedEntityPks = normalizeIdValues(entityPks);
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const normalizedEntityTypes = Array.from(new Set(entityTypes.map((v) => v.trim()).filter(Boolean)));
  const normalizedSources = Array.from(new Set(sources.map((v) => v.trim()).filter(Boolean)));
  const normalizedTaxonomyIds = Array.from(new Set(ncbi_tax_id.map((v) => v.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const normalizedFacetLimit = Math.max(1, Math.min(Math.floor(facetLimit), 100));

  const client = await getPool().connect();
  try {
    const schema = SEARCH_SCHEMA();
    if (
      normalizedEntityTypes.length > 0
      && normalizedEntityPks.length === 0
      && normalizedTermIds.length === 0
      && normalizedSources.length === 0
      && normalizedTaxonomyIds.length === 0
      && !trimmedQuery
    ) {
      const result = await client.query<{ facet_name: string; facet_value: string; scoped_count: string | number }>(
        `WITH type_filter_bitmap AS MATERIALIZED (
           SELECT COALESCE(rb_or_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
           FROM ${schema}.facet_entity_bitmap
           WHERE facet_name = 'entity_type'
             AND facet_value = ANY($1::text[])
         ),
         facet_counts AS MATERIALIZED (
           SELECT facet_name, facet_value, scoped_count
           FROM (
             SELECT 'entity_type' AS facet_name,
                    f.facet_value,
                    CASE
                      WHEN f.facet_value = ANY($1::text[])
                        THEN rb_cardinality(f.entity_bitmap)
                      ELSE 0
                    END AS scoped_count
             FROM ${schema}.facet_entity_bitmap f
             WHERE f.facet_name = 'entity_type'
               AND f.facet_value <> '${CV_TERM_ENTITY_TYPE}'
           ) entity_type_facets
           WHERE scoped_count > 0
           UNION ALL
           SELECT facet_name, facet_value, scoped_count
           FROM (
             SELECT 'source' AS facet_name,
                    f.facet_value,
                    rb_cardinality(rb_and(f.entity_bitmap, type_filter_bitmap.bitmap)) AS scoped_count
             FROM ${schema}.facet_entity_bitmap f
             CROSS JOIN type_filter_bitmap
             WHERE f.facet_name = 'source'
           ) source_facets
           WHERE scoped_count > 0
           UNION ALL
           SELECT facet_name, facet_value, scoped_count
           FROM (
             SELECT 'taxonomy_id' AS facet_name,
                    f.facet_value,
                    rb_cardinality(rb_and(f.entity_bitmap, type_filter_bitmap.bitmap)) AS scoped_count
             FROM ${schema}.facet_entity_bitmap f
             CROSS JOIN type_filter_bitmap
             WHERE f.facet_name = 'taxonomy_id'
           ) taxonomy_facets
           WHERE scoped_count > 0
         ),
         ranked_facet_counts AS (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY facet_name ORDER BY scoped_count DESC, facet_value ASC) AS facet_rank
           FROM facet_counts
         )
         SELECT facet_name, facet_value, scoped_count
         FROM ranked_facet_counts
         WHERE facet_rank <= $2::integer
         ORDER BY facet_name, scoped_count DESC`,
        [normalizedEntityTypes, normalizedFacetLimit],
      );
      return result.rows.map((row) => ({
        facetName: row.facet_name,
        facetValue: row.facet_value,
        scopedCount: Number(row.scoped_count || 0),
      }));
    }

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
      const ePkParam = pushParam(normalizedEntityPks);
      scopeParts.push(`SELECT COALESCE(rb_build_agg(bitmap.bitmap_id), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.entity_bitmap_id bitmap
        WHERE bitmap.entity_id = ANY(${ePkParam}::uuid[])`);
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
        SELECT COALESCE(rb_build_agg(bitmap.bitmap_id), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.entity e
        JOIN ${schema}.entity_bitmap_id bitmap ON bitmap.entity_id = e.entity_id
        WHERE LOWER(e.canonical_identifier) = ${queryParam}
           OR e.entity_id IN (
             SELECT e.entity_id
	             FROM jsonb_to_recordset(${entityIdentifiersJsonSql("e")}) AS item(identifier text)
             WHERE LOWER(item.identifier) = ${queryParam}
           )
      )`);
    }

    if (normalizedEntityTypes.length > 0) {
      const typeParam = pushParam(normalizedEntityTypes);
      ctes.push(`type_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_or_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_entity_bitmap
        WHERE facet_name = 'entity_type' AND facet_value = ANY(${typeParam}::text[])
      )`);
    }

    if (normalizedSources.length > 0) {
      const sourceParam = pushParam(normalizedSources);
      ctes.push(`source_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_or_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_entity_bitmap
        WHERE facet_name = 'source' AND facet_value = ANY(${sourceParam}::text[])
      )`);
    }

    if (normalizedTaxonomyIds.length > 0) {
      const taxonomyParam = pushParam(normalizedTaxonomyIds);
      ctes.push(`taxonomy_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_or_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
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

    const facetCountSubquery = (
      facetName: string,
      scope: string,
      extraWhere = "",
    ) => `SELECT facet_name, facet_value, scoped_count
       FROM (
         SELECT '${facetName}' AS facet_name,
                f.facet_value,
                rb_cardinality(rb_and(f.entity_bitmap, ${scope})) AS scoped_count
         FROM ${schema}.facet_entity_bitmap f ${joins.join("\n")}
         WHERE f.facet_name = '${facetName}' ${extraWhere}
       ) scoped_${facetName}_facets
       WHERE scoped_count > 0`;

    const subqueries = [
      facetCountSubquery("entity_type", typeScope, `AND f.facet_value <> '${CV_TERM_ENTITY_TYPE}'`),
      facetCountSubquery("source", sourceScope),
      facetCountSubquery("taxonomy_id", taxonomyScope),
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
