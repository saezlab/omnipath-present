import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, getPool } from "$lib/server/db/client";
import { entity, entityIdentifier, type Entity, type EntityIdentifier } from "$lib/drizzle";
import { entityTypeLabelSqlExpression, normalizeEntityTypeFilterValue, normalizedEntityTypeSqlExpression, taxonomyScopedEntityTypeLabels } from "$lib/entity-filter";
import { normalizeStringValues } from "$lib/entity-public-id";
import { publicEntityIdWhere } from "$lib/server/entity-public-id";

export type EntityWithIdentifiers = Entity & { identifiers: EntityIdentifier[] };

function toEntityRow(row: {
  entity_pk: string | number;
  canonical_identifier: string;
  canonical_identifier_type: string;
  entity_type: string | null;
  taxonomy_id: string | null;
  entity_attributes: Entity["entityAttributes"];
  sources: string[];
}): Entity {
  return {
    entityPk: Number(row.entity_pk),
    canonicalIdentifier: row.canonical_identifier,
    canonicalIdentifierType: row.canonical_identifier_type,
    entityType: row.entity_type,
    taxonomyId: row.taxonomy_id,
    entityAttributes: row.entity_attributes,
    sources: row.sources,
  };
}

function aggregateEntityIdentifiers(
  rows: Array<{ entity: Entity; entity_identifier: EntityIdentifier | null }>,
): EntityWithIdentifiers[] {
  const map = new Map<number, EntityWithIdentifiers>();
  for (const row of rows) {
    const existing = map.get(row.entity.entityPk);
    if (!existing) {
      map.set(row.entity.entityPk, {
        ...row.entity,
        identifiers: row.entity_identifier ? [row.entity_identifier] : [],
      });
    } else if (row.entity_identifier) {
      existing.identifiers.push(row.entity_identifier);
    }
  }
  return Array.from(map.values());
}

export async function getEntityByPublicId(publicId: string): Promise<EntityWithIdentifiers | null> {
  const db = getDb();
  const where = publicEntityIdWhere([publicId.trim()]);
  if (!where) return null;
  const rows = await db
    .select()
    .from(entity)
    .leftJoin(entityIdentifier, eq(entityIdentifier.entityPk, entity.entityPk))
    .where(where)
    .limit(1);
  const results = aggregateEntityIdentifiers(rows as unknown as Array<{ entity: Entity; entity_identifier: EntityIdentifier | null }>);
  return results[0] ?? null;
}

export async function getEntitiesByPublicIds(publicIds: string[]): Promise<EntityWithIdentifiers[]> {
  const where = publicEntityIdWhere(publicIds.map((id) => id.trim()).filter(Boolean));
  if (!where) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(entity)
    .leftJoin(entityIdentifier, eq(entityIdentifier.entityPk, entity.entityPk))
    .where(where);
  return aggregateEntityIdentifiers(rows as unknown as Array<{ entity: Entity; entity_identifier: EntityIdentifier | null }>);
}

export async function getEntitiesByPks(pks: number[]): Promise<EntityWithIdentifiers[]> {
  const normalized = Array.from(new Set(pks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(entity)
    .leftJoin(entityIdentifier, eq(entityIdentifier.entityPk, entity.entityPk))
    .where(inArray(entity.entityPk, normalized));
  return aggregateEntityIdentifiers(rows as unknown as Array<{ entity: Entity; entity_identifier: EntityIdentifier | null }>);
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
  cursor?: number;
} = {}): Promise<{ entities: EntityWithIdentifiers[]; nextCursor: number | null }> {
  const client = await getPool().connect();
  const db = getDb();

  try {
    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const whereParts: string[] = [];
    const params: unknown[] = [];
    const trimmedQuery = query.trim();

    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (trimmedQuery) {
      const queryParam = pushParam(trimmedQuery);
      whereParts.push(`EXISTS (
        SELECT 1
        FROM ${SEARCH_SCHEMA}.entity_identifier ei
        WHERE ei.entity_pk = e.entity_pk
          AND ei.identifier = ${queryParam}
      )`);
    }

    const hasEntityPks = filters.entity_pks?.length && filters.entity_pks.filter(Number.isFinite).length > 0;
    const hasAnnotationTermIds = filters.annotation_term_ids?.length && normalizeStringValues(filters.annotation_term_ids).length > 0;

    if (hasEntityPks && hasAnnotationTermIds) {
      const ePks = filters.entity_pks!.filter(Number.isFinite).map(String);
      const eidParam = pushParam(ePks);
      const terms = normalizeStringValues(filters.annotation_term_ids!);
      const termParam = pushParam(terms);
      whereParts.push(`(
        e.entity_pk = ANY(${eidParam}::bigint[])
        OR EXISTS (
          SELECT 1
          FROM ${SEARCH_SCHEMA}.entity_annotation ea
          WHERE ea.entity_pk = e.entity_pk
            AND ea.term_entity_pk IN (
              SELECT ent.entity_pk FROM ${SEARCH_SCHEMA}.entity ent WHERE ent.canonical_identifier = ANY(${termParam}::text[])
            )
        )
      )`);
    } else if (hasEntityPks) {
      const ePks = filters.entity_pks!.filter(Number.isFinite).map(String);
      const param = pushParam(ePks);
      whereParts.push(`e.entity_pk = ANY(${param}::bigint[])`);
    } else if (hasAnnotationTermIds) {
      const terms = normalizeStringValues(filters.annotation_term_ids!);
      const param = pushParam(terms);
      whereParts.push(`EXISTS (
        SELECT 1
        FROM ${SEARCH_SCHEMA}.entity_annotation ea
        WHERE ea.entity_pk = e.entity_pk
          AND ea.term_entity_pk IN (
            SELECT ent.entity_pk FROM ${SEARCH_SCHEMA}.entity ent WHERE ent.canonical_identifier = ANY(${param}::text[])
          )
      )`);
    }

    if (filters.entity_types?.length) {
      const normalizedTypes = filters.entity_types.map(normalizeEntityTypeFilterValue).filter(Boolean);
      if (normalizedTypes.length) {
        const param = pushParam(normalizedTypes);
        whereParts.push(`${normalizedEntityTypeSqlExpression("e.entity_type")} = ANY(${param}::text[])`);
      }
    }

    if (filters.sources?.length) {
      const sources = normalizeStringValues(filters.sources);
      if (sources.length) {
        const param = pushParam(sources);
        whereParts.push(`e.sources && ${param}::text[]`);
      }
    }

    if (filters.ncbi_tax_id?.length) {
      const taxonomyIds = normalizeStringValues(filters.ncbi_tax_id);
      if (taxonomyIds.length) {
        const taxonomyParam = pushParam(taxonomyIds);
        if (filters.entity_types?.length) {
          const scopedTypeLabelsParam = pushParam([...taxonomyScopedEntityTypeLabels]);
          whereParts.push(`(
            e.taxonomy_id = ANY(${taxonomyParam}::text[])
            OR ${entityTypeLabelSqlExpression("e.entity_type")} <> ALL(${scopedTypeLabelsParam}::text[])
          )`);
        } else {
          whereParts.push(`e.taxonomy_id = ANY(${taxonomyParam}::text[])`);
        }
      }
    }

    if (filters.ontology_terms?.length) {
      const terms = normalizeStringValues(filters.ontology_terms);
      if (terms.length) {
        const param = pushParam(terms);
        whereParts.push(`EXISTS (
          SELECT 1
          FROM ${SEARCH_SCHEMA}.entity_annotation ea
          WHERE ea.entity_pk = e.entity_pk
            AND ea.term_entity_pk IN (
              SELECT ent.entity_pk FROM ${SEARCH_SCHEMA}.entity ent WHERE ent.canonical_identifier = ANY(${param}::text[])
            )
        )`);
      }
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const baseFrom = `FROM ${SEARCH_SCHEMA}.entity e`;

    const pageParams = [...params];
    if (typeof cursor === "number" && Number.isFinite(cursor)) {
      pageParams.push(cursor);
    }
    pageParams.push(limit);
    const limitParam = `$${pageParams.length}`;
    const pageCursorWhere = typeof cursor === "number" && Number.isFinite(cursor)
      ? ` AND e.entity_pk > $${pageParams.length - 1}`
      : "";

    const rowsResult = await client.query<{
      entity_pk: string | number;
      canonical_identifier: string;
      canonical_identifier_type: string;
      entity_type: string | null;
      taxonomy_id: string | null;
      entity_attributes: Entity["entityAttributes"];
      sources: string[];
    }>(
      `SELECT e.*
       FROM ${SEARCH_SCHEMA}.entity e
       ${whereClause}${pageCursorWhere}
       ORDER BY e.entity_pk
       LIMIT ${limitParam}`,
      pageParams,
    );

    const rows = rowsResult.rows.map(toEntityRow);
    const nextCursor = rows.length === limit ? rows[rows.length - 1].entityPk : null;

    if (rows.length === 0) {
      return { entities: [], nextCursor };
    }

    const entityPks = rows.map((row) => row.entityPk);
    const identifierRows = await db
      .select()
      .from(entityIdentifier)
      .where(inArray(entityIdentifier.entityPk, entityPks));

    const identifiersByEntityPk = new Map<number, EntityIdentifier[]>();
    for (const identifier of identifierRows) {
      const existing = identifiersByEntityPk.get(identifier.entityPk);
      if (existing) {
        existing.push(identifier);
      } else {
        identifiersByEntityPk.set(identifier.entityPk, [identifier]);
      }
    }

    return {
      entities: rows.map((row) => ({
        ...row,
        identifiers: identifiersByEntityPk.get(row.entityPk) ?? [],
      })),
      nextCursor,
    };
  } finally {
    client.release();
  }
}

let entityFilterOptionsCache:
  | { value: { entity_types: string[]; sources: string[] }; expiresAt: number }
  | null = null;
let entityFilterOptionsInFlight: Promise<{ entity_types: string[]; sources: string[] }> | null = null;

export async function getEntityFilterOptions(): Promise<{ entity_types: string[]; sources: string[] }> {
  const now = Date.now();
  if (entityFilterOptionsCache && entityFilterOptionsCache.expiresAt > now) {
    return entityFilterOptionsCache.value;
  }
  if (entityFilterOptionsInFlight) {
    return entityFilterOptionsInFlight;
  }

  entityFilterOptionsInFlight = (async () => {
    const client = await getPool().connect();
    try {
      const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
      const [typeResult, sourceResult] = await Promise.all([
        client.query<{ values: string[] | null }>(
          `SELECT array_agg(value ORDER BY value) AS values
           FROM (
             SELECT DISTINCT LOWER(split_part(entity_type, ':', 3)) || ':' || split_part(entity_type, ':', 1) || ':' || split_part(entity_type, ':', 2) AS value
             FROM ${SEARCH_SCHEMA}.entity
             WHERE entity_type IS NOT NULL
           ) t`,
        ),
        client.query<{ values: string[] | null }>(
          `SELECT array_agg(value ORDER BY value) AS values
           FROM (
             SELECT DISTINCT source.value AS value
             FROM ${SEARCH_SCHEMA}.entity e
             CROSS JOIN LATERAL unnest(e.sources) AS source(value)
             WHERE source.value <> ''
           ) t`,
        ),
      ]);

      const value = {
        entity_types: typeResult.rows[0]?.values?.filter(Boolean) ?? [],
        sources: sourceResult.rows[0]?.values?.filter(Boolean) ?? [],
      };

      entityFilterOptionsCache = {
        value,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };

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
  query = "",
}: {
  entityPks?: number[];
  annotationTermIds?: string[];
  entityTypes?: string[];
  sources?: string[];
  query?: string;
}): Promise<EntityFacetCount[]> {
  const normalizedEntityPks = Array.from(new Set(entityPks.filter(Number.isFinite)));
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const normalizedEntityTypes = Array.from(new Set(entityTypes.map((v) => v.trim()).filter(Boolean)));
  const normalizedSources = Array.from(new Set(sources.map((v) => v.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();

  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = [];

    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const ctes: string[] = [];

    // 1. Base scope from selection (entity PKs + annotation terms).
    //    When there is no selection we use the union of all entity_type bitmaps
    //    so that the scope acts as "all entities" (identity for AND).
    const scopeParts: string[] = [];
    if (normalizedTermIds.length > 0) {
      const termParam = pushParam(normalizedTermIds);
      scopeParts.push(`SELECT b.entity_bitmap AS bitmap
        FROM ${S}.entity e
        JOIN ${S}.annotation_term_entity_bitmap b ON b.term_entity_pk = e.entity_pk
        WHERE e.canonical_identifier = ANY(${termParam}::text[])`);
    }
    if (normalizedEntityPks.length > 0) {
      const maxPk = Math.max(...normalizedEntityPks);
      if (maxPk > 2147483647) {
        throw new Error("Entity PK exceeds 32-bit range; bitmap path requires ordinal mapping");
      }
      const ePkParam = pushParam(normalizedEntityPks);
      scopeParts.push(`SELECT rb_build(${ePkParam}::integer[]) AS bitmap`);
    }

    if (scopeParts.length > 0) {
      ctes.push(`scope_base AS MATERIALIZED (
        SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM (
          ${scopeParts.join("\n          UNION ALL\n          ")}
        ) scope_parts
      )`);
    } else {
      ctes.push(`scope_base AS MATERIALIZED (
        SELECT rb_or_agg(entity_bitmap) AS bitmap
        FROM ${S}.facet_entity_bitmap
        WHERE facet_name = 'entity_type'
      )`);
    }

    // 2. Query bitmap: entities matching the text query
    if (trimmedQuery) {
      const queryParam = pushParam(trimmedQuery);
      ctes.push(`query_bitmap AS MATERIALIZED (
        SELECT rb_build_agg(entity_pk::integer) AS bitmap
        FROM ${S}.entity
        WHERE canonical_identifier = ${queryParam}
           OR entity_pk IN (
             SELECT entity_pk FROM ${S}.entity_identifier WHERE identifier = ${queryParam}
           )
      )`);
    }

    // 3. Filter bitmaps from currently active filters
    if (normalizedEntityTypes.length > 0) {
      const typeParam = pushParam(normalizedEntityTypes);
      ctes.push(`type_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${S}.facet_entity_bitmap
        WHERE facet_name = 'entity_type' AND facet_value = ANY(${typeParam}::text[])
      )`);
    }

    if (normalizedSources.length > 0) {
      const sourceParam = pushParam(normalizedSources);
      ctes.push(`source_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${S}.facet_entity_bitmap
        WHERE facet_name = 'source' AND facet_value = ANY(${sourceParam}::text[])
      )`);
    }

    // 4. For each facet, compute counts with all OTHER filters applied.
    const scopeAnd = (extraFilter: string | null): string => {
      const parts = ['scope_base.bitmap'];
      if (trimmedQuery) parts.push('query_bitmap.bitmap');
      if (extraFilter) parts.push(extraFilter);
      if (parts.length === 1) return parts[0];
      return `rb_and(${parts.join(', ')})`;
    };

    const subqueries: string[] = [];

    const joins: string[] = ['CROSS JOIN scope_base'];
    if (trimmedQuery) joins.push('CROSS JOIN query_bitmap');
    if (normalizedEntityTypes.length > 0) joins.push('CROSS JOIN type_filter_bitmap');
    if (normalizedSources.length > 0) joins.push('CROSS JOIN source_filter_bitmap');

    // entity_type counts: scope_base AND query_bitmap AND source_filter (excluding type_filter)
    subqueries.push(`
      SELECT
        'entity_type' AS facet_name,
        f.facet_value,
        rb_cardinality(rb_and(f.entity_bitmap, ${scopeAnd(normalizedSources.length > 0 ? 'source_filter_bitmap.bitmap' : null)})) AS scoped_count
      FROM ${S}.facet_entity_bitmap f
      ${joins.join('\n      ')}
      WHERE f.facet_name = 'entity_type'
        AND rb_cardinality(rb_and(f.entity_bitmap, ${scopeAnd(normalizedSources.length > 0 ? 'source_filter_bitmap.bitmap' : null)})) > 0
    `);

    // source counts: scope_base AND query_bitmap AND type_filter (excluding source_filter)
    subqueries.push(`
      SELECT
        'source' AS facet_name,
        f.facet_value,
        rb_cardinality(rb_and(f.entity_bitmap, ${scopeAnd(normalizedEntityTypes.length > 0 ? 'type_filter_bitmap.bitmap' : null)})) AS scoped_count
      FROM ${S}.facet_entity_bitmap f
      ${joins.join('\n      ')}
      WHERE f.facet_name = 'source'
        AND rb_cardinality(rb_and(f.entity_bitmap, ${scopeAnd(normalizedEntityTypes.length > 0 ? 'type_filter_bitmap.bitmap' : null)})) > 0
    `);

    const result = await client.query<{
      facet_name: string;
      facet_value: string;
      scoped_count: string | number;
    }>(
      `WITH ${ctes.join(",\n")}
       ${subqueries.join("\nUNION ALL\n")}
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

/** Rebuild all bitmap tables from current database snapshots.
 *  Call this immediately after REFRESH MATERIALIZED VIEW entity_annotation.
 */
export async function rebuildAllBitmaps(): Promise<void> {
  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    await client.query(`CALL ${S}.rebuild_all_bitmaps()`);
  } finally {
    client.release();
  }
}
