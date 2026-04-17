"use client";

import { useEntitySelection, useSelectionUrlState } from "@/lib/navigation/url-state";
import { EntitiesRefinePanel } from "./entities-refine-panel";
import { InteractionsRefinePanel } from "./interactions-refine-panel";
import { SelectionAnnotationsRefinePanel } from "./selection-annotations-refine-panel";
import { useSelectionScope } from "@/features/selection/selection-scope";

export function SelectionRefinePanel() {
  const { query, filters, setFilters, tab } = useSelectionUrlState();
  const { entityIds, annotationIds } = useEntitySelection();
  const { scopedEntityIds } = useSelectionScope(entityIds, annotationIds);

  if (tab === "interactions") {
    return (
      <InteractionsRefinePanel
        lockedEntityIds={scopedEntityIds}
        filtersOverride={filters}
        setFiltersOverride={setFilters}
      />
    );
  }

  if (tab === "annotations") {
    return (
      <SelectionAnnotationsRefinePanel
        scopedEntityIds={scopedEntityIds}
        query={query}
        filters={filters}
        setFilters={setFilters}
      />
    );
  }

  return (
    <EntitiesRefinePanel
      lockedEntityIds={scopedEntityIds}
      queryOverride={query}
      filtersOverride={filters}
      setFiltersOverride={setFilters}
    />
  );
}
