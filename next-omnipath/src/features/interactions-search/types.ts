import type { EntityRelation, EntityRelationEvidence } from "@next-omnipath/drizzle";
import type { EntityWithIdentifiers } from "@/lib/queries/entity";

export type InteractionListRow = {
  relation: EntityRelation;
  subjectEntity: EntityWithIdentifiers;
  objectEntity: EntityWithIdentifiers;
};

export type InteractionDetailsData = InteractionListRow & {
  evidence: EntityRelationEvidence[];
};
