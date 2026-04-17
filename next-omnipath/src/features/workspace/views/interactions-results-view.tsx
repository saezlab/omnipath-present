"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { InteractionsExploreTab } from "@/features/explore/components/interactions-explore-tab";
import { getAssociatedEntityScope } from "@/lib/associations/associated-entities";
import { useEntitySelection, useInteractionsUrlState } from "@/lib/navigation/url-state";

interface InteractionsResultsViewProps {
  useEntityFilters?: boolean;
  lockedEntityIds?: Array<string | number>;
  filtersOverride?: MeilisearchFilters;
  setFiltersOverride?: (filters: MeilisearchFilters) => void;
}

const EMPTY_LOCKED_ENTITY_IDS: Array<string | number> = [];

export function InteractionsResultsView({
  useEntityFilters = true,
  lockedEntityIds = EMPTY_LOCKED_ENTITY_IDS,
  filtersOverride,
  setFiltersOverride,
}: InteractionsResultsViewProps) {
  const { entityIds: urlEntityIds, filters: urlFilters, setFilters: setUrlFilters } = useInteractionsUrlState();
  const { entityIds: selectedEntityIds } = useEntitySelection();
  const [expandedEntityIds, setExpandedEntityIds] = useState<string[]>([]);

  const normalizedLockedEntityIds = useMemo(
    () => lockedEntityIds.map((id) => String(id).trim()).filter(Boolean),
    [lockedEntityIds],
  );

  const scopedEntityIds = useMemo(() => {
    if (normalizedLockedEntityIds.length > 0) return normalizedLockedEntityIds;
    if (urlEntityIds.length > 0) return urlEntityIds;
    if (selectedEntityIds.length > 0) return selectedEntityIds;
    return [];
  }, [normalizedLockedEntityIds, selectedEntityIds, urlEntityIds]);

  const enforceEntityScope = useCallback((next: MeilisearchFilters): MeilisearchFilters => {
    if (!useEntityFilters || scopedEntityIds.length === 0) return next;
    return {
      ...next,
      entity_ids: scopedEntityIds,
      member_a_id: undefined,
      member_b_id: undefined,
    };
  }, [scopedEntityIds, useEntityFilters]);

  const filters = useMemo(
    () => enforceEntityScope(filtersOverride || urlFilters),
    [enforceEntityScope, filtersOverride, urlFilters],
  );

  useEffect(() => {
    if (!filters.include_associated_entities || scopedEntityIds.length === 0) {
      setExpandedEntityIds(scopedEntityIds);
      return;
    }

    let cancelled = false;
    void getAssociatedEntityScope(scopedEntityIds)
      .then((scope) => {
        if (!cancelled) {
          setExpandedEntityIds(scope.expandedEntityIds);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExpandedEntityIds(scopedEntityIds);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters.include_associated_entities, scopedEntityIds]);

  const effectiveFilters = useMemo<MeilisearchFilters>(() => {
    const { include_associated_entities: _includeAssociatedEntities, ...rest } = filters;
    if (!filters.include_associated_entities || scopedEntityIds.length === 0) {
      return rest;
    }

    return {
      ...rest,
      entity_ids: expandedEntityIds.length > 0 ? expandedEntityIds : scopedEntityIds,
      member_a_id: undefined,
      member_b_id: undefined,
    };
  }, [expandedEntityIds, filters, scopedEntityIds]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <InteractionsExploreTab
          filters={effectiveFilters}
          onFilterChange={(next) => {
            const scoped = enforceEntityScope(next);
            if (setFiltersOverride) {
              setFiltersOverride(scoped);
              return;
            }
            setUrlFilters(scoped);
          }}
          onFilterCountsUpdate={() => {}}
          useInternalRefineLayout={false}
        />
      </div>
    </div>
  );
}
