"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Download, Filter, Tag, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { searchOntologyTerms, searchScopedOntologyTerms, getOntologyPrefixes, type ScopedOntologyTerm } from "@/lib/queries/ontology-term";
import { getEntitiesByPublicIds } from "@/lib/queries/entity";
import { materializeAnnotationsSubset } from "@/lib/subsets/client";
import type { OntologyTerm } from "@next-omnipath/drizzle";
import { useEntitySelection } from "@/lib/navigation/url-state";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCallback, useMemo, useState } from "react";

interface AnnotationBrowserTabProps {
  query: string;
  species?: string;
  scopedEntityIds?: string[];
  filters?: import("@/types/search").SearchFilters;
  onFiltersChange?: (filters: import("@/types/search").SearchFilters) => void;
  entityFilters?: import("@/types/search").SearchFilters;
}

function LoadingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="h-48 animate-pulse rounded-2xl border bg-muted/30" />
      ))}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <div className="text-lg font-semibold">{title}</div>
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function AnnotationCards({ results }: { results: Array<OntologyTerm | ScopedOntologyTerm> }) {
  const { addAnnotation, isAnnotationSelected, removeAnnotation } = useEntitySelection();

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {results.map((term) => {
        const selected = isAnnotationSelected(term.termId);

        return (
          <Card key={term.termId} className="h-full transition-shadow hover:shadow-sm">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base leading-tight">{term.label || term.termId}</CardTitle>
                  <CardDescription className="font-mono text-xs">{term.termId}</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  onClick={() => {
                    if (selected) {
                      removeAnnotation(term.termId);
                      return;
                    }
                    addAnnotation({
                      id: term.termId,
                      label: term.label || term.termId,
                      namespace: term.ontologyPrefix || undefined,
                      definition: term.definition,
                    });
                  }}
                  className="shrink-0"
                >
                  {selected ? <Check className="size-4" /> : <Tag className="size-4" />}
                  {selected ? "Selected" : "Add"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {term.ontologyPrefix ? <Badge variant="outline">{term.ontologyPrefix}</Badge> : null}
                {"annotatedEntityCount" in term ? (
                  <Badge variant="secondary">{term.annotatedEntityCount.toLocaleString()} entities</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <p className="line-clamp-4 text-sm text-muted-foreground">
                {term.definition || "No definition available for this ontology term."}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AnnotationFilterSidebar({
  prefixes,
  selectedPrefixes,
  onTogglePrefix,
  onClearFilters,
  isMobile = false,
}: {
  prefixes: string[];
  selectedPrefixes: string[];
  onTogglePrefix: (prefix: string) => void;
  onClearFilters: () => void;
  isMobile?: boolean;
}) {
  const activeFilterCount = selectedPrefixes.length;
  const content = (
    <div className="space-y-6">
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Ontology prefixes</h4>
        <div className="space-y-1 max-h-[calc(100vh-14rem)] overflow-y-auto pr-2">
          {prefixes.map((prefix) => (
            <div key={prefix} className="flex items-center justify-between py-0.5 gap-2">
              <Label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-normal leading-5 text-foreground">
                <Checkbox
                  checked={selectedPrefixes.includes(prefix)}
                  onCheckedChange={() => onTogglePrefix(prefix)}
                  className={selectedPrefixes.includes(prefix) ? "border-primary" : ""}
                />
                <span className="truncate font-mono text-xs">{prefix}</span>
              </Label>
            </div>
          ))}
          {prefixes.length === 0 ? <p className="text-sm text-muted-foreground">Loading prefixes…</p> : null}
        </div>
      </div>
    </div>
  );

  if (isMobile) return content;

  return (
    <Card className="h-full overflow-hidden flex flex-col">
      <CardHeader className="border-b flex-shrink-0 h-[57px] flex items-center py-3">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">Filters</h3>
          </div>
          {activeFilterCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
              Clear all ({activeFilterCount})
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto py-4">
        {content}
      </CardContent>
    </Card>
  );
}

export function AnnotationBrowserTab({ query, scopedEntityIds, filters, onFiltersChange }: AnnotationBrowserTabProps) {
  const isMobile = useIsMobile();
  const isScoped = !!scopedEntityIds?.length;
  const [localSelectedPrefixes, setLocalSelectedPrefixes] = useState<string[]>([]);
  const selectedPrefixes = filters?.ontology_prefixes || localSelectedPrefixes;
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data: prefixes } = useQuery({
    queryKey: ["ontology-prefixes"],
    queryFn: getOntologyPrefixes,
    staleTime: 60_000,
  });

  const {
    data: results,
    loading: isLoading,
    loadingMore,
    hasMore,
    sentinelRef,
  } = useInfiniteScroll<OntologyTerm>({
    fetchData: useCallback(async (offset: number, limit: number) => {
      const page = isScoped
        ? await searchScopedOntologyTerms({
            entityIds: scopedEntityIds || [],
            query,
            prefixes: selectedPrefixes.length > 0 ? selectedPrefixes : undefined,
            limit,
            offset,
          })
        : await searchOntologyTerms({
            query,
            prefixes: selectedPrefixes.length > 0 ? selectedPrefixes : undefined,
            limit,
            offset,
          });

      return { results: page };
    }, [isScoped, query, scopedEntityIds, selectedPrefixes]),
    pageSize: 30,
    dependencies: [query, selectedPrefixes, scopedEntityIds, isScoped],
    queryKey: ["explore-annotations", query, selectedPrefixes, scopedEntityIds],
    root: isMobile ? null : scrollRoot,
  });

  const prefixOptions = useMemo(() => prefixes || [], [prefixes]);

  const setSelectedPrefixes = useCallback((next: string[]) => {
    if (onFiltersChange) {
      onFiltersChange({
        ...(filters || {}),
        ontology_prefixes: next.length > 0 ? next : undefined,
      });
      return;
    }
    setLocalSelectedPrefixes(next);
  }, [filters, onFiltersChange]);

  const togglePrefix = (prefix: string) => {
    const next = selectedPrefixes.includes(prefix)
      ? selectedPrefixes.filter((p) => p !== prefix)
      : [...selectedPrefixes, prefix];
    setSelectedPrefixes(next);
  };

  const handleExport = useCallback(async () => {
    try {
      setExportError(null);
      const scopedEntities = isScoped && scopedEntityIds?.length
        ? await getEntitiesByPublicIds(scopedEntityIds)
        : [];
      const artifact = await materializeAnnotationsSubset(
        {
          ...(selectedPrefixes.length > 0 ? { prefixes: selectedPrefixes } : {}),
          ...(scopedEntities.length > 0 ? { entity_pks: scopedEntities.map((entity) => entity.entityPk) } : {}),
        },
        query || "",
      );

      const link = document.createElement("a");
      link.href = artifact.objectUrl;
      link.download = artifact.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(artifact.objectUrl);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to export annotations");
    }
  }, [isScoped, query, scopedEntityIds, selectedPrefixes]);

  const filterPane = (
    <AnnotationFilterSidebar
      prefixes={prefixOptions}
      selectedPrefixes={selectedPrefixes}
      onTogglePrefix={togglePrefix}
      onClearFilters={() => setSelectedPrefixes([])}
      isMobile={isMobile}
    />
  );

  const resultsPane = (
    <div ref={setScrollRoot} className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {selectedPrefixes.length > 0 ? `${selectedPrefixes.length} prefix filter${selectedPrefixes.length === 1 ? "" : "s"} active` : "All ontology prefixes"}
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
          <Download className="size-4" />
          Export
        </Button>
      </div>
      {exportError ? <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{exportError}</div> : null}
      {isLoading && results.length === 0 ? (
        <LoadingGrid />
      ) : results.length > 0 ? (
        <div className="space-y-4">
          <AnnotationCards results={results} />
          <div
            ref={sentinelRef as React.RefObject<HTMLDivElement>}
            className="flex justify-center py-4"
            style={{ minHeight: '40px' }}
          >
            {loadingMore ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm text-muted-foreground">Loading more...</span>
              </div>
            ) : hasMore ? (
              <div className="h-4 w-4" />
            ) : null}
          </div>
        </div>
      ) : (
        <EmptyState
          title="No annotations found"
          description={query.trim().length > 0
            ? (isScoped
                ? "Try a different ontology term, synonym, or ID within the current entity scope."
                : "Try a different ontology term, synonym, or ID such as GO:0005634 or MI:0217.")
            : (isScoped
                ? "No annotation terms are available for the current entity scope."
                : "No annotation terms are available to browse right now.")}
        />
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b p-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="w-full">
                <Filter className="mr-2 size-4" />
                Filters
                {selectedPrefixes.length > 0 ? <Badge variant="secondary" className="ml-2">{selectedPrefixes.length}</Badge> : null}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85%] overflow-y-auto sm:w-[400px]">
              <SheetHeader>
                <SheetTitle>Annotation filters</SheetTitle>
              </SheetHeader>
              <div className="pt-4">{filterPane}</div>
            </SheetContent>
          </Sheet>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{resultsPane}</div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-[60vh] overflow-hidden rounded-2xl border bg-background/30">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={72} minSize={45} className="min-h-0 overflow-hidden">
          {resultsPane}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={28} minSize={22} className="min-h-0 border-l bg-background/40">
          <div className="h-full overflow-y-auto p-4">{filterPane}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
