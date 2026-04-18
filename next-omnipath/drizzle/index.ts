import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { InferSelectViewModel } from "drizzle-orm/sql";

import {
  association,
  associationEvidence,
  entity,
  entityAnnotation,
  entityIdentifier,
  entitySummary,
  interaction,
  interactionAnnotation,
  interactionEvidence,
} from "./schema";

export * from "./schema";

export type Entity = InferSelectModel<typeof entity>;
export type EntityInsert = InferInsertModel<typeof entity>;
export type EntityIdentifier = InferSelectModel<typeof entityIdentifier>;
export type EntityAnnotation = InferSelectModel<typeof entityAnnotation>;
export type EntitySummary = InferSelectViewModel<typeof entitySummary>;
export type Interaction = InferSelectModel<typeof interaction>;
export type InteractionAnnotation = InferSelectModel<typeof interactionAnnotation>;
export type InteractionEvidence = InferSelectModel<typeof interactionEvidence>;
export type Association = InferSelectModel<typeof association>;
export type AssociationEvidence = InferSelectModel<typeof associationEvidence>;

export type Identifier = {
  key: string;
  value: string;
};
