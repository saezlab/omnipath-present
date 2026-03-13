"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EntityFilterSidebar } from "@/features/search/components/entity-filter-sidebar";
import { searchMeilisearch } from "@/features/search/api/queries";
import { useSearchUrlState } from "@/lib/navigation/url-state";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { OntologyRefineSection } from "./ontology-refine-section";

interface EntitiesRefinePanelProps {
  lockedEntityIds?: Array<string | number>;
}

export function EntitiesRefinePanel({ lockedEntityIds = [] }: EntitiesRefinePanelProps) {
  const { query, species, filters: urlFilters, setFilters } = useSearchUrlState();
  const [filterCounts, setFilterCounts] = useState<{
    entity_type?: Record<string, number>;
    sources?: Record<string, number>;
    ncbi_tax_id?: Record<string, number>;
  }>({});
  const [ontologyFacetCountsByPrefix, setOntologyFacetCountsByPrefix] = useState<Record<string, Record<string, number>>>({});

  const normalizedLockedEntityIds = useMemo(
    () => lockedEntityIds.map((id) => String(id).trim()).filter(Boolean),
    [lockedEntityIds],
  );
  const defaultFilters = useMemo<MeilisearchFilters>(
    () => ({ ncbi_tax_id: [species || "9606"] }),
    [species],
  );
  const filters = useMemo<MeilisearchFilters>(() => {
    const base = Object.keys(urlFilters).length > 0 ? urlFilters : defaultFilters;
    return normalizedLockedEntityIds.length > 0 ? { ...base, entity_ids: normalizedLockedEntityIds } : base;
  }, [defaultFilters, normalizedLockedEntityIds, urlFilters]);

  useEffect(() => {
    async function loadFacets() {
      const response = await searchMeilisearch({
        query: query || "",
        index: "search_entities",
        limit: 1,
        offset: 0,
        filters,
      });
      const facetDistribution = ("facetDistribution" in response ? response.facetDistribution : null) || {};
      setFilterCounts({
        entity_type: facetDistribution.entity_type || {},
        sources: facetDistribution.sources || {},
        ncbi_tax_id: facetDistribution.ncbi_tax_id || {},
      });
      setOntologyFacetCountsByPrefix({
        GO: facetDistribution.cv_terms_go || {},
        MI: facetDistribution.cv_terms_mi || {},
        OM: facetDistribution.cv_terms_om || {},
        HP: facetDistribution.cv_terms_hp || {},
        KW: facetDistribution.cv_terms_kw || {},
      });
    }

    void loadFacets();
  }, [filters, query]);

  const handleFilterChange = useCallback((next: { entity_types?: string[]; sources?: string[]; ncbi_tax_id?: string[] }) => {
    setFilters({
      ...filters,
      ...next,
      ...(normalizedLockedEntityIds.length > 0 ? { entity_ids: normalizedLockedEntityIds } : {}),
    });
  }, [filters, normalizedLockedEntityIds, setFilters]);

  const handleClearFilters = useCallback(() => {
    setFilters(normalizedLockedEntityIds.length > 0 ? { entity_ids: normalizedLockedEntityIds } : { ncbi_tax_id: [species || "9606"] });
  }, [normalizedLockedEntityIds, setFilters, species]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <EntityFilterSidebar
        filters={filters}
        filterCounts={filterCounts}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        isMobile
      />
      <OntologyRefineSection
        filters={filters}
        onFilterChange={(next) => setFilters(normalizedLockedEntityIds.length > 0 ? { ...next, entity_ids: normalizedLockedEntityIds } : next)}
        ontologyFacetCountsByPrefix={ontologyFacetCountsByPrefix}
      />
    </div>
  );
}
