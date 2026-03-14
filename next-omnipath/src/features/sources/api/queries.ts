"use server";

import { INDEXES } from "@/lib/meilisearch/client";
import { searchMeilisearch } from "@/lib/meilisearch/search";
import type { MeilisearchSource } from "@/types/meilisearch";

export interface SourceSearchResponse {
  hits: MeilisearchSource[];
  estimatedTotalHits: number;
}

export async function searchSources(
  query: string,
  limit: number = 20,
  offset: number = 0,
): Promise<SourceSearchResponse> {
  try {
    const result = await searchMeilisearch({
      query,
      index: INDEXES.SOURCES,
      limit,
      offset,
    });

    return {
      hits: (result.hits as MeilisearchSource[]) || [],
      estimatedTotalHits: result.estimatedTotalHits || 0,
    };
  } catch (error) {
    console.error("Error searching sources:", error);
    return {
      hits: [],
      estimatedTotalHits: 0,
    };
  }
}
