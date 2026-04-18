"use server";

import "server-only";

import {
  SEARCH_TARGETS,
  type SearchTarget,
} from "@/lib/search/collections";
import {
  fetchDocuments,
  getInteractionStats as getInteractionStatsData,
  search,
  searchAssociations as searchAssociationsData,
  searchInteractions as searchInteractionsData,
} from "@/lib/data/search";
import { getApiServiceUrl } from "@/lib/api/config";
import type { SearchResponse } from "@/lib/search/types";
import type {
  InteractionSearchResponse,
  SearchFilters,
} from "@/types/search";
import type { EntitySearchResult } from "@/types/entities";
import type { SearchResult } from "@/types/search-results";

export interface EntityInfo {
  id: string;
  canonical_identifier: string;
  display_name: string;
  entity_type_name?: string;
  gene_symbol?: string;
}

export interface ExploreOntologyTerm {
  id: string;
  label: string;
  namespace?: string | null;
  definition?: string | null;
  matchType?: string;
  matchedText?: string;
  score?: number;
  entityCount?: number;
}

export interface AssociatedEntityScope {
  seedEntityIds: string[];
  associatedEntityIds: string[];
  expandedEntityIds: string[];
}

export interface ScopedAnnotationTerm extends ExploreOntologyTerm {
  entityCount: number;
}

interface OntologySearchMatch {
  id: string;
  name?: string | null;
  definition?: string | null;
  namespace?: string | null;
  matched_text?: string;
  match_type?: string;
  score?: number;
}

interface OntologySearchResponse {
  results?: Record<string, OntologySearchMatch[]>;
}

interface TermsResponse {
  terms?: Record<string, {
    id: string;
    name?: string | null;
    definition?: string | null;
    namespace?: string | null;
  } | null>;
}

interface OntologyTreeNode {
  id: string;
  name?: string;
  distance?: number;
  children?: OntologyTreeNode[];
}

interface OntologyTreeResponse {
  root?: OntologyTreeNode | null;
}

interface ResolvedEntityLookupResponse {
  matches?: Array<{ identifier: string; entityIds: string[] }>;
  entities?: Array<Record<string, unknown>>;
}

const ONTOLOGY_ID_PATTERN = /^(GO|MI|OM|HP|KW|CHEBI):\d+$/i;

function normalizeIds(ids?: Array<string | number>) {
  return Array.from(new Set((ids || []).map((id) => String(id).trim()).filter(Boolean)));
}

function normalizeOntologyId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^([A-Za-z]+):(\d+)$/);
  if (!match) return trimmed.toUpperCase();
  return `${match[1].toUpperCase()}:${match[2]}`;
}

function isSmallMoleculeType(entityTypeName: string | undefined): boolean {
  if (!entityTypeName) return false;
  const type = entityTypeName.toLowerCase();
  return type === "smallmolecule"
    || type === "small_molecule"
    || type === "compound"
    || type === "metabolite"
    || type === "drug"
    || type === "lipid";
}

function getShortestName(names: string[] | undefined): string | undefined {
  if (!names || names.length === 0) return undefined;

  const validNames = names.filter((name) =>
    !/^(MLS|SMR|cid_|ZINC|SID_|CID_)/i.test(name) && name.length > 3,
  );

  if (validNames.length > 0) {
    return validNames.reduce((shortest, current) =>
      current.length < shortest.length ? current : shortest,
    );
  }

  return names[0];
}

async function browseOntologyTermsFromEntityHits(species: string | undefined, limit: number): Promise<ExploreOntologyTerm[]> {
  const filters: SearchFilters = species ? { ncbi_tax_id: [species] } : {};
  const response = await searchEntities({
    query: "",
    limit: Math.max(limit * 10, 250),
    offset: 0,
    filters,
    facets: [],
  });

  const counts = new Map<string, number>();
  for (const hit of response.hits || []) {
    const rawTerms = (hit.ontology_terms || hit.cv_terms) as unknown;
    const terms = Array.isArray(rawTerms) ? rawTerms : [];
    for (const term of terms) {
      const normalized = normalizeOntologyId(String(term));
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  const entries = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const resolved = await resolveOntologyTerms(entries.map(([termId]) => termId));

  return entries.map(([termId, count]) => ({
    id: termId,
    label: resolved[termId]?.label || termId,
    namespace: resolved[termId]?.namespace,
    definition: resolved[termId]?.definition,
    entityCount: count,
  }));
}

export async function searchEntities({
  query,
  target,
  index,
  limit = 20,
  offset = 0,
  filters = {},
  facets,
  trackTotalHits,
  includeIdentifiers,
  includeOntologyTerms,
}: {
  query: string;
  target?: SearchTarget;
  index?: SearchTarget;
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
  facets?: string[];
  trackTotalHits?: boolean;
  includeIdentifiers?: boolean;
  includeOntologyTerms?: boolean;
}): Promise<SearchResponse> {
  try {
    return await search({
      query,
      target: target ?? index ?? SEARCH_TARGETS.ENTITIES,
      limit,
      offset,
      filters,
      facets,
      trackTotalHits,
      includeIdentifiers,
      includeOntologyTerms,
    });
  } catch (error) {
    console.error("Error searching entities:", error);
    return {
      hits: [],
      estimatedTotalHits: 0,
      limit,
      offset,
      processingTimeMs: 0,
      query,
      facetDistribution: {},
    };
  }
}

export async function getEntityDocumentsByIds(target: SearchTarget, documentIds: string[]) {
  try {
    return await fetchDocuments(target, documentIds);
  } catch (error) {
    console.error("Error fetching documents:", error);
    return { documents: [] };
  }
}

export async function getEntityById(entityId: string): Promise<EntitySearchResult | null> {
  const normalizedId = entityId.trim();
  if (!normalizedId) {
    return null;
  }

  try {
    const { documents } = await fetchDocuments(SEARCH_TARGETS.ENTITIES, [normalizedId]);
    const entity = documents[0] as unknown as EntitySearchResult | undefined;
    return entity ?? null;
  } catch (error) {
    console.error("Error fetching entity by ID:", error);
    return null;
  }
}

export async function searchInteractions(
  query: string,
  filters: SearchFilters,
  limit: number = 20,
  offset: number = 0,
): Promise<InteractionSearchResponse> {
  try {
    const result = await searchInteractionsData({
      query,
      limit,
      offset,
      filters,
    });

    return {
      hits: (result.hits as InteractionSearchResponse["hits"]) || [],
      estimatedTotalHits: (result.estimatedTotalHits as number) || 0,
      limit,
      offset,
      processingTimeMs: (result.processingTimeMs as number) || 0,
      query,
      facetDistribution: result.facetDistribution as Record<string, Record<string, number>> | undefined,
    };
  } catch (error) {
    console.error("Error searching interactions:", error);
    return {
      hits: [],
      estimatedTotalHits: 0,
      limit,
      offset,
      processingTimeMs: 0,
      query,
    };
  }
}

export async function getEntitiesByIds(entityIds: string[]): Promise<Map<string, EntityInfo>> {
  if (entityIds.length === 0) {
    return new Map();
  }

  try {
    const uniqueIds = [...new Set(entityIds)];
    const data = await fetchDocuments(SEARCH_TARGETS.ENTITIES, uniqueIds);
    const entityMap = new Map<string, EntityInfo>();

    for (const doc of data.documents) {
      const id = String(doc.entity_id);
      const names = doc.names as string[] | undefined;
      const geneSymbols = doc.gene_symbols as string[] | undefined;
      const entityType = doc.entity_type as string | undefined;
      const identifiers = doc.identifiers as Array<{ key?: string; value?: string }> | undefined;
      const entityTypeName = entityType?.split(":")[0];

      const getIdentifierByType = (types: string[]): string | undefined => {
        if (!identifiers) return undefined;
        for (const identifier of identifiers) {
          const identifierType = identifier.key?.split(":")[0].toLowerCase();
          if (identifierType && identifier.value && types.some((type) => identifierType.includes(type))) {
            return identifier.value;
          }
        }
        return undefined;
      };

      let displayName: string;
      let canonicalId: string;

      if (isSmallMoleculeType(entityTypeName)) {
        const shortName = getShortestName(names);
        const chemblId = getIdentifierByType(["chembl"]);
        const pubchemId = getIdentifierByType(["pubchem", "cid"]);

        if (chemblId) {
          displayName = chemblId;
        } else if (shortName && !/^\d+$/.test(shortName)) {
          displayName = shortName;
        } else {
          displayName = pubchemId || shortName || String(doc.entity_id);
        }

        canonicalId = chemblId || pubchemId || names?.[0] || String(doc.entity_id);
      } else if (entityTypeName?.toLowerCase() === "protein") {
        const uniprotId = getIdentifierByType(["uniprot", "uniprotkb"]);
        displayName = geneSymbols?.[0] || uniprotId || names?.[0] || String(doc.entity_id);
        canonicalId = uniprotId || names?.[0] || String(doc.entity_id);
      } else {
        displayName = geneSymbols?.[0] || names?.[0] || String(doc.entity_id);
        canonicalId = names?.[0] || String(doc.entity_id);
      }

      entityMap.set(id, {
        id: String(doc.entity_id),
        canonical_identifier: canonicalId,
        display_name: displayName,
        entity_type_name: entityTypeName,
        gene_symbol: geneSymbols?.[0],
      });
    }

    return entityMap;
  } catch (error) {
    console.error("Error fetching entities by IDs:", error);
    return new Map();
  }
}

export async function searchAssociations(
  query: string,
  filters: SearchFilters,
  limit: number = 20,
  offset: number = 0,
) {
  try {
    return await searchAssociationsData({
      query,
      limit,
      offset,
      filters,
    });
  } catch (error) {
    console.error("Error searching associations:", error);
    return {
      hits: [],
      estimatedTotalHits: 0,
      limit,
      offset,
      processingTimeMs: 0,
      query,
    };
  }
}

export async function normalizeOntologyFilterValues(terms: string[] | undefined): Promise<string[] | undefined> {
  if (!terms?.length) return undefined;

  const normalizedTerms = terms
    .map((term) => String(term).trim())
    .filter((term) => term.length > 0);

  if (normalizedTerms.length === 0) return undefined;

  const idsToResolve = normalizedTerms.filter((term) => ONTOLOGY_ID_PATTERN.test(term));
  if (idsToResolve.length === 0) return [...new Set(normalizedTerms)];

  try {
    const response = await fetch(`${getApiServiceUrl()}/terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term_ids: [...new Set(idsToResolve)] }),
    });

    if (!response.ok) {
      throw new Error(`Failed to normalize ontology filter values (${response.status})`);
    }

    const data = (await response.json()) as TermsResponse;
    const expandedTerms = new Set<string>(normalizedTerms);

    for (const term of idsToResolve) {
      const resolved = data.terms?.[term];
      const name = resolved?.name?.trim();
      if (name) expandedTerms.add(`${name}:${term}`);
    }

    return [...expandedTerms];
  } catch (error) {
    console.error("Error normalizing ontology filter values:", error);
    return [...new Set(normalizedTerms)];
  }
}

export async function resolveOntologyTerms(termIds: string[]): Promise<Record<string, ExploreOntologyTerm>> {
  const normalized = Array.from(new Set(termIds.map((termId) => normalizeOntologyId(termId)).filter(Boolean)));
  if (normalized.length === 0) return {};

  try {
    const response = await fetch(`${getApiServiceUrl()}/terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term_ids: normalized }),
    });

    if (!response.ok) {
      throw new Error(`Failed to resolve ontology terms (${response.status})`);
    }

    const data = (await response.json()) as TermsResponse;
    const resolved: Record<string, ExploreOntologyTerm> = {};

    for (const termId of normalized) {
      const term = data.terms?.[termId];
      if (!term) continue;
      resolved[termId] = {
        id: term.id,
        label: term.name || term.id,
        namespace: term.namespace,
        definition: term.definition,
      };
    }

    return resolved;
  } catch (error) {
    console.error("Error resolving ontology terms", error);
    return {};
  }
}

export async function searchOntologyTerms(query: string, limit = 24): Promise<ExploreOntologyTerm[]> {
  const normalized = query.trim();
  if (!normalized) {
    return [];
  }

  if (ONTOLOGY_ID_PATTERN.test(normalized)) {
    const normalizedId = normalizeOntologyId(normalized);
    const resolved = await resolveOntologyTerms([normalizedId]);
    const term = resolved[normalizedId];
    return term ? [term] : [{ id: normalizedId, label: normalizedId }];
  }

  try {
    const response = await fetch(`${getApiServiceUrl()}/terms/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [normalized], limit }),
    });

    if (!response.ok) {
      throw new Error(`Failed to search ontology terms (${response.status})`);
    }

    const data = (await response.json()) as OntologySearchResponse;
    const matches = data.results?.[normalized] || [];

    const mapped = matches.map((match) => ({
      id: normalizeOntologyId(match.id),
      label: match.name || match.id,
      namespace: match.namespace,
      definition: match.definition,
      matchType: match.match_type,
      matchedText: match.matched_text,
      score: match.score,
    }));

    if (mapped.length > 0) {
      return mapped;
    }
  } catch (error) {
    console.error("Error searching ontology terms", error);
  }

  try {
    const fallback = await browseOntologyTermsFromEntityHits(undefined, Math.max(limit * 3, 120));
    const lowerQuery = normalized.toLowerCase();
    return fallback
      .filter((term) =>
        term.id.toLowerCase().includes(lowerQuery)
        || term.label.toLowerCase().includes(lowerQuery)
        || term.namespace?.toLowerCase().includes(lowerQuery)
        || term.definition?.toLowerCase().includes(lowerQuery),
      )
      .slice(0, limit);
  } catch (error) {
    console.error("Error in ontology search fallback", error);
    return [];
  }
}

export async function browseTopOntologyTerms(species?: string, limit = 24): Promise<ExploreOntologyTerm[]> {
  try {
    return await browseOntologyTermsFromEntityHits(species, limit);
  } catch (error) {
    console.error("Error browsing ontology terms", error);
    return [];
  }
}

export async function resolveEntityIdentifiers(identifiers: string[]): Promise<ResolvedEntityLookupResponse> {
  const normalizedIdentifiers = identifiers.map((identifier) => identifier.trim()).filter(Boolean);
  if (normalizedIdentifiers.length === 0) {
    return { matches: [], entities: [] };
  }

  const response = await fetch(`${getApiServiceUrl()}/entity-lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers: normalizedIdentifiers }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Entity lookup error: ${response.status} ${text}`);
  }

  return (await response.json()) as ResolvedEntityLookupResponse;
}

export async function exploreOntologyTree(termIds: string[]): Promise<OntologyTreeNode | null> {
  const normalizedTermIds = termIds.map((termId) => termId.trim()).filter(Boolean);
  if (normalizedTermIds.length === 0) {
    return null;
  }

  const response = await fetch(`${getApiServiceUrl()}/tree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term_ids: normalizedTermIds }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API service error: ${response.status} ${text}`);
  }

  const data = (await response.json()) as OntologyTreeResponse;
  return data.root || null;
}

export async function getAssociatedEntityScope(entityIds: Array<string | number>): Promise<AssociatedEntityScope> {
  const seedEntityIds = normalizeIds(entityIds);
  if (seedEntityIds.length === 0) {
    return {
      seedEntityIds: [],
      associatedEntityIds: [],
      expandedEntityIds: [],
    };
  }

  const response = await searchAssociations("", { member_entity_ids: seedEntityIds }, 10000, 0);

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

export async function getEntityIdsForAnnotationTerms(annotationIds: string[]): Promise<string[]> {
  const normalized = normalizeIds(annotationIds);
  if (normalized.length === 0) return [];

  const pageSize = 250;
  const entityIds = new Set<string>();
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const response = await searchEntities({
      query: "",
      target: SEARCH_TARGETS.ENTITIES,
      limit: pageSize,
      offset,
      filters: { ontology_terms: normalized },
    });

    const hits = response.hits || [];
    for (const hit of hits) {
      const entityId = String(hit.entity_id ?? "").trim();
      if (entityId) {
        entityIds.add(entityId);
      }
    }

    total = response.estimatedTotalHits || hits.length;
    if (hits.length < pageSize) break;
    offset += pageSize;
  }

  return Array.from(entityIds);
}

export async function getScopedAnnotationTerms(
  scopedEntityIds: string[],
  filters: SearchFilters = {},
): Promise<ScopedAnnotationTerm[]> {
  if (scopedEntityIds.length === 0) return [];

  const pageSize = 250;
  const counts = new Map<string, number>();

  for (let index = 0; index < scopedEntityIds.length; index += pageSize) {
    const batch = scopedEntityIds.slice(index, index + pageSize);
    const response = await searchEntities({
      query: "",
      target: SEARCH_TARGETS.ENTITIES,
      limit: batch.length,
      offset: 0,
      filters: { ...filters, entity_ids: batch },
    });

    for (const hit of response.hits || []) {
      const rawTerms = Array.isArray(hit.ontology_terms)
        ? hit.ontology_terms
        : Array.isArray(hit.cv_terms)
          ? hit.cv_terms
          : [];

      const uniqueTerms = new Set(rawTerms.map((term) => String(term).trim()).filter(Boolean));
      uniqueTerms.forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
    }
  }

  const termIds = Array.from(counts.keys());
  if (termIds.length === 0) return [];

  const resolved = await resolveOntologyTerms(termIds);
  return termIds
    .map((termId) => ({
      id: termId,
      label: resolved[termId]?.label || termId,
      namespace: resolved[termId]?.namespace,
      definition: resolved[termId]?.definition,
      entityCount: counts.get(termId) || 0,
    }))
    .sort((a, b) => b.entityCount - a.entityCount || a.label.localeCompare(b.label));
}

export async function getInteractionStats() {
  return getInteractionStatsData();
}

export async function getSelectionInteractionCount(filters: SearchFilters, scopedEntityIds: string[]): Promise<number> {
  if (scopedEntityIds.length === 0) {
    return 0;
  }

  const response = await searchInteractions("", { ...filters, entity_ids: scopedEntityIds }, 1, 0);
  return response.estimatedTotalHits || 0;
}

export async function searchResults(params: Parameters<typeof searchEntities>[0]) {
  return searchEntities(params);
}


export type SearchEntitiesResponse = Awaited<ReturnType<typeof searchEntities>>;
export type SearchInteractionsResponse = Awaited<ReturnType<typeof searchInteractions>>;
export type GetEntitiesByIdsResponse = Awaited<ReturnType<typeof getEntitiesByIds>>;
