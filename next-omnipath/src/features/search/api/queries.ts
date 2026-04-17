"use server";

import { searchMeilisearch as meilisearchDirectSearch, type SearchResponse } from '@/lib/meilisearch/search';
import type { IndexName } from '@/lib/meilisearch/client';
import type { MeilisearchFilters } from '@/types/meilisearch';

export async function searchMeilisearch({
  query,
  index = "search_entities",
  limit = 20,
  offset = 0,
  filters = {},
  facets,
  trackTotalHits,
  includeIdentifiers,
  includeOntologyTerms,
}: {
  query: string;
  index?: IndexName;
  limit?: number;
  offset?: number;
  filters?: MeilisearchFilters;
  facets?: string[];
  trackTotalHits?: boolean;
  includeIdentifiers?: boolean;
  includeOntologyTerms?: boolean;
}): Promise<SearchResponse> {
  // Allow empty query to show all results with facets (for initial load and filtering)
  try {
    return await meilisearchDirectSearch({ index, query, limit, offset, filters, facets, trackTotalHits, includeIdentifiers, includeOntologyTerms });
  } catch (e) {
    console.error("Error searching entities:", e);
    return {
      hits: [],
      estimatedTotalHits: 0,
      limit,
      offset,
      processingTimeMs: 0,
      query,
      facetDistribution: {},
    };
  }
}

export type SearchMeilisearchResponse = Awaited<ReturnType<typeof searchMeilisearch>>;
