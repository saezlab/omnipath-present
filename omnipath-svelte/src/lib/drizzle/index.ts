export * from "./schema";

export type Entity = {
  entityPk: string;
  canonicalIdentifier: string;
  canonicalIdentifierType: string;
  resolutionStatus?: string | null;
  entityType: string | null;
  taxonomyId: string | null;
  entityAttributes: unknown;
  sources: string[];
  relationCount?: number;
  entityFacetHints?: EntityFacetHints;
};

export type EntityFacetHints = {
  chemicalClasses: string[];
  metabolicDomains: string[];
  structuralSpecificities: string[];
};

export type EntityOntologyHierarchy = {
  termId: string;
  ontologyPrefix: string | null;
  label: string | null;
  definition: string | null;
  ontologyId: string | null;
  childCount: number;
  parentCount: number;
};

export type EntityInsert = Entity;

export type EntityIdentifier = {
  id?: string;
  entityPk: string;
  identifier: string;
  identifierType: string;
};

export type EntityRelation = {
  relationPk: string;
  subjectEntityPk: string;
  predicate: string;
  objectEntityPk: string;
  relationCategory: string | null;
  participantTypes: string[];
  evidenceCount: number;
  sources: string[];
};

export type EntityRelationEvidence = {
  source: string;
  relationEvidencePk: string;
  relationPk: string;
  recordAttributes: unknown;
  subjectAttributes: unknown;
  objectAttributes: unknown;
  evidence: unknown;
};

export type Identifier = {
  key: string;
  value: string;
};
