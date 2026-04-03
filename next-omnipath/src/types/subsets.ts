export type SubsetResource = "entities" | "interactions" | "associations";

export interface EntitySubsetFilters {
  entity_ids?: Array<string | number>;
  entity_types?: string[];
  sources?: string[];
  ncbi_tax_id?: string[];
  ontology_terms?: string[];
}

export interface InteractionSubsetFilters {
  member_a_id?: string | number;
  member_b_id?: string | number;
  entity_ids?: Array<string | number>;
  interaction_types?: string[];
  is_directed?: boolean | null;
  signs?: Array<-1 | 0 | 1>;
  interaction_annotation_terms?: string[];
  participant_annotation_terms?: string[];
  sources?: string[];
}

export interface SubsetMaterializeRequest<TFilters extends object> {
  resource: SubsetResource;
  query?: string;
  filters?: TFilters;
  filename?: string;
}

export interface SubsetArtifact {
  resource: SubsetResource;
  blob: Blob;
  objectUrl: string;
  fileName: string;
  rowCount?: number;
  durationMs?: number;
}

export interface DuckDbFacetBucket {
  value: string;
  count: number;
}

export interface DuckDbFacetCounts {
  interaction_type: DuckDbFacetBucket[];
  sign: DuckDbFacetBucket[];
  is_directed: DuckDbFacetBucket[];
  sources: DuckDbFacetBucket[];
  interaction_annotation_terms: DuckDbFacetBucket[];
  participant_annotation_terms: DuckDbFacetBucket[];
}

export interface DuckDbInteractionsPage {
  rows: Record<string, unknown>[];
  totalCount: number;
}

export interface InteractionLocalFilters {
  interaction_types: string[];
  signs: Array<-1 | 0 | 1>;
  is_directed?: boolean;
  sources: string[];
  interaction_annotation_terms: string[];
  participant_annotation_terms: string[];
}
