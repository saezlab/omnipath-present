"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { searchMeilisearch } from "@/features/search/api/queries";

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
  const normalized = normalizeIds(annotationIds);
  if (normalized.length === 0) return [];

  const pageSize = 250;
  const entityIds = new Set<string>();
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const response = await searchMeilisearch({
      query: "",
      index: "search_entities",
      limit: pageSize,
      offset,
      filters: { ontology_terms: normalized },
    });

    const hits = response.hits || [];
    for (const hit of hits) {
      const entityId = String(hit.entity_id ?? "").trim();
      if (entityId) {
        entityIds.add(entityId);
      }
    }

    total = response.estimatedTotalHits || hits.length;
    if (hits.length < pageSize) break;
    offset += pageSize;
  }

  return Array.from(entityIds);
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
