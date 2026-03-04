// Types for Meilisearch interaction data

export interface InteractionAnnotation {
  term: string;
  value?: string | null;
  unit?: string | null;
}

// Evidence structure with annotations for interaction, member_a, and member_b
export interface InteractionEvidence {
  evidence_serial: number;
  source: string;
  interaction_annotations: InteractionAnnotation[];
  member_a_annotations: InteractionAnnotation[];
  member_b_annotations: InteractionAnnotation[];
}

// Direction with sign information
export interface InteractionDirection {
  direction: 'a-b' | 'b-a';
  sign: -1 | 0 | 1; // -1 = negative/inhibition, 0 = mixed, 1 = positive/activation
}

export interface MeilisearchInteraction {
  // Deterministic numeric identifier for exports/subsetting
  interaction_id?: number;

  // Primary key - pair key like "idA-idB"
  interaction_key: string;

  // Member entity IDs (string IDs)
  member_a_id: string;
  member_b_id: string;

  // Member types as "TypeName:EntityId" format
  member_types: string[];

  // Canonical interaction type pair, e.g. "Protein:MI:0326|Small molecule:MI:0328"
  interaction_type?: string;

  // Evidence array with nested annotation data
  evidence: InteractionEvidence[];

  // Directions with sign information
  directions: InteractionDirection[];

  // Flattened filter fields
  has_direction: boolean;
  has_positive_sign: boolean;
  has_negative_sign: boolean;
  interaction_annotation_terms: string[];
  participant_annotation_terms_go?: string[];
  participant_annotation_terms_mi?: string[];
  participant_annotation_terms_om?: string[];
  participant_annotation_terms_hp?: string[];
  participant_annotation_terms_kw?: string[];
  sources?: string[];

  // Index signature to satisfy DataRow constraint
  [key: string]: unknown;
}

// Association annotation entry
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

// Identifier entry
export interface IdentifierEntry {
  key: string;
  value: string;
}

// Association document type
export interface MeilisearchAssociation {
  // Deterministic numeric identifier for exports/subsetting
  association_id?: number;

  // Primary key
  association_key: string;

  // Parent entity info
  parent_entity_id: string;
  parent_entity_type: string;
  parent_name: string;
  parent_identifiers: IdentifierEntry[];

  // Member entity info
  member_entity_id: string;
  member_entity_type: string;
  member_name: string;
  member_identifiers: IdentifierEntry[];

  // Sources
  sources: string[];

  // Evidence + annotations
  evidence: AssociationEvidence[];
  association_annotation_terms: string[];

  // Index signature
  [key: string]: unknown;
}

export interface CvTermReference {
  id: string;
  name: string;
}

export interface MeilisearchFilters {
  // Interaction filters (new schema)
  member_a_id?: string | number;
  member_b_id?: string | number;
  entity_ids?: Array<string | number>;  // Filter by multiple entity IDs (matches member_a_id OR member_b_id)
  interaction_types?: string[];
  has_direction?: boolean | null;
  has_positive_sign?: boolean | null;
  has_negative_sign?: boolean | null;
  interaction_annotation_terms?: string[];
  participant_annotation_terms_go?: string[];
  participant_annotation_terms_mi?: string[];
  participant_annotation_terms_om?: string[];
  participant_annotation_terms_hp?: string[];
  participant_annotation_terms_kw?: string[];

  // Entity + source-browser filters
  entity_types?: string[];
  sources?: string[];
  license_cv?: string[];
  update_category_cv?: string[];
  content_category_cv_terms?: string[];
  ncbi_tax_id?: string[];
  cv_terms_go?: string[];
  cv_terms_mi?: string[];
  cv_terms_om?: string[];
  cv_terms_hp?: string[];
  cv_terms_kw?: string[];

  // Association filters
  parent_entity_ids?: Array<string | number>;
  member_entity_ids?: Array<string | number>;
  parent_entity_types?: string[];
  member_entity_types?: string[];
  association_annotation_terms?: string[];
}

export interface MeilisearchSearchParams {
  query: string;
  filters: MeilisearchFilters;
  limit: number;
  offset: number;
}

export interface MeilisearchSourceFunctionRecord {
  function: string;
  records: number;
}

export interface MeilisearchSource {
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
  function_records: MeilisearchSourceFunctionRecord[];
  total_records: number;
  function_records_json?: string;
  [key: string]: unknown;
}

export interface MeilisearchSearchResponse {
  hits: MeilisearchInteraction[];
  estimatedTotalHits: number;
  limit: number;
  offset: number;
  processingTimeMs: number;
  query: string;
  facetDistribution?: Record<string, Record<string, number>>;
}
