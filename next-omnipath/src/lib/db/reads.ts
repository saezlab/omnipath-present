import 'server-only';

import {
  and,
  countDistinct,
  eq,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  association,
  associationEvidence,
  entity,
  entityAnnotation,
  entityIdentifier,
  entitySummary,
  interaction,
  interactionAnnotation,
  interactionEvidence,
  type Association,
  type AssociationEvidence,
  type Entity,
  type EntityAnnotation,
  type EntityIdentifier,
  type EntitySummary,
  type Interaction,
  type InteractionAnnotation,
  type InteractionEvidence,
} from '@next-omnipath/drizzle';

import { getDb, getPool } from '@/lib/db/client';
import type { SearchFilters } from '@/types/search';

function uniqueStrings(values: Array<string | number | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => `${value ?? ''}`.trim()).filter(Boolean)));
}

function normalizePublicIds(publicIds: Array<string | number>): string[] {
  return uniqueStrings(publicIds);
}

function parsePublicEntityId(publicId: string): { canonicalIdentifierType: string; canonicalIdentifier: string } | null {
  const trimmed = publicId.trim();
  if (!trimmed) return null;

  const separatorIndex = trimmed.indexOf('|');
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return null;
  }

  return {
    canonicalIdentifierType: trimmed.slice(0, separatorIndex),
    canonicalIdentifier: trimmed.slice(separatorIndex + 1),
  };
}

export function toPublicEntityId(entityRow: Pick<Entity, 'canonicalIdentifierType' | 'canonicalIdentifier'>): string {
  return `${entityRow.canonicalIdentifierType}|${entityRow.canonicalIdentifier}`;
}

function publicIdWhere(publicIds: string[]): SQL | undefined {
  const parsed = publicIds
    .map(parsePublicEntityId)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

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

function normalizeEntityTypeFilterValue(value: string | null | undefined): string {
  const text = (value || '').trim();
  if (!text) return '';
  const parts = text.split(':');
  if (parts.length < 3) return text.toLowerCase();
  return `${parts[0].toLowerCase()}:${parts[1].toUpperCase()}:${parts.slice(2).join(':').toUpperCase()}`;
}

function normalizeInteractionTypeFilterValue(value: string | null | undefined): string {
  const text = (value || '').trim();
  if (!text) return '';
  return text
    .split('|')
    .map((part) => normalizeEntityTypeFilterValue(part))
    .sort()
    .join('|');
}

function normalizedEntityTypeSql(column: typeof entity.entityType): SQL {
  return sql`LOWER(split_part(${column}, ':', 3)) || ':' || split_part(${column}, ':', 1) || ':' || split_part(${column}, ':', 2)`;
}

async function getEntityPkMapByPublicIds(publicIds: string[]): Promise<Map<string, number>> {
  const normalized = normalizePublicIds(publicIds);
  if (normalized.length === 0) {
    return new Map();
  }

  const where = publicIdWhere(normalized);
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

  return new Map(rows.map((row) => [`${row.canonicalIdentifierType}|${row.canonicalIdentifier}`, row.entityPk]));
}

function buildEntityFilterConditions(filters: SearchFilters, scopedEntityPks?: number[]): SQL[] {
  const conditions: SQL[] = [];

  if (scopedEntityPks?.length) {
    conditions.push(inArray(entity.entityPk, scopedEntityPks));
  }

  if (filters.entity_types?.length) {
    const normalizedTypes = filters.entity_types
      .map((value) => normalizeEntityTypeFilterValue(String(value)))
      .filter(Boolean);
    if (normalizedTypes.length) {
      conditions.push(sql`${normalizedEntityTypeSql(entity.entityType)} = ANY(${normalizedTypes})`);
    }
  }

  if (filters.sources?.length) {
    const sources = uniqueStrings(filters.sources);
    if (sources.length) {
      conditions.push(sql`${entity.sources} && ${sources}`);
    }
  }

  if (filters.ncbi_tax_id?.length) {
    const taxonomyIds = uniqueStrings(filters.ncbi_tax_id);
    if (taxonomyIds.length) {
      conditions.push(inArray(entity.taxonomyId, taxonomyIds));
    }
  }

  if (filters.ontology_terms?.length) {
    const terms = uniqueStrings(filters.ontology_terms);
    if (terms.length) {
      conditions.push(sql`EXISTS (
        SELECT 1
        FROM entity_annotation ea_filter
        WHERE ea_filter.entity_pk = ${entity.entityPk}
          AND ea_filter.cv_term = ANY(${terms})
      )`);
    }
  }

  return conditions;
}

export async function getEntityByPublicId(publicId: string): Promise<Entity | null> {
  const rows = await getEntitiesByPublicIds([publicId]);
  return rows[0] ?? null;
}

export async function getEntitiesByPublicIds(publicIds: string[]): Promise<Entity[]> {
  const normalized = normalizePublicIds(publicIds);
  if (normalized.length === 0) {
    return [];
  }

  const where = publicIdWhere(normalized);
  if (!where) {
    return [];
  }

  const rows = await getDb().select().from(entity).where(where);
  const order = new Map(normalized.map((id, index) => [id, index]));
  return rows.sort((a, b) => (order.get(toPublicEntityId(a)) ?? Number.MAX_SAFE_INTEGER) - (order.get(toPublicEntityId(b)) ?? Number.MAX_SAFE_INTEGER));
}

export async function getEntitiesByPks(entityPks: number[]): Promise<Entity[]> {
  const normalized = Array.from(new Set(entityPks.filter((value) => Number.isFinite(value))));
  if (normalized.length === 0) {
    return [];
  }

  return getDb().select().from(entity).where(inArray(entity.entityPk, normalized));
}

export async function getEntityIdentifiers(entityPk: number): Promise<EntityIdentifier[]> {
  return getDb().select().from(entityIdentifier).where(eq(entityIdentifier.entityPk, entityPk));
}

export async function getEntityIdentifiersByEntityPks(entityPks: number[]): Promise<EntityIdentifier[]> {
  const normalized = Array.from(new Set(entityPks.filter((value) => Number.isFinite(value))));
  if (normalized.length === 0) {
    return [];
  }

  return getDb().select().from(entityIdentifier).where(inArray(entityIdentifier.entityPk, normalized));
}

export async function getEntityAnnotations(entityPk: number): Promise<EntityAnnotation[]> {
  return getDb().select().from(entityAnnotation).where(eq(entityAnnotation.entityPk, entityPk));
}

export async function getEntityAnnotationsByEntityPks(entityPks: number[]): Promise<EntityAnnotation[]> {
  const normalized = Array.from(new Set(entityPks.filter((value) => Number.isFinite(value))));
  if (normalized.length === 0) {
    return [];
  }

  return getDb().select().from(entityAnnotation).where(inArray(entityAnnotation.entityPk, normalized));
}

export async function getEntitySummary(entityPk: number): Promise<EntitySummary | null> {
  const rows = await getDb().select().from(entitySummary).where(eq(entitySummary.entityPk, entityPk)).limit(1);
  return rows[0] ?? null;
}

export async function getInteractionById(interactionPk: number): Promise<Interaction | null> {
  const rows = await getDb().select().from(interaction).where(eq(interaction.interactionPk, interactionPk)).limit(1);
  return rows[0] ?? null;
}

export async function getInteractionEvidence(interactionPk: number): Promise<InteractionEvidence[]> {
  return getDb().select().from(interactionEvidence).where(eq(interactionEvidence.interactionPk, interactionPk));
}

export async function getInteractionAnnotations(interactionPk: number): Promise<InteractionAnnotation[]> {
  return getDb().select().from(interactionAnnotation).where(eq(interactionAnnotation.interactionPk, interactionPk));
}

export async function getAssociationById(associationPk: number): Promise<Association | null> {
  const rows = await getDb().select().from(association).where(eq(association.associationPk, associationPk)).limit(1);
  return rows[0] ?? null;
}

export async function getAssociationEvidence(associationPk: number): Promise<AssociationEvidence[]> {
  return getDb().select().from(associationEvidence).where(eq(associationEvidence.associationPk, associationPk));
}

export async function getEntityPublicIdsForAnnotationTerms(termIds: string[]): Promise<string[]> {
  const normalizedTerms = normalizePublicIds(termIds);
  if (normalizedTerms.length === 0) {
    return [];
  }

  const rows = await getDb()
    .selectDistinct({
      canonicalIdentifier: entity.canonicalIdentifier,
      canonicalIdentifierType: entity.canonicalIdentifierType,
    })
    .from(entityAnnotation)
    .innerJoin(entity, eq(entity.entityPk, entityAnnotation.entityPk))
    .where(inArray(entityAnnotation.cvTerm, normalizedTerms));

  return rows.map((row) => `${row.canonicalIdentifierType}|${row.canonicalIdentifier}`);
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

  return rows.map((row) => `${row.canonicalIdentifierType}|${row.canonicalIdentifier}`);
}

export async function getAnnotationTermCountsForEntityPublicIds(
  publicIds: string[],
  filters: SearchFilters = {},
): Promise<Array<{ cvTerm: string; entityCount: number }>> {
  const entityPkMap = await getEntityPkMapByPublicIds(publicIds);
  const scopedEntityPks = Array.from(entityPkMap.values());
  if (scopedEntityPks.length === 0) {
    return [];
  }

  const conditions = buildEntityFilterConditions(filters, scopedEntityPks);
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  if (!where) {
    return [];
  }

  const rows = await getDb()
    .select({
      cvTerm: entityAnnotation.cvTerm,
      entityCount: countDistinct(entityAnnotation.entityPk),
    })
    .from(entityAnnotation)
    .innerJoin(entity, eq(entity.entityPk, entityAnnotation.entityPk))
    .where(where)
    .groupBy(entityAnnotation.cvTerm);

  return rows
    .map((row) => ({
      cvTerm: row.cvTerm,
      entityCount: Number(row.entityCount ?? 0),
    }))
    .sort((a, b) => b.entityCount - a.entityCount || a.cvTerm.localeCompare(b.cvTerm));
}