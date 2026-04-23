"use server";

import { eq, inArray } from "drizzle-orm";
import { getDb, getPool } from "@/lib/db/client";
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

  const client = await getPool().connect();
  try {
    const queryText = `SELECT
      ei.identifier,
      e.entity_pk,
      e.canonical_identifier,
      e.canonical_identifier_type,
      e.entity_type,
      e.taxonomy_id,
      e.entity_attributes,
      e.sources
    FROM entity_identifier ei
    JOIN entity e ON e.entity_pk = ei.entity_pk
    WHERE %WHERE%
    ORDER BY e.entity_pk`;

    type QueryRow = {
      identifier: string;
      entity_pk: string;
      canonical_identifier: string;
      canonical_identifier_type: string;
      entity_type: string | null;
      taxonomy_id: string | null;
      entity_attributes: unknown;
      sources: string[];
    };

    const exactResult = await client.query<QueryRow>(
      queryText.replace("%WHERE%", `ei.identifier = ANY($1::text[])`),
      [normalized],
    );

    const exactMatchedKeys = new Set(exactResult.rows.map((row) => row.identifier.toLowerCase()));
    const loweredMisses = Array.from(
      new Set(
        normalized
          .map((identifier) => identifier.toLowerCase())
          .filter((identifier) => !exactMatchedKeys.has(identifier)),
      ),
    );

    const fallbackResult = loweredMisses.length
      ? await client.query<QueryRow>(
          queryText.replace("%WHERE%", `LOWER(ei.identifier) = ANY($1::text[])`),
          [loweredMisses],
        )
      : { rows: [] as QueryRow[] };

    const matchMap = new Map<string, string[]>();
    const entityMap = new Map<number, Entity>();

    for (const row of [...exactResult.rows, ...fallbackResult.rows]) {
      const key = row.identifier.toLowerCase();
      const entityPk = Number(row.entity_pk);
      const entityRow: Entity = {
        entityPk,
        canonicalIdentifier: row.canonical_identifier,
        canonicalIdentifierType: row.canonical_identifier_type,
        entityType: row.entity_type,
        taxonomyId: row.taxonomy_id,
        entityAttributes: row.entity_attributes as Entity["entityAttributes"],
        sources: row.sources,
      };

      if (!entityMap.has(entityPk)) {
        entityMap.set(entityPk, entityRow);
      }

      const entityIds = matchMap.get(key) || [];
      const entityId = toPublicEntityId(entityRow);
      if (!entityIds.includes(entityId)) {
        entityIds.push(entityId);
      }
      matchMap.set(key, entityIds);
    }

    return {
      matches: normalized.map((identifier) => ({
        identifier,
        entityIds: matchMap.get(identifier.toLowerCase()) || [],
      })),
      entities: Array.from(entityMap.values()),
    };
  } finally {
    client.release();
  }
}
