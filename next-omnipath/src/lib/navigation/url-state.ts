"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import type { MeilisearchFilters } from "@/types/meilisearch";
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

const selectionTabParser = parseAsStringLiteral(["selection", "interactions", "associations"] as const).withDefault("selection");
const searchModeParser = parseAsStringLiteral(["full-text", "identifier", "batch"] as const).withDefault("full-text");
const searchTypeParser = parseAsStringLiteral(["search_entities", "cv_terms"] as const).withDefault("search_entities");
const SELECTION_STORAGE_KEY = "omnipath-selection-entities";
const SELECTION_IDS_STORAGE_KEY = "omnipath-selection-ids";

type SelectionEntityCache = Record<string, SelectedEntity>;

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

export function useSearchUrlState() {
  const [query, setQuery] = useQueryState("q", parseAsString.withDefault(""));
  const [mode, setMode] = useQueryState("mode", searchModeParser);
  const [type, setType] = useQueryState("type", searchTypeParser);
  const [species, setSpecies] = useQueryState("species", parseAsString.withDefault("9606"));
  const [entityWorkflow, setEntityWorkflowState] = useQueryState("entity_workflow", parseAsString);
  const [rawFilters, setRawFilters] = useQueryState("filters", parseAsString);

  const filters = useMemo(() => parseFiltersParam(rawFilters), [rawFilters]);

  const setFilters = useCallback((next: MeilisearchFilters) => {
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

  const setFilters = useCallback((next: MeilisearchFilters) => {
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
  const [rawEntities, setRawEntities] = useQueryState("entities", parseAsString);
  const [rawFilters, setRawFilters] = useQueryState("filters", parseAsString);

  const entityIds = useMemo(() => parseEntityIdsParam(rawEntities), [rawEntities]);
  const filters = useMemo(() => parseFiltersParam(rawFilters), [rawFilters]);

  const setEntityIds = useCallback((next: Array<string | number>) => {
    const normalized = normalizeStringArray(next);
    writeSelectionIds(normalized);
    void setRawEntities(serializeEntityIdsParam(normalized));
  }, [setRawEntities]);

  const setFilters = useCallback((next: MeilisearchFilters) => {
    void setRawFilters(serializeFiltersParam(next));
  }, [setRawFilters]);

  return {
    tab: parseSelectionTab(tab),
    setTab: (next: SelectionTab) => void setTab(next),
    entityIds,
    setEntityIds,
    filters,
    setFilters,
  };
}

export function useEntitySelection() {
  const [rawEntities, setRawEntities] = useQueryState("entities", parseAsString);
  const urlEntityIds = useMemo(() => parseEntityIdsParam(rawEntities), [rawEntities]);
  const [cache, setCache] = useState<SelectionEntityCache>({});
  const [fallbackEntityIds, setFallbackEntityIds] = useState<string[]>([]);

  useEffect(() => {
    setCache(readSelectionCache());
    setFallbackEntityIds(readSelectionIds());
  }, []);

  useEffect(() => {
    if (rawEntities === null) return;
    setFallbackEntityIds(urlEntityIds);
    writeSelectionIds(urlEntityIds);
  }, [rawEntities, urlEntityIds]);

  const entityIds = useMemo(() => {
    return rawEntities !== null ? urlEntityIds : fallbackEntityIds;
  }, [fallbackEntityIds, rawEntities, urlEntityIds]);

  const selectedEntities = useMemo<SelectedEntity[]>(() => {
    return entityIds.map((id) => cache[id] || { id, entityId: id, name: id });
  }, [cache, entityIds]);

  const persistCache = useCallback((updater: (prev: SelectionEntityCache) => SelectionEntityCache) => {
    setCache((prev) => {
      const next = updater(prev);
      writeSelectionCache(next);
      return next;
    });
  }, []);

  const setEntityIds = useCallback((next: Array<string | number>) => {
    const normalized = normalizeStringArray(next);
    setFallbackEntityIds(normalized);
    writeSelectionIds(normalized);
    void setRawEntities(serializeEntityIdsParam(normalized));
  }, [setRawEntities]);

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

  const clearSelection = useCallback(() => {
    persistCache(() => ({}));
    setFallbackEntityIds([]);
    writeSelectionIds([]);
    void setRawEntities(null);
  }, [persistCache, setRawEntities]);

  const isSelected = useCallback((id: string) => {
    const normalized = String(id).trim();
    return entityIds.includes(normalized);
  }, [entityIds]);

  return {
    selectedEntities,
    entityIds,
    setEntityIds,
    addEntity,
    removeEntity,
    clearSelection,
    isSelected,
    selectionCount: entityIds.length,
  };
}
