import { page } from "$app/stores";
import { goto } from "$app/navigation";
import { browser } from "$app/environment";
import type { SearchFilters } from "$lib/types/search";
import {
  parseEntityIdsParam,
  parseFiltersParam,
  parseSelectionTab,
  parseSearchMode,
  parseSearchType,
  parseEntityWorkflow,
  serializeEntityIdsParam,
  serializeFiltersParam,
  type SearchMode,
  type SearchType,
  type SelectionTab,
  type EntityWorkflow,
} from "$lib/navigation/url-codecs";

export interface SelectedEntity {
  id: string;
  entityId?: string | number;
  name: string;
  type?: string;
  cv_terms?: string[];
  references?: string[];
  associated_entity_ids?: Array<string | number>;
  fullResult?: unknown;
}

export interface SelectedAnnotation {
  id: string;
  label: string;
  namespace?: string;
  definition?: string | null;
}

/* ── reactive current URL from page store ── */
let currentUrl = $state<URL | null>(null);
if (browser) {
  page.subscribe((p) => {
    currentUrl = p.url;
  });
}

function updateSearchParam(key: string, value: string | null) {
  const url = currentUrl ? new URL(currentUrl) : new URL("http://localhost");
  if (value === null || value === "") {
    url.searchParams.delete(key);
  } else {
    url.searchParams.set(key, value);
  }
  void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
}

export function getSearchUrlState(url?: URL) {
  const u = url || currentUrl || new URL("http://localhost");
  return {
    query: u.searchParams.get("q") || "",
    mode: parseSearchMode(u.searchParams.get("mode")),
    type: parseSearchType(u.searchParams.get("type")),
    species: u.searchParams.get("species") || "9606",
    entityWorkflow: parseEntityWorkflow(u.searchParams.get("entity_workflow")),
    filters: parseFiltersParam(u.searchParams.get("filters")),
  };
}

export function setSearchQuery(value: string) {
  updateSearchParam("q", value.trim() || null);
}

export function setSearchMode(value: SearchMode) {
  updateSearchParam("mode", value);
}

export function setSearchType(value: SearchType) {
  updateSearchParam("type", value);
}

export function setSpecies(value: string | null) {
  updateSearchParam("species", value);
}

export function setEntityWorkflow(value: EntityWorkflow) {
  updateSearchParam("entity_workflow", value === "direct_lookup" ? null : value);
}

export function setSearchFilters(value: SearchFilters) {
  updateSearchParam("filters", serializeFiltersParam(value));
}

export function getInteractionsUrlState(url?: URL) {
  const u = url || currentUrl || new URL("http://localhost");
  const singleEntity = u.searchParams.get("entity");
  const multiEntities = u.searchParams.get("entities");
  const fromMany = parseEntityIdsParam(multiEntities);
  return {
    entityIds: fromMany.length > 0 ? fromMany : parseEntityIdsParam(singleEntity),
    filters: parseFiltersParam(u.searchParams.get("filters")),
  };
}

export function setInteractionsEntityIds(value: Array<string | number>) {
  const url = currentUrl ? new URL(currentUrl) : new URL("http://localhost");
  if (value.length === 1) {
    url.searchParams.set("entity", String(value[0]));
    url.searchParams.delete("entities");
  } else {
    const serialized = serializeEntityIdsParam(value);
    if (serialized) url.searchParams.set("entities", serialized);
    else url.searchParams.delete("entities");
    url.searchParams.delete("entity");
  }
  void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
}

export function setInteractionsFilters(value: SearchFilters) {
  updateSearchParam("filters", serializeFiltersParam(value));
}

export function getSelectionUrlState(url?: URL) {
  const u = url || currentUrl || new URL("http://localhost");
  return {
    tab: parseSelectionTab(u.searchParams.get("tab")),
    query: u.searchParams.get("q") || "",
    entityIds: parseEntityIdsParam(u.searchParams.get("entities")),
    filters: parseFiltersParam(u.searchParams.get("filters")),
  };
}

export function setSelectionTab(value: SelectionTab) {
  updateSearchParam("tab", value);
}

export function setSelectionQuery(value: string) {
  updateSearchParam("q", value.trim() || null);
}

export function setSelectionEntityIds(value: Array<string | number>) {
  updateSearchParam("entities", serializeEntityIdsParam(value));
}

export function setSelectionFilters(value: SearchFilters) {
  updateSearchParam("filters", serializeFiltersParam(value));
}

/* ── localStorage-backed selection cache ── */

const SELECTION_STORAGE_KEY = "omnipath-selection-entities";
const SELECTION_IDS_STORAGE_KEY = "omnipath-selection-ids";
const SELECTION_ANNOTATIONS_STORAGE_KEY = "omnipath-selection-annotations";
const SELECTION_ANNOTATION_IDS_STORAGE_KEY = "omnipath-selection-annotation-ids";

type SelectionEntityCache = Record<string, SelectedEntity>;
type SelectionAnnotationCache = Record<string, SelectedAnnotation>;

function readSelectionCache(): SelectionEntityCache {
  if (!browser) return {};
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SelectionEntityCache;
  } catch {
    return {};
  }
}

function writeSelectionCache(cache: SelectionEntityCache) {
  if (!browser) return;
  localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(cache));
}

function readSelectionIds(): string[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(SELECTION_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeSelectionIds(ids: string[]) {
  if (!browser) return;
  localStorage.setItem(SELECTION_IDS_STORAGE_KEY, JSON.stringify(ids));
}

function readSelectionAnnotationCache(): SelectionAnnotationCache {
  if (!browser) return {};
  try {
    const raw = localStorage.getItem(SELECTION_ANNOTATIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SelectionAnnotationCache;
  } catch {
    return {};
  }
}

function writeSelectionAnnotationCache(cache: SelectionAnnotationCache) {
  if (!browser) return;
  localStorage.setItem(SELECTION_ANNOTATIONS_STORAGE_KEY, JSON.stringify(cache));
}

function readSelectionAnnotationIds(): string[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(SELECTION_ANNOTATION_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeSelectionAnnotationIds(ids: string[]) {
  if (!browser) return;
  localStorage.setItem(SELECTION_ANNOTATION_IDS_STORAGE_KEY, JSON.stringify(ids));
}

/* ── Global reactive selection state ── */

let entityCache = $state<SelectionEntityCache>(readSelectionCache());
let annotationCache = $state<SelectionAnnotationCache>(readSelectionAnnotationCache());
let fallbackEntityIds = $state<string[]>(readSelectionIds());
let fallbackAnnotationIds = $state<string[]>(readSelectionAnnotationIds());

export function getSelectionStore() {
  const urlEntityIds = $derived(parseEntityIdsParam(currentUrl?.searchParams.get("entities") ?? null));
  const urlAnnotationIds = $derived(parseEntityIdsParam(currentUrl?.searchParams.get("annotations") ?? null));

  const entityIds = $derived(urlEntityIds.length > 0 ? urlEntityIds : fallbackEntityIds);
  const annotationIds = $derived(urlAnnotationIds.length > 0 ? urlAnnotationIds : fallbackAnnotationIds);

  const selectedEntities = $derived<SelectedEntity[]>(
    entityIds.map((id) => entityCache[id] || { id, entityId: id, name: id })
  );

  const selectedAnnotations = $derived<SelectedAnnotation[]>(
    annotationIds.map((id) => annotationCache[id] || { id, label: id })
  );

  function setEntityIds(next: Array<string | number>) {
    const normalized = next.map(String);
    fallbackEntityIds = normalized;
    writeSelectionIds(normalized);
    updateSearchParam("entities", serializeEntityIdsParam(normalized));
  }

  function setAnnotationIds(next: Array<string | number>) {
    const normalized = next.map(String);
    fallbackAnnotationIds = normalized;
    writeSelectionAnnotationIds(normalized);
    updateSearchParam("annotations", serializeEntityIdsParam(normalized));
  }

  function addEntity(entity: SelectedEntity) {
    const id = String(entity.entityId ?? entity.id).trim();
    if (!id) return;

    const nextCache = {
      ...entityCache,
      [id]: {
        ...entityCache[id],
        ...entity,
        id,
        entityId: entity.entityId ?? id,
      },
    };
    entityCache = nextCache;
    writeSelectionCache(nextCache);

    if (entityIds.includes(id)) return;
    const next = [...entityIds, id];
    fallbackEntityIds = next;
    writeSelectionIds(next);
    updateSearchParam("entities", serializeEntityIdsParam(next));
  }

  function addAnnotation(annotation: SelectedAnnotation) {
    const id = String(annotation.id).trim();
    if (!id) return;

    const nextCache = {
      ...annotationCache,
      [id]: {
        ...annotationCache[id],
        ...annotation,
        id,
        label: annotation.label || id,
      },
    };
    annotationCache = nextCache;
    writeSelectionAnnotationCache(nextCache);

    if (annotationIds.includes(id)) return;
    const next = [...annotationIds, id];
    fallbackAnnotationIds = next;
    writeSelectionAnnotationIds(next);
    updateSearchParam("annotations", serializeEntityIdsParam(next));
  }

  function removeEntity(id: string) {
    const normalized = String(id).trim();
    if (!normalized) return;

    const { [normalized]: _, ...rest } = entityCache;
    entityCache = rest;
    writeSelectionCache(rest);

    const next = entityIds.filter((entry) => entry !== normalized);
    fallbackEntityIds = next;
    writeSelectionIds(next);
    updateSearchParam("entities", serializeEntityIdsParam(next));
  }

  function removeAnnotation(id: string) {
    const normalized = String(id).trim();
    if (!normalized) return;

    const { [normalized]: _, ...rest } = annotationCache;
    annotationCache = rest;
    writeSelectionAnnotationCache(rest);

    const next = annotationIds.filter((entry) => entry !== normalized);
    fallbackAnnotationIds = next;
    writeSelectionAnnotationIds(next);
    updateSearchParam("annotations", serializeEntityIdsParam(next));
  }

  function clearSelection() {
    entityCache = {};
    annotationCache = {};
    writeSelectionCache({});
    writeSelectionAnnotationCache({});
    fallbackEntityIds = [];
    fallbackAnnotationIds = [];
    writeSelectionIds([]);
    writeSelectionAnnotationIds([]);
    updateSearchParam("entities", null);
    updateSearchParam("annotations", null);
  }

  function isSelected(id: string) {
    return entityIds.includes(String(id).trim());
  }

  function isAnnotationSelected(id: string) {
    return annotationIds.includes(String(id).trim());
  }

  return {
    get selectedEntities() { return selectedEntities; },
    get selectedAnnotations() { return selectedAnnotations; },
    get entityIds() { return entityIds; },
    get annotationIds() { return annotationIds; },
    setEntityIds,
    setAnnotationIds,
    addEntity,
    addAnnotation,
    removeEntity,
    removeAnnotation,
    clearSelection,
    isSelected,
    isAnnotationSelected,
    get selectionCount() { return entityIds.length; },
    get annotationCount() { return annotationIds.length; },
    get totalSelectionCount() { return entityIds.length + annotationIds.length; },
  };
}
