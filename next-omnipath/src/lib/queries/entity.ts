"use server";

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, getPool } from "@/lib/db/client";
import { entity, entityIdentifier, type Entity, type EntityIdentifier } from "@next-omnipath/drizzle";
import { entityTypeLabelSqlExpression, normalizeEntityTypeFilterValue, normalizedEntityTypeSqlExpression, taxonomyScopedEntityTypeLabels } from "@/lib/entity-filter";
import { normalizeStringValues, publicEntityIdWhere } from "@/lib/entity-public-id";

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
  const results = aggregateEntityIdentifiers(rows);
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
  return aggregateEntityIdentifiers(rows);
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
  return aggregateEntityIdentifiers(rows);
}

export async function searchEntities({
  query = "",
  limit = 20,
  cursor,
  filters = {},
}: {
  query?: string;
  filters?: {
    entity_ids?: Array<string | number>;
    entity_types?: string[];
    sources?: string[];
    ncbi_tax_id?: string[];
    ontology_terms?: string[];
  };
  limit?: number;
  cursor?: number;
} = {}): Promise<{ entities: Entity[]; nextCursor: number | null }> {
  const client = await getPool().connect();

  try {
    const whereParts: string[] = [];
    const params: unknown[] = [];
    const trimmedQuery = query.trim();

    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (trimmedQuery) {
      const queryParam = pushParam(trimmedQuery);
      whereParts.push(`ei.identifier = ${queryParam}`);
    }

    if (filters.entity_ids?.length) {
      const ids = filters.entity_ids.map(String).filter(Boolean);
      if (ids.length) {
        const param = pushParam(ids);
        whereParts.push(`(e.canonical_identifier_type || '|' || e.canonical_identifier) = ANY(${param}::text[])`);
      }
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
          FROM entity_relation er
          JOIN entity eo ON eo.entity_pk = er.object_entity_pk
          WHERE er.subject_entity_pk = e.entity_pk
            AND er.relation_category = 'annotation'
            AND eo.canonical_identifier = ANY(${param}::text[])
        )`);
      }
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const baseFrom = trimmedQuery
      ? `FROM entity_identifier ei JOIN entity e ON e.entity_pk = ei.entity_pk`
      : `FROM entity e`;

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
       ${baseFrom}
       ${whereClause}${pageCursorWhere}
       ORDER BY e.entity_pk
       LIMIT ${limitParam}`,
      pageParams,
    );

    const rows = rowsResult.rows.map(toEntityRow);
    const nextCursor = rows.length === limit ? rows[rows.length - 1].entityPk : null;

    return { entities: rows, nextCursor };
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
