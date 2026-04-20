"use server";

import "server-only";

import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { annotationTerm, annotationTermSearch, entity, entityAnnotation } from "@next-omnipath/drizzle";
import { getDb } from "@/lib/db/client";
import { normalizeStringValues, publicEntityIdWhere, toPublicEntityId } from "@/lib/entity-public-id";
import {
  normalizeEntityTypeFilterValue,
  normalizedEntityTypeDrizzleSql,
} from "@/lib/entity-filter";
import type { SearchFilters } from "@/types/search";

export interface ExploreOntologyTerm {
  id: string;
  label: string;
  namespace?: string | null;
  definition?: string | null;
  matchType?: string;
  matchedText?: string;
  score?: number;
  annotatedEntityCount?: number;
}

const ONTOLOGY_ID_PATTERN = /^(GO|MI|OM|HP|KW|CHEBI):\d+$/i;


async function getEntityPkMapByPublicIds(publicIds: string[]): Promise<Map<string, number>> {
  const normalized = normalizeStringValues(publicIds);
  if (normalized.length === 0) {
    return new Map();
  }

  const where = publicEntityIdWhere(normalized);
  if (!where) {
    return new Map();
  }

  const rows = await getDb()
    .select({
      entityPk: entity.entityPk,
      canonicalIdentifier: entity.canonicalIdentifier,
      canonicalIdentifierType: entity.canonicalIdentifierType,
    })
    .from(entity)
    .where(where);

  return new Map(rows.map((row) => [toPublicEntityId(row), row.entityPk]));
}

function buildEntityFilterConditions(filters: SearchFilters, scopedEntityPks?: number[]): SQL[] {
  const conditions: SQL[] = [];

  if (scopedEntityPks?.length) {
    conditions.push(inArray(entity.entityPk, scopedEntityPks));
  }

  if (filters.entity_types?.length) {
    const normalizedTypes = filters.entity_types
      .map((value) => normalizeEntityTypeFilterValue(String(value)))
      .filter(Boolean);
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
        SELECT 1
        FROM entity_annotation ea_filter
        WHERE ea_filter.entity_pk = ${entity.entityPk}
          AND ea_filter.cv_term = ANY(${terms})
      )`);
    }
  }

  return conditions;
}

export async function getEntityPublicIdsForAnnotationTerms(termIds: string[]): Promise<string[]> {
  const normalizedTerms = normalizeStringValues(termIds);
  if (normalizedTerms.length === 0) {
    return [];
  }

  const rows = await getDb()
    .selectDistinct({
      canonicalIdentifier: entity.canonicalIdentifier,
      canonicalIdentifierType: entity.canonicalIdentifierType,
    })
    .from(entityAnnotation)
    .innerJoin(entity, eq(entity.entityPk, entityAnnotation.entityPk))
    .where(inArray(entityAnnotation.cvTerm, normalizedTerms));

  return rows.map((row) => toPublicEntityId(row));
}

export async function getAnnotationTermsForEntityPublicIds(
  publicIds: string[],
  filters: SearchFilters = {},
  query = "",
  limit?: number,
): Promise<ExploreOntologyTerm[]> {
  const entityPkMap = await getEntityPkMapByPublicIds(publicIds);
  const scopedEntityPks = Array.from(entityPkMap.values());
  if (scopedEntityPks.length === 0) {
    return [];
  }

  const conditions = buildEntityFilterConditions(filters, scopedEntityPks);
  const normalizedQuery = query.trim();


  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  if (!where) {
    return [];
  }

  const rows = await getDb()
    .select({
      accession: entityAnnotation.cvTerm,
      label: annotationTerm.label,
      namespace: annotationTerm.namespace,
      definition: annotationTerm.definition,
      annotatedEntityCount: sql<number>`count(DISTINCT ${entityAnnotation.entityPk})`,
    })
    .from(entityAnnotation)
    .innerJoin(entity, eq(entity.entityPk, entityAnnotation.entityPk))
    .leftJoin(annotationTerm, eq(annotationTerm.accession, entityAnnotation.cvTerm))
    .where(and(
      where,
      normalizedQuery
        ? or(
            sql`${entityAnnotation.cvTerm} ILIKE ${`%${normalizedQuery}%`}`,
            sql`COALESCE(${annotationTerm.label}, '') ILIKE ${`%${normalizedQuery}%`}`,
            sql`COALESCE(${annotationTerm.definition}, '') ILIKE ${`%${normalizedQuery}%`}`,
            sql`COALESCE(${annotationTerm.namespace}, '') ILIKE ${`%${normalizedQuery}%`}`,
          )
        : undefined,
    ))
    .groupBy(entityAnnotation.cvTerm, annotationTerm.label, annotationTerm.namespace, annotationTerm.definition)
    .orderBy(desc(sql`count(DISTINCT ${entityAnnotation.entityPk})`), asc(entityAnnotation.cvTerm))
    .limit(limit ?? 10_000);

  return rows
    .map((row) => ({
      id: normalizeOntologyId(row.accession),
      label: row.label || normalizeOntologyId(row.accession),
      namespace: row.namespace,
      definition: row.definition,
      annotatedEntityCount: Number(row.annotatedEntityCount || 0),
    }))
    .filter((row) => Boolean(row.id));
}

function normalizeOntologyId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^([A-Za-z]+):(\d+)$/);
  if (!match) return trimmed.toUpperCase();
  return `${match[1].toUpperCase()}:${match[2]}`;
}

function mapLocalOntologyTerms(
  rows: Array<{
    accession: string | null;
    label?: string | null;
    namespace?: string | null;
    definition?: string | null;
    annotatedEntityCount?: number | null;
  }>,
): ExploreOntologyTerm[] {
  return rows
    .map((row) => {
      const id = normalizeOntologyId(row.accession || "");
      return {
        id,
        label: row.label || id,
        namespace: row.namespace,
        definition: row.definition,
        annotatedEntityCount: row.annotatedEntityCount == null ? undefined : Number(row.annotatedEntityCount),
      };
    })
    .filter((row) => Boolean(row.id));
}

async function browseOntologyTermsFromEntityHits(
  species: string | undefined,
  limit: number,
  query = "",
): Promise<ExploreOntologyTerm[]> {
  void species;

  const normalizedQuery = query.trim();
  const db = getDb();

  const rows = await db
    .select({
      accession: annotationTermSearch.accession,
      label: annotationTermSearch.label,
      namespace: annotationTermSearch.namespace,
      definition: annotationTermSearch.definition,
      annotatedEntityCount: annotationTermSearch.annotatedEntityCount,
    })
    .from(annotationTermSearch)
    .where(
      normalizedQuery
        ? or(
            sql`COALESCE(${annotationTermSearch.accession}, '') ILIKE ${`%${normalizedQuery}%`}`,
            sql`COALESCE(${annotationTermSearch.label}, '') ILIKE ${`%${normalizedQuery}%`}`,
            sql`COALESCE(${annotationTermSearch.definition}, '') ILIKE ${`%${normalizedQuery}%`}`,
            sql`COALESCE(${annotationTermSearch.namespace}, '') ILIKE ${`%${normalizedQuery}%`}`,
          )
        : undefined,
    )
    .orderBy(desc(annotationTermSearch.annotatedEntityCount), asc(annotationTermSearch.accession))
    .limit(limit);

  return mapLocalOntologyTerms(rows);
}

export async function resolveOntologyTerms(termIds: string[]): Promise<Record<string, ExploreOntologyTerm | null>> {
  const normalized = Array.from(new Set(termIds.map((termId) => normalizeOntologyId(termId)).filter(Boolean)));
  if (normalized.length === 0) return {};

  try {
    const rows = await getDb()
      .select({
        accession: annotationTerm.accession,
        label: annotationTerm.label,
        namespace: annotationTerm.namespace,
        definition: annotationTerm.definition,
      })
      .from(annotationTerm)
      .where(inArray(annotationTerm.accession, normalized));

    const byId = new Map(
      rows.map((row) => [normalizeOntologyId(row.accession), {
        id: normalizeOntologyId(row.accession),
        label: row.label || normalizeOntologyId(row.accession),
        namespace: row.namespace,
        definition: row.definition,
      }]),
    );

    return Object.fromEntries(normalized.map((termId) => [termId, byId.get(termId) || null]));
  } catch (error) {
    console.error("Error resolving ontology terms", error);
    return Object.fromEntries(normalized.map((termId) => [termId, null]));
  }
}

export async function searchOntologyTerms(query: string, limit = 24): Promise<ExploreOntologyTerm[]> {
  const normalized = query.trim();
  if (!normalized) {
    return [];
  }

  const results = await browseOntologyTermsFromEntityHits(undefined, limit, normalized);
  if (results.length > 0) {
    return results;
  }

  if (ONTOLOGY_ID_PATTERN.test(normalized)) {
    const normalizedId = normalizeOntologyId(normalized);
    return [{ id: normalizedId, label: normalizedId }];
  }

  return [];
}

export async function browseAnnotationTerms({
  query = "",
  species,
  scopedEntityIds,
  entityFilters = {},
  limit = 24,
}: {
  query?: string;
  species?: string;
  scopedEntityIds?: string[];
  entityFilters?: SearchFilters;
  limit?: number;
} = {}): Promise<ExploreOntologyTerm[]> {
  const normalizedQuery = query.trim();

  if (scopedEntityIds?.length) {
    try {
      return await getAnnotationTermsForEntityPublicIds(scopedEntityIds, entityFilters, normalizedQuery, limit);
    } catch (error) {
      console.error("Error browsing scoped annotation terms:", error);
      return [];
    }
  }

  const annotationResults = await browseOntologyTermsFromEntityHits(species, limit, normalizedQuery);
  if (annotationResults.length > 0 || !normalizedQuery) {
    return annotationResults;
  }

  return searchOntologyTerms(normalizedQuery, limit);
}
