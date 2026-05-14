import type { Entity, Identifier as LegacyIdentifier } from "$lib/drizzle";
import type { EntityWithIdentifiers } from "$lib/types/entities";
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
  return entityType ? getIdentifierTypeLabel(entityType) : "Entity";
}

export function isSmallMoleculeEntity(entity: EntityLike): boolean {
  const typeLabel = getEntityTypeLabel(entity).toLowerCase().replace(/[\s_]/g, "");
  return typeLabel === "smallmolecule"
    || typeLabel === "compound"
    || typeLabel === "metabolite"
    || typeLabel === "drug"
    || typeLabel === "lipid";
}

export function isCvTermEntity(entity: EntityLike): boolean {
  const typeLabel = getEntityTypeLabel(entity).toLowerCase().replace(/[\s_]/g, "");
  return typeLabel === "cvterm";
}

export function getEntityIdentifiers(entity: EntityLike): EntityIdentifierLike[] {
  const typedEntity = entity as { identifiers?: unknown };
  const raw = Array.isArray(typedEntity.identifiers) ? typedEntity.identifiers : [];
  return raw
    .map((item: unknown) => {
      if (!isObject(item)) return null;
      const key = typeof item.key === "string"
        ? item.key
        : typeof item.identifierType === "string"
          ? item.identifierType
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

export function getIdentifierTypeLabel(identifierType: string): string {
  const text = identifierType.trim();
  if (!text) return "";
  const parts = text.split(":");

  if (parts.length >= 3 && /^[A-Z][A-Z0-9_-]*$/.test(parts[0])) {
    return parts.slice(2).join(":").trim() || text;
  }

  if (parts.length >= 3 && /^[A-Z][A-Z0-9_-]*$/.test(parts[parts.length - 2])) {
    return parts.slice(0, -2).join(":").trim() || text;
  }

  return parts[parts.length - 1]?.trim() || text;
}

export function getIdentifierDisplayTypeForValue(entity: EntityLike, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const identifier = getEntityIdentifiers(entity).find((item) => item.value.trim() === trimmed);
  if (identifier) return identifier.key;

  if (entity.canonicalIdentifier?.trim() === trimmed) {
    return entity.canonicalIdentifierType;
  }

  return undefined;
}

function identifierLabel(identifierType: string): string {
  return getIdentifierTypeLabel(identifierType).toLowerCase();
}

function normalizedIdentifierTypeText(identifierType: string): string {
  return [identifierType, getIdentifierTypeLabel(identifierType)]
    .join(" ")
    .toLowerCase()
    .replace(/[_-]/g, " ");
}

function identifierTypeMatches(identifierType: string, types: string[]): boolean {
  const normalized = normalizedIdentifierTypeText(identifierType);
  return types.some((type) => normalized.includes(type.toLowerCase().replace(/[_-]/g, " ")));
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

const DESCRIPTION_ATTRIBUTE_TERM_KEYS = [
  "OM:0603:Function",
  "OM:0605:Disease",
  "OM:0604:Subcellular Location",
] as const;

export function getAllowedEntityDescriptions(entity: EntityLike): string[] {
  if (!Array.isArray(entity.entityAttributes)) return [];

  const allowedTerms = new Set(DESCRIPTION_ATTRIBUTE_TERM_KEYS.map((term) => term.toLowerCase()));
  const allowedLabels = new Set(DESCRIPTION_ATTRIBUTE_TERM_KEYS.map((term) => getIdentifierTypeLabel(term).toLowerCase()));

  return entity.entityAttributes.flatMap((attribute) => {
    if (!isObject(attribute)) return [];
    const term = typeof attribute.term === "string" ? attribute.term.trim().toLowerCase() : "";
    const value = typeof attribute.value === "string" ? attribute.value.trim() : "";
    const label = getIdentifierTypeLabel(term).toLowerCase();
    if (!term || !value || (!allowedTerms.has(term) && !allowedLabels.has(label))) return [];
    return [value];
  });
}

function getPreferredName(names: string[]): string | undefined {
  const scored = uniqueStrings(names).map((name, index) => {
    const trimmed = name.trim();
    let score = 0;
    if (/^https?:\/\//i.test(trimmed)) score += 100;
    if (/^(MLS|SMR|cid_|ZINC|SID_|CID_|InChI=)/i.test(trimmed)) score += 100;
    if (/^[A-Z0-9._-]{1,3}$/.test(trimmed)) score += 10;
    if (/^[A-Z][0-9A-Z]{3,}$/.test(trimmed)) score += 8;
    if (trimmed.length > 80) score += 25;
    if (trimmed.length > 40) score += 8;
    if (trimmed.length < 4) score += 4;
    if (/^[A-Z][a-z]/.test(trimmed)) score -= 3;
    return { name: trimmed, score, index };
  });

  scored.sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.index - b.index);
  return scored[0]?.name;
}

export function getIdentifiersByType(entity: EntityLike, types: string[]): string[] {
  const values: string[] = [];
  for (const identifier of getEntityIdentifiers(entity)) {
    const value = identifier.value.trim();
    if (identifierTypeMatches(identifier.key, types) && value) {
      values.push(value);
    }
  }
  return uniqueStrings(values);
}

function getIdentifierByType(entity: EntityLike, types: string[]): string | undefined {
  return getIdentifiersByType(entity, types)[0];
}

export function getEntityDisplayName(entity: EntityLike): string {
  const { names, geneSymbols } = classifyEntityIdentifiers(entity);
  const publicId = getEntityPublicId(entity);
  const entityTypeLabel = getEntityTypeLabel(entity).toLowerCase();

  if (isSmallMoleculeEntity(entity)) {
    const preferredName = getPreferredName(names);
    const chebiId = getIdentifierByType(entity, ["chebi"]);
    const pubchemId = getIdentifierByType(entity, ["pubchem compound", "pubchem"]);
    const hmdbId = getIdentifierByType(entity, ["hmdb"]);
    const chemblId = getIdentifierByType(entity, ["chembl"]);
    if (preferredName && !/^\d+$/.test(preferredName) && !/^InChI=/i.test(preferredName)) return preferredName;
    const identifierFallbacks = [chebiId, chemblId, hmdbId, pubchemId];
    return identifierFallbacks.find((identifier) => identifier && !/^\d+$/.test(identifier))
      || identifierFallbacks.find(Boolean)
      || preferredName
      || entity.canonicalIdentifier
      || publicId;
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

  if (isCvTermEntity(entity)) {
    const primary = names[0];
    const canonicalIdentifier = entity.canonicalIdentifier || undefined;
    return primary && canonicalIdentifier && primary !== canonicalIdentifier ? canonicalIdentifier : undefined;
  }

  if (entityTypeLabel === "protein") {
    const canonicalIdentifier = entity.canonicalIdentifier || undefined;
    const primary = geneSymbols[0];
    if (primary && canonicalIdentifier && primary !== canonicalIdentifier) {
      return canonicalIdentifier;
    }
    const uniprotId = getIdentifierByType(entity, ["uniprot", "uniprotkb"]);
    if (uniprotId && uniprotId !== primary) return uniprotId;
    return names[0] && names[0] !== primary ? names[0] : undefined;
  }

  if (isSmallMoleculeEntity(entity)) {
    return getIdentifierByType(entity, ["chebi"])
      || getIdentifierByType(entity, ["pubchem compound", "pubchem"])
      || getIdentifierByType(entity, ["hmdb"])
      || getIdentifierByType(entity, ["chembl"])
      || undefined;
  }

  if (geneSymbols[0] && names[0] && geneSymbols[0] !== names[0]) {
    return names[0];
  }

  return undefined;
}

export function getEntitySmiles(entity: EntityLike): string | null {
  return getIdentifierByType(entity, ["smiles", "canonical smiles", "canonical_smiles", "biotin tag", "biotin"]) || null;
}
