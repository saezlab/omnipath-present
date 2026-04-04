"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { OntologyTermLabel } from "@/features/ontology/ontology-term-label";
import { CvTermHoverCard } from "@/features/search/components/result-card";
import { RefinePanelLayout, RefineSection } from "@/features/workspace/refine/refine-panel-layout";
import { SelectedFiltersSection, type SelectedFilterItem } from "@/features/workspace/refine/selected-filters-section";
import { useMemo, type ReactNode } from "react";
import { useDuckDbResourceWorkspace } from "./context";

function splitLabelAndId(value: string): { label: string; id?: string } {
  const normalized = value.trim();
  const accessionFirst = normalized.match(/^([A-Z]+:\d+):(.+)$/);
  if (accessionFirst) return { id: accessionFirst[1], label: accessionFirst[2] };
  const accessionLast = normalized.match(/^(.*?):([A-Z]+:\d+)$/);
  if (accessionLast) return { label: accessionLast[1], id: accessionLast[2] };
  return { label: value };
}

function renderCvLabel(value: string): ReactNode {
  const { label, id } = splitLabelAndId(value);
  if (!id) return label;
  return (
    <CvTermHoverCard termId={id}>
      <span className="cursor-help underline decoration-dotted underline-offset-2">
        <OntologyTermLabel termId={id} />
      </span>
    </CvTermHoverCard>
  );
}

function renderInteractionType(value: string): ReactNode {
  if (!value) return value;
  const parts = value.split("|").map((part) => part.trim()).filter(Boolean);
  return (
    <span>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 ? " · " : null}
          {renderCvLabel(part)}
        </span>
      ))}
    </span>
  );
}

function signLabel(value: -1 | 0 | 1): string {
  if (value === 1) return "Activation";
  if (value === -1) return "Inhibition";
  return "Unsigned";
}

function FilterButton({ active, label, count, onClick }: { active: boolean; label: ReactNode; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${active ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
    >
      <span>{label}</span>
      {typeof count === "number" ? <Badge variant="outline">{count}</Badge> : null}
    </button>
  );
}

export function DuckDbResourceRefinePane() {
  const {
    clearLocalFilters,
    facets,
    loading,
    loadingLabel,
    loadingProgress,
    localFilters,
    materialized,
    refreshSubset,
    resourceIds,
    rowCount,
    setIsDirected,
    toggleLocalFacet,
    toggleSign,
  } = useDuckDbResourceWorkspace();

  const selectedFilterItems = useMemo<SelectedFilterItem[]>(() => {
    const items: SelectedFilterItem[] = [];

    localFilters.sources.forEach((value) => {
      items.push({
        id: `source:${value}`,
        label: `Resource/source: ${value}`,
        onRemove: () => toggleLocalFacet("sources", value),
      });
    });

    localFilters.interaction_types.forEach((value) => {
      items.push({
        id: `interaction-type:${value}`,
        label: <span>Interaction type: {renderInteractionType(value)}</span>,
        onRemove: () => toggleLocalFacet("interaction_types", value),
      });
    });

    if (localFilters.is_directed === true) {
      items.push({ id: "directed:true", label: "Directed", onRemove: () => setIsDirected(undefined) });
    }
    if (localFilters.is_directed === false) {
      items.push({ id: "directed:false", label: "Undirected", onRemove: () => setIsDirected(undefined) });
    }

    localFilters.signs.forEach((value) => {
      items.push({
        id: `sign:${value}`,
        label: signLabel(value),
        onRemove: () => toggleSign(value),
      });
    });

    return items;
  }, [localFilters, setIsDirected, toggleLocalFacet, toggleSign]);

  return (
    <RefinePanelLayout title="Resource filters">
      {selectedFilterItems.length > 0 ? (
        <RefineSection title="Selected filters" defaultOpen={false}>
          <SelectedFiltersSection items={selectedFilterItems} onClearAll={clearLocalFilters} />
        </RefineSection>
      ) : null}

      <div className="space-y-3 text-sm">
        {loading && loadingLabel ? (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{loadingLabel}</span>
              {typeof loadingProgress === "number" ? <span className="text-muted-foreground">{loadingProgress}%</span> : null}
            </div>
            {typeof loadingProgress === "number" ? <Progress value={loadingProgress} /> : null}
          </div>
        ) : null}

        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-sm font-medium">Selected resources</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {resourceIds.map((resourceId) => <Badge key={resourceId} variant="outline">{resourceId}</Badge>)}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {typeof rowCount === "number" ? `${rowCount.toLocaleString()} interaction rows loaded` : "Loading row counts…"}
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={() => void refreshSubset()} disabled={loading}>
            {loading ? "Loading…" : materialized ? "Reload resources" : "Load resources"}
          </Button>
          <Button size="sm" variant="outline" onClick={clearLocalFilters}>
            Clear local filters
          </Button>
        </div>
      </div>

      <RefineSection title="Direction" defaultOpen>
        <div className="space-y-2">
          <FilterButton active={localFilters.is_directed === true} label="Directed" onClick={() => setIsDirected(localFilters.is_directed === true ? undefined : true)} />
          <FilterButton active={localFilters.is_directed === false} label="Undirected" onClick={() => setIsDirected(localFilters.is_directed === false ? undefined : false)} />
        </div>
      </RefineSection>

      <RefineSection title="Sign" defaultOpen>
        <div className="space-y-2">
          {([1, -1, 0] as const).map((value) => (
            <FilterButton
              key={value}
              active={localFilters.signs.includes(value)}
              label={signLabel(value)}
              count={facets.sign.find((bucket) => Number(bucket.value) === value)?.count}
              onClick={() => toggleSign(value)}
            />
          ))}
        </div>
      </RefineSection>

      <RefineSection title="Interaction type" defaultOpen>
        <div className="space-y-2">
          {facets.interaction_type.map((bucket) => (
            <FilterButton
              key={bucket.value}
              active={localFilters.interaction_types.includes(bucket.value)}
              label={renderInteractionType(bucket.value)}
              count={bucket.count}
              onClick={() => toggleLocalFacet("interaction_types", bucket.value)}
            />
          ))}
        </div>
      </RefineSection>

      <RefineSection title="Resource / source" defaultOpen>
        <div className="space-y-2">
          {facets.sources.map((bucket) => (
            <FilterButton
              key={bucket.value}
              active={localFilters.sources.includes(bucket.value)}
              label={bucket.value}
              count={bucket.count}
              onClick={() => toggleLocalFacet("sources", bucket.value)}
            />
          ))}
        </div>
      </RefineSection>
    </RefinePanelLayout>
  );
}
