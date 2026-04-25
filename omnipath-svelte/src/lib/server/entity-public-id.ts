import { and, eq, or, type SQL } from "drizzle-orm";
import { entity } from "$lib/drizzle";
import { parsePublicEntityId, type PublicEntityIdParts } from "$lib/entity-public-id";

export function publicEntityIdWhere(publicIds: string[]): SQL | undefined {
  const parsed = publicIds
    .map(parsePublicEntityId)
    .filter((value): value is PublicEntityIdParts => Boolean(value));

  if (parsed.length === 0) {
    return undefined;
  }

  return or(
    ...parsed.map(({ canonicalIdentifierType, canonicalIdentifier }) => and(
      eq(entity.canonicalIdentifierType, canonicalIdentifierType),
      eq(entity.canonicalIdentifier, canonicalIdentifier),
    )),
  );
}
