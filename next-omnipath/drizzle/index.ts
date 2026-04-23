import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import {
  entity,
  entityIdentifier,
  entityRelation,
  entityRelationEvidence,
  ontologyTerm,
} from "./schema";

export * from "./schema";

export type Entity = InferSelectModel<typeof entity>;
export type EntityInsert = InferInsertModel<typeof entity>;
export type EntityIdentifier = InferSelectModel<typeof entityIdentifier>;
export type EntityRelation = InferSelectModel<typeof entityRelation>;
export type EntityRelationEvidence = InferSelectModel<typeof entityRelationEvidence>;
export type OntologyTerm = InferSelectModel<typeof ontologyTerm>;

export type Identifier = {
  key: string;
  value: string;
};
