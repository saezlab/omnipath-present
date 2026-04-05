"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { createConnection, registerParquetFile, releaseObjectUrl } from "@/lib/duckdb/browser";
import {
  type AnnotationEntityPageRow,
  type AnnotationEntitySummary,
  type AnnotationTermCountRow,
  mountResourceAnnotations,
  queryAnnotationEntityPage,
  queryAnnotationEntitySummaries,
  queryAnnotationEntitySearchKeys,
  queryAnnotationEntityTerms,
  queryAnnotationTermCounts,
  queryAnnotationTermResourceSupport,
  queryAnnotationTermsForEntities,
} from "@/lib/duckdb/annotation-resource-sql";
import { mountResourceEntities, mountResourceIdentifierRows } from "@/lib/duckdb/resource-sql";
import { fetchResourceWorkspaceArtifact, fetchResourceWorkspaceManifest } from "@/lib/resource-workspace";
import { useEntitySelection } from "@/contexts/entity-selection-context";

export type AnnotationWorkspaceMode = "annotations_to_entities" | "entities_to_annotations";
export type AnnotationTermMatchMode = "any" | "all";

type LoadingStage =
  | "idle"
  | "instantiating_duckdb"
  | "requesting_manifest"
  | "downloading_annotations"
  | "downloading_entities"
  | "loading_tables"
  | "querying_local";

interface DuckDbAnnotationWorkspaceContextValue {
  loading: boolean;
  loadingStage: LoadingStage;
  loadingLabel: string | null;
  loadingProgress: number | null;
  error: string | null;
  materialized: boolean;
  resourceIds: string[];
  mode: AnnotationWorkspaceMode;
  setMode: (mode: AnnotationWorkspaceMode) => void;
  termMatchMode: AnnotationTermMatchMode;
  setTermMatchMode: (mode: AnnotationTermMatchMode) => void;
  selectedTerms: string[];
  addSelectedTerm: (termId: string) => void;
  removeSelectedTerm: (termId: string) => void;
  clearSelectedTerms: () => void;
  availableTerms: AnnotationTermCountRow[];
  selectedEntitiesTermCounts: AnnotationTermCountRow[];
  selectionEntityIds: string[];
  searchEntities: (query: string, limit?: number) => Promise<AnnotationEntitySummary[]>;
  rows: AnnotationEntityPageRow[];
  totalCount: number;
  pageIndex: number;
  pageSize: number;
  setPageIndex: (next: number) => void;
  selectedRowKeys: string[];
  toggleSelectedRow: (rowKey: string) => void;
  clearSelectedRows: () => void;
  refreshSubset: () => Promise<void>;
  entitySummaries: Map<string, AnnotationEntitySummary>;
  focusedTermId: string | null;
  setFocusedTermId: (termId: string | null) => void;
  focusedTermSupport: Array<{ resource_id: string; entity_count: number; annotation_count: number }>;
  focusedEntityKey: string | null;
  setFocusedEntityKey: (rowKey: string | null) => void;
  focusedEntityTerms: string[];
}

const DuckDbAnnotationWorkspaceContext = createContext<DuckDbAnnotationWorkspaceContextValue | null>(null);

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function DuckDbAnnotationWorkspaceProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const { entityIds: selectionEntityIds } = useEntitySelection();
  const connectionRef = useRef<AsyncDuckDBConnection | null>(null);
  const currentObjectUrlsRef = useRef<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<LoadingStage>("idle");
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [materialized, setMaterialized] = useState(false);
  const [mode, setMode] = useState<AnnotationWorkspaceMode>("annotations_to_entities");
  const [termMatchMode, setTermMatchMode] = useState<AnnotationTermMatchMode>("any");
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [availableTerms, setAvailableTerms] = useState<AnnotationTermCountRow[]>([]);
  const [selectedEntitiesTermCounts, setSelectedEntitiesTermCounts] = useState<AnnotationTermCountRow[]>([]);
  const [rows, setRows] = useState<AnnotationEntityPageRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize] = useState(25);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [entitySummaries, setEntitySummaries] = useState<Map<string, AnnotationEntitySummary>>(new Map());
  const [focusedTermId, setFocusedTermId] = useState<string | null>(null);
  const [focusedTermSupport, setFocusedTermSupport] = useState<Array<{ resource_id: string; entity_count: number; annotation_count: number }>>([]);
  const [focusedEntityKey, setFocusedEntityKey] = useState<string | null>(null);
  const [focusedEntityTerms, setFocusedEntityTerms] = useState<string[]>([]);

  const resourceIds = useMemo(() => {
    const raw = searchParams.get("resources") || "";
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }, [searchParams]);
  const resourceKey = useMemo(() => resourceIds.join(","), [resourceIds]);

  const setLoadingState = useCallback((stage: LoadingStage, label: string | null, progress: number | null) => {
    setLoadingStage(stage);
    setLoadingLabel(label);
    setLoadingProgress(progress === null ? null : clampProgress(progress));
  }, []);

  const ensureConnection = useCallback(async () => {
    if (!connectionRef.current) {
      setLoadingState("instantiating_duckdb", "Instantiating DuckDB WASM…", 5);
      connectionRef.current = await createConnection();
    }
    return connectionRef.current;
  }, [setLoadingState]);

  const refreshEntityQuery = useCallback(async (nextPageIndex: number, nextSelectedTerms: string[], nextTermMatchMode: AnnotationTermMatchMode) => {
    if (!materialized) return;
    if (nextSelectedTerms.length === 0) {
      setRows([]);
      setTotalCount(0);
      return;
    }

    setLoadingState("querying_local", "Running local annotation queries…", 96);
    const connection = await ensureConnection();
    const page = await queryAnnotationEntityPage(connection, nextSelectedTerms, nextTermMatchMode, nextPageIndex, pageSize);
    setRows(page.rows);
    setTotalCount(page.totalCount);
    setLoadingState("querying_local", "Running local annotation queries…", 100);
  }, [ensureConnection, materialized, pageSize, setLoadingState]);

  const refreshSubset = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMaterialized(false);
    setSelectedRowKeys([]);
    setFocusedEntityKey(null);
    setFocusedEntityTerms([]);
    setFocusedTermSupport([]);

    try {
      if (resourceIds.length === 0) {
        throw new Error("No resources selected.");
      }

      const connection = await ensureConnection();
      setLoadingState("requesting_manifest", "Resolving selected resource artifacts…", 12);
      const manifest = await fetchResourceWorkspaceManifest(resourceIds);
      const annotationResources = manifest.resources.filter((resource) => resource.artifacts.includes("annotations.parquet"));
      const entityResources = manifest.resources.filter((resource) => resource.artifacts.includes("entities.parquet"));
      const sourceIdentifierResources = manifest.resources.filter((resource) => resource.artifacts.includes("entity_identifiers_source.parquet"));
      const resolvedIdentifierResources = manifest.resources.filter((resource) => resource.artifacts.includes("entity_identifiers_resolved.parquet"));

      if (annotationResources.length === 0) {
        throw new Error("Selected resources do not provide annotations.parquet artifacts.");
      }

      await Promise.all(currentObjectUrlsRef.current.map((url) => releaseObjectUrl(url)));
      currentObjectUrlsRef.current = [];

      const annotationFiles: Array<{ fileName: string; resourceId: string }> = [];
      for (const [index, resource] of annotationResources.entries()) {
        setLoadingState("downloading_annotations", `Downloading ${resource.resource_id} annotations…`, 18 + Math.round((index / Math.max(annotationResources.length, 1)) * 32));
        const artifact = await fetchResourceWorkspaceArtifact(resource.resource_id, "annotations.parquet");
        currentObjectUrlsRef.current.push(artifact.objectUrl);
        await registerParquetFile(artifact.fileName, artifact.blob);
        annotationFiles.push({ fileName: artifact.fileName, resourceId: resource.resource_id });
      }

      const entityFiles: Array<{ fileName: string; resourceId: string }> = [];
      for (const [index, resource] of entityResources.entries()) {
        setLoadingState("downloading_entities", `Downloading ${resource.resource_id} entities…`, 56 + Math.round((index / Math.max(entityResources.length, 1)) * 16));
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

      setLoadingState("loading_tables", "Loading selected resource annotations into DuckDB…", 80);
      await mountResourceAnnotations(connection, annotationFiles);
      await mountResourceEntities(connection, entityFiles);
      await mountResourceIdentifierRows(connection, sourceIdentifierFiles, { includeCanonicalFlag: false, viewName: "resource_entity_identifiers_source" });
      await mountResourceIdentifierRows(connection, resolvedIdentifierFiles, { includeCanonicalFlag: true, viewName: "resource_entity_identifiers_resolved" });

      const [termCounts, summaries] = await Promise.all([
        queryAnnotationTermCounts(connection, 150),
        queryAnnotationEntitySummaries(connection),
      ]);

      setAvailableTerms(termCounts);
      setEntitySummaries(summaries);
      setMaterialized(true);
      setPageIndex(0);
      await refreshEntityQuery(0, selectedTerms, termMatchMode);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load selected resources");
      setAvailableTerms([]);
      setSelectedEntitiesTermCounts([]);
      setEntitySummaries(new Map());
      setRows([]);
      setTotalCount(0);
      setMaterialized(false);
    } finally {
      setLoading(false);
      setLoadingState("idle", null, null);
    }
  }, [ensureConnection, refreshEntityQuery, resourceIds, selectedTerms, setLoadingState, termMatchMode]);

  useEffect(() => {
    void refreshSubset();
  }, [resourceKey]);

  useEffect(() => {
    if (!materialized || mode !== "annotations_to_entities") return;
    setLoading(true);
    setError(null);
    void refreshEntityQuery(pageIndex, selectedTerms, termMatchMode)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Failed to query local annotation dataset"))
      .finally(() => {
        setLoading(false);
        setLoadingState("idle", null, null);
      });
  }, [materialized, mode, pageIndex, refreshEntityQuery, selectedTerms, setLoadingState, termMatchMode]);

  useEffect(() => {
    if (!materialized || mode !== "entities_to_annotations") return;
    void ensureConnection()
      .then((connection) => queryAnnotationTermsForEntities(connection, selectionEntityIds))
      .then(setSelectedEntitiesTermCounts)
      .catch(() => setSelectedEntitiesTermCounts([]));
  }, [ensureConnection, materialized, mode, selectionEntityIds]);

  useEffect(() => {
    if (!materialized || !focusedTermId) {
      setFocusedTermSupport([]);
      return;
    }
    void ensureConnection()
      .then((connection) => queryAnnotationTermResourceSupport(connection, focusedTermId))
      .then(setFocusedTermSupport)
      .catch(() => setFocusedTermSupport([]));
  }, [ensureConnection, focusedTermId, materialized]);

  useEffect(() => {
    if (!materialized || !focusedEntityKey) {
      setFocusedEntityTerms([]);
      return;
    }
    const [resourceId, entityId] = focusedEntityKey.split(":", 2);
    if (!resourceId || !entityId) {
      setFocusedEntityTerms([]);
      return;
    }
    void ensureConnection()
      .then((connection) => queryAnnotationEntityTerms(connection, resourceId, entityId))
      .then(setFocusedEntityTerms)
      .catch(() => setFocusedEntityTerms([]));
  }, [ensureConnection, focusedEntityKey, materialized]);

  useEffect(() => {
    return () => {
      void Promise.all(currentObjectUrlsRef.current.map((url) => releaseObjectUrl(url)));
      if (connectionRef.current) {
        void connectionRef.current.close();
      }
    };
  }, []);

  const addSelectedTerm = useCallback((termId: string) => {
    const normalized = termId.trim();
    if (!normalized) return;
    setPageIndex(0);
    setSelectedTerms((current) => current.includes(normalized) ? current : [...current, normalized]);
    setFocusedTermId(normalized);
  }, []);

  const removeSelectedTerm = useCallback((termId: string) => {
    setPageIndex(0);
    setSelectedTerms((current) => current.filter((value) => value !== termId));
    setSelectedRowKeys([]);
    setFocusedTermId((current) => current === termId ? null : current);
  }, []);

  const clearSelectedTerms = useCallback(() => {
    setPageIndex(0);
    setSelectedTerms([]);
    setSelectedRowKeys([]);
    setFocusedTermId(null);
    setRows([]);
    setTotalCount(0);
  }, []);

  const toggleSelectedRow = useCallback((rowKey: string) => {
    setSelectedRowKeys((current) => current.includes(rowKey) ? current.filter((value) => value !== rowKey) : [...current, rowKey]);
    setFocusedEntityKey(rowKey);
  }, []);

  const clearSelectedRows = useCallback(() => setSelectedRowKeys([]), []);

  const searchEntities = useCallback(async (query: string, limit = 12) => {
    if (!materialized) return [];
    const connection = await ensureConnection();
    const keys = await queryAnnotationEntitySearchKeys(connection, query, limit);
    return keys.map((key) => entitySummaries.get(key)).filter((value): value is AnnotationEntitySummary => Boolean(value));
  }, [ensureConnection, entitySummaries, materialized]);

  const value = useMemo<DuckDbAnnotationWorkspaceContextValue>(() => ({
    loading,
    loadingStage,
    loadingLabel,
    loadingProgress,
    error,
    materialized,
    resourceIds,
    mode,
    setMode,
    termMatchMode,
    setTermMatchMode,
    selectedTerms,
    addSelectedTerm,
    removeSelectedTerm,
    clearSelectedTerms,
    availableTerms,
    selectedEntitiesTermCounts,
    selectionEntityIds,
    searchEntities,
    rows,
    totalCount,
    pageIndex,
    pageSize,
    setPageIndex,
    selectedRowKeys,
    toggleSelectedRow,
    clearSelectedRows,
    refreshSubset,
    entitySummaries,
    focusedTermId,
    setFocusedTermId,
    focusedTermSupport,
    focusedEntityKey,
    setFocusedEntityKey,
    focusedEntityTerms,
  }), [
    addSelectedTerm,
    availableTerms,
    clearSelectedRows,
    clearSelectedTerms,
    entitySummaries,
    error,
    focusedEntityKey,
    focusedEntityTerms,
    focusedTermId,
    focusedTermSupport,
    loading,
    loadingLabel,
    loadingProgress,
    loadingStage,
    materialized,
    mode,
    pageIndex,
    pageSize,
    refreshSubset,
    removeSelectedTerm,
    resourceIds,
    rows,
    searchEntities,
    selectedEntitiesTermCounts,
    selectionEntityIds,
    selectedRowKeys,
    selectedTerms,
    termMatchMode,
    totalCount,
    toggleSelectedRow,
  ]);

  return <DuckDbAnnotationWorkspaceContext.Provider value={value}>{children}</DuckDbAnnotationWorkspaceContext.Provider>;
}

export function useDuckDbAnnotationWorkspace() {
  const context = useContext(DuckDbAnnotationWorkspaceContext);
  if (!context) {
    throw new Error("useDuckDbAnnotationWorkspace must be used within DuckDbAnnotationWorkspaceProvider");
  }
  return context;
}
