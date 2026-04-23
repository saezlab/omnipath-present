"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { entity, entityIdentifier, type Entity, type EntityIdentifier } from "@next-omnipath/drizzle";
import { normalizeStringValues, toPublicEntityId } from "@/lib/entity-public-id";

export async function getIdentifiersByEntityPk(entityPk: number): Promise<EntityIdentifier[]> {
  const db = getDb();
  return db.select().from(entityIdentifier).where(eq(entityIdentifier.entityPk, entityPk));
}

export async function getIdentifiersByEntityPks(entityPks: number[]): Promise<EntityIdentifier[]> {
  const normalized = Array.from(new Set(entityPks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];
  const db = getDb();
  return db.select().from(entityIdentifier).where(inArray(entityIdentifier.entityPk, normalized));
}

export async function resolveEntityIdentifiers(identifiers: string[]): Promise<{
  matches: Array<{ identifier: string; entityIds: string[] }>;
  entities: Entity[];
}> {
  const normalized = normalizeStringValues(identifiers);
  if (normalized.length === 0) return { matches: [], entities: [] };

  const lowered = normalized.map((id) => id.toLowerCase());
  const db = getDb();

  const rows = await db
    .select()
    .from(entityIdentifier)
    .innerJoin(entity, eq(entity.entityPk, entityIdentifier.entityPk))
    .where(sql`LOWER(${entityIdentifier.identifier}) = ANY(${lowered})`);

  const rowsByInput = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.entity_identifier.identifier.toLowerCase();
    const current = rowsByInput.get(key) || [];
    current.push(row);
    rowsByInput.set(key, current);
  }

  const entityById = new Map<string, Entity>();
  const matches = normalized.map((identifier) => {
    const matchedRows = rowsByInput.get(identifier.toLowerCase()) || [];
    const entityIds = new Set<string>();

    for (const row of matchedRows) {
      const entityId = toPublicEntityId(row.entity);
      entityIds.add(entityId);
      if (!entityById.has(entityId)) {
        entityById.set(entityId, row.entity);
      }
    }

    return { identifier, entityIds: Array.from(entityIds) };
  });

  return {
    matches,
    entities: Array.from(entityById.values()),
  };
}
