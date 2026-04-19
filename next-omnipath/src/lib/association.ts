"use server";

import "server-only";

import { eq, inArray } from "drizzle-orm";
import type { SearchFilters } from "@/types/search";
import type { AssociationListRow } from "@/features/associations/types";
import type { SearchResponse } from "@/lib/search/types";
import { searchAssociations as searchAssociationsData } from "@/lib/search_data/search";
import { getDb } from "@/lib/db/client";
import { normalizeStringValues, publicEntityIdWhere, toPublicEntityId } from "@/lib/entity-public-id";
import {
  association,
  associationEvidence,
  entity,
  type Association,
  type AssociationEvidence,
} from "@next-omnipath/drizzle";

async function getEntityPkMapByPublicIds(publicIds: string[]): Promise<Map<string, number>> {
  const normalized = normalizeStringValues(publicIds);
  if (normalized.length === 0) {
    return new Map();
  }

  const where = publicEntityIdWhere(normalized);
  if (!where) {
    return new Map();
  }

  const rows = await getDb()
    .select({
      entityPk: entity.entityPk,
      canonicalIdentifier: entity.canonicalIdentifier,
      canonicalIdentifierType: entity.canonicalIdentifierType,
    })
    .from(entity)
    .where(where);

  return new Map(rows.map((row) => [toPublicEntityId(row), row.entityPk]));
}

export async function getAssociationById(associationPk: number): Promise<Association | null> {
  const rows = await getDb().select().from(association).where(eq(association.associationPk, associationPk)).limit(1);
  return rows[0] ?? null;
}

export async function getAssociationEvidence(associationPk: number): Promise<AssociationEvidence[]> {
  return getDb().select().from(associationEvidence).where(eq(associationEvidence.associationPk, associationPk));
}

export async function getAssociatedEntityPublicIdsByMemberPublicIds(publicIds: string[]): Promise<string[]> {
  const entityPkMap = await getEntityPkMapByPublicIds(publicIds);
  const memberEntityPks = Array.from(entityPkMap.values());
  if (memberEntityPks.length === 0) {
    return [];
  }

  const rows = await getDb()
    .selectDistinct({
      canonicalIdentifier: entity.canonicalIdentifier,
      canonicalIdentifierType: entity.canonicalIdentifierType,
    })
    .from(association)
    .innerJoin(entity, eq(entity.entityPk, association.parentEntityPk))
    .where(inArray(association.memberEntityPk, memberEntityPks));

  return rows.map((row) => toPublicEntityId(row));
}

export async function searchAssociations(
  query: string,
  filters: SearchFilters,
  limit: number = 20,
  offset: number = 0,
): Promise<SearchResponse<AssociationListRow>> {
  try {
    return await searchAssociationsData({
      query,
      limit,
      offset,
      filters,
    });
  } catch (error) {
    console.error("Error searching associations:", error);
    return {
      hits: [],
      estimatedTotalHits: 0,
      limit,
      offset,
      processingTimeMs: 0,
      query,
    };
  }
}
