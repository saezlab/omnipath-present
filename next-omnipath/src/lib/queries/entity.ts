"use server";

import { and, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, getPool } from "@/lib/db/client";
import { entity, entityIdentifier, type Entity, type EntityIdentifier } from "@next-omnipath/drizzle";
import { normalizeEntityTypeFilterValue, normalizedEntityTypeDrizzleSql } from "@/lib/entity-filter";
import { normalizeStringValues, publicEntityIdWhere } from "@/lib/entity-public-id";

export type EntityWithIdentifiers = Entity & { identifiers: EntityIdentifier[] };

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
} = {}): Promise<{ entities: Entity[]; total: number; nextCursor: number | null }> {
  const db = getDb();
  const conditions: SQL[] = [];

  if (filters.entity_ids?.length) {
    const ids = filters.entity_ids.map(String);
    conditions.push(sql`(e.canonical_identifier_type || '|' || e.canonical_identifier) = ANY(${ids})`);
  }

  if (filters.entity_types?.length) {
    const normalizedTypes = filters.entity_types.map(normalizeEntityTypeFilterValue).filter(Boolean);
    if (normalizedTypes.length) {
      conditions.push(sql`${normalizedEntityTypeDrizzleSql(entity.entityType)} = ANY(${normalizedTypes})`);
    }
  }

  if (filters.sources?.length) {
    const sources = normalizeStringValues(filters.sources);
    if (sources.length) {
      conditions.push(sql`${entity.sources} && ${sources}`);
    }
  }

  if (filters.ncbi_tax_id?.length) {
    const taxonomyIds = normalizeStringValues(filters.ncbi_tax_id);
    if (taxonomyIds.length) {
      conditions.push(inArray(entity.taxonomyId, taxonomyIds));
    }
  }

  if (filters.ontology_terms?.length) {
    const terms = normalizeStringValues(filters.ontology_terms);
    if (terms.length) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM entity_relation er
        JOIN entity eo ON eo.entity_pk = er.object_entity_pk
        WHERE er.subject_entity_pk = ${entity.entityPk}
          AND er.relation_category = 'annotation'
          AND eo.canonical_identifier = ANY(${terms})
      )`);
    }
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    const pattern = `%${trimmedQuery}%`;
    conditions.push(sql`(
      ${entity.canonicalIdentifier} ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM entity_identifier ei
        WHERE ei.entity_pk = ${entity.entityPk}
          AND ei.identifier ILIKE ${pattern}
      )
      OR EXISTS (
        SELECT 1 FROM entity_relation er
        JOIN entity eo ON eo.entity_pk = er.object_entity_pk
        LEFT JOIN ontology_term ot ON ot.term_id = eo.canonical_identifier
        WHERE er.subject_entity_pk = ${entity.entityPk}
          AND er.relation_category = 'annotation'
          AND (
            eo.canonical_identifier ILIKE ${pattern}
            OR COALESCE(ot.label, '') ILIKE ${pattern}
            OR COALESCE(ot.definition, '') ILIKE ${pattern}
          )
      )
    )`);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(entity)
    .where(where);
  const total = Number(countResult[0]?.count || 0);

  const pageConditions = [...conditions];
  if (typeof cursor === "number" && Number.isFinite(cursor)) {
    pageConditions.push(gt(entity.entityPk, cursor));
  }
  const pageWhere = pageConditions.length ? and(...pageConditions) : undefined;

  const rows = await db
    .select()
    .from(entity)
    .where(pageWhere)
    .orderBy(entity.entityPk)
    .limit(limit);

  const nextCursor = rows.length === limit ? rows[rows.length - 1].entityPk : null;

  return { entities: rows, total, nextCursor };
}

export async function getEntityFilterOptions(): Promise<{ entity_types: string[]; sources: string[] }> {
  const client = await getPool().connect();
  try {
    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const [typeResult, sourceResult] = await Promise.all([
      client.query(
        `SELECT DISTINCT LOWER(split_part(entity_type, ':', 3)) || ':' || split_part(entity_type, ':', 1) || ':' || split_part(entity_type, ':', 2) AS value
         FROM ${SEARCH_SCHEMA}.entity
         WHERE entity_type IS NOT NULL
         ORDER BY 1`,
      ),
      client.query(
        `SELECT DISTINCT source.value AS value
         FROM ${SEARCH_SCHEMA}.entity e
         CROSS JOIN LATERAL unnest(e.sources) AS source(value)
         WHERE source.value <> ''
         ORDER BY source.value`,
      ),
    ]);

    return {
      entity_types: typeResult.rows.map((row) => String(row.value)).filter(Boolean),
      sources: sourceResult.rows.map((row) => String(row.value)).filter(Boolean),
    };
  } finally {
    client.release();
  }
}
