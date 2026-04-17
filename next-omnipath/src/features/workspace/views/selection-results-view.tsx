"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { searchInteractionsMeilisearch } from "@/lib/meilisearch/search";
import { useEntitySelection, useSelectionUrlState } from "@/lib/navigation/url-state";
import { formatNumber } from "@/lib/utils";
import { useSelectionScope } from "@/features/selection/selection-scope";
import { EntitiesResultsView } from "./entities-results-view";
import { InteractionsResultsView } from "./interactions-results-view";
import { SelectionAnnotationsView } from "./selection-annotations-view";

export function SelectionResultsView() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { tab, setTab, query, setQuery, filters, setFilters } = useSelectionUrlState();
  const { entityIds, annotationIds, selectedAnnotations } = useEntitySelection();
  const { selectedEntityIds, selectedAnnotationIds, annotationMatchedEntityIds, scopedEntityIds, isLoading } = useSelectionScope(entityIds, annotationIds);
  const [draftQuery, setDraftQuery] = useState(query);
  const [interactionsCount, setInteractionsCount] = useState<number | null>(null);

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  useEffect(() => {
    async function fetchCounts() {
      if (scopedEntityIds.length === 0) {
        setInteractionsCount(0);
        return;
      }

      try {
        const response = await searchInteractionsMeilisearch({
          query: "",
          index: "search_interactions",
          limit: 1,
          offset: 0,
          filters: { ...filters, entity_ids: scopedEntityIds },
        });
        setInteractionsCount(response.estimatedTotalHits || 0);
      } catch (error) {
        console.error("Error fetching selection interaction counts:", error);
        setInteractionsCount(0);
      }
    }

    void fetchCounts();
  }, [filters, scopedEntityIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isTypingTarget = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable;

      if (event.key === "/" && !isTypingTarget) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectionSummary = useMemo(() => {
    return [
      `${formatNumber(selectedEntityIds.length)} explicit entities`,
      `${formatNumber(selectedAnnotationIds.length)} explicit annotations`,
      `${formatNumber(annotationMatchedEntityIds.length)} annotation-matched entities`,
      `${formatNumber(scopedEntityIds.length)} entities in scope`,
    ];
  }, [annotationMatchedEntityIds.length, scopedEntityIds.length, selectedAnnotationIds.length, selectedEntityIds.length]);

  const submitSearch = () => {
    setQuery(draftQuery.trim());
  };

  const clearSelectionFilters = () => {
    setFilters({});
  };

  if (!isLoading && scopedEntityIds.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Card className="w-full max-w-2xl border-dashed">
          <CardContent className="space-y-4 py-12 text-center">
            <h1 className="text-2xl font-semibold">Selection is empty</h1>
            <p className="text-muted-foreground">
              Use Explore to add entities or annotations. Selection will scope entities, interactions, and annotations to that shared subset.
            </p>
            {selectedAnnotations.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                {selectedAnnotations.slice(0, 8).map((annotation) => (
                  <Badge key={annotation.id} variant="secondary">{annotation.label}</Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b bg-background/70 px-4 py-4 backdrop-blur-sm">
        <div className="space-y-4">
          <div className="rounded-[1.5rem] border bg-card p-3 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  type="search"
                  value={draftQuery}
                  onChange={(event) => setDraftQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitSearch();
                    }
                  }}
                  placeholder={tab === "annotations" ? "Search scoped annotations…" : tab === "interactions" ? "Search scoped interactions…" : "Search scoped entities…"}
                  className="h-14 rounded-[1.2rem] border-0 bg-muted/40 pl-12 text-base shadow-none sm:text-lg"
                />
              </div>
              <div className="flex items-center gap-2 lg:shrink-0">
                <Button onClick={submitSearch} className="h-10 rounded-xl px-4">Search</Button>
                {Object.keys(filters).length > 0 ? (
                  <Button variant="outline" onClick={clearSelectionFilters} className="h-10 rounded-xl px-4">Clear filters</Button>
                ) : null}
              </div>
            </div>

            <div className="mt-3">
              <Tabs value={tab} onValueChange={(value) => setTab(value as "entities" | "interactions" | "annotations") }>
                <TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl bg-muted/60 p-1">
                  <TabsTrigger value="entities" className="rounded-xl gap-2">
                    Entities
                    <Badge variant="secondary">{formatNumber(scopedEntityIds.length)}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="interactions" className="rounded-xl gap-2">
                    Interactions
                    <Badge variant="secondary">{interactionsCount === null ? "…" : formatNumber(interactionsCount)}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="annotations" className="rounded-xl gap-2">
                    Annotations
                    <Badge variant="secondary">{formatNumber(selectedAnnotationIds.length)}</Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {selectionSummary.map((item) => (
                  <Badge key={item} variant="secondary">{item}</Badge>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                Selection mirrors Explore, but every result is constrained to the current scoped entity set derived from explicit entities plus entities matched by selected annotations.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as "entities" | "interactions" | "annotations")} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabsContent value="entities" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <EntitiesResultsView
            lockedEntityIds={scopedEntityIds}
            hideSearchArea
            queryOverride={query}
            filtersOverride={filters}
          />
        </TabsContent>

        <TabsContent value="interactions" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <InteractionsResultsView
            lockedEntityIds={scopedEntityIds}
            filtersOverride={filters}
            setFiltersOverride={setFilters}
          />
        </TabsContent>

        <TabsContent value="annotations" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4">
          <SelectionAnnotationsView scopedEntityIds={scopedEntityIds} query={query} filters={filters} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
