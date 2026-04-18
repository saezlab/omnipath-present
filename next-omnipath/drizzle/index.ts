import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import { association, entity, entityIdentifier, interaction } from "./schema";

export * from "./schema";

export type Entity = InferSelectModel<typeof entity>;
export type EntityInsert = InferInsertModel<typeof entity>;
export type EntityIdentifier = InferSelectModel<typeof entityIdentifier>;
export type Interaction = InferSelectModel<typeof interaction>;
export type Association = InferSelectModel<typeof association>;

export type Identifier = {
  key: string;
  value: string;
};
