import type { Entity, Identifier } from "@next-omnipath/drizzle";

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

export interface EntitySearchRow extends Entity {
  identifiers: Identifier[];
  id: string;
  entity_id: string;
  type: "entity";
  matchRank?: number | null;
}

export interface SearchResult {
  id: string;
  type?: "entity" | "cv_term" | "source";

  entity_id?: string | number;
  entity_type?: Entity["entityType"] | null;
  names?: string[];
  synonyms?: string[];
  gene_symbols?: string[];
  descriptions?: string[];
  references?: string[];
  identifiers?: Identifier[];
  sources?: Entity["sources"];
  complexes?: number[];
  cv_terms?: string[];
  ontology_terms?: string[];
  pathways?: number[];
  reactions?: number[];
  num_interactions?: number;
  canonical_identifier?: Entity["canonicalIdentifier"] | null;
  canonical_identifier_type?: Entity["canonicalIdentifierType"] | null;
  ncbi_tax_id?: string | null;
  definition?: string;
  name?: string;
  is_annotated?: boolean;
  canonical_smiles?: string;
  formula?: string;
  molecular_weight?: number;
  matchRank?: number | null;

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
