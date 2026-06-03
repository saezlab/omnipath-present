import type { SearchFilters } from "$lib/types/search";
import type { InteractionDetailsData, InteractionListRow } from "$lib/types/interactions";
import type { EntityOntologyHierarchy } from "$lib/drizzle";

export type EntitySearchCursor = { relationCount: number; entityPk: string };
export type SelectionScopeMode = "union" | "intersection";
export type SelectionScopeRequest = {
  entityPks?: Array<string | number>;
  annotationTermIds?: string[];
  includeAssociatedEntities?: boolean;
  includeMembersParticipants?: boolean;
  mode?: SelectionScopeMode;
};

export async function fetchSelectionScope(params: {
  entityPks?: Array<string | number>;
  annotationTermIds?: string[];
  includeAssociatedEntities?: boolean;
  includeMembersParticipants?: boolean;
  mode?: SelectionScopeMode;
}) {
  const res = await fetch("/app-api/selection/scope", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to resolve selection scope");
  return res.json() as Promise<{
    entityPks: string[];
    seedEntityPks: string[];
    termEntityPks: string[];
    ontologyTermIds: string[];
    criteriaCount: number;
    expandedEntityCount: number;
  }>;
}

export async function fetchEntitiesSearch(params: {
  query?: string;
  limit?: number;
  cursor?: EntitySearchCursor | null;
  filters?: SearchFilters;
}) {
  const hasLargeFilters = params.filters && (
    (params.filters.entity_pks?.length ?? 0) > 50 ||
    (params.filters.annotation_term_ids?.length ?? 0) > 10
  );

  if (hasLargeFilters) {
    const res = await fetch("/app-api/entities/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: params.query || "",
        limit: params.limit ?? 20,
        cursor: params.cursor,
        filters: params.filters,
      }),
    });
    if (!res.ok) throw new Error("Failed to fetch entities");
    return res.json() as Promise<{
      entities: Array<{
        entityPk: string;
        canonicalIdentifier: string;
        canonicalIdentifierType: string;
        resolutionStatus?: string | null;
        entityType: string | null;
        taxonomyId: string | null;
        entityAttributes: unknown;
        sources: string[];
        relationCount?: number;
        ontologyHierarchy?: EntityOntologyHierarchy | null;
        identifiersTotal?: number;
        identifiers: Array<{
          id?: string;
          entityPk: string;
          identifier: string;
          identifierType: string;
        }>;
      }>;
      nextCursor: EntitySearchCursor | null;
    }>;
  }

  const url = new URL("/app-api/entities/search", window.location.origin);
  if (params.query) url.searchParams.set("q", params.query);
  if (params.limit) url.searchParams.set("limit", String(params.limit));
  if (params.cursor != null) url.searchParams.set("cursor", JSON.stringify(params.cursor));
  if (params.filters && Object.keys(params.filters).length > 0) {
    url.searchParams.set("filters", JSON.stringify(params.filters));
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch entities");
  return res.json() as Promise<{
    entities: Array<{
      entityPk: string;
      canonicalIdentifier: string;
      canonicalIdentifierType: string;
      resolutionStatus?: string | null;
      entityType: string | null;
      taxonomyId: string | null;
      entityAttributes: unknown;
      sources: string[];
      relationCount?: number;
      ontologyHierarchy?: EntityOntologyHierarchy | null;
      identifiersTotal?: number;
      identifiers: Array<{
        id?: string;
        entityPk: string;
        identifier: string;
        identifierType: string;
      }>;
    }>;
    nextCursor: EntitySearchCursor | null;
  }>;
}

export async function fetchEntityFilterOptions() {
  const res = await fetch("/app-api/entities/filter-options");
  if (!res.ok) throw new Error("Failed to fetch entity filter options");
  return res.json() as Promise<{
    entity_types: string[];
    sources: string[];
    taxonomy_ids: string[];
  }>;
}

export async function fetchRelationsSearch(params: {
  filters?: SearchFilters;
  limit?: number;
  offset?: number;
}) {
  const res = await fetch("/app-api/relations/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to fetch relations");
  return res.json() as Promise<{
    relations: Array<{
      relationPk: string;
      subjectEntityPk: string;
      predicate: string;
      objectEntityPk: string;
      relationCategory: string;
      participantTypes: string[];
      evidenceCount: number;
      sources: string[];
    }>;
    total: number;
  }>;
}

export async function fetchRelationFilterOptions() {
  const res = await fetch("/app-api/relations/filter-options");
  if (!res.ok) throw new Error("Failed to fetch relation filter options");
  return res.json() as Promise<{
    predicatesByCategory: Record<string, string[]>;
    sources: string[];
    interactionTypes: string[];
  }>;
}

export async function fetchRelationEvidence(relationPk: string | number) {
  const res = await fetch(`/app-api/relations/${relationPk}/evidence`);
  if (!res.ok) throw new Error("Failed to fetch relation evidence");
  return res.json() as Promise<{ evidence: InteractionDetailsData["evidence"] }>;
}

export async function fetchEntitiesByPublicIds(publicIds: string[]) {
  const res = await fetch("/app-api/entities/by-public-ids", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_ids: publicIds }),
  });
  if (!res.ok) throw new Error("Failed to fetch entities by public ids");
  return res.json() as Promise<{
    entities: Array<{
      entityPk: string;
      canonicalIdentifier: string;
      canonicalIdentifierType: string;
      resolutionStatus?: string | null;
      entityType: string | null;
      taxonomyId: string | null;
      entityAttributes: unknown;
      sources: string[];
      relationCount?: number;
      ontologyHierarchy?: EntityOntologyHierarchy | null;
      identifiersTotal?: number;
      identifiers: Array<{
        id?: string;
        entityPk: string;
        identifier: string;
        identifierType: string;
      }>;
    }>;
  }>;
}

export async function fetchEntitiesByPks(pks: Array<string | number>) {
  const res = await fetch("/app-api/entities/by-pks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pks }),
  });
  if (!res.ok) throw new Error("Failed to fetch entities by pks");
  const data = await res.json() as { entities: Array<{
    entityPk: string;
    canonicalIdentifier: string;
    canonicalIdentifierType: string;
    resolutionStatus?: string | null;
    entityType: string | null;
    taxonomyId: string | null;
    entityAttributes: unknown;
    sources: string[];
    relationCount?: number;
    ontologyHierarchy?: EntityOntologyHierarchy | null;
    identifiersTotal?: number;
    identifiers: Array<{ id?: string; entityPk: string; identifier: string; identifierType: string }>;
  }> };
  return data;
}

export async function fetchOntologySearch(params: {
  query?: string;
  prefixes?: string[];
  ontologyIds?: string[];
  limit?: number;
  offset?: number;
}) {
  const url = new URL("/app-api/ontology/search", window.location.origin);
  if (params.query) url.searchParams.set("q", params.query);
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.offset != null) url.searchParams.set("offset", String(params.offset));
  if (params.prefixes?.length) url.searchParams.set("prefixes", params.prefixes.join(","));
  if (params.ontologyIds?.length) url.searchParams.set("ontologyIds", params.ontologyIds.join(","));

  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch ontology terms");
  return res.json() as Promise<
    Array<{
      termId: string;
      ontologyPrefix: string | null;
      ontologyId: string | null;
      label: string | null;
      definition: string | null;
      synonyms: string[];
      sources: string[];
      annotatedEntityCount: number;
      annotatedRelationCount: number;
      annotatedItemCount: number;
    }>
  >;
}

export async function fetchScopedOntologySearch(params: {
  entityPks?: Array<string | number>;
  termIds?: string[];
  selectionScope?: SelectionScopeRequest;
  query?: string;
  prefixes?: string[];
  ontologyIds?: string[];
  limit?: number;
  offset?: number;
}) {
  const res = await fetch("/app-api/ontology/scoped-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entityPks: params.entityPks || [],
      termIds: params.termIds || [],
      selectionScope: params.selectionScope,
      query: params.query || "",
      prefixes: params.prefixes,
      ontologyIds: params.ontologyIds,
      limit: params.limit ?? 24,
      offset: params.offset ?? 0,
    }),
  });
  if (!res.ok) throw new Error("Failed to fetch scoped ontology terms");
  return res.json() as Promise<
    Array<{
      termId: string;
      ontologyPrefix: string | null;
      ontologyId: string | null;
      label: string | null;
      definition: string | null;
      synonyms: string[];
      sources: string[];
      annotatedEntityCount: number;
      annotatedRelationCount: number;
      annotatedItemCount: number;
    }>
  >;
}

export async function fetchOntologyPrefixes() {
  const res = await fetch("/app-api/ontology/prefixes");
  if (!res.ok) throw new Error("Failed to fetch ontology prefixes");
  return res.json() as Promise<{ prefixes: string[] }>;
}

export async function fetchScopedOntologyPrefixCounts(params: {
  entityPks?: Array<string | number>;
  annotationTermIds?: string[];
  query?: string;
}) {
  const res = await fetch("/app-api/ontology/prefix-counts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to fetch scoped ontology prefix counts");
  return res.json() as Promise<Array<{ prefix: string; scopedCount: number }>>;
}

export async function fetchScopedOntologyIdCounts(params: {
  entityPks?: Array<string | number>;
  annotationTermIds?: string[];
  selectionScope?: SelectionScopeRequest;
  query?: string;
}) {
  const res = await fetch("/app-api/ontology/ontology-id-counts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to fetch scoped ontology id counts");
  return res.json() as Promise<Array<{ ontologyId: string; scopedCount: number }>>;
}

export async function fetchTerms(termIds: string[]) {
  const res = await fetch("/app-api/terms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term_ids: termIds }),
  });
  if (!res.ok) throw new Error("Failed to fetch terms");
  return res.json() as Promise<{ terms: Record<string, unknown | null> }>;
}

export async function fetchScopedEntityFacetCounts(params: {
  entityIds?: Array<string | number>;
  annotationTermIds?: string[];
  entityTypes?: string[];
  sources?: string[];
  ncbi_tax_id?: string[];
  query?: string;
  facetLimit?: number;
}) {
  const res = await fetch("/app-api/entities/scoped-facets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to fetch scoped entity facet counts");
  return res.json() as Promise<
    Array<{ facetName: string; facetValue: string; scopedCount: number }>
  >;
}

export async function fetchScopedRelationFacetCounts(params: {
  entityIds?: Array<string | number>;
  endpointMode?: "any" | "both";
  mode?: SelectionScopeMode;
  annotationTermIds?: string[];
  predicates?: string[];
  interactionTypes?: string[];
  sources?: string[];
  taxonomyIds?: string[];
}) {
  const res = await fetch("/app-api/relations/scoped-facets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to fetch scoped relation facet counts");
  return res.json() as Promise<
    Array<{ facetName: string; facetValue: string; facetCategory?: string | null; scopedCount: number }>
  >;
}

// ── Statistics / query API (Milestone H) ────────────────────────────────────
// Hand-written wrappers over the api-service /api/stats/* endpoints (reached via
// the /api/[...path] catch-all proxy). No codegen; keep in sync with stats.py.

async function fetchStats<T>(path: string): Promise<T> {
  const res = await fetch(`/api/stats/${path}`);
  if (!res.ok) throw new Error(`Failed to fetch stats/${path}`);
  return res.json() as Promise<T>;
}

export interface StatsSource {
  slug: string;
  short: string;
  full: string;
  entityCount: number;
  interactionCount: number;
  associationCount: number;
  identifierCount: number;
  ontologyTermCount: number;
}

export const fetchStatsSources = () => fetchStats<StatsSource[]>("sources");
export const fetchStatsEntityTypes = () =>
  fetchStats<Array<{ entityType: string; count: number }>>("entity-types");
export const fetchStatsInteractionTypes = () =>
  fetchStats<Array<{ interactionType: string; interactionClass: string | null; count: number }>>(
    "interaction-types",
  );
export const fetchStatsIdentifierTypes = () =>
  fetchStats<Array<{ identifierType: string; count: number }>>("identifier-types");
export const fetchStatsChemicalClasses = () =>
  fetchStats<Array<{ chemicalClass: string; count: number }>>("chemical-classes");
export const fetchStatsMetabolicDomains = () =>
  fetchStats<Array<{ metabolicDomain: string; count: number }>>("metabolic-domains");
export const fetchStatsBuildManifest = () =>
  fetchStats<{ buildId: string; builtAt: string; partialBuild: boolean; [k: string]: unknown }>(
    "build-manifest",
  );
export const fetchStatsCoverageProfile = () =>
  fetchStats<Array<{ nResources: number; nEntities: number }>>("coverage-profile");
export const fetchStatsResourceOverlap = (contentKind = "entity") =>
  fetchStats<Array<{ sourceA: string; sourceB: string; overlap: number }>>(
    `resource-overlap?contentKind=${encodeURIComponent(contentKind)}`,
  );
