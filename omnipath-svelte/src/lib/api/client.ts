import type { SearchFilters } from "$lib/types/search";
import type { InteractionDetailsData, InteractionListRow } from "$lib/types/interactions";

export async function fetchEntitiesSearch(params: {
  query?: string;
  limit?: number;
  cursor?: number | null;
  filters?: SearchFilters;
}) {
  const url = new URL("/app-api/entities/search", window.location.origin);
  if (params.query) url.searchParams.set("q", params.query);
  if (params.limit) url.searchParams.set("limit", String(params.limit));
  if (params.cursor != null) url.searchParams.set("cursor", String(params.cursor));
  if (params.filters && Object.keys(params.filters).length > 0) {
    url.searchParams.set("filters", JSON.stringify(params.filters));
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch entities");
  return res.json() as Promise<{
    entities: Array<{
      entityPk: number;
      canonicalIdentifier: string;
      canonicalIdentifierType: string;
      entityType: string | null;
      taxonomyId: string | null;
      entityAttributes: unknown;
      sources: string[];
      identifiers: Array<{
        id: number;
        entityPk: number;
        identifier: string;
        identifierType: string;
      }>;
    }>;
    nextCursor: number | null;
  }>;
}

export async function fetchEntityFilterOptions() {
  const res = await fetch("/app-api/entities/filter-options");
  if (!res.ok) throw new Error("Failed to fetch entity filter options");
  return res.json() as Promise<{
    entity_types: string[];
    sources: string[];
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
      relationPk: number;
      subjectEntityPk: number;
      predicate: string;
      objectEntityPk: number;
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

export async function fetchRelationEvidence(relationPk: number) {
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
      entityPk: number;
      canonicalIdentifier: string;
      canonicalIdentifierType: string;
      entityType: string | null;
      taxonomyId: string | null;
      entityAttributes: unknown;
      sources: string[];
      identifiers: Array<{
        id: number;
        entityPk: number;
        identifier: string;
        identifierType: string;
      }>;
    }>;
  }>;
}

export async function fetchEntitiesByPks(pks: number[]) {
  const res = await fetch("/app-api/entities/by-pks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pks }),
  });
  if (!res.ok) throw new Error("Failed to fetch entities by pks");
  const data = await res.json() as { entities: Array<{
    entityPk: number;
    canonicalIdentifier: string;
    canonicalIdentifierType: string;
    entityType: string | null;
    taxonomyId: string | null;
    entityAttributes: unknown;
    sources: string[];
    identifiers: Array<{ id: number; entityPk: number; identifier: string; identifierType: string }>;
  }> };
  return data;
}

export async function fetchOntologySearch(params: {
  query?: string;
  prefixes?: string[];
  limit?: number;
  offset?: number;
}) {
  const url = new URL("/app-api/ontology/search", window.location.origin);
  if (params.query) url.searchParams.set("q", params.query);
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.offset != null) url.searchParams.set("offset", String(params.offset));
  if (params.prefixes?.length) url.searchParams.set("prefixes", params.prefixes.join(","));

  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch ontology terms");
  return res.json() as Promise<
    Array<{
      termId: string;
      ontologyPrefix: string | null;
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
  entityIds: string[];
  query?: string;
  prefixes?: string[];
  limit?: number;
  offset?: number;
}) {
  const url = new URL("/app-api/ontology/scoped-search", window.location.origin);
  if (params.query) url.searchParams.set("q", params.query);
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.offset != null) url.searchParams.set("offset", String(params.offset));
  if (params.prefixes?.length) url.searchParams.set("prefixes", params.prefixes.join(","));
  if (params.entityIds?.length) url.searchParams.set("entityIds", params.entityIds.join(","));

  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch scoped ontology terms");
  return res.json() as Promise<
    Array<{
      termId: string;
      ontologyPrefix: string | null;
      label: string | null;
      definition: string | null;
      synonyms: string[];
      sources: string[];
      annotatedEntityCount: number;
    }>
  >;
}

export async function fetchOntologyPrefixes() {
  const res = await fetch("/app-api/ontology/prefixes");
  if (!res.ok) throw new Error("Failed to fetch ontology prefixes");
  return res.json() as Promise<{ prefixes: string[] }>;
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
