import type {
  Association,
  AssociationEvidence as DbAssociationEvidence,
  Entity,
} from "@next-omnipath/drizzle";

export type EntityIdentifierRow = {
  entityPk: number;
  identifierType: string;
  identifier: string;
};

export type AssociationAnnotation = {
  term: string;
  value?: string | null;
  unit?: string | null;
};

export type AssociationEvidence = {
  evidence_serial: number;
  source: string;
  role_term_id?: string | null;
  stoichiometry?: string | null;
  annotations: AssociationAnnotation[];
  parent_annotations: AssociationAnnotation[];
  member_annotations: AssociationAnnotation[];
};

export type AssociationListRow = {
  association: Association;
  parent: Entity;
  member: Entity;
};

export type AssociationDetailsData = {
  association: Association;
  parent: Entity;
  member: Entity;
  parentIdentifiers: EntityIdentifierRow[];
  memberIdentifiers: EntityIdentifierRow[];
  evidence: AssociationEvidence[];
  rawEvidence: DbAssociationEvidence[];
};
