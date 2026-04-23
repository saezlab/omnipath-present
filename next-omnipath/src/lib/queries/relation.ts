"use server";

import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, getPool } from "@/lib/db/client";
import { entity, entityRelation, type Entity, type EntityRelation } from "@next-omnipath/drizzle";
import { toPublicEntityId } from "@/lib/entity-public-id";

export type RelationWithEntities = EntityRelation & {
  subjectEntity: Entity;
  objectEntity: Entity;
};

function toRelationRow(row: {
  relation_pk: string | number;
  subject_entity_pk: string | number;
  predicate: string;
  object_entity_pk: string | number;
  relation_category: string;
  evidence_count: string | number;
  sources: string[];
}): EntityRelation {
  return {
    relationPk: Number(row.relation_pk),
    subjectEntityPk: Number(row.subject_entity_pk),
    predicate: row.predicate,
    objectEntityPk: Number(row.object_entity_pk),
    relationCategory: row.relation_category,
    evidenceCount: Number(row.evidence_count),
    sources: row.sources,
  };
}

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
  annotationTerms?: string[];
  interactionAnnotationTerms?: string[];
  participantAnnotationTerms?: string[];
}

function normalizeNumberValues(values: number[] | undefined): number[] {
  return Array.from(new Set((values || []).filter(Number.isFinite)));
}

function normalizeStringValues(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
}

function buildRelationSearchWhere(filters: RelationFilters) {
  const whereParts: string[] = [];
  const params: unknown[] = [];

  const pushParam = (value: unknown, cast?: string): string => {
    params.push(value);
    const placeholder = `$${params.length}`;
    return cast ? `${placeholder}::${cast}` : placeholder;
  };

  if (filters.relationCategories?.length) {
    whereParts.push(`relation_category = ANY(${pushParam(filters.relationCategories, "text[]")})`);
  }

  if (filters.predicates?.length) {
    whereParts.push(`predicate = ANY(${pushParam(filters.predicates, "text[]")})`);
  }

  const subjectEntityPks = normalizeNumberValues(filters.subjectEntityPks);
  if (subjectEntityPks.length) {
    whereParts.push(`subject_entity_pk = ANY(${pushParam(subjectEntityPks, "bigint[]")})`);
  }

  const objectEntityPks = normalizeNumberValues(filters.objectEntityPks);
  if (objectEntityPks.length) {
    whereParts.push(`object_entity_pk = ANY(${pushParam(objectEntityPks, "bigint[]")})`);
  }

  const entityPks = normalizeNumberValues(filters.entityPks);
  if (entityPks.length) {
    const placeholder = pushParam(entityPks, "bigint[]");
    whereParts.push(`(subject_entity_pk = ANY(${placeholder}) OR object_entity_pk = ANY(${placeholder}))`);
  }

  if (filters.sources?.length) {
    whereParts.push(`sources && ${pushParam(filters.sources, "text[]")}`);
  }

  const annotationTerms = normalizeStringValues(filters.annotationTerms);
  if (annotationTerms.length) {
    whereParts.push(`EXISTS (
      SELECT 1
      FROM relation_annotation_term rat
      WHERE rat.relation_pk = entity_relation.relation_pk
        AND rat.term_id = ANY(${pushParam(annotationTerms, "text[]")})
    )`);
  }
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
  const client = await getPool().connect();
  try {
    const { whereClause, params } = buildRelationSearchWhere(filters);

    const pageParams = [...params, limit, offset];
    const relationsResult = await client.query<{
      relation_pk: string | number;
      subject_entity_pk: string | number;
      predicate: string;
      object_entity_pk: string | number;
      relation_category: string;
      evidence_count: string | number;
      sources: string[];
    }>(
      `SELECT *
       FROM entity_relation
       ${whereClause}
       ORDER BY relation_pk
       LIMIT $${pageParams.length - 1}
       OFFSET $${pageParams.length}`,
      pageParams,
    );

    return { relations: relationsResult.rows.map(toRelationRow) };
  } finally {
    client.release();
  }
}

export async function countRelations(filters: RelationFilters = {}): Promise<number> {
  const client = await getPool().connect();
  try {
    const { whereClause, params } = buildRelationSearchWhere(filters);
    const result = await client.query<{ count: string }>(
      `SELECT count(*) AS count
       FROM entity_relation
       ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.count || 0);
  } finally {
    client.release();
  }
}

let relationFilterOptionsCache:
  | { value: { predicatesByCategory: Record<string, string[]>; sources: string[] }; expiresAt: number }
  | null = null;
let relationFilterOptionsInFlight:
  | Promise<{ predicatesByCategory: Record<string, string[]>; sources: string[] }>
  | null = null;

export async function getRelationFilterOptions(): Promise<{
  predicatesByCategory: Record<string, string[]>;
  sources: string[];
}> {
  const now = Date.now();
  if (relationFilterOptionsCache && relationFilterOptionsCache.expiresAt > now) {
    return relationFilterOptionsCache.value;
  }
  if (relationFilterOptionsInFlight) {
    return relationFilterOptionsInFlight;
  }

  relationFilterOptionsInFlight = (async () => {
    const client = await getPool().connect();
    try {
      const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
      const [predicateResult, sourceResult] = await Promise.all([
        client.query<{ category: string; predicates: string[] | null }>(
          `SELECT category, array_agg(predicate ORDER BY predicate) AS predicates
           FROM (
             SELECT DISTINCT r.relation_category AS category, r.predicate AS predicate
             FROM ${SEARCH_SCHEMA}.entity_relation r
           ) t
           GROUP BY category
           ORDER BY category`,
        ),
        client.query<{ values: string[] | null }>(
          `SELECT array_agg(value ORDER BY value) AS values
           FROM (
             SELECT DISTINCT source.value AS value
             FROM ${SEARCH_SCHEMA}.entity_relation r
             CROSS JOIN LATERAL unnest(r.sources) AS source(value)
             WHERE source.value <> ''
           ) t`,
        ),
      ]);

      const value = {
        predicatesByCategory: Object.fromEntries(
          predicateResult.rows.map((row) => [row.category, row.predicates?.filter(Boolean) ?? []]),
        ),
        sources: sourceResult.rows[0]?.values?.filter(Boolean) ?? [],
      };

      relationFilterOptionsCache = {
        value,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };

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
