export interface CvTermReference {
  id: string;
  name: string;
}

export interface SearchFilters {
  member_a_id?: string | number;
  member_b_id?: string | number;
  entity_ids?: Array<string | number>;
  entity_pks?: Array<string | number>;
  annotation_term_ids?: string[];
  interaction_types?: string[];
  predicates?: string[];
  relation_categories?: string[];
  is_directed?: boolean | null;
  signs?: Array<-1 | 0 | 1>;

  entity_types?: string[];
  sources?: string[];
  license_cv?: string[];
  update_category_cv?: string[];
  content_category_cv_terms?: string[];
  ncbi_tax_id?: string[];
  ontology_terms?: string[];
  ontology_ids?: string[];

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
