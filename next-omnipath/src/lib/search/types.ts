export interface SearchResponse {
  hits: Record<string, unknown>[];
  estimatedTotalHits: number;
  limit: number;
  offset: number;
  processingTimeMs: number;
  query: string;
  facetDistribution?: Record<string, Record<string, number>>;
}
