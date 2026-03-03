"use server";

import { searchMeilisearch } from "@/lib/meilisearch/search";
import { INDEXES } from "@/lib/meilisearch/client";
import type { MeilisearchFilters, MeilisearchSource } from "@/types/meilisearch";

export interface SourceSearchResponse {
  hits: MeilisearchSource[];
  estimatedTotalHits: number;
  facetDistribution?: Record<string, Record<string, number>>;
}

export async function searchSources(
  query: string,
  filters: MeilisearchFilters = {},
  limit: number = 20,
  offset: number = 0,
): Promise<SourceSearchResponse> {
  try {
    const result = await searchMeilisearch({
      query,
      index: INDEXES.SOURCES,
      filters,
      limit,
      offset,
    });

    return {
      hits: (result.hits as MeilisearchSource[]) || [],
      estimatedTotalHits: result.estimatedTotalHits || 0,
      facetDistribution: result.facetDistribution,
    };
  } catch (error) {
    console.error("Error searching sources:", error);
    return {
      hits: [],
      estimatedTotalHits: 0,
    };
  }
}
