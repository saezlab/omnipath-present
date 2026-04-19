"use server";

import "server-only";

import { eq, sql } from "drizzle-orm";
import { entity, entityIdentifier, type Identifier } from "@next-omnipath/drizzle";
import { getDb } from "@/lib/db/client";
import { getEntityDisplayName, getEntityTypeLabel } from "@/lib/entities/display";
import { toPublicEntityId } from "@/lib/entity-public-id";

interface ResolvedEntityRow {
  matchedIdentifier: string;
  entityPk: number;
  canonicalIdentifier: string;
  canonicalIdentifierType: string;
  entityType: string | null;
  identifiers: Identifier[] | null;
  sources: string[] | null;
  taxonomyId: string | null;
  entityAttributes: unknown;
}

export interface ResolvedEntityLookupResponse {
  matches: Array<{ identifier: string; entityIds: string[] }>;
  entities: Array<{
    id: string;
    entity_id: string;
    type: "entity";
    entityPk: number;
    canonicalIdentifier: string;
    canonicalIdentifierType: string;
    entityType: string | null;
    identifiers: Identifier[];
    sources: string[];
    taxonomyId: string | null;
    entityAttributes: unknown;
    matchRank: null;
    display_name: string;
    canonical_identifier: string;
    canonical_identifier_type: string;
    entity_type: string | null;
    taxonomy_id: string | null;
    entity_attributes: unknown;
  }>;
}

function normalizeIdentifiers(identifiers: string[]): string[] {
  return Array.from(new Set(identifiers.map((identifier) => identifier.trim()).filter(Boolean)));
}

export async function resolveEntityIdentifiers(identifiers: string[]): Promise<ResolvedEntityLookupResponse> {
  const normalizedIdentifiers = normalizeIdentifiers(identifiers);
  if (normalizedIdentifiers.length === 0) {
    return { matches: [], entities: [] };
  }

  try {
    const db = getDb();
    const lowered = normalizedIdentifiers.map((identifier) => identifier.toLowerCase());

    const rows = await db
      .select({
        matchedIdentifier: entityIdentifier.identifier,
        entityPk: entity.entityPk,
        canonicalIdentifier: entity.canonicalIdentifier,
        canonicalIdentifierType: entity.canonicalIdentifierType,
        entityType: entity.entityType,
        identifiers: entity.identifiers,
        sources: entity.sources,
        taxonomyId: entity.taxonomyId,
        entityAttributes: entity.entityAttributes,
      })
      .from(entityIdentifier)
      .innerJoin(entity, eq(entity.entityPk, entityIdentifier.entityPk))
      .where(sql`LOWER(${entityIdentifier.identifier}) = ANY(${lowered})`);

    const rowsByInput = new Map<string, ResolvedEntityRow[]>();
    for (const row of rows as ResolvedEntityRow[]) {
      const key = row.matchedIdentifier.toLowerCase();
      const current = rowsByInput.get(key) || [];
      current.push(row);
      rowsByInput.set(key, current);
    }

    const entityById = new Map<string, ResolvedEntityLookupResponse["entities"][number]>();
    const matches = normalizedIdentifiers.map((identifier) => {
      const matchedRows = rowsByInput.get(identifier.toLowerCase()) || [];
      const seenEntityIds = new Set<string>();
      const entityIds: string[] = [];

      for (const row of matchedRows) {
        const entityId = toPublicEntityId(row);
        if (seenEntityIds.has(entityId)) continue;
        seenEntityIds.add(entityId);
        entityIds.push(entityId);

        if (!entityById.has(entityId)) {
          const entityRecord = {
            entityPk: row.entityPk,
            canonicalIdentifier: row.canonicalIdentifier,
            canonicalIdentifierType: row.canonicalIdentifierType,
            entityType: row.entityType,
            identifiers: (row.identifiers || []) as Identifier[],
            sources: row.sources || [],
            taxonomyId: row.taxonomyId,
            entityAttributes: row.entityAttributes,
          };

          entityById.set(entityId, {
            id: entityId,
            entity_id: entityId,
            type: "entity",
            entityPk: row.entityPk,
            canonicalIdentifier: row.canonicalIdentifier,
            canonicalIdentifierType: row.canonicalIdentifierType,
            entityType: row.entityType,
            identifiers: (row.identifiers || []) as Identifier[],
            sources: row.sources || [],
            taxonomyId: row.taxonomyId,
            entityAttributes: row.entityAttributes,
            matchRank: null,
            display_name: getEntityDisplayName(entityRecord),
            canonical_identifier: row.canonicalIdentifier,
            canonical_identifier_type: row.canonicalIdentifierType,
            entity_type: row.entityType,
            taxonomy_id: row.taxonomyId,
            entity_attributes: row.entityAttributes,
          });
        }
      }

      return {
        identifier,
        entityIds,
      };
    });

    const entities = Array.from(entityById.values()).sort((a, b) => {
      const typeCompare = (getEntityTypeLabel({ entityType: a.entity_type } as never) || "").localeCompare(
        getEntityTypeLabel({ entityType: b.entity_type } as never) || "",
      );
      if (typeCompare !== 0) return typeCompare;
      return a.display_name.localeCompare(b.display_name);
    });

    return { matches, entities };
  } catch (error) {
    console.error("Error resolving entity identifiers:", error);
    return { matches: [], entities: [] };
  }
}
