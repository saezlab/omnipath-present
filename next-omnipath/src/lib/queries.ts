"use server";

import "server-only";

import { SEARCH_TARGETS, type SearchTarget } from "@/lib/search/collections";
import {
  getInteractionStats as getInteractionStatsData,
  search,
  searchAssociations as searchAssociationsData,
  searchInteractions as searchInteractionsData,
} from "@/lib/data/search";
import { getApiServiceUrl } from "@/lib/api/config";
import {
  getAnnotationTermCountsForEntityPublicIds,
  getAssociatedEntityPublicIdsByMemberPublicIds,
  getAssociationById,
  getAssociationEvidence,
  getEntitiesByPks,
  getEntitiesByPublicIds,
  getEntityAnnotations,
  getEntityByPublicId,
  getEntityIdentifiers,
  getEntityIdentifiersByEntityPks,
  getEntityPublicIdsForAnnotationTerms,
  getEntitySummary,
  getInteractionAnnotations,
  getInteractionById,
  getInteractionCountForEntityPublicIds,
  getInteractionEvidence,
  toPublicEntityId,
} from "@/lib/db/reads";
import {
  classifyEntityIdentifiers,
  getEntityDisplayName,
  getEntityPublicId,
  getEntitySecondaryName,
  getEntityTypeLabel,
} from "@/lib/entities/display";
import type { SearchResponse } from "@/lib/search/types";
import type { SearchFilters } from "@/types/search";
import type { InteractionDetailsData, InteractionEvidence, InteractionListRow } from "@/features/interactions-search/types";
import type { AssociationAnnotation, AssociationDetailsData, AssociationEvidence, AssociationListRow } from "@/features/associations/types";
import type { EntitySearchRow, SearchResult } from "@/types/search-results";

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

async function browseOntologyTermsFromEntityHits(species: string | undefined, limit: number): Promise<ExploreOntologyTerm[]> {
  const filters: SearchFilters = species ? { ncbi_tax_id: [species] } : {};
  const response = await searchEntities({
    query: "",
    limit: 0,
    offset: 0,
    filters,
    facets: ["ontology_terms"],
  });

  const counts = Object.entries(response.facetDistribution?.ontology_terms || {})
    .map(([termId, count]) => [normalizeOntologyId(termId), Number(count || 0)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const entries = counts;

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
}): Promise<SearchResponse<EntitySearchRow>> {
  try {
    return await search<EntitySearchRow>({
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

export async function getEntityRowByPublicId(entityId: string) {
  const normalizedId = entityId.trim();
  if (!normalizedId) {
    return null;
  }

  try {
    return await getEntityByPublicId(normalizedId);
  } catch (error) {
    console.error("Error fetching entity row by public ID:", error);
    return null;
  }
}

export async function getEntityDetailsByPublicId(entityId: string) {
  const normalizedId = entityId.trim();
  if (!normalizedId) {
    return null;
  }

  try {
    const entity = await getEntityByPublicId(normalizedId);
    if (!entity) {
      return null;
    }

    const [identifiers, annotations, summary] = await Promise.all([
      getEntityIdentifiers(entity.entityPk),
      getEntityAnnotations(entity.entityPk),
      getEntitySummary(entity.entityPk),
    ]);

    return {
      entity,
      identifiers,
      annotations,
      summary,
    };
  } catch (error) {
    console.error("Error fetching entity details by public ID:", error);
    return null;
  }
}

function parseCvValue(value: string | null | undefined): { accession: string; label: string } {
  const text = (value || "").trim();
  const parts = text.split(":");
  if (parts.length < 3) {
    return { accession: text, label: text };
  }
  return {
    accession: `${parts[0]}:${parts[1]}`,
    label: parts.slice(2).join(":").trim(),
  };
}

function toLegacyLabeledValue(value: string | null | undefined): string {
  const { accession, label } = parseCvValue(value);
  if (!accession || !label) return value || "";
  return `${label.toLowerCase()}:${accession}`;
}

function mapEvidenceAttributes(
  attributes: Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined,
): AssociationAnnotation[] {
  return (attributes || []).map((item) => ({
    term: toLegacyLabeledValue(item.term),
    value: item.value ?? null,
    unit: item.unit ? toLegacyLabeledValue(item.unit) : null,
  }));
}

function mapInteractionEvidenceRows(rows: Awaited<ReturnType<typeof getInteractionEvidence>>): InteractionEvidence[] {
  return rows.map((row, index) => ({
    evidence_serial: index + 1,
    source: row.source,
    direction: row.direction === 1 ? "a-b" : row.direction === -1 ? "b-a" : row.direction === 0 ? "undirected" : null,
    sign: row.sign === 1 || row.sign === -1 || row.sign === 0 ? row.sign : null,
    interaction_annotations: [
      ...mapEvidenceAttributes(row.recordAttributes as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
      ...mapEvidenceAttributes(row.evidence as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
    ],
    member_a_annotations: mapEvidenceAttributes(row.entityAAttributes as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
    member_b_annotations: mapEvidenceAttributes(row.entityBAttributes as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
  }));
}

export async function searchInteractions(
  query: string,
  filters: SearchFilters,
  limit: number = 20,
  offset: number = 0,
): Promise<SearchResponse<InteractionListRow>> {
  try {
    const result = await searchInteractionsData({
      query,
      limit,
      offset,
      filters,
    });

    return {
      hits: result.hits || [],
      estimatedTotalHits: result.estimatedTotalHits || 0,
      limit,
      offset,
      processingTimeMs: result.processingTimeMs || 0,
      query,
      facetDistribution: result.facetDistribution,
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

export async function getInteractionDetailsById(interactionId: number): Promise<InteractionDetailsData | null> {
  if (!Number.isFinite(interactionId)) {
    return null;
  }

  try {
    const interaction = await getInteractionById(interactionId);
    if (!interaction) {
      return null;
    }

    const [entities, evidence, interactionAnnotations] = await Promise.all([
      getEntitiesByPks([interaction.entityAPk, interaction.entityBPk]),
      getInteractionEvidence(interaction.interactionPk),
      getInteractionAnnotations(interaction.interactionPk),
    ]);

    const entityByPk = new Map(entities.map((entity) => [entity.entityPk, entity]));
    const entityA = entityByPk.get(interaction.entityAPk);
    const entityB = entityByPk.get(interaction.entityBPk);

    if (!entityA || !entityB) {
      return null;
    }

    return {
      interaction,
      entityA,
      entityB,
      evidence: mapInteractionEvidenceRows(evidence),
      interactionAnnotations,
      rawEvidence: evidence,
    };
  } catch (error) {
    console.error("Error fetching interaction details:", error);
    return null;
  }
}

export async function getEntitiesByIds(entityIds: string[]): Promise<Map<string, EntityInfo>> {
  if (entityIds.length === 0) {
    return new Map();
  }

  try {
    const uniqueIds = [...new Set(entityIds)];
    const entities = await getEntitiesByPublicIds(uniqueIds);
    const identifiers = await getEntityIdentifiersByEntityPks(entities.map((entity) => entity.entityPk));
    const identifiersByEntityPk = new Map<number, typeof identifiers>();

    for (const identifier of identifiers) {
      const current = identifiersByEntityPk.get(identifier.entityPk) || [];
      current.push(identifier);
      identifiersByEntityPk.set(identifier.entityPk, current);
    }

    const entityMap = new Map<string, EntityInfo>();

    for (const entity of entities) {
      const entityWithIdentifiers = {
        ...entity,
        identifiers: (identifiersByEntityPk.get(entity.entityPk) || []).map((identifier) => ({
          key: identifier.identifierType,
          value: identifier.identifier,
        })),
      };
      const publicId = toPublicEntityId(entity);
      const { geneSymbols } = classifyEntityIdentifiers(entityWithIdentifiers);

      entityMap.set(publicId, {
        id: publicId,
        canonical_identifier: getEntitySecondaryName(entityWithIdentifiers) || entity.canonicalIdentifier,
        display_name: getEntityDisplayName(entityWithIdentifiers),
        entity_type_name: getEntityTypeLabel(entityWithIdentifiers),
        gene_symbol: geneSymbols[0],
      });
    }

    return entityMap;
  } catch (error) {
    console.error("Error fetching entities by IDs:", error);
    return new Map();
  }
}

function mapAssociationEvidenceRows(rows: Awaited<ReturnType<typeof getAssociationEvidence>>): AssociationEvidence[] {
  return rows.map((row, index) => ({
    evidence_serial: index + 1,
    source: row.source,
    role_term_id: row.roleTermId ?? null,
    stoichiometry: row.stoichiometry ?? null,
    annotations: [
      ...mapEvidenceAttributes(row.recordAttributes as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
      ...mapEvidenceAttributes(row.evidence as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
    ],
    parent_annotations: mapEvidenceAttributes(row.parentAttributes as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
    member_annotations: mapEvidenceAttributes(row.memberAttributes as Array<{ term?: string | null; value?: string | null; unit?: string | null }> | null | undefined),
  }));
}

export async function searchAssociations(
  query: string,
  filters: SearchFilters,
  limit: number = 20,
  offset: number = 0,
): Promise<SearchResponse<AssociationListRow>> {
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

export async function getAssociationDetailsById(associationId: number): Promise<AssociationDetailsData | null> {
  if (!Number.isFinite(associationId)) {
    return null;
  }

  try {
    const association = await getAssociationById(associationId);
    if (!association) {
      return null;
    }

    const [entities, evidence, identifiers] = await Promise.all([
      getEntitiesByPks([association.parentEntityPk, association.memberEntityPk]),
      getAssociationEvidence(association.associationPk),
      getEntityIdentifiersByEntityPks([association.parentEntityPk, association.memberEntityPk]),
    ]);

    const entityByPk = new Map(entities.map((entity) => [entity.entityPk, entity]));
    const parent = entityByPk.get(association.parentEntityPk);
    const member = entityByPk.get(association.memberEntityPk);

    if (!parent || !member) {
      return null;
    }

    return {
      association,
      parent,
      member,
      parentIdentifiers: identifiers.filter((identifier) => identifier.entityPk === association.parentEntityPk),
      memberIdentifiers: identifiers.filter((identifier) => identifier.entityPk === association.memberEntityPk),
      evidence: mapAssociationEvidenceRows(evidence),
      rawEvidence: evidence,
    };
  } catch (error) {
    console.error("Error fetching association details:", error);
    return null;
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

  const associatedEntityIds = (await getAssociatedEntityPublicIdsByMemberPublicIds(seedEntityIds))
    .filter((id) => !seedEntityIds.includes(id));

  return {
    seedEntityIds,
    associatedEntityIds,
    expandedEntityIds: [...seedEntityIds, ...associatedEntityIds],
  };
}

export async function getEntityIdsForAnnotationTerms(annotationIds: string[]): Promise<string[]> {
  const normalized = normalizeIds(annotationIds);
  if (normalized.length === 0) return [];

  try {
    return await getEntityPublicIdsForAnnotationTerms(normalized);
  } catch (error) {
    console.error("Error fetching entity IDs for annotation terms:", error);
    return [];
  }
}

export async function getScopedAnnotationTerms(
  scopedEntityIds: string[],
  filters: SearchFilters = {},
): Promise<ScopedAnnotationTerm[]> {
  if (scopedEntityIds.length === 0) return [];

  try {
    const counts = await getAnnotationTermCountsForEntityPublicIds(scopedEntityIds, filters);
    const termIds = counts.map((entry) => entry.cvTerm);
    if (termIds.length === 0) return [];

    const resolved = await resolveOntologyTerms(termIds);
    return counts
      .map((entry) => ({
        id: entry.cvTerm,
        label: resolved[entry.cvTerm]?.label || entry.cvTerm,
        namespace: resolved[entry.cvTerm]?.namespace,
        definition: resolved[entry.cvTerm]?.definition,
        entityCount: entry.entityCount,
      }))
      .sort((a, b) => b.entityCount - a.entityCount || a.label.localeCompare(b.label));
  } catch (error) {
    console.error("Error fetching scoped annotation terms:", error);
    return [];
  }
}

export async function getInteractionStats() {
  return getInteractionStatsData();
}

export async function getSelectionInteractionCount(filters: SearchFilters, scopedEntityIds: string[]): Promise<number> {
  if (scopedEntityIds.length === 0) {
    return 0;
  }

  try {
    return await getInteractionCountForEntityPublicIds(scopedEntityIds, filters);
  } catch (error) {
    console.error("Error fetching selection interaction count:", error);
    return 0;
  }
}

export async function searchResults(params: Parameters<typeof searchEntities>[0]) {
  return searchEntities(params);
}


export type SearchEntitiesResponse = Awaited<ReturnType<typeof searchEntities>>;
export type SearchInteractionsResponse = Awaited<ReturnType<typeof searchInteractions>>;
export type SearchAssociationsResponse = Awaited<ReturnType<typeof searchAssociations>>;
export type GetEntitiesByIdsResponse = Awaited<ReturnType<typeof getEntitiesByIds>>;
