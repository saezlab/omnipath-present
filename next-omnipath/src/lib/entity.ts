"use server";

import "server-only";

import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { SearchFilters } from "@/types/search";
import type { EntitySearchRow } from "@/types/search-results";
import { getAssociatedEntityPublicIdsByMemberPublicIds } from "@/lib/association";
import { getEntityPublicIdsForAnnotationTerms } from "@/lib/annotation";
import {
  normalizeStringValues,
  parsePublicEntityId,
  publicEntityIdWhere,
  toPublicEntityId,
} from "@/lib/entity-public-id";
import {
  normalizeEntityTypeFilterValue,
  normalizedEntityTypeDrizzleSql,
} from "@/lib/entity-filter";
import { getDb } from "@/lib/db/client";
import {
  entity,
  entityAnnotation,
  entityIdentifier,
  entitySummary,
  type Entity,
  type EntityAnnotation,
  type EntityIdentifier,
  type EntitySummary,
  type Identifier,
} from "@next-omnipath/drizzle";
import { loadFacetDistributionFromMaterializedView } from "@/lib/postgres-search/search";

function normalizeIds(ids?: Array<string | number>): string[] {
  return normalizeStringValues(ids || []);
}

function toEntitySearchRow(row: typeof entity.$inferSelect): EntitySearchRow {
  const publicId = `${row.canonicalIdentifierType}|${row.canonicalIdentifier}`;

  return {
    ...row,
    identifiers: (row.identifiers || []) as Identifier[],
    id: publicId,
    entity_id: publicId,
    type: "entity",
    matchRank: null,
  };
}

function buildEntitySearchConditions(filters: SearchFilters, query: string): SQL[] {
  const conditions: SQL[] = [];

  if (filters.entity_ids?.length) {
    const parsed = normalizeIds(filters.entity_ids)
      .map(parsePublicEntityId)
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    if (parsed.length > 0) {
      conditions.push(or(
        ...parsed.map(({ canonicalIdentifierType, canonicalIdentifier }) => and(
          eq(entity.canonicalIdentifierType, canonicalIdentifierType),
          eq(entity.canonicalIdentifier, canonicalIdentifier),
        )),
      )!);
    }
  }

  if (filters.entity_types?.length) {
    const normalizedTypes = filters.entity_types
      .map((value) => normalizeEntityTypeFilterValue(String(value)))
      .filter(Boolean);

    if (normalizedTypes.length > 0) {
      conditions.push(sql`${normalizedEntityTypeDrizzleSql(entity.entityType)} = ANY(${normalizedTypes})`);
    }
  }

  if (filters.sources?.length) {
    const sources = normalizeIds(filters.sources);
    if (sources.length > 0) {
      conditions.push(sql`${entity.sources} && ${sources}`);
    }
  }

  if (filters.ncbi_tax_id?.length) {
    const taxonomyIds = normalizeIds(filters.ncbi_tax_id);
    if (taxonomyIds.length > 0) {
      conditions.push(inArray(entity.taxonomyId, taxonomyIds));
    }
  }

  if (filters.ontology_terms?.length) {
    const termIds = normalizeIds(filters.ontology_terms);
    if (termIds.length > 0) {
      conditions.push(sql`EXISTS (
        SELECT 1
        FROM ${entityAnnotation} ea_filter
        WHERE ea_filter.entity_pk = ${entity.entityPk}
          AND ea_filter.cv_term = ANY(${termIds})
      )`);
    }
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    const exact = trimmedQuery;
    const prefix = `${trimmedQuery}%`;
    const contains = `%${trimmedQuery}%`;

    conditions.push(sql`EXISTS (
      SELECT 1
      FROM ${entityIdentifier} ei_filter
      WHERE ei_filter.entity_pk = ${entity.entityPk}
        AND (
          ei_filter.identifier ILIKE ${exact}
          OR ei_filter.identifier ILIKE ${prefix}
          OR ei_filter.identifier ILIKE ${contains}
        )
    )`);
  }

  return conditions;
}

export interface SearchEntitiesParams {
  query?: string;
  limit?: number;
  cursor?: number;
  filters?: SearchFilters;
}

export interface SearchEntitiesResult {
  hits: EntitySearchRow[];
  total: number;
  nextCursor: number | null;
}

export interface EntityFilterCounts {
  entity_type: Record<string, number>;
  sources: Record<string, number>;
  ncbi_tax_id: Record<string, number>;
  ontology_terms: Record<string, number>;
}

export interface AssociatedEntityIdsResult {
  seedEntityIds: string[];
  associatedEntityIds: string[];
}

export async function getEntityByPublicId(publicId: string): Promise<Entity | null> {
  const rows = await getEntitiesByPublicIds([publicId]);
  return rows[0] ?? null;
}

export async function getEntitiesByPublicIds(publicIds: string[]): Promise<Entity[]> {
  const normalized = normalizeIds(publicIds);
  if (normalized.length === 0) {
    return [];
  }

  const where = publicEntityIdWhere(normalized);
  if (!where) {
    return [];
  }

  const rows = await getDb().select().from(entity).where(where);
  const order = new Map(normalized.map((id, index) => [id, index]));
  return rows.sort((a, b) => (order.get(toPublicEntityId(a)) ?? Number.MAX_SAFE_INTEGER) - (order.get(toPublicEntityId(b)) ?? Number.MAX_SAFE_INTEGER));
}

export async function getEntitiesByPks(entityPks: number[]): Promise<Entity[]> {
  const normalized = Array.from(new Set(entityPks.filter((value) => Number.isFinite(value))));
  if (normalized.length === 0) {
    return [];
  }

  return getDb().select().from(entity).where(inArray(entity.entityPk, normalized));
}

export async function getEntityIdentifiers(entityPk: number): Promise<EntityIdentifier[]> {
  return getDb().select().from(entityIdentifier).where(eq(entityIdentifier.entityPk, entityPk));
}

export async function getEntityIdentifiersByEntityPks(entityPks: number[]): Promise<EntityIdentifier[]> {
  const normalized = Array.from(new Set(entityPks.filter((value) => Number.isFinite(value))));
  if (normalized.length === 0) {
    return [];
  }

  return getDb().select().from(entityIdentifier).where(inArray(entityIdentifier.entityPk, normalized));
}

export async function getEntityAnnotations(entityPk: number): Promise<EntityAnnotation[]> {
  return getDb().select().from(entityAnnotation).where(eq(entityAnnotation.entityPk, entityPk));
}

export async function getEntityAnnotationsByEntityPks(entityPks: number[]): Promise<EntityAnnotation[]> {
  const normalized = Array.from(new Set(entityPks.filter((value) => Number.isFinite(value))));
  if (normalized.length === 0) {
    return [];
  }

  return getDb().select().from(entityAnnotation).where(inArray(entityAnnotation.entityPk, normalized));
}

export async function getEntitySummary(entityPk: number): Promise<EntitySummary | null> {
  const rows = await getDb().select().from(entitySummary).where(eq(entitySummary.entityPk, entityPk)).limit(1);
  return rows[0] ?? null;
}

export async function searchEntities({
  query = "",
  limit = 20,
  cursor,
  filters = {},
}: SearchEntitiesParams = {}): Promise<SearchEntitiesResult> {
  try {
    const db = getDb();
    const baseConditions = buildEntitySearchConditions(filters, query);
    const pageConditions = [
      ...baseConditions,
      ...(typeof cursor === "number" && Number.isFinite(cursor) ? [gt(entity.entityPk, cursor)] : []),
    ];

    const baseWhere = baseConditions.length > 0 ? and(...baseConditions) : undefined;
    const pageWhere = pageConditions.length > 0 ? and(...pageConditions) : undefined;

    const [{ total }] = await db
      .select({ total: count() })
      .from(entity)
      .where(baseWhere);

    const rows = await db
      .select()
      .from(entity)
      .where(pageWhere)
      .orderBy(asc(entity.entityPk))
      .limit(limit);

    const hits = rows.map(toEntitySearchRow);

    return {
      hits,
      total: Number(total || 0),
      nextCursor: hits.length === limit ? hits[hits.length - 1]?.entityPk ?? null : null,
    };
  } catch (error) {
    console.error("Error searching entities:", error);
    return {
      hits: [],
      total: 0,
      nextCursor: null,
    };
  }
}

export async function getEntity(publicId: string) {
  const normalizedPublicId = publicId.trim();
  if (!normalizedPublicId) {
    return null;
  }

  try {
    return await getEntityByPublicId(normalizedPublicId);
  } catch (error) {
    console.error("Error fetching entity:", error);
    return null;
  }
}

export async function getEntityDetails(publicId: string) {
  const normalizedPublicId = publicId.trim();
  if (!normalizedPublicId) {
    return null;
  }

  try {
    const entityRow = await getEntityByPublicId(normalizedPublicId);
    if (!entityRow) {
      return null;
    }

    const [identifiers, annotations, summary] = await Promise.all([
      getEntityIdentifiers(entityRow.entityPk),
      getEntityAnnotations(entityRow.entityPk),
      getEntitySummary(entityRow.entityPk),
    ]);

    return {
      entity: entityRow,
      identifiers,
      annotations,
      summary,
    };
  } catch (error) {
    console.error("Error fetching entity details:", error);
    return null;
  }
}

export async function getAssociatedEntityIds(seedEntityIdsInput: Array<string | number>): Promise<AssociatedEntityIdsResult> {
  const seedEntityIds = normalizeIds(seedEntityIdsInput);
  if (seedEntityIds.length === 0) {
    return {
      seedEntityIds: [],
      associatedEntityIds: [],
    };
  }

  try {
    const associatedEntityIds = (await getAssociatedEntityPublicIdsByMemberPublicIds(seedEntityIds))
      .filter((id) => !seedEntityIds.includes(id));

    return {
      seedEntityIds,
      associatedEntityIds,
    };
  } catch (error) {
    console.error("Error fetching associated entity IDs:", error);
    return {
      seedEntityIds,
      associatedEntityIds: [],
    };
  }
}

export async function getEntityIdsForAnnotationTerms(termIds: string[]): Promise<string[]> {
  const normalizedTermIds = normalizeIds(termIds);
  if (normalizedTermIds.length === 0) {
    return [];
  }

  try {
    return await getEntityPublicIdsForAnnotationTerms(normalizedTermIds);
  } catch (error) {
    console.error("Error fetching entity IDs for annotation terms:", error);
    return [];
  }
}

export async function getEntityFilterCounts({
  query = "",
  filters = {},
}: {
  query?: string;
  filters?: SearchFilters;
} = {}): Promise<EntityFilterCounts> {
  void query;
  void filters;

  try {
    const facetDistribution = await loadFacetDistributionFromMaterializedView("entity_filter_counts");

    return {
      entity_type: facetDistribution.entity_type || {},
      sources: facetDistribution.sources || {},
      ncbi_tax_id: facetDistribution.ncbi_tax_id || {},
      ontology_terms: facetDistribution.ontology_terms || {},
    };
  } catch (error) {
    console.error("Error fetching entity filter counts:", error);
    return {
      entity_type: {},
      sources: {},
      ncbi_tax_id: {},
      ontology_terms: {},
    };
  }
}
