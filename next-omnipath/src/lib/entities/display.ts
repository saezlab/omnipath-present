import type { Entity, Identifier as LegacyIdentifier } from "@next-omnipath/drizzle";
import type { EntityWithIdentifiers } from "@/lib/queries/entity";
export type EntityLike = Entity | EntityWithIdentifiers;
export type EntityIdentifierLike = LegacyIdentifier;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isEntityRecord(entity: EntityLike): entity is Entity {
  return "entityPk" in entity && "canonicalIdentifier" in entity;
}

export function getEntityPublicId(entity: EntityLike): string {
  return `${entity.canonicalIdentifierType}|${entity.canonicalIdentifier}`;
}

export function getEntityTypeValue(entity: EntityLike): string | undefined | null {
  return entity.entityType;
}

export function getEntityTypeLabel(entity: EntityLike): string {
  const entityType = getEntityTypeValue(entity);
  return entityType ? entityType.split(":")[0] : "Entity";
}

export function isSmallMoleculeEntity(entity: EntityLike): boolean {
  const typeLabel = getEntityTypeLabel(entity).toLowerCase().replace(/[\s_]/g, "");
  return typeLabel === "smallmolecule"
    || typeLabel === "compound"
    || typeLabel === "metabolite"
    || typeLabel === "drug"
    || typeLabel === "lipid";
}

export function getEntityIdentifiers(entity: EntityLike): EntityIdentifierLike[] {
  const typedEntity = entity as { identifiers?: unknown };
  const raw = Array.isArray(typedEntity.identifiers) ? typedEntity.identifiers : [];
  return raw
    .map((item: unknown) => {
      if (!isObject(item)) return null;
      const key = typeof item.key === "string"
        ? item.key
        : typeof item.identifier_type === "string"
          ? item.identifier_type
          : null;
      const value = typeof item.value === "string"
        ? item.value
        : typeof item.identifier === "string"
          ? item.identifier
          : null;

      if (!key || !value) return null;
      return { key, value } satisfies EntityIdentifierLike;
    })
    .filter((identifier): identifier is EntityIdentifierLike => Boolean(identifier));
}

function identifierLabel(identifierType: string): string {
  const text = identifierType.trim();
  if (!text) return "";
  const parts = text.split(":");

  if (parts.length >= 3 && !/^[A-Z][A-Z0-9_-]*$/.test(parts[0])) {
    return parts[0].toLowerCase();
  }

  if (parts.length >= 3) {
    return parts.slice(2).join(":").toLowerCase();
  }

  return text.toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

export function classifyEntityIdentifiers(entity: EntityLike): {
  names: string[];
  synonyms: string[];
  geneSymbols: string[];
} {
  const names: string[] = [];
  const synonyms: string[] = [];
  const geneSymbols: string[] = [];

  for (const identifier of getEntityIdentifiers(entity)) {
    const label = identifierLabel(identifier.key);
    const value = identifier.value.trim();
    if (!value) continue;

    if (label.includes("gene name primary")) {
      geneSymbols.push(value);
      continue;
    }
    if (label.includes("gene name synonym")) {
      synonyms.push(value);
      continue;
    }
    if (label === "name" || label.endsWith(":name") || label.includes(" entry name")) {
      names.push(value);
      continue;
    }
    if (label.includes("synonym")) {
      synonyms.push(value);
    }
  }

  return {
    names: uniqueStrings(names),
    synonyms: uniqueStrings(synonyms),
    geneSymbols: uniqueStrings(geneSymbols),
  };
}

function mapEntityAttributesToDescriptions(attributes: unknown): string[] {
  if (!Array.isArray(attributes)) return [];

  const preferredKeywords = [
    "function",
    "description",
    "disease",
    "subcellular location",
    "pathway",
    "activity regulation",
    "tissue specificity",
    "developmental stage",
    "note",
  ];

  const preferred: string[] = [];
  const fallback: string[] = [];

  for (const attribute of attributes) {
    if (!isObject(attribute)) continue;
    const value = typeof attribute.value === "string" ? attribute.value.trim() : "";
    if (!value) continue;
    const term = typeof attribute.term === "string" ? attribute.term : "";
    const label = identifierLabel(term);
    if (preferredKeywords.some((keyword) => label.includes(keyword))) {
      preferred.push(value);
    } else {
      fallback.push(value);
    }
  }

  return uniqueStrings([...preferred, ...fallback]).slice(0, 20);
}

export function getEntityDescriptions(entity: EntityLike): string[] {
  return mapEntityAttributesToDescriptions(entity.entityAttributes);
}

function getShortestName(names: string[]): string | undefined {
  const validNames = names.filter((name) => !/^(MLS|SMR|cid_|ZINC|SID_|CID_)/i.test(name) && name.length > 3);
  if (validNames.length > 0) {
    return validNames.reduce((shortest, current) => current.length < shortest.length ? current : shortest);
  }
  return names[0];
}

function getIdentifierByType(entity: EntityLike, types: string[]): string | undefined {
  for (const identifier of getEntityIdentifiers(entity)) {
    const normalized = identifier.key.split(":")[0]?.toLowerCase() || "";
    if (types.some((type) => normalized.includes(type)) && identifier.value) {
      return identifier.value;
    }
  }
  return undefined;
}

export function getEntityDisplayName(entity: EntityLike): string {
  const { names, geneSymbols } = classifyEntityIdentifiers(entity);
  const publicId = getEntityPublicId(entity);
  const entityTypeLabel = getEntityTypeLabel(entity).toLowerCase();

  if (isSmallMoleculeEntity(entity)) {
    const shortName = getShortestName(names);
    const chemblId = getIdentifierByType(entity, ["chembl"]);
    const pubchemId = getIdentifierByType(entity, ["pubchem", "cid"]);
    if (chemblId) return chemblId;
    if (shortName && !/^\d+$/.test(shortName)) return shortName;
    return pubchemId || shortName || publicId;
  }

  if (entityTypeLabel === "protein") {
    const uniprotId = getIdentifierByType(entity, ["uniprot", "uniprotkb"]);
    return geneSymbols[0] || uniprotId || names[0] || entity.canonicalIdentifier || publicId;
  }

  return geneSymbols[0] || names[0] || entity.canonicalIdentifier || publicId;
}

export function getEntitySecondaryName(entity: EntityLike): string | undefined {
  const { names, geneSymbols } = classifyEntityIdentifiers(entity);
  const entityTypeLabel = getEntityTypeLabel(entity).toLowerCase();

  if (entityTypeLabel === "protein") {
    const canonicalIdentifier = entity.canonicalIdentifier || undefined;
    const primary = geneSymbols[0];
    if (primary && canonicalIdentifier && primary !== canonicalIdentifier) {
      return canonicalIdentifier;
    }
    return names[0] && names[0] !== primary ? names[0] : undefined;
  }

  if (geneSymbols[0] && names[0] && geneSymbols[0] !== names[0]) {
    return names[0];
  }

  return undefined;
}

export function getEntitySmiles(entity: EntityLike): string | null {
  for (const identifier of getEntityIdentifiers(entity)) {
    const idType = identifier.key.split(":")[0]?.toLowerCase().trim();
    if (idType === "biotin tag" || idType === "biotin" || idType === "smiles" || idType === "canonical_smiles") {
      return identifier.value;
    }
  }

  return null;
}
