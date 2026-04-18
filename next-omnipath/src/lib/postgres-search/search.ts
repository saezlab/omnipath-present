import 'server-only';
import { Pool } from 'pg';
import type { SearchResponse } from '@/lib/search/types';
import type {
  IdentifierEntry,
  MeilisearchAssociation,
  MeilisearchFilters,
  MeilisearchInteraction,
} from '@/types/meilisearch';
import type { SearchResult } from '@/features/search/components/result-card';

const DATABASE_URL = process.env.DATABASE_URL;
const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || 'public';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL });
  }
  return pool;
}

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

function toPublicEntityId(row: { canonical_identifier_type?: string | null; canonical_identifier?: string | null }): string {
  const type = row.canonical_identifier_type || '';
  const identifier = row.canonical_identifier || '';
  return `${type}|${identifier}`;
}

function normalizeEntityType(value: string | null | undefined): string {
  return toLegacyLabeledValue(value);
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

function identifierLabel(identifierType: string): string {
  const text = (identifierType || '').trim();
  if (!text) return '';
  const parts = text.split(':');

  // Legacy normalized identifier keys are stored as "label:ACCESSION",
  // e.g. "gene name primary:OM:0200" or "uniprot:MI:1097".
  // Raw CV values are stored as "ACCESSION:LABEL",
  // e.g. "OM:0200:Gene Name Primary" or "MI:1097:Uniprot".
  if (parts.length >= 3 && !/^[A-Z][A-Z0-9_-]*$/.test(parts[0])) {
    return parts[0].toLowerCase();
  }

  return parseCvValue(text).label.toLowerCase();
}

function classifyEntityIdentifiers(identifiers: IdentifierEntry[]): {
  names: string[];
  synonyms: string[];
  geneSymbols: string[];
} {
  const names: string[] = [];
  const synonyms: string[] = [];
  const geneSymbols: string[] = [];

  for (const identifier of identifiers) {
    const label = identifierLabel(identifier.key);
    const value = identifier.value?.trim();
    if (!value) continue;

    if (label.includes('gene name primary')) {
      geneSymbols.push(value);
      continue;
    }
    if (label.includes('gene name synonym')) {
      synonyms.push(value);
      continue;
    }
    if (label === 'name' || label.endsWith(':name') || label.includes(' entry name')) {
      names.push(value);
      continue;
    }
    if (label.includes('synonym')) {
      synonyms.push(value);
    }
  }

  return {
    names: uniqueStrings(names),
    synonyms: uniqueStrings(synonyms),
    geneSymbols: uniqueStrings(geneSymbols),
  };
}

function mapEntityAttributesToDescriptions(attributes: Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined): string[] {
  if (!attributes) return [];
  const preferredKeywords = [
    'function',
    'description',
    'disease',
    'subcellular location',
    'pathway',
    'activity regulation',
    'tissue specificity',
    'developmental stage',
    'note',
  ];

  const preferred: string[] = [];
  const fallback: string[] = [];

  for (const attribute of attributes) {
    const value = attribute?.value?.trim();
    if (!value) continue;
    const label = parseCvValue(attribute.term).label.toLowerCase();
    if (preferredKeywords.some((keyword) => label.includes(keyword))) {
      preferred.push(value);
    } else {
      fallback.push(value);
    }
  }

  return uniqueStrings([...preferred, ...fallback]).slice(0, 20);
}

function mapEntityRow(row: any): SearchResult {
  const identifiers = ((row.identifiers || []) as Array<{
    key?: string;
    value?: string;
    identifier_type?: string;
    identifier?: string;
  }>)
    .map((item) => ({
      key: normalizeIdentifierKey(item.key ?? item.identifier_type),
      value: item.value ?? item.identifier,
    }))
    .filter((item): item is { key: string; value: string } => Boolean(item.key && item.value));

  const classified = classifyEntityIdentifiers(identifiers);
  const names = uniqueStrings(classified.names);
  const descriptions = mapEntityAttributesToDescriptions(row.entity_attributes);
  const ontologyTerms = uniqueStrings((row.ontology_terms || []) as string[]);
  const publicId = toPublicEntityId(row);

  return {
    id: publicId,
    entity_id: publicId,
    type: 'entity',
    entity_type: normalizeEntityType(row.entity_type),
    names,
    synonyms: classified.synonyms,
    gene_symbols: classified.geneSymbols,
    descriptions,
    references: [],
    identifiers,
    sources: uniqueStrings((row.sources || []) as string[]),
    num_interactions: Number(row.num_interactions || 0),
    ontology_terms: ontologyTerms,
    cv_terms: ontologyTerms,
    ncbi_tax_id: row.taxonomy_id || null,
    canonical_identifier: row.canonical_identifier || null,
    canonical_identifier_type: row.canonical_identifier_type || null,
  };
}

function mapEvidenceAttributes(
  attributes: Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined,
) {
  return (attributes || []).map((item) => ({
    term: toLegacyLabeledValue(item.term),
    value: item.value ?? null,
    unit: item.unit ? toLegacyLabeledValue(item.unit) : null,
  }));
}

async function loadFacetDistributionFromMaterializedView(viewName: string): Promise<FacetDistribution> {
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

export async function getEntityFilterFacetDistributionPostgres(params?: {
  query?: string;
  filters?: MeilisearchFilters;
  facets?: string[];
}): Promise<FacetDistribution> {
  const query = params?.query || '';
  const filters = params?.filters || {};
  const requestedFacets = new Set((params?.facets !== undefined
    ? params.facets
    : ['entity_type', 'sources', 'ncbi_tax_id', 'ontology_terms']) as string[]);

  if (!query.trim() && Object.keys(filters).length === 0) {
    const facetDistribution = await loadFacetDistributionFromMaterializedView('entity_filter_counts');
    return Object.fromEntries(Object.entries(facetDistribution).filter(([key]) => requestedFacets.has(key)));
  }

  const client = await getPool().connect();
  try {
    const whereParams: SqlParams = [];
    const where = buildEntityWhere(filters, query, whereParams);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const facetSelects: string[] = [];

    if (requestedFacets.has('entity_type')) {
      facetSelects.push(`
       SELECT
         'entity_type'::text AS filter_key,
         CASE
           WHEN entity_type IS NULL OR btrim(entity_type) = '' THEN NULL
           ELSE lower(split_part(entity_type, ':', 3)) || ':' || split_part(entity_type, ':', 1) || ':' || split_part(entity_type, ':', 2)
         END AS filter_value,
         COUNT(*)::bigint AS doc_count
       FROM filtered_entities
       GROUP BY 2`);
    }

    if (requestedFacets.has('sources')) {
      facetSelects.push(`
       SELECT
         'sources'::text AS filter_key,
         source AS filter_value,
         COUNT(DISTINCT entity_pk)::bigint AS doc_count
       FROM filtered_entities
       CROSS JOIN LATERAL unnest(sources) AS source
       WHERE source IS NOT NULL AND btrim(source) <> ''
       GROUP BY source`);
    }

    if (requestedFacets.has('ncbi_tax_id')) {
      facetSelects.push(`
       SELECT
         'ncbi_tax_id'::text AS filter_key,
         taxonomy_id AS filter_value,
         COUNT(*)::bigint AS doc_count
       FROM filtered_entities
       WHERE taxonomy_id IS NOT NULL AND btrim(taxonomy_id) <> ''
       GROUP BY taxonomy_id`);
    }

    if (requestedFacets.has('ontology_terms')) {
      facetSelects.push(`
       SELECT
         'ontology_terms'::text AS filter_key,
         ea.cv_term AS filter_value,
         COUNT(DISTINCT ea.entity_pk)::bigint AS doc_count
       FROM filtered_entities fe
       JOIN ${SEARCH_SCHEMA}.entity_annotation ea ON ea.entity_pk = fe.entity_pk
       WHERE ea.cv_term IS NOT NULL AND btrim(ea.cv_term) <> ''
       GROUP BY ea.cv_term`);
    }

    if (facetSelects.length === 0) {
      return {};
    }

    const result = await client.query(
      `WITH filtered_entities AS (
         SELECT e.entity_pk, e.entity_type, e.sources, e.taxonomy_id
         FROM ${SEARCH_SCHEMA}.entity e
         ${whereSql}
       )
       ${facetSelects.join('\n       UNION ALL\n')}
       ORDER BY filter_key, doc_count DESC, filter_value`,
      whereParams,
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

export async function getInteractionFilterFacetDistributionPostgres(): Promise<FacetDistribution> {
  return loadFacetDistributionFromMaterializedView('interaction_filter_counts');
}

function buildEntityWhere(filters: MeilisearchFilters, query: string, params: SqlParams): string[] {
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
  filters?: MeilisearchFilters;
  facets?: string[];
  trackTotalHits?: boolean;
  includeIdentifiers?: boolean;
  includeOntologyTerms?: boolean;
}): Promise<SearchResponse> {
  const {
    query,
    limit = 20,
    offset = 0,
    filters = {},
    facets,
    trackTotalHits = true,
    includeIdentifiers = true,
    includeOntologyTerms = true,
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
      const facetDistribution = await getEntityFilterFacetDistributionPostgres({ query, filters, facets });
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
         e.entity_pk,
         e.canonical_identifier,
         e.canonical_identifier_type,
         e.entity_type,
         e.taxonomy_id,
         e.entity_attributes,
         e.sources,
         COALESCE(es.interaction_count, 0) AS num_interactions,
         COALESCE(${includeIdentifiers ? 'e.identifiers' : `'[]'::jsonb`}, '[]'::jsonb) AS identifiers,
         COALESCE(ann.ontology_terms, ARRAY[]::text[]) AS ontology_terms
       FROM paged p
       JOIN ${SEARCH_SCHEMA}.entity e ON e.entity_pk = p.entity_pk
       LEFT JOIN ${SEARCH_SCHEMA}.entity_summary es ON es.entity_pk = e.entity_pk
       ${includeOntologyTerms ? `LEFT JOIN LATERAL (
         SELECT array_agg(ea.cv_term ORDER BY ea.cv_term) AS ontology_terms
         FROM ${SEARCH_SCHEMA}.entity_annotation ea
         WHERE ea.entity_pk = e.entity_pk
       ) ann ON true` : `LEFT JOIN LATERAL (
         SELECT ARRAY[]::text[] AS ontology_terms
       ) ann ON true`}
       ORDER BY e.entity_pk`,
      queryParams,
    );

    const hits = rowsResult.rows.map(mapEntityRow);
    const facetDistribution = offset === 0
      ? await getEntityFilterFacetDistributionPostgres({ query, filters, facets })
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

async function fetchEntityRowsByPublicIds(publicIds: string[]): Promise<SearchResult[]> {
  if (publicIds.length === 0) return [];
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT
         e.entity_pk,
         e.canonical_identifier,
         e.canonical_identifier_type,
         e.entity_type,
         e.taxonomy_id,
         e.entity_attributes,
         e.sources,
         COALESCE(es.interaction_count, 0) AS num_interactions,
         COALESCE(e.identifiers, '[]'::jsonb) AS identifiers,
         COALESCE(ann.ontology_terms, ARRAY[]::text[]) AS ontology_terms
       FROM ${SEARCH_SCHEMA}.entity e
       LEFT JOIN ${SEARCH_SCHEMA}.entity_summary es ON es.entity_pk = e.entity_pk
       LEFT JOIN LATERAL (
         SELECT array_agg(ea.cv_term ORDER BY ea.cv_term) AS ontology_terms
         FROM ${SEARCH_SCHEMA}.entity_annotation ea
         WHERE ea.entity_pk = e.entity_pk
       ) ann ON true
       WHERE (e.canonical_identifier_type || '|' || e.canonical_identifier) = ANY($1::text[])
       ORDER BY e.entity_pk`,
      [publicIds],
    );
    const mapped = result.rows.map(mapEntityRow);
    const order = new Map(publicIds.map((id, index) => [id, index]));
    return mapped.sort((a, b) => (order.get(String(a.entity_id)) ?? 999999) - (order.get(String(b.entity_id)) ?? 999999));
  } finally {
    client.release();
  }
}

export async function fetchDocumentsPostgres(indexName: string, documentIds: string[]): Promise<{ documents: Record<string, unknown>[] }> {
  if (indexName !== 'search_entities') {
    return { documents: [] };
  }
  const documents = await fetchEntityRowsByPublicIds(documentIds);
  return { documents: documents as unknown as Record<string, unknown>[] };
}

function buildInteractionWhere(filters: MeilisearchFilters, query: string, params: SqlParams): string[] {
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

function mapInteractionRow(row: any): MeilisearchInteraction {
  const memberAId = toPublicEntityId({
    canonical_identifier_type: row.member_a_identifier_type,
    canonical_identifier: row.member_a_identifier,
  });
  const memberBId = toPublicEntityId({
    canonical_identifier_type: row.member_b_identifier_type,
    canonical_identifier: row.member_b_identifier,
  });
  return {
    interaction_id: Number(row.interaction_pk),
    interaction_key: String(row.interaction_pk),
    member_a_id: memberAId,
    member_b_id: memberBId,
    member_types: [normalizeEntityType(row.member_a_type), normalizeEntityType(row.member_b_type)],
    interaction_type: `${normalizeEntityType(row.member_a_type)}|${normalizeEntityType(row.member_b_type)}`,
    is_directed: Boolean(row.is_directed),
    sign: (row.sign ?? 0) as -1 | 0 | 1,
    evidence_count: Number(row.evidence_count || 0),
    sources: uniqueStrings((row.sources || []) as string[]),
    interaction_annotation_terms: uniqueStrings((row.interaction_annotation_terms || []) as string[]),
    participant_annotation_terms: uniqueStrings((row.participant_annotation_terms || []) as string[]),
    evidence: ((row.evidence_rows || []) as any[]).map((item, index) => ({
      evidence_serial: index + 1,
      source: item.source,
      interaction_annotations: [
        ...mapEvidenceAttributes(item.record_attributes),
        ...mapEvidenceAttributes(item.evidence),
      ],
      member_a_annotations: mapEvidenceAttributes(item.entity_a_attributes),
      member_b_annotations: mapEvidenceAttributes(item.entity_b_attributes),
    })),
  };
}

export async function searchInteractionsPostgres(params: {
  query: string;
  limit?: number;
  offset?: number;
  filters?: MeilisearchFilters;
}): Promise<SearchResponse> {
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
         i.sign,
         i.evidence_count,
         i.sources,
         (i.direction IS NOT NULL AND i.direction <> 0) AS is_directed,
         ea.entity_type AS member_a_type,
         eb.entity_type AS member_b_type,
         ea.canonical_identifier AS member_a_identifier,
         ea.canonical_identifier_type AS member_a_identifier_type,
         eb.canonical_identifier AS member_b_identifier,
         eb.canonical_identifier_type AS member_b_identifier_type,
         COALESCE(ia.interaction_annotation_terms, ARRAY[]::text[]) AS interaction_annotation_terms,
         COALESCE(pa.participant_annotation_terms, ARRAY[]::text[]) AS participant_annotation_terms,
         COALESCE(ev.evidence_rows, '[]'::jsonb) AS evidence_rows
       FROM paged p
       JOIN ${SEARCH_SCHEMA}.interaction i ON i.interaction_pk = p.interaction_pk
       JOIN ${SEARCH_SCHEMA}.entity ea ON ea.entity_pk = i.entity_a_pk
       JOIN ${SEARCH_SCHEMA}.entity eb ON eb.entity_pk = i.entity_b_pk
       LEFT JOIN LATERAL (
         SELECT array_agg(cv_term ORDER BY cv_term) AS interaction_annotation_terms
         FROM ${SEARCH_SCHEMA}.interaction_annotation ia2
         WHERE ia2.interaction_pk = i.interaction_pk
       ) ia ON true
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT cv_term ORDER BY cv_term) AS participant_annotation_terms
         FROM ${SEARCH_SCHEMA}.entity_annotation pea
         WHERE pea.entity_pk IN (i.entity_a_pk, i.entity_b_pk)
       ) pa ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'source', ie.source,
             'record_attributes', ie.record_attributes,
             'entity_a_attributes', ie.entity_a_attributes,
             'entity_b_attributes', ie.entity_b_attributes,
             'evidence', ie.evidence
           ) ORDER BY ie.source, ie.interaction_pk
         ) AS evidence_rows
         FROM ${SEARCH_SCHEMA}.interaction_evidence ie
         WHERE ie.interaction_pk = i.interaction_pk
       ) ev ON true
       ORDER BY i.interaction_pk`,
      [...whereParams, limit, offset],
    );

    const facetDistribution = offset === 0
      ? await getInteractionFilterFacetDistributionPostgres()
      : undefined;
    return {
      hits: rowsResult.rows.map(mapInteractionRow) as unknown as Record<string, unknown>[],
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

function mapAssociationRow(row: any): MeilisearchAssociation {
  const parentEntityId = toPublicEntityId({
    canonical_identifier_type: row.parent_identifier_type,
    canonical_identifier: row.parent_identifier,
  });
  const memberEntityId = toPublicEntityId({
    canonical_identifier_type: row.member_identifier_type,
    canonical_identifier: row.member_identifier,
  });

  const parentIdentifiers = ((row.parent_identifiers || []) as Array<{ key: string; value: string }>)
    .map((item) => ({ key: normalizeIdentifierKey(item.key), value: item.value }))
    .filter((item) => item.value);
  const memberIdentifiers = ((row.member_identifiers || []) as Array<{ key: string; value: string }>)
    .map((item) => ({ key: normalizeIdentifierKey(item.key), value: item.value }))
    .filter((item) => item.value);

  const parentNames = classifyEntityIdentifiers(parentIdentifiers).names;
  const parentGeneSymbols = classifyEntityIdentifiers(parentIdentifiers).geneSymbols;
  const memberNames = classifyEntityIdentifiers(memberIdentifiers).names;
  const memberGeneSymbols = classifyEntityIdentifiers(memberIdentifiers).geneSymbols;

  return {
    association_id: Number(row.association_pk),
    association_key: String(row.association_pk),
    parent_entity_id: parentEntityId,
    parent_entity_type: normalizeEntityType(row.parent_entity_type),
    parent_name: parentGeneSymbols[0] || parentNames[0] || row.parent_identifier,
    parent_identifiers: parentIdentifiers,
    member_entity_id: memberEntityId,
    member_entity_type: normalizeEntityType(row.member_entity_type),
    member_name: memberGeneSymbols[0] || memberNames[0] || row.member_identifier,
    member_identifiers: memberIdentifiers,
    sources: uniqueStrings((row.sources || []) as string[]),
    evidence: ((row.evidence_rows || []) as any[]).map((item, index) => ({
      evidence_serial: index + 1,
      source: item.source,
      annotations: [
        ...mapEvidenceAttributes(item.record_attributes),
        ...mapEvidenceAttributes(item.evidence),
      ],
    })),
    association_annotation_terms: [],
  };
}

function buildAssociationWhere(filters: MeilisearchFilters, query: string, params: SqlParams): string[] {
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
  filters?: MeilisearchFilters;
}): Promise<SearchResponse> {
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
         a.sources,
         ep.entity_type AS parent_entity_type,
         ep.canonical_identifier AS parent_identifier,
         ep.canonical_identifier_type AS parent_identifier_type,
         em.entity_type AS member_entity_type,
         em.canonical_identifier AS member_identifier,
         em.canonical_identifier_type AS member_identifier_type,
         COALESCE(pid.parent_identifiers, '[]'::jsonb) AS parent_identifiers,
         COALESCE(mid.member_identifiers, '[]'::jsonb) AS member_identifiers,
         COALESCE(ev.evidence_rows, '[]'::jsonb) AS evidence_rows
       FROM paged p
       JOIN ${SEARCH_SCHEMA}.association a ON a.association_pk = p.association_pk
       JOIN ${SEARCH_SCHEMA}.entity ep ON ep.entity_pk = a.parent_entity_pk
       JOIN ${SEARCH_SCHEMA}.entity em ON em.entity_pk = a.member_entity_pk
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('key', ei.identifier_type, 'value', ei.identifier) ORDER BY ei.identifier_type, ei.identifier) AS parent_identifiers
         FROM ${SEARCH_SCHEMA}.entity_identifier ei
         WHERE ei.entity_pk = ep.entity_pk
       ) pid ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('key', ei.identifier_type, 'value', ei.identifier) ORDER BY ei.identifier_type, ei.identifier) AS member_identifiers
         FROM ${SEARCH_SCHEMA}.entity_identifier ei
         WHERE ei.entity_pk = em.entity_pk
       ) mid ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'source', ae.source,
             'record_attributes', ae.record_attributes,
             'evidence', ae.evidence
           ) ORDER BY ae.source, ae.association_pk
         ) AS evidence_rows
         FROM ${SEARCH_SCHEMA}.association_evidence ae
         WHERE ae.association_pk = a.association_pk
       ) ev ON true
       ORDER BY a.association_pk`,
      [...whereParams, limit, offset],
    );

    return {
      hits: rowsResult.rows.map(mapAssociationRow) as unknown as Record<string, unknown>[],
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
