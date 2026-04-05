"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { OntologyTermLabel } from "@/features/ontology/ontology-term-label";
import { CvTermHoverCard } from "@/features/search/components/result-card";
import { RefinePanelLayout, RefineSection } from "@/features/workspace/refine/refine-panel-layout";
import { formatNumber } from "@/lib/utils";
import { useDuckDbAnnotationWorkspace } from "./context";

interface OntologySearchMatch {
  id: string;
  name?: string | null;
  ontology_id?: string | null;
  matched_text?: string | null;
  match_type?: string | null;
}

interface TreeNode {
  id: string;
  name?: string;
  children?: TreeNode[];
}

function TreePreview({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm" style={{ marginLeft: depth * 12 }}>
        <CvTermHoverCard termId={node.id}>
          <span className="cursor-help underline decoration-dotted underline-offset-2">{node.name || node.id}</span>
        </CvTermHoverCard>
      </div>
      {node.children?.length ? (
        <div className="space-y-2">
          {node.children.slice(0, depth === 0 ? 12 : 6).map((child) => (
            <TreePreview key={`${node.id}-${child.id}`} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DuckDbAnnotationRefinePane() {
  const {
    addSelectedTerm,
    availableTerms,
    clearSelectedTerms,
    error,
    focusedTermId,
    loading,
    loadingLabel,
    loadingProgress,
    materialized,
    mode,
    refreshSubset,
    removeSelectedTerm,
    resourceIds,
    selectedTerms,
    setFocusedTermId,
    setMode,
    setTermMatchMode,
    termMatchMode,
    totalCount,
  } = useDuckDbAnnotationWorkspace();

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<OntologySearchMatch[]>([]);
  const [treeRoot, setTreeRoot] = useState<TreeNode | null>(null);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/ontology/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries: [normalized], limit: 12 }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Ontology search failed (${response.status})`);
        }

        const data = (await response.json()) as { results?: Record<string, OntologySearchMatch[]> };
        setSearchResults(data.results?.[normalized] || []);
      } catch (nextError) {
        if ((nextError as Error).name === "AbortError") return;
        setSearchResults([]);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  useEffect(() => {
    if (selectedTerms.length === 0) {
      setTreeRoot(null);
      return;
    }

    const controller = new AbortController();
    void fetch("/api/ontology/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ termIds: selectedTerms }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Tree request failed (${response.status})`);
        }
        return response.json() as Promise<{ root?: TreeNode | null }>;
      })
      .then((data) => setTreeRoot(data.root || null))
      .catch((nextError) => {
        if ((nextError as Error).name === "AbortError") return;
        setTreeRoot(null);
      });

    return () => controller.abort();
  }, [selectedTerms]);

  const selectedCountLabel = useMemo(() => {
    if (!selectedTerms.length) return "No terms selected";
    return `${formatNumber(selectedTerms.length)} selected term${selectedTerms.length === 1 ? "" : "s"}`;
  }, [selectedTerms]);

  function addTypedTerm() {
    const normalized = query.trim();
    if (!normalized) return;
    addSelectedTerm(normalized);
    setQuery("");
    setSearchResults([]);
  }

  return (
    <RefinePanelLayout title="Annotation query">
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
            {materialized ? `${formatNumber(availableTerms.length)} top local terms loaded` : "Load selected resources to inspect local annotations."}
          </div>
          {error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={() => void refreshSubset()} disabled={loading}>
            {loading ? "Loading…" : materialized ? "Reload resources" : "Load resources"}
          </Button>
          <Button size="sm" variant="outline" onClick={clearSelectedTerms} disabled={selectedTerms.length === 0}>
            Clear terms
          </Button>
        </div>
      </div>

      <RefineSection title="Mode" defaultOpen>
        <div className="grid grid-cols-1 gap-2">
          <Button variant={mode === "annotations_to_entities" ? "default" : "outline"} onClick={() => setMode("annotations_to_entities")}>
            Annotations → Entities
          </Button>
          <Button variant={mode === "entities_to_annotations" ? "default" : "outline"} onClick={() => setMode("entities_to_annotations")}>
            Entities → Annotations
          </Button>
        </div>
      </RefineSection>

      {mode === "annotations_to_entities" ? (
        <>
          <RefineSection title="Term search" defaultOpen>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTypedTerm();
                    }
                  }}
                  placeholder="Search ontology label, synonym, or accession…"
                />
                <Button onClick={addTypedTerm}>Add</Button>
              </div>
              {searchResults.length > 0 ? (
                <div className="space-y-2">
                  {searchResults.map((match) => {
                    const termId = match.id || match.ontology_id || "";
                    return (
                      <button
                        key={`${termId}-${match.matched_text || match.name || termId}`}
                        type="button"
                        onClick={() => {
                          addSelectedTerm(termId);
                          setFocusedTermId(termId);
                          setQuery("");
                          setSearchResults([]);
                        }}
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

          <RefineSection title={`Selected terms · ${selectedCountLabel}`} defaultOpen>
            {selectedTerms.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedTerms.map((termId) => (
                  <button
                    key={termId}
                    type="button"
                    onClick={() => setFocusedTermId(termId)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${focusedTermId === termId ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                  >
                    <CvTermHoverCard termId={termId}>
                      <span className="cursor-help underline decoration-dotted underline-offset-2">
                        <OntologyTermLabel termId={termId} />
                      </span>
                    </CvTermHoverCard>
                    <span className="font-mono text-[11px] text-muted-foreground">{termId}</span>
                    <span
                      role="button"
                      aria-label={`Remove ${termId}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeSelectedTerm(termId);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Add one or more ontology terms to query local entity annotations.</div>
            )}
          </RefineSection>

          <RefineSection title="Matching semantics" defaultOpen>
            <div className="grid grid-cols-2 gap-2">
              <Button variant={termMatchMode === "any" ? "default" : "outline"} onClick={() => setTermMatchMode("any")}>ANY selected term</Button>
              <Button variant={termMatchMode === "all" ? "default" : "outline"} onClick={() => setTermMatchMode("all")}>ALL selected terms</Button>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {termMatchMode === "any" ? `${formatNumber(totalCount)} entities currently match at least one selected term.` : `${formatNumber(totalCount)} entities currently match every selected term.`}
            </div>
          </RefineSection>

          <RefineSection title="Merged ontology tree" defaultOpen={false}>
            {treeRoot ? (
              <TreePreview node={treeRoot} />
            ) : (
              <div className="text-sm text-muted-foreground">Select ontology terms to preview their merged hierarchy.</div>
            )}
          </RefineSection>

          <RefineSection title="Top local terms" defaultOpen={false}>
            <div className="space-y-2">
              {availableTerms.slice(0, 40).map((term) => (
                <button
                  key={term.cv_term}
                  type="button"
                  onClick={() => {
                    addSelectedTerm(term.cv_term);
                    setFocusedTermId(term.cv_term);
                  }}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium"><OntologyTermLabel termId={term.cv_term} /></div>
                    <div className="truncate text-xs text-muted-foreground">{term.cv_term}</div>
                  </div>
                  <Badge variant="outline">{formatNumber(term.entity_count)}</Badge>
                </button>
              ))}
            </div>
          </RefineSection>
        </>
      ) : (
        <RefineSection title="Coming next" defaultOpen>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Entity-set enrichment is coming next.</p>
            <p>This mode will start from a saved entity set and surface enriched annotations and ontology branches.</p>
          </div>
        </RefineSection>
      )}
    </RefinePanelLayout>
  );
}
