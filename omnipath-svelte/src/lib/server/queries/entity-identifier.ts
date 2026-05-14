import { getPool } from "$lib/server/db/client";
import type { Entity, EntityIdentifier } from "$lib/drizzle";
import { normalizeStringValues, toPublicEntityId } from "$lib/entity-public-id";

const SEARCH_SCHEMA = () => process.env.OMNIPATH_PG_SCHEMA || "public";

export async function getIdentifiersByEntityPk(entityPk: number): Promise<EntityIdentifier[]> {
  return getIdentifiersByEntityPks([entityPk]);
}

export async function getIdentifiersByEntityPks(entityPks: number[]): Promise<EntityIdentifier[]> {
  const normalized = Array.from(new Set(entityPks.filter(Number.isFinite)));
  if (normalized.length === 0) return [];

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const result = await client.query<{
      entity_id: string | number;
      identifier_id: string | number;
      identifier_type: string;
      identifier: string;
    }>(
      `SELECT DISTINCT
         eer.entity_id,
         i.identifier_id,
         i.type AS identifier_type,
         i.value AS identifier
       FROM ${schema}.entity_evidence_resolution eer
       JOIN ${schema}.entity_evidence_identifier eei ON eei.entity_evidence_id = eer.entity_evidence_id
       JOIN ${schema}.identifier i ON i.identifier_id = eei.identifier_id
       WHERE eer.entity_id = ANY($1::bigint[])
       ORDER BY eer.entity_id, i.type, i.value`,
      [normalized],
    );

    return result.rows.map((row) => ({
      id: Number(row.identifier_id),
      entityPk: Number(row.entity_id),
      identifier: row.identifier,
      identifierType: row.identifier_type,
    }));
  } finally {
    client.release();
  }
}

export async function resolveEntityIdentifiers(identifiers: string[]): Promise<{
  matches: Array<{ identifier: string; entityIds: string[] }>;
  entities: Entity[];
}> {
  const normalized = normalizeStringValues(identifiers);
  if (normalized.length === 0) return { matches: [], entities: [] };

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const lowered = normalized.map((identifier) => identifier.toLowerCase());
    const result = await client.query<{
      lookup_identifier: string;
      entity_id: string | number;
      id: string;
      id_type: string;
      entity_type: string | null;
      taxonomy_id: string | null;
    }>(
      `SELECT DISTINCT
         i.value AS lookup_identifier,
         e.entity_id,
         e.id,
         e.id_type,
         e.entity_type,
         e.taxonomy_id
       FROM ${schema}.identifier i
       JOIN ${schema}.entity_evidence_identifier eei ON eei.identifier_id = i.identifier_id
       JOIN ${schema}.entity_evidence_resolution eer ON eer.entity_evidence_id = eei.entity_evidence_id
       JOIN ${schema}.entity e ON e.entity_id = eer.entity_id
       WHERE LOWER(i.value) = ANY($1::text[])
       ORDER BY e.entity_id`,
      [lowered],
    );

    const matchMap = new Map<string, string[]>();
    const entityMap = new Map<number, Entity>();
    for (const row of result.rows) {
      const entityPk = Number(row.entity_id);
      const entityRow: Entity = {
        entityPk,
        canonicalIdentifier: row.id,
        canonicalIdentifierType: row.id_type,
        entityType: row.entity_type,
        taxonomyId: row.taxonomy_id,
        entityAttributes: null,
        sources: [],
      };
      entityMap.set(entityPk, entityRow);

      const key = row.lookup_identifier.toLowerCase();
      const ids = matchMap.get(key) ?? [];
      const publicId = toPublicEntityId(entityRow);
      if (!ids.includes(publicId)) ids.push(publicId);
      matchMap.set(key, ids);
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
