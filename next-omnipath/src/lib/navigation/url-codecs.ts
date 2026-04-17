import type { MeilisearchFilters } from "@/types/meilisearch";

export type ResultsView = "entities" | "interactions" | "selection";
export type SelectionTab = "entities" | "interactions" | "annotations";
export type SearchMode = "full-text" | "identifier" | "batch";
export type SearchType = "search_entities" | "cv_terms";
export type EntityWorkflow = "direct_lookup" | "annotations_to_entities" | "entities_to_annotations";

const SEARCH_MODES = new Set<SearchMode>(["full-text", "identifier", "batch"]);
const SELECTION_TABS = new Set<SelectionTab>(["entities", "interactions", "annotations"]);
const SEARCH_TYPES = new Set<SearchType>(["search_entities", "cv_terms"]);
const ENTITY_WORKFLOWS = new Set<EntityWorkflow>(["direct_lookup", "annotations_to_entities", "entities_to_annotations"]);

export function normalizeStringArray(value: Array<string | number> | undefined | null): string[] {
  if (!value) return [];

  return Array.from(
    new Set(
      value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

export function parseEntityIdsParam(value: string | null | undefined): string[] {
  if (!value) return [];
  return normalizeStringArray(value.split(","));
}

export function serializeEntityIdsParam(value: Array<string | number> | undefined | null): string | null {
  const normalized = normalizeStringArray(value);
  return normalized.length > 0 ? normalized.join(",") : null;
}

export function parseFiltersParam(value: string | null | undefined): MeilisearchFilters {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as MeilisearchFilters;
  } catch {
    return {};
  }
}

export function serializeFiltersParam(value: MeilisearchFilters | undefined | null): string | null {
  if (!value || Object.keys(value).length === 0) return null;
  return JSON.stringify(value);
}

export function parseSelectionTab(value: string | null | undefined): SelectionTab {
  if (value === "selection") {
    return "entities";
  }
  if (value === "associations") {
    return "interactions";
  }
  if (value && SELECTION_TABS.has(value as SelectionTab)) {
    return value as SelectionTab;
  }
  return "entities";
}

export function parseSearchMode(value: string | null | undefined): SearchMode {
  if (value && SEARCH_MODES.has(value as SearchMode)) {
    return value as SearchMode;
  }
  return "full-text";
}

export function parseSearchType(value: string | null | undefined): SearchType {
  if (value && SEARCH_TYPES.has(value as SearchType)) {
    return value as SearchType;
  }
  return "search_entities";
}

export function parseEntityWorkflow(value: string | null | undefined): EntityWorkflow {
  if (value && ENTITY_WORKFLOWS.has(value as EntityWorkflow)) {
    return value as EntityWorkflow;
  }
  return "direct_lookup";
}

export function buildWorkspaceUrl(params: {
  view?: ResultsView;
  query?: string;
  mode?: SearchMode;
  type?: SearchType;
  species?: string | null;
  entityWorkflow?: EntityWorkflow;
  entityIds?: Array<string | number>;
  annotationIds?: Array<string | number>;
  tab?: SelectionTab;
  filters?: MeilisearchFilters;
}): string {
  const searchParams = new URLSearchParams();
  searchParams.set("view", params.view || "entities");

  if (params.query?.trim()) searchParams.set("q", params.query.trim());
  if (params.mode && params.mode !== "full-text") searchParams.set("mode", params.mode);
  if (params.type && params.type !== "search_entities") searchParams.set("type", params.type);
  if (params.species?.trim()) searchParams.set("species", params.species.trim());
  if (params.entityWorkflow && params.entityWorkflow !== "direct_lookup") searchParams.set("entity_workflow", params.entityWorkflow);

  const normalizedEntityIds = normalizeStringArray(params.entityIds);
  if ((params.view || "entities") === "interactions" && normalizedEntityIds.length === 1) {
    searchParams.set("entity", normalizedEntityIds[0]);
  } else {
    const entityIds = serializeEntityIdsParam(normalizedEntityIds);
    if (entityIds) searchParams.set("entities", entityIds);
  }

  const annotationIds = serializeEntityIdsParam(params.annotationIds);
  if (annotationIds) searchParams.set("annotations", annotationIds);

  if (params.tab && params.tab !== "entities") searchParams.set("tab", params.tab);

  const filters = serializeFiltersParam(params.filters);
  if (filters) searchParams.set("filters", filters);

  return `/workspace?${searchParams.toString()}`;
}

export function buildSearchUrl(params: {
  query?: string;
  mode?: SearchMode;
  type?: SearchType;
  species?: string | null;
  entityWorkflow?: EntityWorkflow;
  filters?: MeilisearchFilters;
  entityIds?: Array<string | number>;
}): string {
  return buildWorkspaceUrl({
    view: "entities",
    query: params.query,
    mode: params.mode,
    type: params.type,
    species: params.species,
    entityWorkflow: params.entityWorkflow,
    entityIds: params.entityIds,
    filters: params.filters,
  });
}

export function buildInteractionsUrl(params: {
  entityIds?: Array<string | number>;
  filters?: MeilisearchFilters;
}): string {
  return buildWorkspaceUrl({
    view: "interactions",
    entityIds: params.entityIds,
    filters: params.filters,
  });
}

export function buildSelectionUrl(params: {
  entityIds?: Array<string | number>;
  annotationIds?: Array<string | number>;
  tab?: SelectionTab;
  filters?: MeilisearchFilters;
}): string {
  return buildWorkspaceUrl({
    view: "selection",
    entityIds: params.entityIds,
    annotationIds: params.annotationIds,
    tab: params.tab,
    filters: params.filters,
  });
}

export function appendSelectionToUrl(path: string, entityIds?: Array<string | number>): string {
  const normalized = serializeEntityIdsParam(entityIds);
  if (!normalized) return path;

  const url = new URL(path, "https://omnipath.local");
  url.searchParams.set("entities", normalized);
  return `${url.pathname}${url.search}`;
}
