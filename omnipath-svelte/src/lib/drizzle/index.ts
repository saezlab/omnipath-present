export * from "./schema";

export type Entity = {
  entityPk: number;
  canonicalIdentifier: string;
  canonicalIdentifierType: string;
  entityType: string | null;
  taxonomyId: string | null;
  entityAttributes: unknown;
  sources: string[];
  relationCount?: number;
};

export type EntityInsert = Entity;

export type EntityIdentifier = {
  id?: number | bigint;
  entityPk: number;
  identifier: string;
  identifierType: string;
};

export type EntityRelation = {
  relationPk: number;
  subjectEntityPk: number;
  predicate: string;
  objectEntityPk: number;
  relationCategory: string | null;
  participantTypes: string[];
  evidenceCount: number;
  sources: string[];
};

export type EntityRelationEvidence = {
  source: string;
  relationEvidencePk: string;
  relationPk: number;
  recordAttributes: unknown;
  subjectAttributes: unknown;
  objectAttributes: unknown;
  evidence: unknown;
};

export type Identifier = {
  key: string;
  value: string;
};
