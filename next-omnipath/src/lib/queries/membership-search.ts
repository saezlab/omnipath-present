"use server";

import { getEntitiesByPublicIds } from "@/lib/queries/entity";
import { getAssociatedEntityIds as getAssociatedEntityIdsByPks } from "@/lib/queries/relation";

export async function getAssociatedEntityIds(entityIds: string[]): Promise<{ associatedEntityIds: string[] }> {
  const entities = await getEntitiesByPublicIds(entityIds);
  const associatedEntityIds = await getAssociatedEntityIdsByPks(entities.map((entity) => entity.entityPk));
  return { associatedEntityIds };
}
