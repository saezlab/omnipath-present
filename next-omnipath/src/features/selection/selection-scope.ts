"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getEntityIdsForAnnotationTerms } from "@/lib/queries/ontology-term";

export interface DerivedSelectionScope {
  selectedEntityIds: string[];
  selectedAnnotationIds: string[];
  annotationMatchedEntityIds: string[];
  scopedEntityIds: string[];
}

export function deriveSelectionScope(input: {
  selectedEntityIds?: Array<string | number>;
  selectedAnnotationIds?: Array<string | number>;
  annotationMatchedEntityIds?: Array<string | number>;
}): DerivedSelectionScope {
  const selectedEntityIds = normalizeIds(input.selectedEntityIds);
  const selectedAnnotationIds = normalizeIds(input.selectedAnnotationIds);
  const annotationMatchedEntityIds = normalizeIds(input.annotationMatchedEntityIds);

  return {
    selectedEntityIds,
    selectedAnnotationIds,
    annotationMatchedEntityIds,
    scopedEntityIds: Array.from(new Set([...selectedEntityIds, ...annotationMatchedEntityIds])),
  };
}

function normalizeIds(ids?: Array<string | number>) {
  return Array.from(new Set((ids || []).map((id) => String(id).trim()).filter(Boolean)));
}

async function fetchEntityIdsForSelectedAnnotations(annotationIds: string[]): Promise<string[]> {
  return getEntityIdsForAnnotationTerms(annotationIds);
}

export function useSelectionScope(selectedEntityIds: string[], selectedAnnotationIds: string[]) {
  const annotationScopeQuery = useQuery({
    queryKey: ["selection-scope-annotation-entities", selectedAnnotationIds],
    queryFn: () => fetchEntityIdsForSelectedAnnotations(selectedAnnotationIds),
    enabled: selectedAnnotationIds.length > 0,
    staleTime: 60_000,
  });

  const scope = useMemo(
    () => deriveSelectionScope({
      selectedEntityIds,
      selectedAnnotationIds,
      annotationMatchedEntityIds: annotationScopeQuery.data || [],
    }),
    [annotationScopeQuery.data, selectedAnnotationIds, selectedEntityIds],
  );

  return {
    ...scope,
    isLoading: annotationScopeQuery.isLoading,
    isFetching: annotationScopeQuery.isFetching,
  };
}
