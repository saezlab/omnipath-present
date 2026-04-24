"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Database, Tag, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useEntitySelection, useSelectionUrlState } from "@/lib/navigation/url-state";
import { AnnotationBrowserTab } from "@/features/explore/components/annotation-browser-tab";
import { EntitiesExploreTab } from "@/features/explore/components/entities-explore-tab";
import { ExploreBrowserShell } from "@/features/explore/components/explore-browser-shell";
import { RelationsExploreTab } from "@/features/explore/components/relations-explore-tab";
import { useSelectionScope } from "@/features/selection/selection-scope";

export function SelectionResultsView() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { tab, setTab, query, setQuery, filters, setFilters } = useSelectionUrlState();
  const {
    entityIds,
    annotationIds,
    selectedEntities,
    selectedAnnotations,
    removeEntity,
    removeAnnotation,
    clearSelection,
  } = useEntitySelection();
  const shouldResolveAnnotationEntities = tab !== "interactions";
  const { selectedEntityIds, selectedAnnotationIds, scopedEntityIds, isLoading } = useSelectionScope(entityIds, annotationIds, {
    resolveAnnotationEntities: shouldResolveAnnotationEntities,
  });
  const [draftQuery, setDraftQuery] = useState(query);

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

  const isInteractionSelectionEmpty = selectedEntityIds.length === 0 && selectedAnnotationIds.length === 0;
  const hasSelection = selectedEntities.length > 0 || selectedAnnotations.length > 0;

  const selectionSheetContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b bg-muted/20 px-6 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border bg-background/70 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Database className="size-4 text-primary" />
              Entities
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{selectedEntities.length}</div>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Tag className="size-4 text-primary" />
              CV terms
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{selectedAnnotations.length}</div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Selected items</h3>
            <p className="text-xs text-muted-foreground">Remove individual entries or clear the whole selection.</p>
          </div>
          <Button variant="outline" size="sm" onClick={clearSelection} className="h-8 shrink-0 gap-1.5">
            <Trash2 className="size-3.5" />
            Clear all
          </Button>
        </div>

        <div className="space-y-6">
          {selectedEntities.length > 0 ? (
            <section className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Database className="size-3.5" />
                Entities
              </div>
              <div className="space-y-2">
                {selectedEntities.map((entity) => (
                  <div key={entity.id} className="group flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {(entity.name || entity.id).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{entity.name || entity.id}</div>
                      <div className="mt-1 flex items-center gap-2">
                        {entity.type ? <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[10px] uppercase">{entity.type}</Badge> : null}
                        <span className="truncate font-mono text-xs text-muted-foreground">{entity.id}</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${entity.name || entity.id}`}
                      onClick={() => removeEntity(entity.id)}
                      className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {selectedAnnotations.length > 0 ? (
            <section className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Tag className="size-3.5" />
                CV terms
              </div>
              <div className="space-y-2">
                {selectedAnnotations.map((annotation) => (
                  <div key={annotation.id} className="group flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                      {annotation.namespace?.slice(0, 2).toUpperCase() || "CV"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{annotation.label || annotation.id}</div>
                      <div className="mt-1 flex items-center gap-2">
                        {annotation.namespace ? <Badge variant="outline" className="h-5 rounded-md px-1.5 font-mono text-[10px] uppercase">{annotation.namespace}</Badge> : null}
                        <span className="truncate font-mono text-xs text-muted-foreground">{annotation.id}</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${annotation.label || annotation.id}`}
                      onClick={() => removeAnnotation(annotation.id)}
                      className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );

  const selectionFooterCta = hasSelection ? (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="lg" className="fixed bottom-6 right-6 z-40 h-12 rounded-full px-4 shadow-lg">
          <span>Open Selection</span>
          <Badge variant="secondary" className="ml-2 rounded-full px-2 py-0.5 text-xs">
            {selectedEntities.length + selectedAnnotations.length}
          </Badge>
          <ArrowRight className="ml-2 size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[92vw] gap-0 overflow-hidden p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <SheetTitle className="text-xl">Current selection</SheetTitle>
          <SheetDescription>
            This selection scopes the entities, interactions, and annotations tabs.
          </SheetDescription>
        </SheetHeader>
        {selectionSheetContent}
      </SheetContent>
    </Sheet>
  ) : null;

  if (!isLoading && ((tab === "interactions" && isInteractionSelectionEmpty) || (tab !== "interactions" && scopedEntityIds.length === 0))) {
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
        <RelationsExploreTab
          filters={filters}
          onFilterChange={setFilters}
          useInternalRefineLayout={false}
          scopedEntityIds={selectedEntityIds}
          scopedAnnotationIds={selectedAnnotationIds}
        />
      ) : (
        <AnnotationBrowserTab
          query={query}
          scopedEntityIds={scopedEntityIds}
          filters={filters}
          onFiltersChange={setFilters}
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
        { value: "entities", label: "Entities" },
        { value: "interactions", label: "Interactions" },
        { value: "annotations", label: "Annotations" },
      ]}
      content={content}
      searchPlaceholder={tab === "annotations" ? "Search scoped annotations…" : tab === "interactions" ? "Search scoped interactions…" : "Search scoped entities…"}
      searchInputRef={inputRef}
      showSpeciesPicker={false}
      footerCta={selectionFooterCta}
    />
  );
}
