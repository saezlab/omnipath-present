import type { EntityRelationEvidence } from "@next-omnipath/drizzle";
import type {
  AssociationEvidenceItem,
  InteractionAnnotationValue,
} from "@/lib/relations/semantics";
import type { EntityWithIdentifiers } from "@/lib/queries/entity";

export type AssociationAnnotation = InteractionAnnotationValue;
export type AssociationEvidence = AssociationEvidenceItem;

export type AssociationListRow = {
  association: {
    associationPk: number;
    relationPk: number;
    parentEntityPk: number;
    memberEntityPk: number;
    predicate: string;
    relationCategory: string;
    roleTermId: string | null;
    stoichiometry: string | null;
    evidenceCount: number;
    sources: string[];
  };
  parent: EntityWithIdentifiers;
  member: EntityWithIdentifiers;
};

export type EntityIdentifierRow = {
  entityPk: number;
  identifierType: string;
  identifier: string;
};

export type AssociationDetailsData = AssociationListRow & {
  parentIdentifiers: EntityIdentifierRow[];
  memberIdentifiers: EntityIdentifierRow[];
  evidence: AssociationEvidence[];
  rawEvidence: EntityRelationEvidence[];
};
