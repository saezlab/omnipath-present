export type SubsetResource = "entities" | "relations" | "ontology";

export interface AnnotationSubsetFilters {
  prefixes?: string[];
  ontology_prefixes?: string[];
  entity_pks?: number[];
}

export interface EntitySubsetFilters {
  entity_pks?: number[];
  entity_ids?: Array<string | number>;
  entity_types?: string[];
  sources?: string[];
  taxonomy_ids?: string[];
  ncbi_tax_id?: string[];
}

export interface RelationSubsetFilters {
  relation_pks?: number[];
  subject_entity_pks?: number[];
  object_entity_pks?: number[];
  entity_pks?: number[];
  entity_ids?: Array<string | number>;
  predicates?: string[];
  interaction_types?: string[];
  relation_categories?: Array<"interaction" | "association">;
  participant_types?: string[];
  sources?: string[];
  annotation_terms?: string[];
  ontology_terms?: string[];
  annotation_scopes?: string[];
}

export type InteractionSubsetFilters = RelationSubsetFilters;

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
  predicate: DuckDbFacetBucket[];
  relation_category: DuckDbFacetBucket[];
  sources: DuckDbFacetBucket[];
  participant_types: DuckDbFacetBucket[];
  annotation_terms: DuckDbFacetBucket[];
}

export interface DuckDbInteractionsPage {
  rows: Record<string, unknown>[];
  totalCount: number;
}

export interface InteractionLocalFilters {
  predicates: string[];
  relation_categories: Array<"interaction" | "association">;
  sources: string[];
  annotation_terms: string[];
}
