"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefinePanelLayout, RefineSection } from "./refine-panel-layout";
import { useSearchUrlState, useEntitySelection } from "@/lib/navigation/url-state";
import { EntitiesRefinePanel } from "./entities-refine-panel";
import { searchMeilisearch } from "@/features/search/api/queries";
import type { SearchResult } from "@/features/search/components/result-card";
import { OntologyTermLabel } from "@/features/ontology/ontology-term-label";
import { CvTermHoverCard } from "@/features/search/components/result-card";

interface OntologySearchMatch {
  id: string;
  name?: string | null;
  ontology_id?: string | null;
  matched_text?: string | null;
  match_type?: string | null;
}

export function EntityWorkflowRefinePanel() {
  const { entityWorkflow, setEntityWorkflow, filters, setFilters } = useSearchUrlState();
  const { addEntity, isSelected, removeEntity, selectedEntities } = useEntitySelection();
  const [termQuery, setTermQuery] = useState("");
  const [termResults, setTermResults] = useState<OntologySearchMatch[]>([]);
  const [entityQuery, setEntityQuery] = useState("");
  const [entityResults, setEntityResults] = useState<SearchResult[]>([]);
  const [entityLoading, setEntityLoading] = useState(false);

  const selectedTerms = useMemo(() => filters.ontology_terms || [], [filters.ontology_terms]);

  useEffect(() => {
    const normalized = termQuery.trim();
    if (!normalized || entityWorkflow !== "annotations_to_entities") {
      setTermResults([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/terms/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries: [normalized], limit: 12 }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Ontology search failed (${response.status})`);
        const data = (await response.json()) as { results?: Record<string, OntologySearchMatch[]> };
        setTermResults(data.results?.[normalized] || []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setTermResults([]);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [entityWorkflow, termQuery]);

  useEffect(() => {
    const normalized = entityQuery.trim();
    if (entityWorkflow !== "entities_to_annotations" || normalized.length < 2) {
      setEntityResults([]);
      setEntityLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setEntityLoading(true);
        const response = await searchMeilisearch({
          query: normalized,
          index: "search_entities",
          limit: 8,
          offset: 0,
          filters: {},
        });
        if (!cancelled) {
          setEntityResults((response.hits as SearchResult[]) || []);
        }
      } catch {
        if (!cancelled) setEntityResults([]);
      } finally {
        if (!cancelled) setEntityLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [entityQuery, entityWorkflow]);

  function addSelectedTerm(termId: string) {
    const normalized = termId.trim();
    if (!normalized || selectedTerms.includes(normalized)) return;
    setFilters({ ...filters, ontology_terms: [...selectedTerms, normalized] });
    setTermQuery("");
    setTermResults([]);
  }

  function removeSelectedTerm(termId: string) {
    const nextTerms = selectedTerms.filter((term) => term !== termId);
    setFilters({ ...filters, ontology_terms: nextTerms.length > 0 ? nextTerms : undefined });
  }

  if (entityWorkflow === "direct_lookup") {
    return <EntitiesRefinePanel />;
  }

  if (entityWorkflow === "annotations_to_entities") {
    return (
      <RefinePanelLayout title="Annotations → Entities">
        <RefineSection title="Workflow" defaultOpen>
          <div className="space-y-2 text-sm">
            <div className="text-muted-foreground">Start with ontology terms, then review matching entities in the results pane.</div>
            <Button variant="outline" size="sm" onClick={() => setEntityWorkflow("direct_lookup")}>Switch to direct lookup</Button>
          </div>
        </RefineSection>

        <RefineSection title="Term search" defaultOpen>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={termQuery}
                onChange={(event) => setTermQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSelectedTerm(termQuery);
                  }
                }}
                placeholder="Search ontology label, synonym, or accession…"
              />
              <Button onClick={() => addSelectedTerm(termQuery)}>Add</Button>
            </div>
            {termResults.length > 0 ? (
              <div className="space-y-2">
                {termResults.map((match) => {
                  const termId = match.id || match.ontology_id || "";
                  return (
                    <button
                      key={`${termId}-${match.matched_text || match.name || termId}`}
                      type="button"
                      onClick={() => addSelectedTerm(termId)}
                      className="flex w-full items-start justify-between rounded-md border px-3 py-2 text-left hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{match.name || termId}</div>
                        <div className="truncate text-xs text-muted-foreground">{termId}</div>
                      </div>
                      {match.match_type ? <Badge variant="outline">{match.match_type}</Badge> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </RefineSection>

        <RefineSection title={`Selected terms · ${selectedTerms.length}`} defaultOpen>
          {selectedTerms.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedTerms.map((termId) => (
                <button
                  key={termId}
                  type="button"
                  onClick={() => removeSelectedTerm(termId)}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:bg-muted/40"
                  title="Remove term"
                >
                  <CvTermHoverCard termId={termId}>
                    <span className="cursor-help underline decoration-dotted underline-offset-2">
                      <OntologyTermLabel termId={termId} />
                    </span>
                  </CvTermHoverCard>
                  <span className="font-mono text-[11px] text-muted-foreground">{termId}</span>
                  <span className="text-muted-foreground">×</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No ontology terms selected yet.</div>
          )}
        </RefineSection>

      </RefinePanelLayout>
    );
  }

  return (
    <RefinePanelLayout title="Entities → Annotations">
      <RefineSection title="Workflow" defaultOpen>
        <div className="space-y-2 text-sm">
          <div className="text-muted-foreground">Search for entities, add them to selection, then summarize their annotations in the results pane.</div>
          <Button variant="outline" size="sm" onClick={() => setEntityWorkflow("direct_lookup")}>Switch to direct lookup</Button>
        </div>
      </RefineSection>

      <RefineSection title="Entity search" defaultOpen>
        <div className="space-y-3">
          <Input
            value={entityQuery}
            onChange={(event) => setEntityQuery(event.target.value)}
            placeholder="Search entities to add…"
          />
          {entityLoading ? <div className="text-sm text-muted-foreground">Searching…</div> : null}
          {entityResults.length > 0 ? (
            <div className="space-y-2">
              {entityResults.map((result) => {
                const entityId = String(result.entity_id ?? result.id ?? "").trim();
                if (!entityId) return null;
                const selected = isSelected(entityId);
                const displayName = result.gene_symbols?.[0] || result.names?.[0] || entityId;
                return (
                  <div key={entityId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{displayName}</div>
                      <div className="truncate text-xs text-muted-foreground">{entityId}</div>
                    </div>
                    <Button
                      size="sm"
                      variant={selected ? "outline" : "default"}
                      onClick={() => {
                        if (selected) {
                          removeEntity(entityId);
                          return;
                        }
                        addEntity({
                          id: entityId,
                          entityId,
                          name: displayName,
                          type: typeof result.entity_type === "string" ? result.entity_type : undefined,
                          cv_terms: result.cv_terms,
                          fullResult: result,
                        });
                      }}
                    >
                      {selected ? "Remove" : "Add"}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : entityQuery.trim().length >= 2 && !entityLoading ? (
            <div className="text-sm text-muted-foreground">No entities matched that query.</div>
          ) : null}
        </div>
      </RefineSection>

      <RefineSection title={`Selected entity set · ${selectedEntities.length}`} defaultOpen>
        {selectedEntities.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selectedEntities.map((entity) => {
              const entityId = String(entity.entityId ?? entity.id);
              return (
                <button
                  key={entityId}
                  type="button"
                  onClick={() => removeEntity(entityId)}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm hover:bg-muted/40"
                  title="Remove from selection"
                >
                  <span>{entity.name}</span>
                  <span className="text-muted-foreground">×</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No entities added yet.</div>
        )}
      </RefineSection>
    </RefinePanelLayout>
  );
}
