"use server";

import "server-only";

import type { SearchFilters } from "@/types/search";
import type { AssociationListRow } from "@/features/associations/types";
import type { SearchResponse } from "@/lib/search/types";
import { searchAssociations as searchAssociationsData } from "@/lib/search_data/search";

export async function searchAssociations(
  query: string,
  filters: SearchFilters,
  limit: number = 20,
  offset: number = 0,
): Promise<SearchResponse<AssociationListRow>> {
  try {
    return await searchAssociationsData({
      query,
      limit,
      offset,
      filters,
    });
  } catch (error) {
    console.error("Error searching associations:", error);
    return {
      hits: [],
      estimatedTotalHits: 0,
      limit,
      offset,
      processingTimeMs: 0,
      query,
    };
  }
}
