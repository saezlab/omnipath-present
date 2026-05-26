import type { Entity, EntityIdentifier, Identifier as DrizzleIdentifier } from '$lib/drizzle';

export type Identifier = DrizzleIdentifier;
export type EntityRecord = Entity;
export type EntityWithIdentifiers = Entity & {
  identifiers: EntityIdentifier[];
  identifiersTotal?: number;
  relationCount?: number;
};
export type HydratedEntityRecord = EntityWithIdentifiers;
