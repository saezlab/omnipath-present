export interface SearchResponse<THit = Record<string, unknown>> {
  hits: THit[];
  estimatedTotalHits: number;
  limit: number;
  offset: number;
  processingTimeMs: number;
  query: string;
}
