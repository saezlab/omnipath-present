import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, getPool } from "$lib/server/db/client";
import { entity, entityRelation, type Entity, type EntityRelation } from "$lib/drizzle";
import { toPublicEntityId } from "$lib/entity-public-id";

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
  participant_types: string[] | null;
  evidence_count: string | number;
  sources: string[] | null;
}): EntityRelation {
  return {
    relationPk: Number(row.relation_pk),
    subjectEntityPk: Number(row.subject_entity_pk),
    predicate: row.predicate,
    objectEntityPk: Number(row.object_entity_pk),
    relationCategory: row.relation_category,
    participantTypes: (row.participant_types || []).filter(Boolean),
    evidenceCount: Number(row.evidence_count),
    sources: (row.sources || []).filter(Boolean),
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
    subjectEntity: row.subject_entity as unknown as Entity,
    objectEntity: row.object_entity as unknown as Entity,
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

function buildRelationSearchWhere(filters: RelationFilters) {
  const whereParts: string[] = [];
  const params: unknown[] = [];

  const pushParam = (value: unknown, cast?: string): string => {
    params.push(value);
    const placeholder = `$${params.length}`;
    return cast ? `${placeholder}::${cast}` : placeholder;
  };

  const entityPkPredicate = (placeholder: string) =>
    `(subject_entity_pk = ANY(${placeholder}) OR object_entity_pk = ANY(${placeholder}))`;

  const annotationTermPredicate = (placeholder: string) => `(
      EXISTS (
        SELECT 1
        FROM relation_annotation_term rat
        WHERE rat.relation_pk = entity_relation.relation_pk
          AND rat.term_id = ANY(${placeholder})
      )
      OR (
        entity_relation.relation_category = 'annotation'
        AND EXISTS (
          SELECT 1
          FROM entity term_entity
          WHERE term_entity.entity_pk = entity_relation.object_entity_pk
            AND term_entity.canonical_identifier = ANY(${placeholder})
        )
      )
      OR (
        entity_relation.relation_category = 'membership'
        AND EXISTS (
          SELECT 1
          FROM entity_relation participant_annotation
          JOIN entity term_entity ON term_entity.entity_pk = participant_annotation.object_entity_pk
          WHERE participant_annotation.relation_category = 'annotation'
            AND participant_annotation.subject_entity_pk IN (
              entity_relation.subject_entity_pk,
              entity_relation.object_entity_pk
            )
            AND term_entity.canonical_identifier = ANY(${placeholder})
        )
      )
    )`;

  if (filters.relationCategories?.length) {
    whereParts.push(`relation_category = ANY(${pushParam(filters.relationCategories, "text[]")})`);
  }

  if (filters.predicates?.length) {
    whereParts.push(`predicate = ANY(${pushParam(filters.predicates, "text[]")})`);
  }

  const interactionTypes = normalizeStringValues(filters.interactionTypes);
  if (interactionTypes.length) {
    whereParts.push(`participant_types @> ${pushParam(interactionTypes, "text[]")}`);
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
    whereParts.push(entityPkPredicate(pushParam(entityPks, "bigint[]")));
  }

  if (filters.sources?.length) {
    whereParts.push(`sources && ${pushParam(filters.sources, "text[]")}`);
  }

  const annotationTerms = normalizeStringValues(filters.annotationTerms);
  if (annotationTerms.length) {
    whereParts.push(annotationTermPredicate(pushParam(annotationTerms, "text[]")));
  }

  const scopeParts: string[] = [];
  const scopeEntityPks = normalizeNumberValues(filters.scopeEntityPks);
  if (scopeEntityPks.length) {
    scopeParts.push(entityPkPredicate(pushParam(scopeEntityPks, "bigint[]")));
  }
  const scopeAnnotationTerms = normalizeStringValues(filters.scopeAnnotationTerms);
  if (scopeAnnotationTerms.length) {
    scopeParts.push(annotationTermPredicate(pushParam(scopeAnnotationTerms, "text[]")));
  }
  if (scopeParts.length) {
    whereParts.push(`(${scopeParts.join(" OR ")})`);
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
    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const relationsResult = await client.query<{
      relation_pk: string | number;
      subject_entity_pk: string | number;
      predicate: string;
      object_entity_pk: string | number;
      relation_category: string;
      participant_types: string[] | null;
      evidence_count: string | number;
      sources: string[] | null;
    }>(
      `SELECT *
       FROM ${SEARCH_SCHEMA}.entity_relation
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
    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const result = await client.query<{ count: string }>(
      `SELECT count(*) AS count
       FROM ${SEARCH_SCHEMA}.entity_relation
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

type RelationFilterOptionsCache = {
  value: RelationFilterOptions;
  expiresAt: number;
};

const relationFilterOptionsGlobal = globalThis as typeof globalThis & {
  __omnipathRelationFilterOptionsCache?: RelationFilterOptionsCache | null;
  __omnipathRelationFilterOptionsInFlight?: Promise<RelationFilterOptions> | null;
};

function getCachedRelationFilterOptions(now: number): RelationFilterOptions | null {
  const cached = relationFilterOptionsGlobal.__omnipathRelationFilterOptionsCache;
  return cached && cached.expiresAt > now ? cached.value : null;
}

function setCachedRelationFilterOptions(value: RelationFilterOptions) {
  relationFilterOptionsGlobal.__omnipathRelationFilterOptionsCache = {
    value,
    expiresAt: Date.now() + 30 * 60 * 1000,
  };
}

export async function getRelationFilterOptions(): Promise<RelationFilterOptions> {
  const now = Date.now();
  const cached = getCachedRelationFilterOptions(now);
  if (cached) return cached;

  if (relationFilterOptionsGlobal.__omnipathRelationFilterOptionsInFlight) {
    return relationFilterOptionsGlobal.__omnipathRelationFilterOptionsInFlight;
  }

  relationFilterOptionsGlobal.__omnipathRelationFilterOptionsInFlight = (async () => {
    const client = await getPool().connect();
    try {
      const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";

      const [predicateResult, sourceResult, interactionTypeResult] = await Promise.all([
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
          `SELECT array_agg(resource_id ORDER BY resource_id) AS values
           FROM ${SEARCH_SCHEMA}.resources
           WHERE interaction_count > 0
              OR membership_count > 0
              OR annotation_count > 0`,
        ),
        client.query<{ values: string[] | null }>(
          `SELECT array_agg(value ORDER BY value) AS values
           FROM (
             SELECT DISTINCT participant_type.value AS value
             FROM ${SEARCH_SCHEMA}.entity_relation r
             CROSS JOIN LATERAL unnest(r.participant_types) AS participant_type(value)
             WHERE r.relation_category = 'interaction'
               AND participant_type.value <> ''
           ) t`,
        ),
      ]);

      const value = {
        predicatesByCategory: Object.fromEntries(
          predicateResult.rows.map((row) => [row.category, row.predicates?.filter(Boolean) ?? []]),
        ),
        sources: sourceResult.rows[0]?.values?.filter(Boolean) ?? [],
        interactionTypes: interactionTypeResult.rows[0]?.values?.filter(Boolean) ?? [],
      };

      setCachedRelationFilterOptions(value);
      return value;
    } finally {
      client.release();
      relationFilterOptionsGlobal.__omnipathRelationFilterOptionsInFlight = null;
    }
  })();

  return relationFilterOptionsGlobal.__omnipathRelationFilterOptionsInFlight;
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
    //    When there is no selection we use the union of all predicate bitmaps
    //    so that the scope acts as "all relations" (identity for AND).
    const scopeParts: string[] = [];
    if (normalizedTermIds.length > 0) {
      const termParam = pushParam(normalizedTermIds);
      scopeParts.push(`SELECT b.relation_bitmap AS bitmap
        FROM ${S}.entity e
        JOIN ${S}.annotation_term_relation_bitmap b ON b.term_entity_pk = e.entity_pk
        WHERE e.canonical_identifier = ANY(${termParam}::text[])`);
    }
    if (normalizedEntityPks.length > 0) {
      const ePkParam = pushParam(normalizedEntityPks);
      scopeParts.push(`SELECT rb_build_agg(relation_pk::integer) AS bitmap
        FROM ${S}.entity_relation
        WHERE subject_entity_pk = ANY(${ePkParam}::bigint[])
           OR object_entity_pk = ANY(${ePkParam}::bigint[])`);
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
        SELECT rb_or_agg(relation_bitmap) AS bitmap
        FROM ${S}.facet_relation_bitmap
        WHERE facet_name = 'predicate'
      )`);
    }

    // 2. Filter bitmaps from currently active filters
    if (normalizedPredicates.length > 0) {
      const predParam = pushParam(normalizedPredicates);
      ctes.push(`predicate_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${S}.facet_relation_bitmap
        WHERE facet_name = 'predicate' AND facet_value = ANY(${predParam}::text[])
      )`);
    }

    if (normalizedInteractionTypes.length > 0) {
      const typeParam = pushParam(normalizedInteractionTypes);
      ctes.push(`participant_type_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${S}.facet_relation_bitmap
        WHERE facet_name = 'participant_type' AND facet_value = ANY(${typeParam}::text[])
      )`);
    }

    if (normalizedSources.length > 0) {
      const sourceParam = pushParam(normalizedSources);
      ctes.push(`source_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${S}.facet_relation_bitmap
        WHERE facet_name = 'source' AND facet_value = ANY(${sourceParam}::text[])
      )`);
    }

    // 3. For each facet, compute counts with all OTHER filters applied.
    const scopeAnd = (extras: (string | null)[]): string => {
      const parts = ['scope_base.bitmap', ...extras.filter((e): e is string => e != null)];
      if (parts.length === 1) return parts[0];
      // rb_and only takes 2 arguments; chain nested calls
      return parts.reduce((acc, part) => `rb_and(${acc}, ${part})`);
    };

    const subqueries: string[] = [];

    const joins: string[] = ['CROSS JOIN scope_base'];
    if (normalizedPredicates.length > 0) joins.push('CROSS JOIN predicate_filter_bitmap');
    if (normalizedInteractionTypes.length > 0) joins.push('CROSS JOIN participant_type_filter_bitmap');
    if (normalizedSources.length > 0) joins.push('CROSS JOIN source_filter_bitmap');

    // predicate counts: scope_base AND participant_type_filter AND source_filter
    subqueries.push(`
      SELECT
        'predicate' AS facet_name,
        f.facet_value,
        f.facet_category,
        rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([
          normalizedInteractionTypes.length > 0 ? 'participant_type_filter_bitmap.bitmap' : null,
          normalizedSources.length > 0 ? 'source_filter_bitmap.bitmap' : null,
        ])})) AS scoped_count
      FROM ${S}.facet_relation_bitmap f
      ${joins.join('\n      ')}
      WHERE f.facet_name = 'predicate'
        AND rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([
          normalizedInteractionTypes.length > 0 ? 'participant_type_filter_bitmap.bitmap' : null,
          normalizedSources.length > 0 ? 'source_filter_bitmap.bitmap' : null,
        ])})) > 0
    `);

    // participant_type counts: scope_base AND predicate_filter AND source_filter
    subqueries.push(`
      SELECT
        'participant_type' AS facet_name,
        f.facet_value,
        f.facet_category,
        rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([
          normalizedPredicates.length > 0 ? 'predicate_filter_bitmap.bitmap' : null,
          normalizedSources.length > 0 ? 'source_filter_bitmap.bitmap' : null,
        ])})) AS scoped_count
      FROM ${S}.facet_relation_bitmap f
      ${joins.join('\n      ')}
      WHERE f.facet_name = 'participant_type'
        AND rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([
          normalizedPredicates.length > 0 ? 'predicate_filter_bitmap.bitmap' : null,
          normalizedSources.length > 0 ? 'source_filter_bitmap.bitmap' : null,
        ])})) > 0
    `);

    // source counts: scope_base AND predicate_filter AND participant_type_filter
    subqueries.push(`
      SELECT
        'source' AS facet_name,
        f.facet_value,
        f.facet_category,
        rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([
          normalizedPredicates.length > 0 ? 'predicate_filter_bitmap.bitmap' : null,
          normalizedInteractionTypes.length > 0 ? 'participant_type_filter_bitmap.bitmap' : null,
        ])})) AS scoped_count
      FROM ${S}.facet_relation_bitmap f
      ${joins.join('\n      ')}
      WHERE f.facet_name = 'source'
        AND rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([
          normalizedPredicates.length > 0 ? 'predicate_filter_bitmap.bitmap' : null,
          normalizedInteractionTypes.length > 0 ? 'participant_type_filter_bitmap.bitmap' : null,
        ])})) > 0
    `);

    const result = await client.query<{
      facet_name: string;
      facet_value: string;
      facet_category: string | null;
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
      facetCategory: row.facet_category,
      scopedCount: Number(row.scoped_count || 0),
    }));
  } finally {
    client.release();
  }
}
