"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import type { SearchFilters } from "@/types/search";
import type { SearchResult } from "@/features/search/components/result-card";
import {
  normalizeStringArray,
  parseEntityIdsParam,
  parseEntityWorkflow,
  parseFiltersParam,
  parseSelectionTab,
  serializeEntityIdsParam,
  serializeFiltersParam,
  type EntityWorkflow,
  type SearchMode,
  type SearchType,
  type SelectionTab,
} from "./url-codecs";

export interface SelectedEntity {
  id: string;
  entityId?: string | number;
  name: string;
  type?: string;
  cv_terms?: string[];
  references?: string[];
  fullResult?: SearchResult;
  associated_entity_ids?: Array<string | number>;
}

export interface SelectedAnnotation {
  id: string;
  label: string;
  namespace?: string;
  definition?: string | null;
}

const selectionTabParser = parseAsStringLiteral(["entities", "selection", "interactions", "annotations", "associations"] as const).withDefault("entities");
const searchModeParser = parseAsStringLiteral(["full-text", "identifier", "batch"] as const).withDefault("full-text");
const searchTypeParser = parseAsStringLiteral(["search_entities", "cv_terms"] as const).withDefault("search_entities");
const SELECTION_STORAGE_KEY = "omnipath-selection-entities";
const SELECTION_IDS_STORAGE_KEY = "omnipath-selection-ids";
const SELECTION_ANNOTATIONS_STORAGE_KEY = "omnipath-selection-annotations";
const SELECTION_ANNOTATION_IDS_STORAGE_KEY = "omnipath-selection-annotation-ids";

type SelectionEntityCache = Record<string, SelectedEntity>;
type SelectionAnnotationCache = Record<string, SelectedAnnotation>;

function readSelectionCache(): SelectionEntityCache {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SelectionEntityCache;
  } catch {
    return {};
  }
}

function writeSelectionCache(cache: SelectionEntityCache) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(cache));
}

function readSelectionIds(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(SELECTION_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeStringArray(parsed as Array<string | number>) : [];
  } catch {
    return [];
  }
}

function writeSelectionIds(ids: Array<string | number>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SELECTION_IDS_STORAGE_KEY, JSON.stringify(normalizeStringArray(ids)));
}

function readSelectionAnnotationCache(): SelectionAnnotationCache {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(SELECTION_ANNOTATIONS_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SelectionAnnotationCache;
  } catch {
    return {};
  }
}

function writeSelectionAnnotationCache(cache: SelectionAnnotationCache) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SELECTION_ANNOTATIONS_STORAGE_KEY, JSON.stringify(cache));
}

function readSelectionAnnotationIds(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(SELECTION_ANNOTATION_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeStringArray(parsed as Array<string | number>) : [];
  } catch {
    return [];
  }
}

function writeSelectionAnnotationIds(ids: Array<string | number>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SELECTION_ANNOTATION_IDS_STORAGE_KEY, JSON.stringify(normalizeStringArray(ids)));
}

export function useSearchUrlState() {
  const [query, setQuery] = useQueryState("q", parseAsString.withDefault(""));
  const [mode, setMode] = useQueryState("mode", searchModeParser);
  const [type, setType] = useQueryState("type", searchTypeParser);
  const [species, setSpecies] = useQueryState("species", parseAsString.withDefault("9606"));
  const [entityWorkflow, setEntityWorkflowState] = useQueryState("entity_workflow", parseAsString);
  const [rawFilters, setRawFilters] = useQueryState("filters", parseAsString);

  const filters = useMemo(() => parseFiltersParam(rawFilters), [rawFilters]);

  const setFilters = useCallback((next: SearchFilters) => {
    void setRawFilters(serializeFiltersParam(next));
  }, [setRawFilters]);

  return {
    query,
    setQuery: (next: string) => void setQuery(next || null),
    mode,
    setMode: (next: SearchMode) => void setMode(next),
    type,
    setType: (next: SearchType) => void setType(next),
    species,
    setSpecies: (next: string) => void setSpecies(next || null),
    entityWorkflow: parseEntityWorkflow(entityWorkflow),
    setEntityWorkflow: (next: EntityWorkflow) => void setEntityWorkflowState(next === "direct_lookup" ? null : next),
    filters,
    setFilters,
  };
}

export function useInteractionsUrlState() {
  const [singleEntity, setSingleEntity] = useQueryState("entity", parseAsString);
  const [multiEntities, setMultiEntities] = useQueryState("entities", parseAsString);
  const [rawFilters, setRawFilters] = useQueryState("filters", parseAsString);

  const entityIds = useMemo(() => {
    const fromMany = parseEntityIdsParam(multiEntities);
    if (fromMany.length > 0) return fromMany;
    return parseEntityIdsParam(singleEntity);
  }, [multiEntities, singleEntity]);

  const filters = useMemo(() => parseFiltersParam(rawFilters), [rawFilters]);

  const setEntityIds = useCallback((next: Array<string | number>) => {
    const normalized = normalizeStringArray(next);
    if (normalized.length === 1) {
      void setSingleEntity(normalized[0]);
      void setMultiEntities(null);
      return;
    }

    void setSingleEntity(null);
    void setMultiEntities(serializeEntityIdsParam(normalized));
  }, [setMultiEntities, setSingleEntity]);

  const setFilters = useCallback((next: SearchFilters) => {
    void setRawFilters(serializeFiltersParam(next));
  }, [setRawFilters]);

  return {
    entityIds,
    setEntityIds,
    filters,
    setFilters,
  };
}

export function useSelectionUrlState() {
  const [tab, setTab] = useQueryState("tab", selectionTabParser);
  const [query, setQuery] = useQueryState("q", parseAsString.withDefault(""));
  const [rawEntities, setRawEntities] = useQueryState("entities", parseAsString);
  const [rawFilters, setRawFilters] = useQueryState("filters", parseAsString);

  const entityIds = useMemo(() => parseEntityIdsParam(rawEntities), [rawEntities]);
  const filters = useMemo(() => parseFiltersParam(rawFilters), [rawFilters]);

  const setEntityIds = useCallback((next: Array<string | number>) => {
    const normalized = normalizeStringArray(next);
    writeSelectionIds(normalized);
    void setRawEntities(serializeEntityIdsParam(normalized));
  }, [setRawEntities]);

  const setFilters = useCallback((next: SearchFilters) => {
    void setRawFilters(serializeFiltersParam(next));
  }, [setRawFilters]);

  return {
    tab: parseSelectionTab(tab),
    setTab: (next: SelectionTab) => void setTab(next),
    query,
    setQuery: (next: string) => void setQuery(next || null),
    entityIds,
    setEntityIds,
    filters,
    setFilters,
  };
}

export function useEntitySelection() {
  const [rawEntities, setRawEntities] = useQueryState("entities", parseAsString);
  const [rawAnnotations, setRawAnnotations] = useQueryState("annotations", parseAsString);
  const urlEntityIds = useMemo(() => parseEntityIdsParam(rawEntities), [rawEntities]);
  const urlAnnotationIds = useMemo(() => parseEntityIdsParam(rawAnnotations), [rawAnnotations]);
  const [cache, setCache] = useState<SelectionEntityCache>({});
  const [annotationCache, setAnnotationCache] = useState<SelectionAnnotationCache>({});
  const [fallbackEntityIds, setFallbackEntityIds] = useState<string[]>([]);
  const [fallbackAnnotationIds, setFallbackAnnotationIds] = useState<string[]>([]);

  useEffect(() => {
    setCache(readSelectionCache());
    setAnnotationCache(readSelectionAnnotationCache());
    setFallbackEntityIds(readSelectionIds());
    setFallbackAnnotationIds(readSelectionAnnotationIds());
  }, []);

  useEffect(() => {
    if (rawEntities === null) return;
    setFallbackEntityIds(urlEntityIds);
    writeSelectionIds(urlEntityIds);
  }, [rawEntities, urlEntityIds]);

  useEffect(() => {
    if (rawAnnotations === null) return;
    setFallbackAnnotationIds(urlAnnotationIds);
    writeSelectionAnnotationIds(urlAnnotationIds);
  }, [rawAnnotations, urlAnnotationIds]);

  const entityIds = useMemo(() => {
    return rawEntities !== null ? urlEntityIds : fallbackEntityIds;
  }, [fallbackEntityIds, rawEntities, urlEntityIds]);

  const annotationIds = useMemo(() => {
    return rawAnnotations !== null ? urlAnnotationIds : fallbackAnnotationIds;
  }, [fallbackAnnotationIds, rawAnnotations, urlAnnotationIds]);

  const selectedEntities = useMemo<SelectedEntity[]>(() => {
    return entityIds.map((id) => cache[id] || { id, entityId: id, name: id });
  }, [cache, entityIds]);

  const selectedAnnotations = useMemo<SelectedAnnotation[]>(() => {
    return annotationIds.map((id) => annotationCache[id] || { id, label: id });
  }, [annotationCache, annotationIds]);

  const persistCache = useCallback((updater: (prev: SelectionEntityCache) => SelectionEntityCache) => {
    setCache((prev) => {
      const next = updater(prev);
      writeSelectionCache(next);
      return next;
    });
  }, []);

  const persistAnnotationCache = useCallback((updater: (prev: SelectionAnnotationCache) => SelectionAnnotationCache) => {
    setAnnotationCache((prev) => {
      const next = updater(prev);
      writeSelectionAnnotationCache(next);
      return next;
    });
  }, []);

  const setEntityIds = useCallback((next: Array<string | number>) => {
    const normalized = normalizeStringArray(next);
    setFallbackEntityIds(normalized);
    writeSelectionIds(normalized);
    void setRawEntities(serializeEntityIdsParam(normalized));
  }, [setRawEntities]);

  const setAnnotationIds = useCallback((next: Array<string | number>) => {
    const normalized = normalizeStringArray(next);
    setFallbackAnnotationIds(normalized);
    writeSelectionAnnotationIds(normalized);
    void setRawAnnotations(serializeEntityIdsParam(normalized));
  }, [setRawAnnotations]);

  const addEntity = useCallback((entity: SelectedEntity) => {
    const id = String(entity.entityId ?? entity.id).trim();
    if (!id) return;

    persistCache((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        ...entity,
        id,
        entityId: entity.entityId ?? id,
      },
    }));

    if (entityIds.includes(id)) return;
    const nextEntityIds = [...entityIds, id];
    setFallbackEntityIds(nextEntityIds);
    writeSelectionIds(nextEntityIds);
    void setRawEntities(serializeEntityIdsParam(nextEntityIds));
  }, [entityIds, persistCache, setRawEntities]);

  const addAnnotation = useCallback((annotation: SelectedAnnotation) => {
    const id = String(annotation.id).trim();
    if (!id) return;

    persistAnnotationCache((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        ...annotation,
        id,
        label: annotation.label || id,
      },
    }));

    if (annotationIds.includes(id)) return;
    const nextAnnotationIds = [...annotationIds, id];
    setFallbackAnnotationIds(nextAnnotationIds);
    writeSelectionAnnotationIds(nextAnnotationIds);
    void setRawAnnotations(serializeEntityIdsParam(nextAnnotationIds));
  }, [annotationIds, persistAnnotationCache, setRawAnnotations]);

  const removeEntity = useCallback((id: string) => {
    const normalized = String(id).trim();
    if (!normalized) return;

    persistCache((prev) => {
      const next = { ...prev };
      delete next[normalized];
      return next;
    });

    const nextEntityIds = entityIds.filter((entry) => entry !== normalized);
    setFallbackEntityIds(nextEntityIds);
    writeSelectionIds(nextEntityIds);
    void setRawEntities(serializeEntityIdsParam(nextEntityIds));
  }, [entityIds, persistCache, setRawEntities]);

  const removeAnnotation = useCallback((id: string) => {
    const normalized = String(id).trim();
    if (!normalized) return;

    persistAnnotationCache((prev) => {
      const next = { ...prev };
      delete next[normalized];
      return next;
    });

    const nextAnnotationIds = annotationIds.filter((entry) => entry !== normalized);
    setFallbackAnnotationIds(nextAnnotationIds);
    writeSelectionAnnotationIds(nextAnnotationIds);
    void setRawAnnotations(serializeEntityIdsParam(nextAnnotationIds));
  }, [annotationIds, persistAnnotationCache, setRawAnnotations]);

  const clearSelection = useCallback(() => {
    persistCache(() => ({}));
    persistAnnotationCache(() => ({}));
    setFallbackEntityIds([]);
    setFallbackAnnotationIds([]);
    writeSelectionIds([]);
    writeSelectionAnnotationIds([]);
    void setRawEntities(null);
    void setRawAnnotations(null);
  }, [persistAnnotationCache, persistCache, setRawAnnotations, setRawEntities]);

  const isSelected = useCallback((id: string) => {
    const normalized = String(id).trim();
    return entityIds.includes(normalized);
  }, [entityIds]);

  const isAnnotationSelected = useCallback((id: string) => {
    const normalized = String(id).trim();
    return annotationIds.includes(normalized);
  }, [annotationIds]);

  return {
    selectedEntities,
    selectedAnnotations,
    entityIds,
    annotationIds,
    setEntityIds,
    setAnnotationIds,
    addEntity,
    addAnnotation,
    removeEntity,
    removeAnnotation,
    clearSelection,
    isSelected,
    isAnnotationSelected,
    selectionCount: entityIds.length,
    annotationCount: annotationIds.length,
    totalSelectionCount: entityIds.length + annotationIds.length,
  };
}
