"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EntityBadge } from "@/components/entity-badge";
import { FilterSidebar, AnnotationFilterSidebar } from "@/features/interactions-search/components/filter-sidebar";
import { CvTermHoverCard } from "@/features/search/components/result-card";
import { searchInteractions } from "@/features/interactions-search/api/queries";
import { useEntitySelection, useInteractionsUrlState } from "@/lib/navigation/url-state";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { RefinePanelLayout, RefineSection } from "./refine-panel-layout";
import { SelectedFiltersSection, type SelectedFilterItem } from "./selected-filters-section";

interface InteractionsRefinePanelProps {
  useEntityFilters?: boolean;
  lockedEntityIds?: Array<string | number>;
  onLockedEntityIdsChange?: (entityIds: string[]) => void;
}

const EMPTY_LOCKED_ENTITY_IDS: Array<string | number> = [];

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

  if (value.includes("|")) {
    return value
      .split("|")
      .map((part) => extractReadableLabel(part.trim()))
      .join(" · ");
  }

  const typedIdMatch = value.match(/^(.+):([A-Z]+:\d+)$/);
  if (typedIdMatch) {
    return typedIdMatch[1];
  }

  return value;
}

export function InteractionsRefinePanel({
  useEntityFilters = true,
  lockedEntityIds = EMPTY_LOCKED_ENTITY_IDS,
  onLockedEntityIdsChange,
}: InteractionsRefinePanelProps) {
  const { entityIds: urlEntityIds, filters: urlFilters, setFilters: setUrlFilters } = useInteractionsUrlState();
  const { entityIds: selectedEntityIds, selectedEntities } = useEntitySelection();
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

  const selectedEntityById = useMemo(
    () => new Map(selectedEntities.map((entity) => [String(entity.entityId ?? entity.id), entity])),
    [selectedEntities],
  );

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

  const handleClearFilters = useCallback(() => {
    if (onLockedEntityIdsChange) {
      onLockedEntityIdsChange([]);
    }
    setUrlFilters(onLockedEntityIdsChange ? {} : enforceEntityScope({}));
  }, [enforceEntityScope, onLockedEntityIdsChange, setUrlFilters]);

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

    const removeValue = (filterKey: keyof MeilisearchFilters, value: string) => {
      const nextValues = ((filters[filterKey] as string[] | undefined) || []).filter((item) => item !== value);
      setUrlFilters(enforceEntityScope({
        ...filters,
        [filterKey]: nextValues.length > 0 ? nextValues : undefined,
      }));
    };

    const pushOntologyItems = (filterKey: keyof MeilisearchFilters, label: string) => {
      const values = (filters[filterKey] as string[] | undefined) || [];
      const grouped = new Map<string, string[]>();

      values.forEach((value) => {
        const canonicalId = extractCanonicalOntologyId(value) || value;
        grouped.set(canonicalId, [...(grouped.get(canonicalId) || []), value]);
      });

      grouped.forEach((groupValues, canonicalId) => {
        const preferredValue = groupValues.find((value) => value !== canonicalId) || groupValues[0];
        items.push({
          id: `${filterKey}:${canonicalId}`,
          label: (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{label}</span>
              <CvTermHoverCard termId={canonicalId}>
                <span className="cursor-help underline decoration-dotted underline-offset-2">
                  {extractReadableLabel(preferredValue)}
                </span>
              </CvTermHoverCard>
            </div>
          ),
          onRemove: () => {
            const nextValues = values.filter((value) => !groupValues.includes(value));
            setUrlFilters(enforceEntityScope({
              ...filters,
              [filterKey]: nextValues.length > 0 ? nextValues : undefined,
            }));
          },
        });
      });
    };

    if (useEntityFilters && scopedEntityIds.length > 0) {
      scopedEntityIds.forEach((value) => {
        items.push({
          id: `entity_scope:${value}`,
          label: renderEntityLabel(String(value)),
          onRemove: onLockedEntityIdsChange
            ? () => onLockedEntityIdsChange(scopedEntityIds.filter((item) => item !== String(value)))
            : undefined,
        });
      });
    } else {
      (filters.entity_ids || []).forEach((value) => {
        items.push({
          id: `entity_ids:${value}`,
          label: renderEntityLabel(String(value)),
          onRemove: () => removeValue("entity_ids", String(value)),
        });
      });
    }

    (filters.interaction_types || []).forEach((value) => {
      items.push({
        id: `interaction_types:${value}`,
        label: `Interaction type: ${extractReadableLabel(value)}`,
        onRemove: () => removeValue("interaction_types", value),
      });
    });

    (filters.sources || []).forEach((value) => {
      items.push({
        id: `sources:${value}`,
        label: `Source: ${extractReadableLabel(value)}`,
        onRemove: () => removeValue("sources", value),
      });
    });

    pushOntologyItems("interaction_annotation_terms", "Interaction annotation");

    ([
      ["participant_annotation_terms_go", "Participant GO"],
      ["participant_annotation_terms_mi", "Participant MI"],
      ["participant_annotation_terms_om", "Participant OM"],
      ["participant_annotation_terms_hp", "Participant HP"],
      ["participant_annotation_terms_kw", "Participant KW"],
    ] as const).forEach(([filterKey, label]) => {
      pushOntologyItems(filterKey, label);
    });

    if (filters.has_direction === true) {
      items.push({
        id: "has_direction:true",
        label: "Directed",
        onRemove: () => setUrlFilters(enforceEntityScope({ ...filters, has_direction: undefined })),
      });
    }

    if (filters.has_direction === false) {
      items.push({
        id: "has_direction:false",
        label: "Undirected",
        onRemove: () => setUrlFilters(enforceEntityScope({ ...filters, has_direction: undefined })),
      });
    }

    if (filters.has_positive_sign === true) {
      items.push({
        id: "has_positive_sign:true",
        label: "Activation",
        onRemove: () => setUrlFilters(enforceEntityScope({ ...filters, has_positive_sign: undefined })),
      });
    }

    if (filters.has_negative_sign === true) {
      items.push({
        id: "has_negative_sign:true",
        label: "Inhibition",
        onRemove: () => setUrlFilters(enforceEntityScope({ ...filters, has_negative_sign: undefined })),
      });
    }

    return items;
  }, [enforceEntityScope, filters, onLockedEntityIdsChange, scopedEntityIds, selectedEntityById, setUrlFilters, useEntityFilters]);

  return (
    <RefinePanelLayout title="Interaction filters">
      {selectedFilterItems.length > 0 ? (
        <RefineSection title="Selected filters" defaultOpen={false}>
          <SelectedFiltersSection items={selectedFilterItems} onClearAll={handleClearFilters} />
        </RefineSection>
      ) : null}
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
