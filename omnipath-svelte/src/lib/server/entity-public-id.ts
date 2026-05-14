import { parsePublicEntityId, type PublicEntityIdParts } from "$lib/entity-public-id";

export function parsePublicEntityIds(publicIds: string[]): PublicEntityIdParts[] {
  return publicIds
    .map(parsePublicEntityId)
    .filter((value): value is PublicEntityIdParts => Boolean(value));
}
