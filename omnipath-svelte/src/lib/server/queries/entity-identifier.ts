import { getPool } from "$lib/server/db/client";
import type { Entity, EntityIdentifier } from "$lib/drizzle";
import { normalizeStringValues, toPublicEntityId } from "$lib/entity-public-id";
import {
  canonicalIdentifierTypeNameSql,
  entityTypeNameSql,
} from "$lib/server/queries/sql-fragments";

const SEARCH_SCHEMA = () => process.env.OMNIPATH_PG_SCHEMA || "public";

export async function getIdentifiersByEntityPk(entityPk: string | number): Promise<EntityIdentifier[]> {
  return getIdentifiersByEntityPks([entityPk]);
}

function normalizeIdValues(values: Array<string | number>): string[] {
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}

export async function getIdentifiersByEntityPks(entityPks: Array<string | number>): Promise<EntityIdentifier[]> {
  const normalized = normalizeIdValues(entityPks);
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
         eil.entity_id,
         i.identifier_id,
         it.name AS identifier_type,
         i.value AS identifier
       FROM ${schema}.entity_identifier_lookup eil
       JOIN ${schema}.identifier_evidence i
         ON i.identifier_id = eil.identifier_id
       JOIN ${schema}.vocab_identifier_type it
         ON it.identifier_type_id = i.identifier_type_id
       WHERE eil.entity_id = ANY($1::uuid[])
         AND i.value <> ''
       ORDER BY eil.entity_id, it.name, i.value`,
      [normalized],
    );

    return result.rows.map((row) => ({
      ...(row.identifier_id == null ? {} : { id: String(row.identifier_id) }),
      entityPk: String(row.entity_id),
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
      `WITH requested AS (
         SELECT unnest($1::text[]) AS query_identifier
       )
       SELECT DISTINCT
         requested.query_identifier AS lookup_identifier,
         e.entity_id,
         e.canonical_identifier AS id,
         ${canonicalIdentifierTypeNameSql(schema, "e")} AS id_type,
         ${entityTypeNameSql(schema, "e")} AS entity_type,
         e.taxonomy_id
       FROM requested
       JOIN ${schema}.identifier_evidence i
         ON LOWER(i.value) = requested.query_identifier
       JOIN ${schema}.entity_identifier_lookup eil
         ON eil.identifier_id = i.identifier_id
       JOIN ${schema}.entity e
         ON e.entity_id = eil.entity_id
       ORDER BY entity_id`,
      [lowered],
    );

    const matchMap = new Map<string, string[]>();
    const entityMap = new Map<string, Entity>();
    for (const row of result.rows) {
      const entityPk = String(row.entity_id);
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
