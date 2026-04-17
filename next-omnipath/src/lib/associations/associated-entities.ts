import { INDEXES } from "@/lib/meilisearch/client";
import { searchAssociationsMeilisearch } from "@/lib/meilisearch/search";

export interface AssociatedEntityScope {
  seedEntityIds: string[];
  associatedEntityIds: string[];
  expandedEntityIds: string[];
}

export async function getAssociatedEntityScope(entityIds: Array<string | number>): Promise<AssociatedEntityScope> {
  const seedEntityIds = Array.from(new Set(entityIds.map((id) => String(id).trim()).filter(Boolean)));
  if (seedEntityIds.length === 0) {
    return {
      seedEntityIds: [],
      associatedEntityIds: [],
      expandedEntityIds: [],
    };
  }

  const response = await searchAssociationsMeilisearch({
    query: "",
    index: INDEXES.ASSOCIATIONS,
    limit: 10000,
    offset: 0,
    filters: { member_entity_ids: seedEntityIds },
  });

  const associatedEntityIds = Array.from(
    new Set(
      response.hits
        .map((hit) => String(hit.parent_entity_id ?? "").trim())
        .filter((id) => id && !seedEntityIds.includes(id)),
    ),
  );

  return {
    seedEntityIds,
    associatedEntityIds,
    expandedEntityIds: [...seedEntityIds, ...associatedEntityIds],
  };
}
