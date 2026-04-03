"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SearchResult } from "@/features/search/components/result-card";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { createConnection, registerParquetFile, releaseObjectUrl } from "@/lib/duckdb/browser";
import {
  buildDuckDbSessionCacheKey,
  deleteCachedDuckDbSession,
  getLatestCachedDuckDbSessionByCacheKey,
  listCachedDuckDbSessions,
  loadCachedDuckDbSession,
  saveCachedDuckDbSession,
  type CachedDuckDbSessionRecord,
} from "@/lib/duckdb/cache";
import {
  mountEntitySubset,
  mountInteractionSubset,
  queryEntityById,
  queryEntitySummaries,
  queryInteractionEntityIds,
  queryInteractionFacets,
  queryInteractionPage,
} from "@/lib/duckdb/sql";
import { materializeEntitiesSubset, materializeInteractionsSubset } from "@/lib/subsets/client";
import { useEntitySelection, useInteractionsUrlState } from "@/lib/navigation/url-state";
import type { DuckDbFacetCounts, InteractionLocalFilters, SubsetArtifact } from "@/types/subsets";

const EMPTY_LOCAL_FILTERS: InteractionLocalFilters = {
  interaction_types: [],
  signs: [],
  sources: [],
  interaction_annotation_terms: [],
  participant_annotation_terms: [],
};

type DuckDbLoadingStage =
  | "idle"
  | "checking_cache"
  | "instantiating_duckdb"
  | "requesting_interactions"
  | "downloading_interactions"
  | "loading_interactions"
  | "requesting_entities"
  | "downloading_entities"
  | "loading_entities"
  | "querying_local";

type DuckDbDatasetSource = "cache" | "server" | null;

interface EntitySummary {
  id: string;
  canonical_identifier: string;
  display_name: string;
  entity_type_name?: string;
}

interface DuckDbWorkspaceContextValue {
  loading: boolean;
  loadingStage: DuckDbLoadingStage;
  loadingLabel: string | null;
  loadingProgress: number | null;
  datasetSource: DuckDbDatasetSource;
  activeSessionId: string | null;
  savedSessions: CachedDuckDbSessionRecord[];
  savedSessionsLoading: boolean;
  error: string | null;
  materialized: boolean;
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  rowCount?: number;
  durationMs?: number;
  rows: Record<string, unknown>[];
  facets: DuckDbFacetCounts;
  localFilters: InteractionLocalFilters;
  serverEntityScope: string[];
  entitySummaries: Map<string, EntitySummary>;
  loadSubset: () => Promise<void>;
  refreshSubset: () => Promise<void>;
  loadSavedSession: (sessionId: string) => Promise<void>;
  deleteSavedSession: (sessionId: string) => Promise<void>;
  getEntityById: (entityId: string) => Promise<SearchResult | null>;
  setPageIndex: (next: number) => void;
  toggleLocalFacet: (facet: "interaction_types" | "sources", value: string) => void;
  toggleAnnotationTerm: (scope: "interaction_annotation_terms" | "participant_annotation_terms", value: string) => void;
  toggleSign: (value: -1 | 0 | 1) => void;
  setIsDirected: (value: boolean | undefined) => void;
  clearLocalFilters: () => void;
}

const DuckDbWorkspaceContext = createContext<DuckDbWorkspaceContextValue | null>(null);

function emptyFacets(): DuckDbFacetCounts {
  return {
    interaction_type: [],
    sign: [],
    is_directed: [],
    sources: [],
    interaction_annotation_terms: [],
    participant_annotation_terms: [],
  };
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toProgressValue(base: number, span: number, percent?: number): number {
  if (typeof percent !== "number" || Number.isNaN(percent)) {
    return clampProgress(base);
  }
  return clampProgress(base + (percent / 100) * span);
}

function createSessionLabel(serverEntityScope: string[], rowCount?: number): string {
  const timestamp = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());

  if (serverEntityScope.length > 0) {
    return `${serverEntityScope.length} entity scope • ${timestamp}`;
  }
  if (typeof rowCount === "number") {
    return `${rowCount.toLocaleString()} rows • ${timestamp}`;
  }
  return `DuckDB subset • ${timestamp}`;
}

export function DuckDbWorkspaceProvider({ children }: { children: ReactNode }) {
  const { entityIds: urlEntityIds, filters: urlFilters } = useInteractionsUrlState();
  const { entityIds: selectedEntityIds } = useEntitySelection();
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<DuckDbLoadingStage>("idle");
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);
  const [datasetSource, setDatasetSource] = useState<DuckDbDatasetSource>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [savedSessions, setSavedSessions] = useState<CachedDuckDbSessionRecord[]>([]);
  const [savedSessionsLoading, setSavedSessionsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [materialized, setMaterialized] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [rowCount, setRowCount] = useState<number | undefined>();
  const [durationMs, setDurationMs] = useState<number | undefined>();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [facets, setFacets] = useState<DuckDbFacetCounts>(emptyFacets);
  const [localFilters, setLocalFilters] = useState<InteractionLocalFilters>(EMPTY_LOCAL_FILTERS);
  const [entitySummaries, setEntitySummaries] = useState<Map<string, EntitySummary>>(new Map());
  const connectionRef = useRef<AsyncDuckDBConnection | null>(null);
  const currentInteractionsObjectUrlRef = useRef<string | undefined>(undefined);
  const currentEntitiesObjectUrlRef = useRef<string | undefined>(undefined);
  const localFiltersRef = useRef<InteractionLocalFilters>(EMPTY_LOCAL_FILTERS);

  const setLoadingState = useCallback((stage: DuckDbLoadingStage, label: string | null, progress: number | null) => {
    setLoadingStage(stage);
    setLoadingLabel(label);
    setLoadingProgress(progress === null ? null : clampProgress(progress));
  }, []);

  const serverEntityScope = useMemo(() => {
    if (urlEntityIds.length > 0) return urlEntityIds;
    if (selectedEntityIds.length > 0) return selectedEntityIds;
    return [];
  }, [selectedEntityIds, urlEntityIds]);

  const serverFilters = useMemo(() => {
    if (serverEntityScope.length === 0) return urlFilters;
    return {
      ...urlFilters,
      entity_ids: serverEntityScope,
      member_a_id: undefined,
      member_b_id: undefined,
    };
  }, [serverEntityScope, urlFilters]);

  const serverCacheKey = useMemo(() => buildDuckDbSessionCacheKey(serverFilters), [serverFilters]);

  useEffect(() => {
    localFiltersRef.current = localFilters;
  }, [localFilters]);

  const refreshSavedSessions = useCallback(async () => {
    setSavedSessionsLoading(true);
    try {
      setSavedSessions(await listCachedDuckDbSessions());
    } catch (nextError) {
      console.error("Failed to load cached DuckDB sessions", nextError);
    } finally {
      setSavedSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSavedSessions();
  }, [refreshSavedSessions]);

  const ensureConnection = useCallback(async () => {
    if (!connectionRef.current) {
      setLoadingState("instantiating_duckdb", "Instantiating DuckDB WASM…", 8);
      connectionRef.current = await createConnection();
    }
    return connectionRef.current;
  }, [setLoadingState]);

  const refreshLocalQueries = useCallback(async (nextPageIndex: number, nextLocalFilters: InteractionLocalFilters) => {
    setLoadingState("querying_local", "Running local DuckDB queries…", 96);
    const connection = await ensureConnection();
    const [page, nextFacets] = await Promise.all([
      queryInteractionPage(connection, nextLocalFilters, nextPageIndex, pageSize),
      queryInteractionFacets(connection, nextLocalFilters),
    ]);

    setRows(page.rows);
    setTotalCount(page.totalCount);
    setFacets(nextFacets);
    setLoadingState("querying_local", "Running local DuckDB queries…", 100);
  }, [ensureConnection, pageSize, setLoadingState]);

  const loadArtifactsIntoWorkspace = useCallback(async ({
    interactionBlob,
    interactionFileName,
    interactionRowCount,
    interactionDurationMs,
    entityBlob,
    entityFileName,
    source,
    sessionId,
  }: {
    interactionBlob: Blob;
    interactionFileName: string;
    interactionRowCount?: number;
    interactionDurationMs?: number;
    entityBlob?: Blob;
    entityFileName?: string;
    source: Exclude<DuckDbDatasetSource, null>;
    sessionId: string | null;
  }) => {
    const connection = await ensureConnection();

    await releaseObjectUrl(currentInteractionsObjectUrlRef.current);
    currentInteractionsObjectUrlRef.current = URL.createObjectURL(interactionBlob);

    setLoadingState("loading_interactions", source === "cache" ? "Loading cached interaction dataset into DuckDB…" : "Loading interaction dataset into DuckDB…", 48);
    await registerParquetFile(interactionFileName, interactionBlob);
    await mountInteractionSubset(connection, interactionFileName);

    await releaseObjectUrl(currentEntitiesObjectUrlRef.current);
    currentEntitiesObjectUrlRef.current = undefined;

    if (entityBlob && entityFileName) {
      currentEntitiesObjectUrlRef.current = URL.createObjectURL(entityBlob);
      setLoadingState("loading_entities", source === "cache" ? "Loading cached entity dataset into DuckDB…" : "Loading entity dataset into DuckDB…", 88);
      await registerParquetFile(entityFileName, entityBlob);
      await mountEntitySubset(connection, entityFileName);
      const summaries = await queryEntitySummaries(connection);
      setEntitySummaries(summaries);
    } else {
      setEntitySummaries(new Map());
    }

    setRowCount(interactionRowCount);
    setDurationMs(interactionDurationMs);
    setMaterialized(true);
    setDatasetSource(source);
    setActiveSessionId(sessionId);
    await refreshLocalQueries(0, localFiltersRef.current);
  }, [ensureConnection, refreshLocalQueries, setLoadingState]);

  const refreshSubset = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPageIndex(0);
    setLoadingState("instantiating_duckdb", "Instantiating DuckDB WASM…", 5);

    try {
      setLoadingState("requesting_interactions", "Requesting interaction subset…", 12);
      const interactionArtifactPromise = materializeInteractionsSubset(serverFilters, "", {
        onProgress: (progress) => {
          if (progress.stage === "requesting") {
            setLoadingState("requesting_interactions", "Requesting interaction subset…", 15);
            return;
          }
          if (progress.stage === "downloading") {
            setLoadingState(
              "downloading_interactions",
              progress.totalBytes
                ? `Downloading interaction subset… ${Math.round(progress.loadedBytes / 1024 / 1024)} / ${Math.round(progress.totalBytes / 1024 / 1024)} MB`
                : "Downloading interaction subset…",
              toProgressValue(15, 25, progress.progressPercent),
            );
            return;
          }
          setLoadingState("downloading_interactions", "Interaction subset downloaded", 40);
        },
      });

      const connection = await ensureConnection();
      const interactionArtifact = await interactionArtifactPromise;

      await releaseObjectUrl(currentInteractionsObjectUrlRef.current);
      currentInteractionsObjectUrlRef.current = interactionArtifact.objectUrl;

      setLoadingState("loading_interactions", "Loading interaction dataset into DuckDB…", 48);
      await registerParquetFile(interactionArtifact.fileName, interactionArtifact.blob);
      await mountInteractionSubset(connection, interactionArtifact.fileName);

      setLoadingState("loading_interactions", "Extracting entity IDs from interaction subset…", 58);
      const interactionEntityIds = await queryInteractionEntityIds(connection);

      await releaseObjectUrl(currentEntitiesObjectUrlRef.current);
      currentEntitiesObjectUrlRef.current = undefined;

      let entityArtifact: SubsetArtifact | undefined;
      if (interactionEntityIds.length > 0) {
        setLoadingState("requesting_entities", "Requesting entity subset…", 62);
        entityArtifact = await materializeEntitiesSubset({ entity_ids: interactionEntityIds }, "", {
          onProgress: (progress) => {
            if (progress.stage === "requesting") {
              setLoadingState("requesting_entities", "Requesting entity subset…", 65);
              return;
            }
            if (progress.stage === "downloading") {
              setLoadingState(
                "downloading_entities",
                progress.totalBytes
                  ? `Downloading entity subset… ${Math.round(progress.loadedBytes / 1024 / 1024)} / ${Math.round(progress.totalBytes / 1024 / 1024)} MB`
                  : "Downloading entity subset…",
                toProgressValue(65, 20, progress.progressPercent),
              );
              return;
            }
            setLoadingState("downloading_entities", "Entity subset downloaded", 85);
          },
        });

        currentEntitiesObjectUrlRef.current = entityArtifact.objectUrl;
        setLoadingState("loading_entities", "Loading entity dataset into DuckDB…", 88);
        await registerParquetFile(entityArtifact.fileName, entityArtifact.blob);
        await mountEntitySubset(connection, entityArtifact.fileName);
        const summaries = await queryEntitySummaries(connection);
        setEntitySummaries(summaries);
      } else {
        setEntitySummaries(new Map());
      }

      setRowCount(interactionArtifact.rowCount);
      setDurationMs(interactionArtifact.durationMs);
      setMaterialized(true);
      setDatasetSource("server");
      await refreshLocalQueries(0, localFiltersRef.current);

      const savedSession = await saveCachedDuckDbSession({
        label: createSessionLabel(serverEntityScope, interactionArtifact.rowCount),
        cacheKey: serverCacheKey,
        serverQuery: "",
        serverFilters,
        interactionArtifact,
        entityArtifact,
      });

      setActiveSessionId(savedSession.id);
      await refreshSavedSessions();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load subset");
      setMaterialized(false);
      setRows([]);
      setTotalCount(0);
      setFacets(emptyFacets());
      setEntitySummaries(new Map());
    } finally {
      setLoading(false);
      setLoadingState("idle", null, null);
    }
  }, [ensureConnection, refreshLocalQueries, refreshSavedSessions, serverCacheKey, serverEntityScope, serverFilters, setLoadingState]);

  const loadSavedSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    setError(null);
    setPageIndex(0);
    setLoadingState("checking_cache", "Loading cached dataset…", 10);

    try {
      const cached = await loadCachedDuckDbSession(sessionId);
      if (!cached) {
        throw new Error("Saved dataset not found in local cache");
      }

      await loadArtifactsIntoWorkspace({
        interactionBlob: cached.interactionBlob,
        interactionFileName: cached.session.interactionArtifact.fileName,
        interactionRowCount: cached.session.interactionArtifact.rowCount,
        interactionDurationMs: cached.session.interactionArtifact.durationMs,
        entityBlob: cached.entityBlob,
        entityFileName: cached.session.entityArtifact?.fileName,
        source: "cache",
        sessionId: cached.session.id,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load cached dataset");
    } finally {
      setLoading(false);
      setLoadingState("idle", null, null);
    }
  }, [loadArtifactsIntoWorkspace, setLoadingState]);

  const loadSubset = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPageIndex(0);
    setLoadingState("checking_cache", "Checking local dataset cache…", 5);

    try {
      const cachedSession = await getLatestCachedDuckDbSessionByCacheKey(serverCacheKey);
      if (cachedSession) {
        const cached = await loadCachedDuckDbSession(cachedSession.id);
        if (cached) {
          await loadArtifactsIntoWorkspace({
            interactionBlob: cached.interactionBlob,
            interactionFileName: cached.session.interactionArtifact.fileName,
            interactionRowCount: cached.session.interactionArtifact.rowCount,
            interactionDurationMs: cached.session.interactionArtifact.durationMs,
            entityBlob: cached.entityBlob,
            entityFileName: cached.session.entityArtifact?.fileName,
            source: "cache",
            sessionId: cached.session.id,
          });
          return;
        }
      }
    } catch (nextError) {
      console.error("Failed to load DuckDB dataset from local cache", nextError);
    } finally {
      setLoading(false);
      setLoadingState("idle", null, null);
    }

    await refreshSubset();
  }, [loadArtifactsIntoWorkspace, refreshSubset, serverCacheKey, setLoadingState]);

  useEffect(() => {
    void loadSubset();
  }, [loadSubset]);

  useEffect(() => {
    if (!materialized) return;
    setLoading(true);
    setError(null);
    void refreshLocalQueries(pageIndex, localFilters)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Failed to query local subset"))
      .finally(() => {
        setLoading(false);
        setLoadingState("idle", null, null);
      });
  }, [localFilters, materialized, pageIndex, refreshLocalQueries, setLoadingState]);

  useEffect(() => {
    return () => {
      void releaseObjectUrl(currentInteractionsObjectUrlRef.current);
      void releaseObjectUrl(currentEntitiesObjectUrlRef.current);
      if (connectionRef.current) {
        void connectionRef.current.close();
      }
    };
  }, []);

  const deleteSavedSession = useCallback(async (sessionId: string) => {
    await deleteCachedDuckDbSession(sessionId);
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setDatasetSource(null);
    }
    await refreshSavedSessions();
  }, [activeSessionId, refreshSavedSessions]);

  const getEntityById = useCallback(async (entityId: string) => {
    const connection = await ensureConnection();
    return queryEntityById(connection, entityId);
  }, [ensureConnection]);

  const toggleStringFacet = useCallback((facet: "interaction_types" | "sources", value: string) => {
    setPageIndex(0);
    setLocalFilters((prev) => {
      const values = prev[facet];
      const nextValues = values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
      return { ...prev, [facet]: nextValues };
    });
  }, []);

  const toggleAnnotationTerm = useCallback((scope: "interaction_annotation_terms" | "participant_annotation_terms", value: string) => {
    setPageIndex(0);
    setLocalFilters((prev) => ({
      ...prev,
      [scope]: prev[scope].includes(value)
        ? prev[scope].filter((entry) => entry !== value)
        : [...prev[scope], value],
    }));
  }, []);

  const toggleSign = useCallback((value: -1 | 0 | 1) => {
    setPageIndex(0);
    setLocalFilters((prev) => ({
      ...prev,
      signs: prev.signs.includes(value) ? prev.signs.filter((entry) => entry !== value) : [...prev.signs, value],
    }));
  }, []);

  const setIsDirected = useCallback((value: boolean | undefined) => {
    setPageIndex(0);
    setLocalFilters((prev) => ({ ...prev, is_directed: value }));
  }, []);

  const clearLocalFilters = useCallback(() => {
    setPageIndex(0);
    setLocalFilters(EMPTY_LOCAL_FILTERS);
  }, []);

  const value = useMemo<DuckDbWorkspaceContextValue>(() => ({
    loading,
    loadingStage,
    loadingLabel,
    loadingProgress,
    datasetSource,
    activeSessionId,
    savedSessions,
    savedSessionsLoading,
    error,
    materialized,
    pageIndex,
    pageSize,
    totalCount,
    rowCount,
    durationMs,
    rows,
    facets,
    localFilters,
    serverEntityScope,
    entitySummaries,
    loadSubset,
    refreshSubset,
    loadSavedSession,
    deleteSavedSession,
    getEntityById,
    setPageIndex,
    toggleLocalFacet: toggleStringFacet,
    toggleAnnotationTerm,
    toggleSign,
    setIsDirected,
    clearLocalFilters,
  }), [
    activeSessionId,
    clearLocalFilters,
    datasetSource,
    deleteSavedSession,
    durationMs,
    entitySummaries,
    error,
    facets,
    getEntityById,
    loadSavedSession,
    loading,
    loadingLabel,
    loadingProgress,
    loadingStage,
    loadSubset,
    localFilters,
    materialized,
    pageIndex,
    pageSize,
    refreshSubset,
    rowCount,
    rows,
    savedSessions,
    savedSessionsLoading,
    serverEntityScope,
    setIsDirected,
    toggleAnnotationTerm,
    toggleSign,
    toggleStringFacet,
    totalCount,
  ]);

  return <DuckDbWorkspaceContext.Provider value={value}>{children}</DuckDbWorkspaceContext.Provider>;
}

export function useDuckDbWorkspace() {
  const context = useContext(DuckDbWorkspaceContext);
  if (!context) {
    throw new Error("useDuckDbWorkspace must be used within DuckDbWorkspaceProvider");
  }
  return context;
}
