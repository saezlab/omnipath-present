export interface InteractionAnnotation {
  term: string;
  value?: string | null;
  unit?: string | null;
}

export interface InteractionEvidence {
  evidence_serial: number;
  source: string;
  interaction_annotations: InteractionAnnotation[];
  member_a_annotations: InteractionAnnotation[];
  member_b_annotations: InteractionAnnotation[];
}

export interface InteractionDirection {
  direction: 'a-b' | 'b-a' | 'undirected';
  sign: -1 | 0 | 1;
}

export interface InteractionSearchResult {
  interaction_id?: number;
  interaction_key: string;
  member_a_id: string;
  member_b_id: string;
  member_types: string[];
  interaction_type?: string;
  is_directed: boolean;
  sign: -1 | 0 | 1;
  evidence?: InteractionEvidence[];
  evidence_count?: number;
  directions?: InteractionDirection[];
  has_direction?: boolean;
  has_positive_sign?: boolean;
  has_negative_sign?: boolean;
  interaction_annotation_terms: string[];
  participant_annotation_terms?: string[];
  sources?: string[];
  [key: string]: unknown;
}

export interface AssociationAnnotation {
  term: string;
  value?: string | null;
  unit?: string | null;
}

export interface AssociationEvidence {
  evidence_serial: number;
  source: string;
  annotations: AssociationAnnotation[];
}

export interface IdentifierEntry {
  key: string;
  value: string;
}

export interface AssociationSearchResult {
  association_id?: number;
  association_key: string;
  parent_entity_id: string;
  parent_entity_type: string;
  parent_name: string;
  parent_identifiers: IdentifierEntry[];
  member_entity_id: string;
  member_entity_type: string;
  member_name: string;
  member_identifiers: IdentifierEntry[];
  sources: string[];
  evidence?: AssociationEvidence[];
  association_annotation_terms: string[];
  [key: string]: unknown;
}

export interface CvTermReference {
  id: string;
  name: string;
}

export interface SearchFilters {
  member_a_id?: string | number;
  member_b_id?: string | number;
  entity_ids?: Array<string | number>;
  interaction_types?: string[];
  is_directed?: boolean | null;
  signs?: Array<-1 | 0 | 1>;
  interaction_annotation_terms?: string[];
  participant_annotation_terms?: string[];

  entity_types?: string[];
  sources?: string[];
  license_cv?: string[];
  update_category_cv?: string[];
  content_category_cv_terms?: string[];
  ncbi_tax_id?: string[];
  ontology_terms?: string[];

  parent_entity_ids?: Array<string | number>;
  member_entity_ids?: Array<string | number>;
  parent_entity_types?: string[];
  member_entity_types?: string[];
  association_annotation_terms?: string[];

  include_associated_entities?: boolean;
}

export interface SearchParams {
  query: string;
  filters: SearchFilters;
  limit: number;
  offset: number;
}

export interface SourceFunctionRecord {
  function: string;
  records: number;
}

export interface SearchSource {
  __doc_id?: string;
  content_hash?: string;
  source_ref: string;
  source: string;
  source_name: string;
  source_accession: string;
  license_cv: string;
  update_category_cv: string;
  resource_url?: string;
  resource_description?: string;
  pubmed: string[];
  finished_at: string;
  function_names: string[];
  content_category_cv_terms?: string[];
  function_records: SourceFunctionRecord[];
  total_records: number;
  function_records_json?: string;
  [key: string]: unknown;
}

export interface InteractionSearchResponse {
  hits: InteractionSearchResult[];
  estimatedTotalHits: number;
  limit: number;
  offset: number;
  processingTimeMs: number;
  query: string;
  facetDistribution?: Record<string, Record<string, number>>;
}
