import type { EntityWithIdentifiers } from "@/lib/queries/entity";
import type { Entity, Identifier as DrizzleIdentifier } from "@next-omnipath/drizzle";

export type Identifier = DrizzleIdentifier;
export type EntityRecord = Entity;
export type HydratedEntityRecord = EntityWithIdentifiers;
