"use client";

import { useEffect, useMemo, useState } from "react";
import { EntityBadge } from "@/components/entity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { CvTermHoverCard } from "@/features/search/components/result-card";
import { OntologyTermLabel } from "@/features/ontology/ontology-term-label";
import { RefinePanelLayout, RefineSection } from "@/features/workspace/refine/refine-panel-layout";
import { SelectedFiltersSection, type SelectedFilterItem } from "@/features/workspace/refine/selected-filters-section";
import { useDuckDbWorkspace } from "./context";

function readableInteractionType(value: string): string {
  if (!value) return value;
  if (value.includes("|")) {
    return value
      .split("|")
      .map((part) => readableInteractionType(part.trim()))
      .join(" · ");
  }
  const match = value.match(/^(.+):([A-Z]+:\d+)$/);
  return match ? match[1] : value;
}

function signLabel(value: -1 | 0 | 1): string {
  if (value === 1) return "Activation";
  if (value === -1) return "Inhibition";
  return "Unsigned";
}

interface OntologySearchMatch {
  id: string;
  ontology_id: string;
  name?: string | null;
}

function extractOntologyId(value: string): string {
  const match = value.match(/(MI|OM|GO|HP|KW|DO|MP|CHEBI|CL|UBERON|MONDO):\d{4,}|WP\d+|R-[A-Z]+-\d+/);
  return match?.[0] || value;
}

function FilterCheckboxRow({
  checked,
  label,
  count,
  onToggle,
}: {
  checked: boolean;
  label: string;
  count?: number;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5 text-sm">
      <div className="flex min-w-0 items-start gap-2">
        <Checkbox checked={checked} onCheckedChange={onToggle} />
        <span className="break-words">{label}</span>
      </div>
      {typeof count === "number" ? <Badge variant="outline">{count}</Badge> : null}
    </label>
  );
}

export function DuckDbRefinePane() {
  const {
    clearLocalFilters,
    datasetSource,
    durationMs,
    entitySummaries,
    facets,
    loading,
    loadingLabel,
    loadingProgress,
    localFilters,
    materialized,
    refreshSubset,
    rowCount,
    serverEntityScope,
    setIsDirected,
    toggleAnnotationTerm,
    toggleLocalFacet,
    toggleSign,
  } = useDuckDbWorkspace();
  const [annotationQuery, setAnnotationQuery] = useState("");
  const [annotationScope, setAnnotationScope] = useState<"interaction_annotation_terms" | "participant_annotation_terms">("interaction_annotation_terms");
  const [ontologySearchOptions, setOntologySearchOptions] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    const query = annotationQuery.trim();
    if (!query) {
      setOntologySearchOptions([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/ontology/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries: [query], limit: 25 }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Ontology search failed (${response.status})`);
        }

        const data = (await response.json()) as { results?: Record<string, OntologySearchMatch[]> };
        const matches = data.results?.[query] || [];
        setOntologySearchOptions(
          matches.map((match) => ({
            value: match.id || match.ontology_id,
            label: match.name || match.id || match.ontology_id,
          })),
        );
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.error("Ontology search failed", error);
        setOntologySearchOptions([]);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [annotationQuery]);

  const selectedFilterItems = useMemo<SelectedFilterItem[]>(() => {
    const items: SelectedFilterItem[] = [];

    serverEntityScope.forEach((entityId) => {
      const entity = entitySummaries.get(entityId);
      items.push({
        id: `entity-scope:${entityId}`,
        label: (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Entity</span>
            <div className="min-w-[140px] max-w-[240px]">
              <EntityBadge
                displayName={entity?.display_name || entityId}
                canonicalIdentifier={entity?.canonical_identifier || entityId}
                entityId={entity?.id || entityId}
                entityType={entity?.entity_type_name}
              />
            </div>
          </div>
        ),
      });
    });

    localFilters.interaction_types.forEach((value) => {
      items.push({
        id: `interaction-type:${value}`,
        label: `Interaction type: ${readableInteractionType(value)}`,
        onRemove: () => toggleLocalFacet("interaction_types", value),
      });
    });

    localFilters.sources.forEach((value) => {
      items.push({
        id: `source:${value}`,
        label: `Source: ${value}`,
        onRemove: () => toggleLocalFacet("sources", value),
      });
    });

    if (localFilters.is_directed === true) {
      items.push({
        id: "is-directed:true",
        label: "Directed",
        onRemove: () => setIsDirected(undefined),
      });
    }

    if (localFilters.is_directed === false) {
      items.push({
        id: "is-directed:false",
        label: "Undirected",
        onRemove: () => setIsDirected(undefined),
      });
    }

    localFilters.signs.forEach((value) => {
      items.push({
        id: `sign:${value}`,
        label: signLabel(value),
        onRemove: () => toggleSign(value),
      });
    });

    localFilters.interaction_annotation_terms.forEach((value) => {
      const termId = extractOntologyId(value);
      items.push({
        id: `interaction-annotation:${value}`,
        label: (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Interaction annotation</span>
            <CvTermHoverCard termId={termId}>
              <span className="cursor-help underline decoration-dotted underline-offset-2">
                <OntologyTermLabel termId={termId} />
              </span>
            </CvTermHoverCard>
          </div>
        ),
        onRemove: () => toggleAnnotationTerm("interaction_annotation_terms", value),
      });
    });

    localFilters.participant_annotation_terms.forEach((value) => {
      const termId = extractOntologyId(value);
      items.push({
        id: `participant-annotation:${value}`,
        label: (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Participant annotation</span>
            <CvTermHoverCard termId={termId}>
              <span className="cursor-help underline decoration-dotted underline-offset-2">
                <OntologyTermLabel termId={termId} />
              </span>
            </CvTermHoverCard>
          </div>
        ),
        onRemove: () => toggleAnnotationTerm("participant_annotation_terms", value),
      });
    });

    return items;
  }, [entitySummaries, localFilters, serverEntityScope, setIsDirected, toggleAnnotationTerm, toggleLocalFacet, toggleSign]);

  return (
    <RefinePanelLayout title="Interaction filters">
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
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void refreshSubset()} disabled={loading}>
              {loading ? "Loading…" : materialized ? "Refresh from server" : "Materialize subset"}
            </Button>
            <Button size="sm" variant="outline" onClick={clearLocalFilters}>
              Clear local filters
            </Button>
          </div>
        </div>

      <RefineSection title="Interaction properties">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Directedness</p>
            <div className="space-y-1">
              <FilterCheckboxRow
                checked={localFilters.is_directed === true}
                label="Directed only"
                onToggle={() => setIsDirected(localFilters.is_directed === true ? undefined : true)}
              />
              <FilterCheckboxRow
                checked={localFilters.is_directed === false}
                label="Undirected only"
                onToggle={() => setIsDirected(localFilters.is_directed === false ? undefined : false)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Sign</p>
            <div className="space-y-1">
              {[
                { value: 1 as const, label: "Activation" },
                { value: 0 as const, label: "Unsigned" },
                { value: -1 as const, label: "Inhibition" },
              ].map((option) => (
                <FilterCheckboxRow
                  key={option.value}
                  checked={localFilters.signs.includes(option.value)}
                  label={option.label}
                  count={facets.sign.find((item) => item.value === String(option.value))?.count}
                  onToggle={() => toggleSign(option.value)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Interaction type</p>
            <div className="max-h-64 space-y-1 overflow-y-auto pr-2">
              {facets.interaction_type.length > 0 ? (
                facets.interaction_type.map((bucket) => (
                  <FilterCheckboxRow
                    key={bucket.value}
                    checked={localFilters.interaction_types.includes(bucket.value)}
                    label={readableInteractionType(bucket.value)}
                    count={bucket.count}
                    onToggle={() => toggleLocalFacet("interaction_types", bucket.value)}
                  />
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No values</div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Sources</p>
            <div className="max-h-64 space-y-1 overflow-y-auto pr-2">
              {facets.sources.length > 0 ? (
                facets.sources.map((bucket) => (
                  <FilterCheckboxRow
                    key={bucket.value}
                    checked={localFilters.sources.includes(bucket.value)}
                    label={bucket.value}
                    count={bucket.count}
                    onToggle={() => toggleLocalFacet("sources", bucket.value)}
                  />
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No values</div>
              )}
            </div>
          </div>
        </div>
      </RefineSection>

      <RefineSection title="Annotations">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={annotationScope === "interaction_annotation_terms" ? "default" : "outline"}
              onClick={() => setAnnotationScope("interaction_annotation_terms")}
            >
              Interaction annotations
            </Button>
            <Button
              size="sm"
              variant={annotationScope === "participant_annotation_terms" ? "default" : "outline"}
              onClick={() => setAnnotationScope("participant_annotation_terms")}
            >
              Participant annotations
            </Button>
          </div>

          <div className="space-y-2">
            <Input
              value={annotationQuery}
              onChange={(event) => setAnnotationQuery(event.target.value)}
              placeholder="Search ontology terms"
            />
            {annotationQuery.trim().length > 0 ? (
              <div className="max-h-64 space-y-1 overflow-y-auto pr-2">
                {ontologySearchOptions.length > 0 ? (
                  ontologySearchOptions.map((option) => {
                    const checked = localFilters[annotationScope].includes(option.value);
                    const termId = extractOntologyId(option.value);
                    return (
                      <label key={`${annotationScope}:${option.value}`} className="flex cursor-pointer items-start gap-2 py-1.5 text-sm">
                        <Checkbox checked={checked} onCheckedChange={() => toggleAnnotationTerm(annotationScope, option.value)} />
                        <CvTermHoverCard termId={termId}>
                          <span className="cursor-help underline decoration-dotted underline-offset-2">
                            {option.label}
                          </span>
                        </CvTermHoverCard>
                      </label>
                    );
                  })
                ) : (
                  <div className="text-sm text-muted-foreground">No ontology matches</div>
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Selected {annotationScope === "interaction_annotation_terms" ? "interaction" : "participant"} annotation terms</p>
            <div className="space-y-1">
              {localFilters[annotationScope].length > 0 ? (
                localFilters[annotationScope].map((value) => {
                  const termId = extractOntologyId(value);
                  return (
                    <label key={`${annotationScope}-selected:${value}`} className="flex cursor-pointer items-start gap-2 py-1.5 text-sm">
                      <Checkbox checked onCheckedChange={() => toggleAnnotationTerm(annotationScope, value)} />
                      <CvTermHoverCard termId={termId}>
                        <span className="cursor-help underline decoration-dotted underline-offset-2">
                          <OntologyTermLabel termId={termId} />
                        </span>
                      </CvTermHoverCard>
                    </label>
                  );
                })
              ) : (
                <div className="text-sm text-muted-foreground">No annotation terms selected</div>
              )}
            </div>
          </div>
        </div>
      </RefineSection>
    </RefinePanelLayout>
  );
}
