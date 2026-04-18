import type { Entity, Identifier as DrizzleIdentifier } from "@next-omnipath/drizzle";

export type Identifier = DrizzleIdentifier;
export type EntityRecord = Entity;

export interface EntitySearchResult {
  id: string;
  type?: "entity";
  entity_id?: string | number;
  entity_type?: EntityRecord["entityType"] | null;
  names?: string[];
  synonyms?: string[];
  gene_symbols?: string[];
  descriptions?: string[];
  references?: string[];
  identifiers?: Identifier[];
  sources?: EntityRecord["sources"];
  complexes?: number[];
  cv_terms?: string[];
  ontology_terms?: string[];
  pathways?: number[];
  reactions?: number[];
  num_interactions?: number;
  canonical_identifier?: EntityRecord["canonicalIdentifier"] | null;
  canonical_identifier_type?: EntityRecord["canonicalIdentifierType"] | null;
  ncbi_tax_id?: string | null;
  definition?: string;
  name?: string;
  is_annotated?: boolean;
  canonical_smiles?: string;
  formula?: string;
  molecular_weight?: number;
}
