"use client";

import { useCallback, useMemo } from "react";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { useEntitySelection, useInteractionsUrlState } from "@/lib/navigation/url-state";
import { InteractionsExploreTab } from "@/features/explore/components/interactions-explore-tab";

interface InteractionsResultsViewProps {
  useEntityFilters?: boolean;
  lockedEntityIds?: Array<string | number>;
}

const EMPTY_LOCKED_ENTITY_IDS: Array<string | number> = [];

export function InteractionsResultsView({
  useEntityFilters = true,
  lockedEntityIds = EMPTY_LOCKED_ENTITY_IDS,
}: InteractionsResultsViewProps) {
  const { entityIds: urlEntityIds, filters: urlFilters, setFilters: setUrlFilters } = useInteractionsUrlState();
  const { entityIds: selectedEntityIds } = useEntitySelection();

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

  const filters = useMemo(() => enforceEntityScope(urlFilters), [enforceEntityScope, urlFilters]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <InteractionsExploreTab
          filters={filters}
          onFilterChange={(next) => setUrlFilters(enforceEntityScope(next))}
          onFilterCountsUpdate={() => {}}
          useInternalRefineLayout={false}
        />
      </div>
    </div>
  );
}
