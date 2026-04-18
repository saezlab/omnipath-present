import type { EntitySearchResult, Identifier } from "@/types/entities";

export interface CvTermSearchResult {
  id: string;
  type: "cv_term";
  name?: string;
  namespace_name?: string;
  definition?: string;
  associated_entity_ids?: string[];
  synonyms?: string[];
  descriptions?: string[];
  gene_symbols?: string[];
}

export interface SourceSearchResult {
  id: string;
  type: "source";
  source_name?: string;
  source_ref?: string;
  source?: string;
  source_accession?: string;
  resource_url?: string;
  resource_description?: string;
  function_records?: Array<{ function: string; records: number }>;
  function_names?: string[];
  content_category_cv_terms?: string[];
  total_records?: number;
  license_cv?: string;
  update_category_cv?: string;
  pubmed?: string[];
  finished_at?: string;
  name?: string;
}

// Transitional UI type for mixed result rendering.
// Entity-specific code should prefer EntitySearchResult.
export interface SearchResult {
  id: string;
  type?: "entity" | "cv_term" | "source";

  entity_id?: string | number;
  entity_type?: EntitySearchResult["entity_type"];
  names?: string[];
  synonyms?: string[];
  gene_symbols?: string[];
  descriptions?: string[];
  references?: string[];
  identifiers?: Identifier[];
  sources?: EntitySearchResult["sources"];
  complexes?: number[];
  cv_terms?: string[];
  ontology_terms?: string[];
  pathways?: number[];
  reactions?: number[];
  num_interactions?: number;
  canonical_identifier?: EntitySearchResult["canonical_identifier"];
  canonical_identifier_type?: EntitySearchResult["canonical_identifier_type"];
  ncbi_tax_id?: EntitySearchResult["ncbi_tax_id"];
  definition?: string;
  name?: string;
  is_annotated?: boolean;
  canonical_smiles?: string;
  formula?: string;
  molecular_weight?: number;

  namespace_name?: string;
  associated_entity_ids?: string[];

  source_name?: string;
  source_ref?: string;
  source?: string;
  source_accession?: string;
  resource_url?: string;
  resource_description?: string;
  function_records?: Array<{ function: string; records: number }>;
  function_names?: string[];
  content_category_cv_terms?: string[];
  total_records?: number;
  license_cv?: string;
  update_category_cv?: string;
  pubmed?: string[];
  finished_at?: string;
}
