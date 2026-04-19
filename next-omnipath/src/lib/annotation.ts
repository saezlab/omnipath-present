"use server";

import "server-only";

import { countDistinct, desc, eq, inArray } from "drizzle-orm";
import { entity, entityAnnotation } from "@next-omnipath/drizzle";
import { getDb } from "@/lib/db/client";
import { getApiServiceUrl } from "@/lib/api/config";
import { getAnnotationTermCountsForEntityPublicIds } from "@/lib/db/reads";
import type { SearchFilters } from "@/types/search";

export interface ExploreOntologyTerm {
  id: string;
  label: string;
  namespace?: string | null;
  definition?: string | null;
  matchType?: string;
  matchedText?: string;
  score?: number;
  entityCount?: number;
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

function normalizeOntologyId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^([A-Za-z]+):(\d+)$/);
  if (!match) return trimmed.toUpperCase();
  return `${match[1].toUpperCase()}:${match[2]}`;
}

async function browseOntologyTermsFromEntityHits(species: string | undefined, limit: number): Promise<ExploreOntologyTerm[]> {
  const db = getDb();
  const rows = await db
    .select({
      termId: entityAnnotation.cvTerm,
      entityCount: countDistinct(entityAnnotation.entityPk),
    })
    .from(entityAnnotation)
    .innerJoin(entity, eq(entity.entityPk, entityAnnotation.entityPk))
    .where(species ? inArray(entity.taxonomyId, [species]) : undefined)
    .groupBy(entityAnnotation.cvTerm)
    .orderBy(desc(countDistinct(entityAnnotation.entityPk)), entityAnnotation.cvTerm)
    .limit(limit);

  const entries = rows
    .map((row) => [normalizeOntologyId(row.termId), Number(row.entityCount || 0)] as const)
    .filter(([termId]) => Boolean(termId));

  const resolved = await resolveOntologyTerms(entries.map(([termId]) => termId));

  return entries.map(([termId, count]) => ({
    id: termId,
    label: resolved[termId]?.label || termId,
    namespace: resolved[termId]?.namespace,
    definition: resolved[termId]?.definition,
    entityCount: count,
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
      const counts = await getAnnotationTermCountsForEntityPublicIds(scopedEntityIds, entityFilters);
      const termIds = counts.map((entry) => entry.cvTerm);
      if (termIds.length === 0) return [];

      const resolved = await resolveOntologyTerms(termIds);
      const results = counts
        .map((entry) => ({
          id: entry.cvTerm,
          label: resolved[entry.cvTerm]?.label || entry.cvTerm,
          namespace: resolved[entry.cvTerm]?.namespace,
          definition: resolved[entry.cvTerm]?.definition,
          entityCount: entry.entityCount,
        }))
        .sort((a, b) => b.entityCount - a.entityCount || a.label.localeCompare(b.label));

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
