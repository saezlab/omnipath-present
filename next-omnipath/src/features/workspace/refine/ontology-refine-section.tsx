"use client";

import { AnnotationFilterSidebar } from "@/features/interactions-search/components/filter-sidebar";
import type { MeilisearchFilters } from "@/types/meilisearch";

interface OntologyRefineSectionProps {
  filters: MeilisearchFilters;
  onFilterChange: (filters: MeilisearchFilters) => void;
  ontologyFacetCountsByPrefix: Record<string, Record<string, number>>;
}

export function OntologyRefineSection({
  filters,
  onFilterChange,
  ontologyFacetCountsByPrefix,
}: OntologyRefineSectionProps) {
  return (
    <AnnotationFilterSidebar
      mode="entities"
      filters={filters}
      onFilterChange={onFilterChange}
      ontologyFacetCountsByPrefix={ontologyFacetCountsByPrefix}
      isMobile
    />
  );
}
