"use server";

import "server-only";

import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { entity, entityAnnotation } from "@next-omnipath/drizzle";
import { getDb } from "@/lib/db/client";
import { getApiServiceUrl } from "@/lib/api/config";
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
}

interface OntologySearchMatch {
  id: string;
  name?: string | null;
  definition?: string | null;
  namespace?: string | null;
  matched_text?: string;
  match_type?: string;
  score?: number;
}

interface OntologySearchResponse {
  results?: Record<string, OntologySearchMatch[]>;
}

interface TermsResponse {
  terms?: Record<string, {
    id: string;
    name?: string | null;
    definition?: string | null;
    namespace?: string | null;
  } | null>;
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
): Promise<string[]> {
  const entityPkMap = await getEntityPkMapByPublicIds(publicIds);
  const scopedEntityPks = Array.from(entityPkMap.values());
  if (scopedEntityPks.length === 0) {
    return [];
  }

  const conditions = buildEntityFilterConditions(filters, scopedEntityPks);
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  if (!where) {
    return [];
  }

  const rows = await getDb()
    .selectDistinct({
      cvTerm: entityAnnotation.cvTerm,
    })
    .from(entityAnnotation)
    .innerJoin(entity, eq(entity.entityPk, entityAnnotation.entityPk))
    .where(where);

  return rows
    .map((row) => row.cvTerm)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function normalizeOntologyId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^([A-Za-z]+):(\d+)$/);
  if (!match) return trimmed.toUpperCase();
  return `${match[1].toUpperCase()}:${match[2]}`;
}

async function browseOntologyTermsFromEntityHits(species: string | undefined, limit: number): Promise<ExploreOntologyTerm[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({
      termId: entityAnnotation.cvTerm,
    })
    .from(entityAnnotation)
    .innerJoin(entity, eq(entity.entityPk, entityAnnotation.entityPk))
    .where(species ? inArray(entity.taxonomyId, [species]) : undefined)
    .orderBy(asc(entityAnnotation.cvTerm))
    .limit(limit);

  const termIds = rows
    .map((row) => normalizeOntologyId(row.termId))
    .filter(Boolean);

  const resolved = await resolveOntologyTerms(termIds);

  return termIds.map((termId) => ({
    id: termId,
    label: resolved[termId]?.label || termId,
    namespace: resolved[termId]?.namespace,
    definition: resolved[termId]?.definition,
  }));
}

export async function resolveOntologyTerms(termIds: string[]): Promise<Record<string, ExploreOntologyTerm | null>> {
  const normalized = Array.from(new Set(termIds.map((termId) => normalizeOntologyId(termId)).filter(Boolean)));
  if (normalized.length === 0) return {};

  try {
    const response = await fetch(`${getApiServiceUrl()}/terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term_ids: normalized }),
    });

    if (!response.ok) {
      throw new Error(`Failed to resolve ontology terms (${response.status})`);
    }

    const data = (await response.json()) as TermsResponse;
    const resolved: Record<string, ExploreOntologyTerm | null> = {};

    for (const termId of normalized) {
      const term = data.terms?.[termId];
      resolved[termId] = term
        ? {
            id: term.id,
            label: term.name || term.id,
            namespace: term.namespace,
            definition: term.definition,
          }
        : null;
    }

    return resolved;
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

  if (ONTOLOGY_ID_PATTERN.test(normalized)) {
    const normalizedId = normalizeOntologyId(normalized);
    const resolved = await resolveOntologyTerms([normalizedId]);
    const term = resolved[normalizedId];
    return term ? [term] : [{ id: normalizedId, label: normalizedId }];
  }

  try {
    const response = await fetch(`${getApiServiceUrl()}/terms/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [normalized], limit }),
    });

    if (!response.ok) {
      throw new Error(`Failed to search ontology terms (${response.status})`);
    }

    const data = (await response.json()) as OntologySearchResponse;
    const matches = data.results?.[normalized] || [];

    const mapped = matches.map((match) => ({
      id: normalizeOntologyId(match.id),
      label: match.name || match.id,
      namespace: match.namespace,
      definition: match.definition,
      matchType: match.match_type,
      matchedText: match.matched_text,
      score: match.score,
    }));

    if (mapped.length > 0) {
      return mapped;
    }
  } catch (error) {
    console.error("Error searching ontology terms", error);
  }

  try {
    const fallback = await browseOntologyTermsFromEntityHits(undefined, Math.max(limit * 3, 120));
    const lowerQuery = normalized.toLowerCase();
    return fallback
      .filter((term) =>
        term.id.toLowerCase().includes(lowerQuery)
        || term.label.toLowerCase().includes(lowerQuery)
        || term.namespace?.toLowerCase().includes(lowerQuery)
        || term.definition?.toLowerCase().includes(lowerQuery),
      )
      .slice(0, limit);
  } catch (error) {
    console.error("Error in ontology search fallback", error);
    return [];
  }
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
      const termIds = await getAnnotationTermsForEntityPublicIds(scopedEntityIds, entityFilters);
      if (termIds.length === 0) return [];

      const resolved = await resolveOntologyTerms(termIds);
      const results = termIds
        .map((termId) => ({
          id: termId,
          label: resolved[termId]?.label || termId,
          namespace: resolved[termId]?.namespace,
          definition: resolved[termId]?.definition,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      if (!normalizedQuery) {
        return results.slice(0, limit);
      }

      const lowerQuery = normalizedQuery.toLowerCase();
      return results
        .filter((term) =>
          term.id.toLowerCase().includes(lowerQuery)
          || term.label.toLowerCase().includes(lowerQuery)
          || term.namespace?.toLowerCase().includes(lowerQuery)
          || term.definition?.toLowerCase().includes(lowerQuery),
        )
        .slice(0, limit);
    } catch (error) {
      console.error("Error browsing scoped annotation terms:", error);
      return [];
    }
  }

  return normalizedQuery.length > 0
    ? searchOntologyTerms(normalizedQuery, limit)
    : browseOntologyTermsFromEntityHits(species, limit);
}
