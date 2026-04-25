import { and, eq, or, type SQL } from "drizzle-orm";
import { entity, type Entity } from "$lib/drizzle";

export interface PublicEntityIdParts {
  canonicalIdentifierType: string;
  canonicalIdentifier: string;
}

export function normalizeStringValues(values: Array<string | number | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => `${value ?? ""}`.trim()).filter(Boolean)));
}

export function parsePublicEntityId(publicId: string): PublicEntityIdParts | null {
  const trimmed = publicId.trim();
  if (!trimmed) return null;

  const separatorIndex = trimmed.indexOf("|");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return null;
  }

  return {
    canonicalIdentifierType: trimmed.slice(0, separatorIndex),
    canonicalIdentifier: trimmed.slice(separatorIndex + 1),
  };
}

export function toPublicEntityId(
  entityRow:
    | Pick<Entity, "canonicalIdentifierType" | "canonicalIdentifier">
    | {
      canonicalIdentifierType?: string | null;
      canonicalIdentifier?: string | null;
      canonical_identifier_type?: string | null;
      canonical_identifier?: string | null;
    },
): string {
  const typedRow = entityRow as {
    canonicalIdentifierType?: string | null;
    canonicalIdentifier?: string | null;
    canonical_identifier_type?: string | null;
    canonical_identifier?: string | null;
  };

  const type = typedRow.canonicalIdentifierType || typedRow.canonical_identifier_type || "";
  const identifier = typedRow.canonicalIdentifier || typedRow.canonical_identifier || "";
  return `${type}|${identifier}`;
}

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
