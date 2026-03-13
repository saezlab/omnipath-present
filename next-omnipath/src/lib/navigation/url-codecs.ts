import type { MeilisearchFilters } from "@/types/meilisearch";

export type SelectionTab = "selection" | "interactions" | "associations";
export type SearchMode = "full-text" | "identifier" | "batch";
export type SearchType = "search_entities" | "cv_terms";

const SEARCH_MODES = new Set<SearchMode>(["full-text", "identifier", "batch"]);
const SELECTION_TABS = new Set<SelectionTab>(["selection", "interactions", "associations"]);
const SEARCH_TYPES = new Set<SearchType>(["search_entities", "cv_terms"]);

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
  if (value && SELECTION_TABS.has(value as SelectionTab)) {
    return value as SelectionTab;
  }
  return "selection";
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

export function buildSearchUrl(params: {
  query?: string;
  mode?: SearchMode;
  type?: SearchType;
  species?: string | null;
  filters?: MeilisearchFilters;
  entityIds?: Array<string | number>;
}): string {
  const searchParams = new URLSearchParams();

  if (params.query?.trim()) searchParams.set("q", params.query.trim());
  if (params.mode && params.mode !== "full-text") searchParams.set("mode", params.mode);
  if (params.type && params.type !== "search_entities") searchParams.set("type", params.type);
  if (params.species?.trim()) searchParams.set("species", params.species.trim());

  const filters = serializeFiltersParam(params.filters);
  if (filters) searchParams.set("filters", filters);

  const entityIds = serializeEntityIdsParam(params.entityIds);
  if (entityIds) searchParams.set("entities", entityIds);

  const query = searchParams.toString();
  return query ? `/search?${query}` : "/search";
}

export function buildInteractionsUrl(params: {
  entityIds?: Array<string | number>;
  filters?: MeilisearchFilters;
}): string {
  const searchParams = new URLSearchParams();

  const entityIds = normalizeStringArray(params.entityIds);
  if (entityIds.length === 1) {
    searchParams.set("entity", entityIds[0]);
  } else if (entityIds.length > 1) {
    searchParams.set("entities", entityIds.join(","));
  }

  const filters = serializeFiltersParam(params.filters);
  if (filters) searchParams.set("filters", filters);

  const query = searchParams.toString();
  return query ? `/explore/interactions?${query}` : "/explore/interactions";
}

export function buildSelectionUrl(params: {
  entityIds?: Array<string | number>;
  tab?: SelectionTab;
  filters?: MeilisearchFilters;
}): string {
  const searchParams = new URLSearchParams();

  const entityIds = serializeEntityIdsParam(params.entityIds);
  if (entityIds) searchParams.set("entities", entityIds);
  if (params.tab && params.tab !== "selection") searchParams.set("tab", params.tab);

  const filters = serializeFiltersParam(params.filters);
  if (filters) searchParams.set("filters", filters);

  const query = searchParams.toString();
  return query ? `/selection?${query}` : "/selection";
}

export function appendSelectionToUrl(path: string, entityIds?: Array<string | number>): string {
  const normalized = serializeEntityIdsParam(entityIds);
  if (!normalized) return path;

  const url = new URL(path, "https://omnipath.local");
  url.searchParams.set("entities", normalized);
  return `${url.pathname}${url.search}`;
}
