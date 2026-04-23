"use server";

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, getPool } from "@/lib/db/client";
import { entity, entityRelation, type Entity, type EntityRelation } from "@next-omnipath/drizzle";
import { toPublicEntityId } from "@/lib/entity-public-id";

export type RelationWithEntities = EntityRelation & {
  subjectEntity: Entity;
  objectEntity: Entity;
};

export async function getRelationByPk(pk: number): Promise<RelationWithEntities | null> {
  const db = getDb();
  const subjectEntity = alias(entity, "subject_entity");
  const objectEntity = alias(entity, "object_entity");

  const rows = await db
    .select()
    .from(entityRelation)
    .innerJoin(subjectEntity, eq(subjectEntity.entityPk, entityRelation.subjectEntityPk))
    .innerJoin(objectEntity, eq(objectEntity.entityPk, entityRelation.objectEntityPk))
    .where(eq(entityRelation.relationPk, pk))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row.entity_relation,
    subjectEntity: row.subject_entity,
    objectEntity: row.object_entity,
  };
}

export async function getRelationsByPks(pks: number[]): Promise<EntityRelation[]> {
  const normalized = Array.from(new Set(pks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];
  const db = getDb();
  return db.select().from(entityRelation).where(inArray(entityRelation.relationPk, normalized));
}

export interface RelationFilters {
  relationCategories?: string[];
  predicates?: string[];
  subjectEntityPks?: number[];
  objectEntityPks?: number[];
  entityPks?: number[];
  sources?: string[];
}

export async function searchRelations({
  filters = {},
  limit = 20,
  offset = 0,
}: {
  filters?: RelationFilters;
  limit?: number;
  offset?: number;
} = {}): Promise<{ relations: EntityRelation[]; total: number }> {
  const db = getDb();
  const conditions: SQL[] = [];

  if (filters.relationCategories?.length) {
    conditions.push(inArray(entityRelation.relationCategory, filters.relationCategories));
  }

  if (filters.predicates?.length) {
    conditions.push(inArray(entityRelation.predicate, filters.predicates));
  }

  if (filters.subjectEntityPks?.length) {
    conditions.push(inArray(entityRelation.subjectEntityPk, filters.subjectEntityPks));
  }

  if (filters.objectEntityPks?.length) {
    conditions.push(inArray(entityRelation.objectEntityPk, filters.objectEntityPks));
  }

  if (filters.entityPks?.length) {
    conditions.push(
      sql`(${entityRelation.subjectEntityPk} = ANY(${filters.entityPks}) OR ${entityRelation.objectEntityPk} = ANY(${filters.entityPks}))`,
    );
  }

  if (filters.sources?.length) {
    conditions.push(sql`${entityRelation.sources} && ${filters.sources}`);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(entityRelation)
    .where(where);
  const total = Number(countResult[0]?.count || 0);

  const relations = await db
    .select()
    .from(entityRelation)
    .where(where)
    .orderBy(entityRelation.relationPk)
    .limit(limit)
    .offset(offset);

  return { relations, total };
}

export async function countRelations(
  filters: RelationFilters = {},
): Promise<number> {
  const { total } = await searchRelations({ filters, limit: 1, offset: 0 });
  return total;
}

export async function getRelationFilterOptions(): Promise<{
  predicatesByCategory: Record<string, string[]>;
  sources: string[];
}> {
  const client = await getPool().connect();
  try {
    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const [predicateResult, sourceResult] = await Promise.all([
      client.query(
        `SELECT DISTINCT r.relation_category AS category, r.predicate AS value
         FROM ${SEARCH_SCHEMA}.entity_relation r
         ORDER BY r.relation_category, r.predicate`,
      ),
      client.query(
        `SELECT DISTINCT source.value AS value
         FROM ${SEARCH_SCHEMA}.entity_relation r
         CROSS JOIN LATERAL unnest(r.sources) AS source(value)
         WHERE source.value <> ''
         ORDER BY source.value`,
      ),
    ]);

    const predicatesByCategory: Record<string, string[]> = {};
    for (const row of predicateResult.rows) {
      const category = String(row.category);
      const predicate = String(row.value);
      if (!predicatesByCategory[category]) predicatesByCategory[category] = [];
      predicatesByCategory[category].push(predicate);
    }

    return { predicatesByCategory, sources: sourceResult.rows.map((r) => String(r.value)).filter(Boolean) };
  } finally {
    client.release();
  }
}

export async function getAssociatedEntityIds(entityPks: number[]): Promise<string[]> {
  const normalized = Array.from(new Set(entityPks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];

  const db = getDb();
  const rows = await db
    .selectDistinct({
      canonicalIdentifier: entity.canonicalIdentifier,
      canonicalIdentifierType: entity.canonicalIdentifierType,
    })
    .from(entityRelation)
    .innerJoin(entity, eq(entity.entityPk, entityRelation.subjectEntityPk))
    .where(
      and(
        eq(entityRelation.relationCategory, "membership"),
        inArray(entityRelation.objectEntityPk, normalized),
      ),
    );

  return rows.map((row) => toPublicEntityId(row));
}
