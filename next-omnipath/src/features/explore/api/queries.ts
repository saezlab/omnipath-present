"use server";

import { getApiServiceUrl } from "@/lib/api/config";
import { searchMeilisearch } from "@/lib/meilisearch/search";
import type { MeilisearchFilters } from "@/types/meilisearch";

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

export async function resolveOntologyTerms(termIds: string[]): Promise<Record<string, ExploreOntologyTerm>> {
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
    const resolved: Record<string, ExploreOntologyTerm> = {};

    for (const termId of normalized) {
      const term = data.terms?.[termId];
      if (!term) continue;
      resolved[termId] = {
        id: term.id,
        label: term.name || term.id,
        namespace: term.namespace,
        definition: term.definition,
      };
    }

    return resolved;
  } catch (error) {
    console.error("Error resolving ontology terms", error);
    return {};
  }
}

async function browseOntologyTermsFromEntityHits(species: string | undefined, limit: number): Promise<ExploreOntologyTerm[]> {
  const filters: MeilisearchFilters = species ? { ncbi_tax_id: [species] } : {};
  const response = await searchMeilisearch({
    query: "",
    index: "search_entities",
    limit: Math.max(limit * 10, 250),
    offset: 0,
    filters,
    facets: [],
  });

  const counts = new Map<string, number>();
  for (const hit of response.hits || []) {
    const rawTerms = (hit.ontology_terms || hit.cv_terms) as unknown;
    const terms = Array.isArray(rawTerms) ? rawTerms : [];
    for (const term of terms) {
      const normalized = normalizeOntologyId(String(term));
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  const entries = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const resolved = await resolveOntologyTerms(entries.map(([termId]) => termId));

  return entries.map(([termId, count]) => ({
    id: termId,
    label: resolved[termId]?.label || termId,
    namespace: resolved[termId]?.namespace,
    definition: resolved[termId]?.definition,
    entityCount: count,
  }));
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

export async function browseTopOntologyTerms(species?: string, limit = 24): Promise<ExploreOntologyTerm[]> {
  try {
    return await browseOntologyTermsFromEntityHits(species, limit);
  } catch (error) {
    console.error("Error browsing ontology terms", error);
    return [];
  }
}
