"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SearchResult } from "@/features/search/components/result-card";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { createConnection, registerParquetFile, releaseObjectUrl } from "@/lib/duckdb/browser";
import {
  mountResourceEntities,
  mountResourceIdentifierRows,
  mountResourceInteractions,
  queryResourceEntityById,
  queryResourceEntitySummaries,
  queryResourceInteractionFacets,
  queryResourceInteractionPage,
} from "@/lib/duckdb/resource-sql";
import { fetchResourceWorkspaceArtifact, fetchResourceWorkspaceManifest } from "@/lib/resource-workspace";
import type { DuckDbFacetCounts, InteractionLocalFilters } from "@/types/subsets";

const EMPTY_LOCAL_FILTERS: InteractionLocalFilters = {
  interaction_types: [],
  signs: [],
  sources: [],
  interaction_annotation_terms: [],
  participant_annotation_terms: [],
};

type DuckDbLoadingStage =
  | "idle"
  | "instantiating_duckdb"
  | "requesting_interactions"
  | "downloading_interactions"
  | "loading_interactions"
  | "downloading_entities"
  | "loading_entities"
  | "querying_local";

interface EntitySummary {
  id: string;
  canonical_identifier: string;
  display_name: string;
  entity_type_name?: string;
}

interface DuckDbResourceWorkspaceContextValue {
  loading: boolean;
  loadingStage: DuckDbLoadingStage;
  loadingLabel: string | null;
  loadingProgress: number | null;
  error: string | null;
  materialized: boolean;
  resourceIds: string[];
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  rowCount?: number;
  rows: Record<string, unknown>[];
  facets: DuckDbFacetCounts;
  localFilters: InteractionLocalFilters;
  entitySummaries: Map<string, EntitySummary>;
  refreshSubset: () => Promise<void>;
  getEntityById: (entityId: string) => Promise<SearchResult | null>;
  setPageIndex: (next: number) => void;
  toggleLocalFacet: (facet: "interaction_types" | "sources", value: string) => void;
  toggleSign: (value: -1 | 0 | 1) => void;
  setIsDirected: (value: boolean | undefined) => void;
  clearLocalFilters: () => void;
}

const DuckDbResourceWorkspaceContext = createContext<DuckDbResourceWorkspaceContextValue | null>(null);

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

export function DuckDbResourceWorkspaceProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<DuckDbLoadingStage>("idle");
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [materialized, setMaterialized] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [rowCount, setRowCount] = useState<number | undefined>();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [facets, setFacets] = useState<DuckDbFacetCounts>(emptyFacets);
  const [localFilters, setLocalFilters] = useState<InteractionLocalFilters>(EMPTY_LOCAL_FILTERS);
  const [entitySummaries, setEntitySummaries] = useState<Map<string, EntitySummary>>(new Map());
  const connectionRef = useRef<AsyncDuckDBConnection | null>(null);
  const currentObjectUrlsRef = useRef<string[]>([]);

  const resourceIds = useMemo(() => {
    const raw = searchParams.get("resources") || "";
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }, [searchParams]);

  const setLoadingState = useCallback((stage: DuckDbLoadingStage, label: string | null, progress: number | null) => {
    setLoadingStage(stage);
    setLoadingLabel(label);
    setLoadingProgress(progress === null ? null : clampProgress(progress));
  }, []);

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
      queryResourceInteractionPage(connection, nextLocalFilters, nextPageIndex, pageSize),
      queryResourceInteractionFacets(connection, nextLocalFilters),
    ]);

    setRows(page.rows);
    setTotalCount(page.totalCount);
    setFacets(nextFacets);
    setLoadingState("querying_local", "Running local DuckDB queries…", 100);
  }, [ensureConnection, pageSize, setLoadingState]);

  const refreshSubset = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPageIndex(0);

    try {
      if (resourceIds.length === 0) {
        throw new Error("No resources selected.");
      }

      const connection = await ensureConnection();
      setLoadingState("requesting_interactions", "Resolving selected resource artifacts…", 12);
      const manifest = await fetchResourceWorkspaceManifest(resourceIds);
      const interactionResources = manifest.resources.filter((resource) => resource.artifacts.includes("interactions.parquet"));
      const entityResources = manifest.resources.filter((resource) => resource.artifacts.includes("entities.parquet"));
      const sourceIdentifierResources = manifest.resources.filter((resource) => resource.artifacts.includes("entity_identifiers_source.parquet"));
      const resolvedIdentifierResources = manifest.resources.filter((resource) => resource.artifacts.includes("entity_identifiers_resolved.parquet"));

      if (interactionResources.length === 0) {
        throw new Error("Selected resources do not provide interactions.parquet artifacts.");
      }

      await Promise.all(currentObjectUrlsRef.current.map((url) => releaseObjectUrl(url)));
      currentObjectUrlsRef.current = [];

      const interactionFiles: Array<{ fileName: string; resourceId: string }> = [];
      for (const [index, resource] of interactionResources.entries()) {
        setLoadingState("downloading_interactions", `Downloading ${resource.resource_id} interactions…`, 20 + Math.round((index / interactionResources.length) * 25));
        const artifact = await fetchResourceWorkspaceArtifact(resource.resource_id, "interactions.parquet");
        currentObjectUrlsRef.current.push(artifact.objectUrl);
        await registerParquetFile(artifact.fileName, artifact.blob);
        interactionFiles.push({ fileName: artifact.fileName, resourceId: resource.resource_id });
      }

      const entityFiles: Array<{ fileName: string; resourceId: string }> = [];
      for (const [index, resource] of entityResources.entries()) {
        setLoadingState("downloading_entities", `Downloading ${resource.resource_id} entities…`, 60 + Math.round((index / Math.max(entityResources.length, 1)) * 20));
        const artifact = await fetchResourceWorkspaceArtifact(resource.resource_id, "entities.parquet");
        currentObjectUrlsRef.current.push(artifact.objectUrl);
        await registerParquetFile(artifact.fileName, artifact.blob);
        entityFiles.push({ fileName: artifact.fileName, resourceId: resource.resource_id });
      }

      const sourceIdentifierFiles: Array<{ fileName: string; resourceId: string }> = [];
      for (const resource of sourceIdentifierResources) {
        const artifact = await fetchResourceWorkspaceArtifact(resource.resource_id, "entity_identifiers_source.parquet");
        currentObjectUrlsRef.current.push(artifact.objectUrl);
        await registerParquetFile(artifact.fileName, artifact.blob);
        sourceIdentifierFiles.push({ fileName: artifact.fileName, resourceId: resource.resource_id });
      }

      const resolvedIdentifierFiles: Array<{ fileName: string; resourceId: string }> = [];
      for (const resource of resolvedIdentifierResources) {
        const artifact = await fetchResourceWorkspaceArtifact(resource.resource_id, "entity_identifiers_resolved.parquet");
        currentObjectUrlsRef.current.push(artifact.objectUrl);
        await registerParquetFile(artifact.fileName, artifact.blob);
        resolvedIdentifierFiles.push({ fileName: artifact.fileName, resourceId: resource.resource_id });
      }

      if (entityFiles.length > 0) {
        setLoadingState("loading_entities", "Loading selected resource entities into DuckDB…", 85);
        await mountResourceEntities(connection, entityFiles);
        await mountResourceIdentifierRows(connection, sourceIdentifierFiles, { includeCanonicalFlag: false, viewName: "resource_entity_identifiers_source" });
        await mountResourceIdentifierRows(connection, resolvedIdentifierFiles, { includeCanonicalFlag: true, viewName: "resource_entity_identifiers_resolved" });
        setEntitySummaries(await queryResourceEntitySummaries(connection));
      } else {
        setEntitySummaries(new Map());
      }

      setLoadingState("loading_interactions", "Loading selected resource interactions into DuckDB…", 50);
      await mountResourceInteractions(
        connection,
        interactionFiles.map(({ fileName, resourceId }) => ({
          interactionFileName: fileName,
          entityFileName: entityFiles.find((entityFile) => entityFile.resourceId === resourceId)?.fileName,
          resourceId,
        })),
      );

      const countResult = await connection.query("SELECT COUNT(*) AS total_count FROM resource_interactions");
      const countRows = countResult.toArray().map((row) => (typeof row === "object" && row && "toJSON" in row && typeof row.toJSON === "function") ? row.toJSON() as Record<string, unknown> : row as Record<string, unknown>);
      setRowCount(Number(countRows[0]?.total_count ?? 0));
      setMaterialized(true);
      await refreshLocalQueries(0, EMPTY_LOCAL_FILTERS);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load selected resources");
      setMaterialized(false);
      setRows([]);
      setTotalCount(0);
      setFacets(emptyFacets());
      setEntitySummaries(new Map());
    } finally {
      setLoading(false);
      setLoadingState("idle", null, null);
    }
  }, [ensureConnection, refreshLocalQueries, resourceIds, setLoadingState]);

  useEffect(() => {
    void refreshSubset();
  }, [refreshSubset]);

  useEffect(() => {
    if (!materialized) return;
    setLoading(true);
    setError(null);
    void refreshLocalQueries(pageIndex, localFilters)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Failed to query local dataset"))
      .finally(() => {
        setLoading(false);
        setLoadingState("idle", null, null);
      });
  }, [localFilters, materialized, pageIndex, refreshLocalQueries, setLoadingState]);

  useEffect(() => {
    return () => {
      void Promise.all(currentObjectUrlsRef.current.map((url) => releaseObjectUrl(url)));
      if (connectionRef.current) {
        void connectionRef.current.close();
      }
    };
  }, []);

  const getEntityById = useCallback(async (entityId: string) => {
    const connection = await ensureConnection();
    return queryResourceEntityById(connection, entityId);
  }, [ensureConnection]);

  const toggleStringFacet = useCallback((facet: "interaction_types" | "sources", value: string) => {
    setPageIndex(0);
    setLocalFilters((prev) => {
      const values = prev[facet];
      const nextValues = values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
      return { ...prev, [facet]: nextValues };
    });
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

  const value = useMemo<DuckDbResourceWorkspaceContextValue>(() => ({
    loading,
    loadingStage,
    loadingLabel,
    loadingProgress,
    error,
    materialized,
    resourceIds,
    pageIndex,
    pageSize,
    totalCount,
    rowCount,
    rows,
    facets,
    localFilters,
    entitySummaries,
    refreshSubset,
    getEntityById,
    setPageIndex,
    toggleLocalFacet: toggleStringFacet,
    toggleSign,
    setIsDirected,
    clearLocalFilters,
  }), [
    clearLocalFilters,
    entitySummaries,
    error,
    facets,
    getEntityById,
    loading,
    loadingLabel,
    loadingProgress,
    loadingStage,
    localFilters,
    materialized,
    pageIndex,
    pageSize,
    refreshSubset,
    resourceIds,
    rowCount,
    rows,
    setIsDirected,
    toggleSign,
    toggleStringFacet,
    totalCount,
  ]);

  return <DuckDbResourceWorkspaceContext.Provider value={value}>{children}</DuckDbResourceWorkspaceContext.Provider>;
}

export function useDuckDbResourceWorkspace() {
  const context = useContext(DuckDbResourceWorkspaceContext);
  if (!context) {
    throw new Error("useDuckDbResourceWorkspace must be used within DuckDbResourceWorkspaceProvider");
  }
  return context;
}
