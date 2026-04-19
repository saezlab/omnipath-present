import 'server-only';
import type { SearchResponse } from '@/lib/search/types';
import type { SearchFilters } from '@/types/search';
import type { InteractionListRow } from '@/features/interactions-search/types';
import type { AssociationListRow } from '@/features/associations/types';
import type { Association, Entity, Identifier, Interaction } from '@next-omnipath/drizzle';
import type { EntitySearchRow } from '@/types/search-results';
import { getPool, schema } from '@/lib/db/client';

const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || 'public';

type EntityRecord = Entity;
type InteractionRecord = Interaction;
type AssociationRecord = Association;

type SqlParams = unknown[];

type FacetDistribution = Record<string, Record<string, number>>;

function addParam(params: SqlParams, value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function parseCvValue(value: string | null | undefined): { accession: string; label: string } {
  const text = (value || '').trim();
  const parts = text.split(':');
  if (parts.length < 3) {
    return { accession: text, label: text };
  }
  return {
    accession: `${parts[0]}:${parts[1]}`,
    label: parts.slice(2).join(':').trim(),
  };
}

function toLegacyLabeledValue(value: string | null | undefined): string {
  const { accession, label } = parseCvValue(value);
  if (!accession || !label) return value || '';
  return `${label.toLowerCase()}:${accession}`;
}

function toPublicEntityId(row: Pick<EntityRecord, 'canonicalIdentifierType' | 'canonicalIdentifier'> | { canonical_identifier_type?: string | null; canonical_identifier?: string | null }): string {
  const typedRow = row as { canonicalIdentifierType?: string | null; canonicalIdentifier?: string | null; canonical_identifier_type?: string | null; canonical_identifier?: string | null };
  const type = typedRow.canonicalIdentifierType || typedRow.canonical_identifier_type || '';
  const identifier = typedRow.canonicalIdentifier || typedRow.canonical_identifier || '';
  return `${type}|${identifier}`;
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

function normalizedEntityTypeSql(column: string): string {
  return `LOWER(split_part(${column}, ':', 3)) || ':' || split_part(${column}, ':', 1) || ':' || split_part(${column}, ':', 2)`;
}

function normalizeIdentifierKey(value: string | null | undefined): string {
  return toLegacyLabeledValue(value);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = `${value || ''}`.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function mapEntitySearchRow(row: {
  entityPk: number;
  canonicalIdentifier: string;
  canonicalIdentifierType: string;
  entityType: string | null;
  identifiers: unknown;
  sources: string[] | null;
  taxonomyId: string | null;
  entityAttributes: unknown;
  matchRank?: number | null;
}): EntitySearchRow {
  const publicId = toPublicEntityId({
    canonicalIdentifierType: row.canonicalIdentifierType,
    canonicalIdentifier: row.canonicalIdentifier,
  });

  return {
    entityPk: row.entityPk,
    canonicalIdentifier: row.canonicalIdentifier,
    canonicalIdentifierType: row.canonicalIdentifierType,
    entityType: row.entityType,
    identifiers: Array.isArray(row.identifiers)
      ? row.identifiers
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const typedItem = item as { key?: string; value?: string; identifier_type?: string; identifier?: string };
          const key = normalizeIdentifierKey(typedItem.key ?? typedItem.identifier_type);
          const value = typedItem.value ?? typedItem.identifier;
          return key && value ? { key, value } : null;
        })
        .filter((item): item is Identifier => Boolean(item))
      : [],
    sources: uniqueStrings((row.sources || []) as string[]),
    taxonomyId: row.taxonomyId,
    entityAttributes: row.entityAttributes,
    id: publicId,
    entity_id: publicId,
    type: 'entity',
    matchRank: row.matchRank ?? null,
  };
}

export async function loadFacetDistributionFromMaterializedView(viewName: string): Promise<FacetDistribution> {
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT filter_key, filter_value, doc_count
       FROM ${SEARCH_SCHEMA}.${viewName}
       ORDER BY filter_key, doc_count DESC, filter_value`
    );

    const facetDistribution: FacetDistribution = {};
    for (const row of result.rows) {
      const key = String(row.filter_key || '').trim();
      const value = String(row.filter_value || '').trim();
      if (!key || !value) continue;
      (facetDistribution[key] ||= {})[value] = Number(row.doc_count || 0);
    }

    return facetDistribution;
  } finally {
    client.release();
  }
}

function filterFacetDistribution(
  facetDistribution: FacetDistribution,
  requestedFacets?: string[],
): FacetDistribution {
  const allowedFacets = new Set(
    requestedFacets && requestedFacets.length > 0
      ? requestedFacets
      : ['entity_type', 'sources', 'ncbi_tax_id', 'ontology_terms'],
  );

  return Object.fromEntries(
    Object.entries(facetDistribution).filter(([key]) => allowedFacets.has(key)),
  );
}

function buildEntityWhere(filters: SearchFilters, query: string, params: SqlParams): string[] {
  const where: string[] = [];

  if (filters.entity_ids?.length) {
    const placeholder = addParam(params, filters.entity_ids.map(String));
    where.push(`(e.canonical_identifier_type || '|' || e.canonical_identifier) = ANY(${placeholder}::text[])`);
  }

  if (filters.entity_types?.length) {
    const placeholder = addParam(params, filters.entity_types.map(String).map(normalizeEntityTypeFilterValue));
    where.push(`${normalizedEntityTypeSql('e.entity_type')} = ANY(${placeholder}::text[])`);
  }

  if (filters.sources?.length) {
    const placeholder = addParam(params, filters.sources.map(String));
    where.push(`e.sources && ${placeholder}::text[]`);
  }

  if (filters.ncbi_tax_id?.length) {
    const placeholder = addParam(params, filters.ncbi_tax_id.map(String));
    where.push(`e.taxonomy_id = ANY(${placeholder}::text[])`);
  }

  if (filters.ontology_terms?.length) {
    const placeholder = addParam(params, filters.ontology_terms.map(String));
    where.push(`EXISTS (
      SELECT 1
      FROM ${SEARCH_SCHEMA}.entity_annotation ea_filter
      WHERE ea_filter.entity_pk = e.entity_pk
        AND ea_filter.cv_term = ANY(${placeholder}::text[])
    )`);
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    const exact = addParam(params, trimmedQuery);
    const prefix = addParam(params, `${trimmedQuery}%`);
    const contains = addParam(params, `%${trimmedQuery}%`);
    where.push(`EXISTS (
      SELECT 1
      FROM ${SEARCH_SCHEMA}.entity_identifier ei_filter
      WHERE ei_filter.entity_pk = e.entity_pk
        AND (
          ei_filter.identifier ILIKE ${exact}
          OR ei_filter.identifier ILIKE ${prefix}
          OR ei_filter.identifier ILIKE ${contains}
        )
    )`);
  }

  return where;
}

export async function searchEntitiesPostgres(params: {
  query: string;
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
  facets?: string[];
  trackTotalHits?: boolean;
  includeIdentifiers?: boolean;
  includeOntologyTerms?: boolean;
}): Promise<SearchResponse<EntitySearchRow>> {
  const {
    query,
    limit = 20,
    offset = 0,
    filters = {},
    facets,
    trackTotalHits = true,
    includeIdentifiers = true,
  } = params;
  const client = await getPool().connect();

  try {
    const whereParams: SqlParams = [];
    const where = buildEntityWhere(filters, query, whereParams);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = trackTotalHits && offset === 0
      ? Number((await client.query(
          `SELECT COUNT(*)::bigint AS total
           FROM ${SEARCH_SCHEMA}.entity e
           ${whereSql}`,
          whereParams,
        )).rows[0]?.total || 0)
      : null;

    if (limit === 0) {
      const facetDistribution = filterFacetDistribution(
        await loadFacetDistributionFromMaterializedView('entity_filter_counts'),
        facets,
      );
      return {
        hits: [],
        estimatedTotalHits: total ?? 0,
        limit,
        offset,
        processingTimeMs: 0,
        query,
        facetDistribution,
      };
    }

    const queryParams = [...whereParams];
    const limitPlaceholder = addParam(queryParams, limit);
    const offsetPlaceholder = addParam(queryParams, offset);
    const trimmedQuery = query.trim();
    const exactPlaceholder = trimmedQuery ? addParam(queryParams, trimmedQuery) : null;
    const prefixPlaceholder = trimmedQuery ? addParam(queryParams, `${trimmedQuery}%`) : null;
    const containsPlaceholder = trimmedQuery ? addParam(queryParams, `%${trimmedQuery}%`) : null;

    const rowsResult = await client.query(
      `WITH paged AS (
         SELECT e.entity_pk
         FROM ${SEARCH_SCHEMA}.entity e
         ${whereSql}
         ORDER BY
           CASE
             WHEN ${trimmedQuery ? `EXISTS (SELECT 1 FROM ${SEARCH_SCHEMA}.entity_identifier ei_rank WHERE ei_rank.entity_pk = e.entity_pk AND ei_rank.identifier ILIKE ${exactPlaceholder})` : 'false'} THEN 0
             WHEN ${trimmedQuery ? `EXISTS (SELECT 1 FROM ${SEARCH_SCHEMA}.entity_identifier ei_rank WHERE ei_rank.entity_pk = e.entity_pk AND ei_rank.identifier ILIKE ${prefixPlaceholder})` : 'false'} THEN 1
             WHEN ${trimmedQuery ? `EXISTS (SELECT 1 FROM ${SEARCH_SCHEMA}.entity_identifier ei_rank WHERE ei_rank.entity_pk = e.entity_pk AND ei_rank.identifier ILIKE ${containsPlaceholder})` : 'false'} THEN 2
             ELSE 3
           END,
           e.entity_pk
         LIMIT ${limitPlaceholder}
         OFFSET ${offsetPlaceholder}
       )
       SELECT
         e.entity_pk AS "entityPk",
         e.canonical_identifier AS "canonicalIdentifier",
         e.canonical_identifier_type AS "canonicalIdentifierType",
         e.entity_type AS "entityType",
         COALESCE(${includeIdentifiers ? 'e.identifiers' : `'[]'::jsonb`}, '[]'::jsonb) AS identifiers,
         e.sources,
         e.taxonomy_id AS "taxonomyId",
         e.entity_attributes AS "entityAttributes",
         CASE
           WHEN ${trimmedQuery ? `EXISTS (SELECT 1 FROM ${SEARCH_SCHEMA}.entity_identifier ei_rank WHERE ei_rank.entity_pk = e.entity_pk AND ei_rank.identifier ILIKE ${exactPlaceholder})` : 'false'} THEN 0
           WHEN ${trimmedQuery ? `EXISTS (SELECT 1 FROM ${SEARCH_SCHEMA}.entity_identifier ei_rank WHERE ei_rank.entity_pk = e.entity_pk AND ei_rank.identifier ILIKE ${prefixPlaceholder})` : 'false'} THEN 1
           WHEN ${trimmedQuery ? `EXISTS (SELECT 1 FROM ${SEARCH_SCHEMA}.entity_identifier ei_rank WHERE ei_rank.entity_pk = e.entity_pk AND ei_rank.identifier ILIKE ${containsPlaceholder})` : 'false'} THEN 2
           ELSE NULL
         END AS "matchRank"
       FROM paged p
       JOIN ${SEARCH_SCHEMA}.entity e ON e.entity_pk = p.entity_pk
       ORDER BY e.entity_pk`,
      queryParams,
    );

    const hits = rowsResult.rows.map(mapEntitySearchRow);
    const facetDistribution = offset === 0
      ? filterFacetDistribution(
          await loadFacetDistributionFromMaterializedView('entity_filter_counts'),
          facets,
        )
      : undefined;
    const estimatedTotalHits = total ?? (offset + hits.length + (hits.length === limit ? 1 : 0));
    return {
      hits,
      estimatedTotalHits,
      limit,
      offset,
      processingTimeMs: 0,
      query,
      facetDistribution,
    };
  } finally {
    client.release();
  }
}

async function fetchEntityRowsByPublicIds(publicIds: string[]): Promise<EntitySearchRow[]> {
  if (publicIds.length === 0) return [];
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT
         e.entity_pk AS "entityPk",
         e.canonical_identifier AS "canonicalIdentifier",
         e.canonical_identifier_type AS "canonicalIdentifierType",
         e.entity_type AS "entityType",
         COALESCE(e.identifiers, '[]'::jsonb) AS identifiers,
         e.sources,
         e.taxonomy_id AS "taxonomyId",
         e.entity_attributes AS "entityAttributes"
       FROM ${SEARCH_SCHEMA}.entity e
       WHERE (e.canonical_identifier_type || '|' || e.canonical_identifier) = ANY($1::text[])
       ORDER BY e.entity_pk`,
      [publicIds],
    );
    const mapped = result.rows.map(mapEntitySearchRow);
    const order = new Map(publicIds.map((id, index) => [id, index]));
    return mapped.sort((a, b) => (order.get(a.entity_id) ?? 999999) - (order.get(b.entity_id) ?? 999999));
  } finally {
    client.release();
  }
}

function buildInteractionWhere(filters: SearchFilters, query: string, params: SqlParams): string[] {
  const where: string[] = [];
  const publicA = `(ea.canonical_identifier_type || '|' || ea.canonical_identifier)`;
  const publicB = `(eb.canonical_identifier_type || '|' || eb.canonical_identifier)`;

  if (filters.entity_ids?.length) {
    const placeholder = addParam(params, filters.entity_ids.map(String));
    where.push(`(${publicA} = ANY(${placeholder}::text[]) OR ${publicB} = ANY(${placeholder}::text[]))`);
  }
  if (filters.member_a_id !== undefined) {
    const placeholder = addParam(params, String(filters.member_a_id));
    where.push(`(${publicA} = ${placeholder} OR ${publicB} = ${placeholder})`);
  }
  if (filters.member_b_id !== undefined) {
    const placeholder = addParam(params, String(filters.member_b_id));
    where.push(`(${publicA} = ${placeholder} OR ${publicB} = ${placeholder})`);
  }
  if (filters.interaction_types?.length) {
    const placeholder = addParam(params, filters.interaction_types.map(String).map(normalizeInteractionTypeFilterValue));
    where.push(`(
      CASE
        WHEN ${normalizedEntityTypeSql('ea.entity_type')} <= ${normalizedEntityTypeSql('eb.entity_type')}
          THEN ${normalizedEntityTypeSql('ea.entity_type')} || '|' || ${normalizedEntityTypeSql('eb.entity_type')}
        ELSE ${normalizedEntityTypeSql('eb.entity_type')} || '|' || ${normalizedEntityTypeSql('ea.entity_type')}
      END
    ) = ANY(${placeholder}::text[])`);
  }
  if (filters.is_directed !== undefined && filters.is_directed !== null) {
    const placeholder = addParam(params, filters.is_directed);
    where.push(`((i.direction IS NOT NULL AND i.direction <> 0) = ${placeholder})`);
  }
  if (filters.signs?.length) {
    const placeholder = addParam(params, filters.signs);
    where.push(`i.sign = ANY(${placeholder}::int[])`);
  }
  if (filters.sources?.length) {
    const placeholder = addParam(params, filters.sources.map(String));
    where.push(`i.sources && ${placeholder}::text[]`);
  }
  if (filters.interaction_annotation_terms?.length) {
    const placeholder = addParam(params, filters.interaction_annotation_terms.map(String));
    where.push(`EXISTS (
      SELECT 1 FROM ${SEARCH_SCHEMA}.interaction_annotation iaf
      WHERE iaf.interaction_pk = i.interaction_pk
        AND iaf.cv_term = ANY(${placeholder}::text[])
    )`);
  }
  if (filters.participant_annotation_terms?.length) {
    const placeholder = addParam(params, filters.participant_annotation_terms.map(String));
    where.push(`EXISTS (
      SELECT 1
      FROM ${SEARCH_SCHEMA}.entity_annotation eaf
      WHERE eaf.cv_term = ANY(${placeholder}::text[])
        AND eaf.entity_pk IN (i.entity_a_pk, i.entity_b_pk)
    )`);
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    const contains = addParam(params, `%${trimmedQuery}%`);
    where.push(`(
      EXISTS (SELECT 1 FROM ${SEARCH_SCHEMA}.entity_identifier eia WHERE eia.entity_pk = i.entity_a_pk AND eia.identifier ILIKE ${contains})
      OR EXISTS (SELECT 1 FROM ${SEARCH_SCHEMA}.entity_identifier eib WHERE eib.entity_pk = i.entity_b_pk AND eib.identifier ILIKE ${contains})
    )`);
  }

  return where;
}

function mapInteractionListRow(row: any): InteractionListRow {
  return {
    interaction: {
      interactionPk: Number(row.interaction_pk),
      entityAPk: Number(row.entity_a_pk),
      entityBPk: Number(row.entity_b_pk),
      direction: row.direction ?? null,
      sign: row.sign ?? 0,
      evidenceCount: Number(row.evidence_count || 0),
      sources: uniqueStrings((row.sources || []) as string[]),
    },
    entityA: {
      entityPk: Number(row.entity_a_pk),
      canonicalIdentifier: row.entity_a_canonical_identifier,
      canonicalIdentifierType: row.entity_a_canonical_identifier_type,
      entityType: row.entity_a_type,
      taxonomyId: row.entity_a_taxonomy_id ?? null,
      entityAttributes: row.entity_a_attributes ?? null,
      sources: uniqueStrings((row.entity_a_sources || []) as string[]),
      identifiers: Array.isArray(row.entity_a_identifiers) ? row.entity_a_identifiers : [],
    },
    entityB: {
      entityPk: Number(row.entity_b_pk),
      canonicalIdentifier: row.entity_b_canonical_identifier,
      canonicalIdentifierType: row.entity_b_canonical_identifier_type,
      entityType: row.entity_b_type,
      taxonomyId: row.entity_b_taxonomy_id ?? null,
      entityAttributes: row.entity_b_attributes ?? null,
      sources: uniqueStrings((row.entity_b_sources || []) as string[]),
      identifiers: Array.isArray(row.entity_b_identifiers) ? row.entity_b_identifiers : [],
    },
  };
}

export async function searchInteractionsPostgres(params: {
  query: string;
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
}): Promise<SearchResponse<InteractionListRow>> {
  const { query, limit = 20, offset = 0, filters = {} } = params;
  const client = await getPool().connect();
  try {
    const whereParams: SqlParams = [];
    const where = buildInteractionWhere(filters, query, whereParams);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total
       FROM ${SEARCH_SCHEMA}.interaction i
       JOIN ${SEARCH_SCHEMA}.entity ea ON ea.entity_pk = i.entity_a_pk
       JOIN ${SEARCH_SCHEMA}.entity eb ON eb.entity_pk = i.entity_b_pk
       ${whereSql}`,
      whereParams,
    );
    const total = Number(countResult.rows[0]?.total || 0);

    const rowsResult = await client.query(
      `WITH paged AS (
         SELECT i.interaction_pk
         FROM ${SEARCH_SCHEMA}.interaction i
         JOIN ${SEARCH_SCHEMA}.entity ea ON ea.entity_pk = i.entity_a_pk
         JOIN ${SEARCH_SCHEMA}.entity eb ON eb.entity_pk = i.entity_b_pk
         ${whereSql}
         ORDER BY i.interaction_pk
         LIMIT $${whereParams.length + 1}
         OFFSET $${whereParams.length + 2}
       )
       SELECT
         i.interaction_pk,
         i.entity_a_pk,
         i.entity_b_pk,
         i.direction,
         i.sign,
         i.evidence_count,
         i.sources,
         ea.canonical_identifier AS entity_a_canonical_identifier,
         ea.canonical_identifier_type AS entity_a_canonical_identifier_type,
         ea.entity_type AS entity_a_type,
         ea.taxonomy_id AS entity_a_taxonomy_id,
         ea.entity_attributes AS entity_a_attributes,
         ea.sources AS entity_a_sources,
         COALESCE(ea.identifiers, '[]'::jsonb) AS entity_a_identifiers,
         eb.canonical_identifier AS entity_b_canonical_identifier,
         eb.canonical_identifier_type AS entity_b_canonical_identifier_type,
         eb.entity_type AS entity_b_type,
         eb.taxonomy_id AS entity_b_taxonomy_id,
         eb.entity_attributes AS entity_b_attributes,
         eb.sources AS entity_b_sources,
         COALESCE(eb.identifiers, '[]'::jsonb) AS entity_b_identifiers
       FROM paged p
       JOIN ${SEARCH_SCHEMA}.interaction i ON i.interaction_pk = p.interaction_pk
       JOIN ${SEARCH_SCHEMA}.entity ea ON ea.entity_pk = i.entity_a_pk
       JOIN ${SEARCH_SCHEMA}.entity eb ON eb.entity_pk = i.entity_b_pk
       ORDER BY i.interaction_pk`,
      [...whereParams, limit, offset],
    );

    const facetDistribution = offset === 0
      ? await loadFacetDistributionFromMaterializedView('interaction_filter_counts')
      : undefined;
    return {
      hits: rowsResult.rows.map(mapInteractionListRow),
      estimatedTotalHits: total,
      limit,
      offset,
      processingTimeMs: 0,
      query,
      facetDistribution,
    };
  } finally {
    client.release();
  }
}

function mapAssociationListRow(row: any): AssociationListRow {
  return {
    association: {
      associationPk: Number(row.association_pk),
      parentEntityPk: Number(row.parent_entity_pk),
      memberEntityPk: Number(row.member_entity_pk),
      roleTermId: row.role_term_id ?? null,
      stoichiometry: row.stoichiometry ?? null,
      sources: uniqueStrings((row.sources || []) as string[]),
    },
    parent: {
      entityPk: Number(row.parent_entity_pk),
      canonicalIdentifier: row.parent_canonical_identifier,
      canonicalIdentifierType: row.parent_canonical_identifier_type,
      entityType: row.parent_entity_type,
      taxonomyId: row.parent_taxonomy_id ?? null,
      entityAttributes: row.parent_attributes ?? null,
      sources: uniqueStrings((row.parent_sources || []) as string[]),
      identifiers: Array.isArray(row.parent_identifiers) ? row.parent_identifiers : [],
    },
    member: {
      entityPk: Number(row.member_entity_pk),
      canonicalIdentifier: row.member_canonical_identifier,
      canonicalIdentifierType: row.member_canonical_identifier_type,
      entityType: row.member_entity_type,
      taxonomyId: row.member_taxonomy_id ?? null,
      entityAttributes: row.member_attributes ?? null,
      sources: uniqueStrings((row.member_sources || []) as string[]),
      identifiers: Array.isArray(row.member_identifiers) ? row.member_identifiers : [],
    },
  };
}

function buildAssociationWhere(filters: SearchFilters, query: string, params: SqlParams): string[] {
  const where: string[] = [];
  const publicParent = `(ep.canonical_identifier_type || '|' || ep.canonical_identifier)`;
  const publicMember = `(em.canonical_identifier_type || '|' || em.canonical_identifier)`;

  if (filters.parent_entity_ids?.length) {
    const placeholder = addParam(params, filters.parent_entity_ids.map(String));
    where.push(`${publicParent} = ANY(${placeholder}::text[])`);
  }
  if (filters.member_entity_ids?.length) {
    const placeholder = addParam(params, filters.member_entity_ids.map(String));
    where.push(`${publicMember} = ANY(${placeholder}::text[])`);
  }
  if (filters.parent_entity_types?.length) {
    const placeholder = addParam(params, filters.parent_entity_types.map(String).map(normalizeEntityTypeFilterValue));
    where.push(`${normalizedEntityTypeSql('ep.entity_type')} = ANY(${placeholder}::text[])`);
  }
  if (filters.member_entity_types?.length) {
    const placeholder = addParam(params, filters.member_entity_types.map(String).map(normalizeEntityTypeFilterValue));
    where.push(`${normalizedEntityTypeSql('em.entity_type')} = ANY(${placeholder}::text[])`);
  }
  if (filters.sources?.length) {
    const placeholder = addParam(params, filters.sources.map(String));
    where.push(`a.sources && ${placeholder}::text[]`);
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    const contains = addParam(params, `%${trimmedQuery}%`);
    where.push(`(
      EXISTS (SELECT 1 FROM ${SEARCH_SCHEMA}.entity_identifier eip WHERE eip.entity_pk = a.parent_entity_pk AND eip.identifier ILIKE ${contains})
      OR EXISTS (SELECT 1 FROM ${SEARCH_SCHEMA}.entity_identifier eim WHERE eim.entity_pk = a.member_entity_pk AND eim.identifier ILIKE ${contains})
    )`);
  }

  return where;
}

export async function searchAssociationsPostgres(params: {
  query: string;
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
}): Promise<SearchResponse<AssociationListRow>> {
  const { query, limit = 20, offset = 0, filters = {} } = params;
  const client = await getPool().connect();
  try {
    const whereParams: SqlParams = [];
    const where = buildAssociationWhere(filters, query, whereParams);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await client.query(
      `SELECT COUNT(*)::bigint AS total
       FROM ${SEARCH_SCHEMA}.association a
       JOIN ${SEARCH_SCHEMA}.entity ep ON ep.entity_pk = a.parent_entity_pk
       JOIN ${SEARCH_SCHEMA}.entity em ON em.entity_pk = a.member_entity_pk
       ${whereSql}`,
      whereParams,
    );
    const total = Number(countResult.rows[0]?.total || 0);

    const rowsResult = await client.query(
      `WITH paged AS (
         SELECT a.association_pk
         FROM ${SEARCH_SCHEMA}.association a
         JOIN ${SEARCH_SCHEMA}.entity ep ON ep.entity_pk = a.parent_entity_pk
         JOIN ${SEARCH_SCHEMA}.entity em ON em.entity_pk = a.member_entity_pk
         ${whereSql}
         ORDER BY a.association_pk
         LIMIT $${whereParams.length + 1}
         OFFSET $${whereParams.length + 2}
       )
       SELECT
         a.association_pk,
         a.parent_entity_pk,
         a.member_entity_pk,
         a.role_term_id,
         a.stoichiometry,
         a.sources,
         ep.canonical_identifier AS parent_canonical_identifier,
         ep.canonical_identifier_type AS parent_canonical_identifier_type,
         ep.entity_type AS parent_entity_type,
         ep.taxonomy_id AS parent_taxonomy_id,
         ep.entity_attributes AS parent_attributes,
         ep.sources AS parent_sources,
         COALESCE(ep.identifiers, '[]'::jsonb) AS parent_identifiers,
         em.canonical_identifier AS member_canonical_identifier,
         em.canonical_identifier_type AS member_canonical_identifier_type,
         em.entity_type AS member_entity_type,
         em.taxonomy_id AS member_taxonomy_id,
         em.entity_attributes AS member_attributes,
         em.sources AS member_sources,
         COALESCE(em.identifiers, '[]'::jsonb) AS member_identifiers
       FROM paged p
       JOIN ${SEARCH_SCHEMA}.association a ON a.association_pk = p.association_pk
       JOIN ${SEARCH_SCHEMA}.entity ep ON ep.entity_pk = a.parent_entity_pk
       JOIN ${SEARCH_SCHEMA}.entity em ON em.entity_pk = a.member_entity_pk
       ORDER BY a.association_pk`,
      [...whereParams, limit, offset],
    );

    return {
      hits: rowsResult.rows.map(mapAssociationListRow),
      estimatedTotalHits: total,
      limit,
      offset,
      processingTimeMs: 0,
      query,
    };
  } finally {
    client.release();
  }
}

export async function getInteractionStatsPostgres(): Promise<Record<string, unknown>> {
  const client = await getPool().connect();
  try {
    const result = await client.query(`SELECT COUNT(*)::bigint AS number_of_documents FROM ${SEARCH_SCHEMA}.interaction`);
    return { numberOfDocuments: Number(result.rows[0]?.number_of_documents || 0) };
  } finally {
    client.release();
  }
}
