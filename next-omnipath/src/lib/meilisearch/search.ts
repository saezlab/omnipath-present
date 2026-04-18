import 'server-only';
import type { MeilisearchFilters } from '@/types/meilisearch';
import { INDEXES, type IndexName } from '@/lib/search/indexes';
import type { SearchResponse } from '@/lib/search/types';
import {
  fetchDocumentsPostgres,
  getInteractionStatsPostgres,
  searchAssociationsPostgres,
  searchEntitiesPostgres,
  searchInteractionsPostgres,
} from '@/lib/postgres-search/search';

export { INDEXES } from '@/lib/search/indexes';

export interface SearchParams {
  query: string;
  index: IndexName;
  limit?: number;
  offset?: number;
  filters?: MeilisearchFilters;
  facets?: string[];
  trackTotalHits?: boolean;
  includeIdentifiers?: boolean;
  includeOntologyTerms?: boolean;
}

export async function searchMeilisearch(params: SearchParams): Promise<SearchResponse> {
  const {
    query,
    index,
    limit = 20,
    offset = 0,
    filters = {},
    facets,
    trackTotalHits = true,
    includeIdentifiers = true,
    includeOntologyTerms = true,
  } = params;

  switch (index) {
    case INDEXES.ENTITIES:
      return searchEntitiesPostgres({
        query,
        limit,
        offset,
        filters,
        facets,
        trackTotalHits,
        includeIdentifiers,
        includeOntologyTerms,
      });
    case INDEXES.INTERACTIONS:
      return searchInteractionsPostgres({ query, limit, offset, filters });
    case INDEXES.ASSOCIATIONS:
      return searchAssociationsPostgres({ query, limit, offset, filters });
    default:
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

export async function searchInteractionsMeilisearch(
  params: SearchParams & { filters?: MeilisearchFilters }
): Promise<SearchResponse> {
  const { query, limit = 20, offset = 0, filters = {} } = params;
  return searchInteractionsPostgres({ query, limit, offset, filters });
}

export async function fetchMeilisearchDocuments(
  indexName: IndexName,
  documentIds: string[],
  _filterField: string = 'id',
): Promise<{ documents: Record<string, unknown>[] }> {
  return fetchDocumentsPostgres(indexName, documentIds);
}

export async function getInteractionStats(): Promise<Record<string, unknown>> {
  return getInteractionStatsPostgres();
}

export async function searchAssociationsMeilisearch(
  params: SearchParams & { filters?: MeilisearchFilters }
): Promise<SearchResponse> {
  const { query, limit = 20, offset = 0, filters = {} } = params;
  return searchAssociationsPostgres({ query, limit, offset, filters });
}
