import 'server-only';

import type { SearchResponse } from '@/lib/search/types';
import type { InteractionListRow } from '@/features/interactions-search/types';
import type { EntitySearchRow } from '@/types/search-results';
import type { SearchFilters } from '@/types/search';
import type { AssociationListRow } from '@/features/associations/types';
import { SEARCH_TARGETS, type SearchTarget } from '@/lib/search/collections';
import {
  getInteractionStatsPostgres,
  searchAssociationsPostgres,
  searchEntitiesPostgres,
  searchInteractionsPostgres,
} from '@/lib/postgres-search/search';

export { SEARCH_TARGETS } from '@/lib/search/collections';

export interface SearchRequest {
  query: string;
  target: SearchTarget;
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
  facets?: string[];
  trackTotalHits?: boolean;
  includeIdentifiers?: boolean;
  includeOntologyTerms?: boolean;
}

export async function search<THit = Record<string, unknown>>(params: SearchRequest): Promise<SearchResponse<THit>> {
  const {
    query,
    target,
    limit = 20,
    offset = 0,
    filters = {},
    facets,
    trackTotalHits = true,
    includeIdentifiers = true,
    includeOntologyTerms = true,
  } = params;

  switch (target) {
    case SEARCH_TARGETS.ENTITIES:
      return await searchEntitiesPostgres({
        query,
        limit,
        offset,
        filters,
        facets,
        trackTotalHits,
        includeIdentifiers,
        includeOntologyTerms,
      }) as unknown as SearchResponse<THit>;
    case SEARCH_TARGETS.INTERACTIONS:
      return await searchInteractionsPostgres({ query, limit, offset, filters }) as unknown as SearchResponse<THit>;
    case SEARCH_TARGETS.ASSOCIATIONS:
      return await searchAssociationsPostgres({ query, limit, offset, filters }) as unknown as SearchResponse<THit>;
    default:
      return {
        hits: [],
        estimatedTotalHits: 0,
        limit,
        offset,
        processingTimeMs: 0,
        query,
      } as SearchResponse<THit>;
  }
}

export async function searchEntities(params: Omit<SearchRequest, 'target'>): Promise<SearchResponse<EntitySearchRow>> {
  return search<EntitySearchRow>({ ...params, target: SEARCH_TARGETS.ENTITIES });
}

export async function searchInteractions(params: Omit<SearchRequest, 'target'>): Promise<SearchResponse<InteractionListRow>> {
  return search<InteractionListRow>({ ...params, target: SEARCH_TARGETS.INTERACTIONS });
}

export async function searchAssociations(params: Omit<SearchRequest, 'target'>): Promise<SearchResponse<AssociationListRow>> {
  return search<AssociationListRow>({ ...params, target: SEARCH_TARGETS.ASSOCIATIONS });
}

export async function getInteractionStats(): Promise<Record<string, unknown>> {
  return getInteractionStatsPostgres();
}
