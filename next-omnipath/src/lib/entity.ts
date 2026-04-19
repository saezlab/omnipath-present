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
import {
  getAssociatedEntityPublicIdsByMemberPublicIds,
  getEntityAnnotations,
  getEntityByPublicId,
  getEntityIdentifiers,
  getEntityPublicIdsForAnnotationTerms,
  getEntitySummary,
} from "@/lib/db/reads";
import { getDb } from "@/lib/db/client";
import { entity, entityAnnotation, entityIdentifier, type Identifier } from "@next-omnipath/drizzle";
import { loadFacetDistributionFromMaterializedView } from "@/lib/postgres-search/search";

function normalizeIds(ids?: Array<string | number>): string[] {
  return Array.from(new Set((ids || []).map((id) => String(id).trim()).filter(Boolean)));
}

function parsePublicEntityId(publicId: string): { canonicalIdentifierType: string; canonicalIdentifier: string } | null {
  const trimmed = publicId.trim();
  if (!trimmed) return null;

  const separatorIndex = trimmed.indexOf("|");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return null;
  }

  return {
    canonicalIdentifierType: trimmed.slice(0, separatorIndex),
    canonicalIdentifier: trimmed.slice(separatorIndex + 1),
  };
}

function normalizeEntityTypeFilterValue(value: string | null | undefined): string {
  const text = (value || "").trim();
  if (!text) return "";
  const parts = text.split(":");
  if (parts.length < 3) return text.toLowerCase();
  return `${parts[0].toLowerCase()}:${parts[1].toUpperCase()}:${parts.slice(2).join(":").toUpperCase()}`;
}

function normalizedEntityTypeSql(column: typeof entity.entityType): SQL {
  return sql`LOWER(split_part(${column}, ':', 3)) || ':' || split_part(${column}, ':', 1) || ':' || split_part(${column}, ':', 2)`;
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
      conditions.push(sql`${normalizedEntityTypeSql(entity.entityType)} = ANY(${normalizedTypes})`);
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
