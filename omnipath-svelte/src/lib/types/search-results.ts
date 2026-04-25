import type { EntityLike } from "$lib/entities/display";
import type { Identifier } from "$lib/types/entities";

export interface SearchResult {
  id: string;
  type?: "entity" | "cv_term" | "source";
  name?: string;
  entity_id?: string | number;
  entity_type?: string;
  namespace_name?: string;
  definition?: string;
  associated_entity_ids?: Array<string | number>;
  synonyms?: string[];
  descriptions?: string[];
  gene_symbols?: string[];
  names?: string[];
  identifiers?: Identifier[];
  references?: string[];
  complexes?: Array<string | number>;
  num_interactions?: number;
  cv_terms?: string[];
  ontology_terms?: string[];
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
  sources?: string[];

  entityPk?: number;
  canonicalIdentifier?: string;
  canonicalIdentifierType?: string;
  entityType?: string | null;
  taxonomyId?: string | null;
  entityAttributes?: unknown;
}

export type EntitySearchRow = EntityLike;
