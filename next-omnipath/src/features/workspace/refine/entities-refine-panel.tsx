"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EntityBadge } from "@/components/entity-badge";
import { EntityFilterSidebar } from "@/features/search/components/entity-filter-sidebar";
import { CvTermHoverCard } from "@/features/search/components/result-card";
import { searchMeilisearch } from "@/features/search/api/queries";
import { useEntitySelection, useSearchUrlState } from "@/lib/navigation/url-state";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { OntologyRefineSection } from "./ontology-refine-section";
import { OntologyTermLabel } from "@/features/ontology/ontology-term-label";
import { RefinePanelLayout, RefineSection } from "./refine-panel-layout";
import { SelectedFiltersSection, type SelectedFilterItem } from "./selected-filters-section";

interface EntitiesRefinePanelProps {
  lockedEntityIds?: Array<string | number>;
  onLockedEntityIdsChange?: (entityIds: string[]) => void;
}

const TAXONOMY_ID_TO_NAME: Record<string, string> = {
  "9606": "Human",
  "10090": "Mouse",
  "10116": "Rat",
  "7227": "Fruit fly",
  "6239": "C. elegans",
  "7955": "Zebrafish",
  "559292": "S. cerevisiae",
  "284812": "S. pombe",
  "83333": "E. coli",
  "224308": "B. subtilis",
};

function extractCanonicalOntologyId(value: string): string | null {
  const ontologyIdMatch = value.match(/(MI|OM|GO|HP|KW|DO|MP|CHEBI|CL|UBERON|MONDO):\d{4,}/);
  return ontologyIdMatch?.[0] || null;
}

function extractReadableLabel(value: string): string {
  const ontologyId = extractCanonicalOntologyId(value);

  if (ontologyId) {
    if (value === ontologyId) return value;
    if (value.endsWith(`:${ontologyId}:${ontologyId}`)) {
      return value.slice(0, -`:${ontologyId}:${ontologyId}`.length);
    }
    if (value.endsWith(`:${ontologyId}`)) {
      return value.slice(0, -`:${ontologyId}`.length);
    }
  }

  const typedIdMatch = value.match(/^(.+):([A-Z]+:\d+)$/);
  if (typedIdMatch) {
    return typedIdMatch[1];
  }

  return value;
}

export function EntitiesRefinePanel({ lockedEntityIds = [], onLockedEntityIdsChange }: EntitiesRefinePanelProps) {
  const { query, species, filters: urlFilters, setFilters } = useSearchUrlState();
  const { selectedEntities } = useEntitySelection();
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

  const selectedEntityById = useMemo(
    () => new Map(selectedEntities.map((entity) => [String(entity.entityId ?? entity.id), entity])),
    [selectedEntities],
  );

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
      const allOntologyCounts = facetDistribution.ontology_terms || {};
      const groupedCounts: Record<string, Record<string, number>> = {};
      Object.entries(allOntologyCounts).forEach(([value, count]) => {
        const match = value.match(/^([A-Z][A-Z0-9_-]*):/);
        const prefix = match ? match[1] : 'OTHER';
        (groupedCounts[prefix] ||= {})[value] = count as number;
      });
      setOntologyFacetCountsByPrefix(groupedCounts);
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
    if (onLockedEntityIdsChange) {
      onLockedEntityIdsChange([]);
    }
    setFilters(onLockedEntityIdsChange
      ? { ncbi_tax_id: [species || "9606"] }
      : normalizedLockedEntityIds.length > 0
        ? { entity_ids: normalizedLockedEntityIds }
        : { ncbi_tax_id: [species || "9606"] });
  }, [normalizedLockedEntityIds, onLockedEntityIdsChange, setFilters, species]);

  const selectedFilterItems = useMemo<SelectedFilterItem[]>(() => {
    const items: SelectedFilterItem[] = [];

    const renderEntityLabel = (entityId: string) => {
      const entity = selectedEntityById.get(entityId);
      return (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Entity</span>
          <div className="min-w-[140px] max-w-[240px]">
            <EntityBadge
              displayName={entity?.name || entityId}
              canonicalIdentifier={String(entity?.entityId ?? entity?.id ?? entityId)}
              entityId={String(entity?.entityId ?? entity?.id ?? entityId)}
              entityType={entity?.type}
            />
          </div>
        </div>
      );
    };

    (filters.entity_ids || []).forEach((value) => {
      const isLocked = normalizedLockedEntityIds.includes(String(value));
      items.push({
        id: `entity_ids:${value}`,
        label: renderEntityLabel(String(value)),
        onRemove: isLocked
          ? onLockedEntityIdsChange
            ? () => onLockedEntityIdsChange(normalizedLockedEntityIds.filter((item) => item !== String(value)))
            : undefined
          : () => {
              const nextValues = (filters.entity_ids || []).filter((item) => String(item) !== String(value));
              setFilters(nextValues.length > 0 ? { ...filters, entity_ids: nextValues } : { ...filters, entity_ids: undefined });
            },
      });
    });

    const pushOntologyItems = (filterKey: "ontology_terms", label: string) => {
      const values = (filters[filterKey] as string[] | undefined) || [];
      const grouped = new Map<string, string[]>();

      values.forEach((value) => {
        const canonicalId = extractCanonicalOntologyId(value) || value;
        grouped.set(canonicalId, [...(grouped.get(canonicalId) || []), value]);
      });

      grouped.forEach((groupValues, canonicalId) => {
        items.push({
          id: `${filterKey}:${canonicalId}`,
          label: (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{label}</span>
              <CvTermHoverCard termId={canonicalId}>
                <span className="cursor-help underline decoration-dotted underline-offset-2">
                  <OntologyTermLabel termId={canonicalId} />
                </span>
              </CvTermHoverCard>
            </div>
          ),
          onRemove: () => {
            const nextValues = values.filter((value) => !groupValues.includes(value));
            setFilters(normalizedLockedEntityIds.length > 0
              ? { ...filters, [filterKey]: nextValues.length > 0 ? nextValues : undefined, entity_ids: normalizedLockedEntityIds }
              : { ...filters, [filterKey]: nextValues.length > 0 ? nextValues : undefined });
          },
        });
      });
    };

    (filters.entity_types || []).forEach((value) => {
      items.push({
        id: `entity_types:${value}`,
        label: `Entity type: ${extractReadableLabel(value)}`,
        onRemove: () => handleFilterChange({
          entity_types: (filters.entity_types || []).filter((item) => item !== value),
        }),
      });
    });

    (filters.sources || []).forEach((value) => {
      items.push({
        id: `sources:${value}`,
        label: `Source: ${extractReadableLabel(value)}`,
        onRemove: () => handleFilterChange({
          sources: (filters.sources || []).filter((item) => item !== value),
        }),
      });
    });

    (filters.ncbi_tax_id || []).forEach((value) => {
      items.push({
        id: `ncbi_tax_id:${value}`,
        label: `Species: ${TAXONOMY_ID_TO_NAME[value] ? `${TAXONOMY_ID_TO_NAME[value]} (${value})` : value}`,
        onRemove: () => handleFilterChange({
          ncbi_tax_id: (filters.ncbi_tax_id || []).filter((item) => item !== value),
        }),
      });
    });

    pushOntologyItems("ontology_terms", "Ontology");

    return items;
  }, [filters, handleFilterChange, normalizedLockedEntityIds, onLockedEntityIdsChange, selectedEntityById, setFilters]);

  return (
    <RefinePanelLayout title="Entity filters">
      {selectedFilterItems.length > 0 ? (
        <RefineSection title="Selected filters" defaultOpen={false}>
          <SelectedFiltersSection items={selectedFilterItems} onClearAll={handleClearFilters} />
        </RefineSection>
      ) : null}
      <RefineSection title="Core filters">
        <EntityFilterSidebar
          filters={filters}
          filterCounts={filterCounts}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
          isMobile
        />
      </RefineSection>
      <RefineSection title="Ontology terms">
        <OntologyRefineSection
          filters={filters}
          onFilterChange={(next) => setFilters(normalizedLockedEntityIds.length > 0 ? { ...next, entity_ids: normalizedLockedEntityIds } : next)}
          ontologyFacetCountsByPrefix={ontologyFacetCountsByPrefix}
        />
      </RefineSection>
    </RefinePanelLayout>
  );
}
