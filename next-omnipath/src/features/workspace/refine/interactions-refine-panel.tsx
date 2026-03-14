"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterSidebar, AnnotationFilterSidebar } from "@/features/interactions-search/components/filter-sidebar";
import { searchInteractions } from "@/features/interactions-search/api/queries";
import { useEntitySelection, useInteractionsUrlState } from "@/lib/navigation/url-state";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { RefinePanelLayout, RefineSection } from "./refine-panel-layout";

interface InteractionsRefinePanelProps {
  useEntityFilters?: boolean;
  lockedEntityIds?: Array<string | number>;
}

const EMPTY_LOCKED_ENTITY_IDS: Array<string | number> = [];

export function InteractionsRefinePanel({
  useEntityFilters = true,
  lockedEntityIds = EMPTY_LOCKED_ENTITY_IDS,
}: InteractionsRefinePanelProps) {
  const { entityIds: urlEntityIds, filters: urlFilters, setFilters: setUrlFilters } = useInteractionsUrlState();
  const { entityIds: selectedEntityIds } = useEntitySelection();
  const [filterCounts, setFilterCounts] = useState<Record<string, Record<string, number>>>({});

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

  useEffect(() => {
    async function loadFacets() {
      const response = await searchInteractions("", filters, 1, 0);
      const facetDist = response.facetDistribution || {};
      const counts: Record<string, Record<string, number>> = {};
      if (facetDist.interaction_type) counts.interaction_type = facetDist.interaction_type;
      if (facetDist.has_direction) counts.has_direction = facetDist.has_direction;
      if (facetDist.has_positive_sign) counts.has_positive_sign = facetDist.has_positive_sign;
      if (facetDist.has_negative_sign) counts.has_negative_sign = facetDist.has_negative_sign;
      if (facetDist.interaction_annotation_terms) counts.interaction_annotation_terms = facetDist.interaction_annotation_terms;
      if (facetDist.participant_annotation_terms_go) counts.participant_annotation_terms_go = facetDist.participant_annotation_terms_go;
      if (facetDist.participant_annotation_terms_mi) counts.participant_annotation_terms_mi = facetDist.participant_annotation_terms_mi;
      if (facetDist.participant_annotation_terms_om) counts.participant_annotation_terms_om = facetDist.participant_annotation_terms_om;
      if (facetDist.participant_annotation_terms_hp) counts.participant_annotation_terms_hp = facetDist.participant_annotation_terms_hp;
      if (facetDist.participant_annotation_terms_kw) counts.participant_annotation_terms_kw = facetDist.participant_annotation_terms_kw;
      if (facetDist.sources) counts.sources = facetDist.sources;
      setFilterCounts(counts);
    }

    void loadFacets();
  }, [filters]);

  const handleClearFilters = useCallback(() => setUrlFilters(enforceEntityScope({})), [enforceEntityScope, setUrlFilters]);

  return (
    <RefinePanelLayout title="Interaction filters">
      <RefineSection title="Interaction properties">
        <FilterSidebar
          filters={filters}
          filterCounts={filterCounts}
          onFilterChange={(next) => setUrlFilters(enforceEntityScope(next))}
          onClearFilters={handleClearFilters}
          isMobile
        />
      </RefineSection>
      <RefineSection title="Annotations">
        <AnnotationFilterSidebar
          mode="interactions"
          filters={filters}
          filterCounts={filterCounts}
          onFilterChange={(next) => setUrlFilters(enforceEntityScope(next))}
          isMobile
        />
      </RefineSection>
    </RefinePanelLayout>
  );
}
