import type {
  InteractionAnnotationValue,
  InteractionEvidenceItem,
  InteractionRecord,
} from "@/lib/relations/semantics";
import type { EntityWithIdentifiers } from "@/lib/queries/entity";

export type InteractionAnnotation = InteractionAnnotationValue;
export type InteractionEvidence = InteractionEvidenceItem;
export type InteractionDetailsData = {
  interaction: InteractionRecord;
  entityA: EntityWithIdentifiers;
  entityB: EntityWithIdentifiers;
  evidence: InteractionEvidenceItem[];
  interactionAnnotations: InteractionAnnotationValue[];
  rawEvidence: import("@next-omnipath/drizzle").EntityRelationEvidence[];
};

export type InteractionListRow = {
  interaction: InteractionRecord;
  entityA: EntityWithIdentifiers;
  entityB: EntityWithIdentifiers;
};

export type InteractionDirection = {
  direction: "a-b" | "b-a" | "undirected";
  sign: -1 | 0 | 1;
};
