"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useEntitySelection, useSelectionUrlState } from "@/lib/navigation/url-state";
import { formatNumber } from "@/lib/utils";
import { AnnotationBrowserTab } from "@/features/explore/components/annotation-browser-tab";
import { EntitiesExploreTab } from "@/features/explore/components/entities-explore-tab";
import { ExploreBrowserShell } from "@/features/explore/components/explore-browser-shell";
import { InteractionsExploreTab } from "@/features/explore/components/interactions-explore-tab";
import { useSelectionScope } from "@/features/selection/selection-scope";

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

  const submitSearch = () => {
    setQuery(draftQuery.trim());
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

  const content = tab === "entities"
    ? (
      <EntitiesExploreTab
        query={query}
        filters={filters}
        onFiltersChange={setFilters}
        scopedEntityIds={scopedEntityIds}
      />
    ) : tab === "interactions"
      ? (
        <InteractionsExploreTab
          filters={filters}
          onFilterChange={setFilters}
          onFilterCountsUpdate={() => {}}
          useInternalRefineLayout={false}
          scopedEntityIds={scopedEntityIds}
        />
      ) : (
        <AnnotationBrowserTab
          query={query}
          scopedEntityIds={scopedEntityIds}
          entityFilters={filters}
        />
      );

  return (
    <ExploreBrowserShell
      query={query}
      draftQuery={draftQuery}
      onDraftQueryChange={setDraftQuery}
      onSubmitSearch={submitSearch}
      tab={tab}
      onTabChange={setTab}
      tabs={[
        { value: "entities", label: "Entities", badge: <Badge variant="secondary">{formatNumber(scopedEntityIds.length)}</Badge> },
        { value: "interactions", label: "Interactions", badge: <Badge variant="secondary">{interactionsCount === null ? "…" : formatNumber(interactionsCount)}</Badge> },
        { value: "annotations", label: "Annotations", badge: <Badge variant="secondary">{formatNumber(selectedAnnotationIds.length)}</Badge> },
      ]}
      content={content}
      searchPlaceholder={tab === "annotations" ? "Search scoped annotations…" : tab === "interactions" ? "Search scoped interactions…" : "Search scoped entities…"}
      searchInputRef={inputRef}
      showSpeciesPicker={false}
    />
  );
}
