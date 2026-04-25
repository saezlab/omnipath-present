import type { Entity, EntityIdentifier, Identifier as DrizzleIdentifier } from '$lib/drizzle';

export type Identifier = DrizzleIdentifier;
export type EntityRecord = Entity;
export type EntityWithIdentifiers = Entity & { identifiers: EntityIdentifier[] };
export type HydratedEntityRecord = EntityWithIdentifiers;
