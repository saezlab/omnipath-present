"use client";

import { EntityBadge } from "@/components/entity-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InteractionListRow } from "@/features/interactions-search/types";
import {
  getEntityDisplayName,
  getEntityPublicId,
  getEntitySecondaryName,
  getEntityTypeLabel,
} from "@/lib/entities/display";
import { getEntitiesByPks, getEntitiesByPublicIds } from "@/lib/queries/entity";
import { searchRelations } from "@/lib/queries/relation";
import { DataCard } from "@/features/interactions-search/components/data-card";
import { AnnotationFilterSidebar, FilterSidebar } from "@/features/interactions-search/components/filter-sidebar";
import { InteractionDetailsSheet } from "@/features/interactions-search/components/interaction-details-sheet";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn, formatNumber } from "@/lib/utils";
import { SearchFilters } from "@/types/search";
import { Filter, Minus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RESULTS_PER_PAGE = 20;

function parseNumericIds(values: Array<string | number> | undefined): { numeric: number[]; nonNumeric: string[] } {
  const numeric: number[] = [];
  const nonNumeric: string[] = [];
  const seenNumeric = new Set<number>();
  const seenNonNumeric = new Set<string>();

  for (const value of values || []) {
    const text = String(value).trim();
    if (!text) continue;
    const parsed = Number(text);
    if (Number.isInteger(parsed)) {
      if (!seenNumeric.has(parsed)) {
        seenNumeric.add(parsed);
        numeric.push(parsed);
      }
    } else if (!seenNonNumeric.has(text)) {
      seenNonNumeric.add(text);
      nonNumeric.push(text);
    }
  }

  return { numeric, nonNumeric };
}

async function buildRelationExportFilters(filters: SearchFilters) {
  const { numeric, nonNumeric } = parseNumericIds(filters.entity_ids);
  const resolvedEntities = nonNumeric.length > 0 ? await getEntitiesByPublicIds(nonNumeric) : [];
  const entityPks = Array.from(new Set([...numeric, ...resolvedEntities.map((entity) => entity.entityPk)]));
  const relationCategories = Array.from(new Set([
    ...(filters.relation_categories?.length ? filters.relation_categories : ["interaction"]),
  ])).filter((value) => value === "interaction" || value === "membership" || value === "annotation");

  return {
    ...(entityPks.length > 0 ? { entity_pks: entityPks } : {}),
    ...(relationCategories.length > 0 ? { relation_categories: relationCategories } : {}),
    ...(filters.predicates?.length ? { predicates: filters.predicates } : {}),
    ...(filters.interaction_types?.length ? { interaction_types: filters.interaction_types } : {}),
    ...(filters.sources?.length ? { sources: filters.sources } : {}),
    ...(filters.ontology_terms?.length ? { ontology_terms: filters.ontology_terms } : {}),
  };
}

type ViewMode = "table" | "network";
type LayoutMode = "search" | "split" | "ontology";

interface RelationsExploreTabProps {
  filters: SearchFilters;
  onFilterChange: (filters: SearchFilters) => void;
  useInternalRefineLayout?: boolean;
  scopedEntityIds?: string[];
  scopedAnnotationIds?: string[];
}

async function searchInteractionRows({
  filters,
  limit,
  offset,
}: {
  filters: SearchFilters;
  limit: number;
  offset: number;
}): Promise<{ hits: InteractionListRow[] }> {
  let entityPks: number[] | undefined;
  if (filters.entity_ids?.length) {
    const entities = await getEntitiesByPublicIds(filters.entity_ids.map(String));
    entityPks = entities.map((entity) => entity.entityPk);
    const hasAnnotationConstraints = Boolean(filters.ontology_terms?.length);
    if (entityPks.length === 0 && !hasAnnotationConstraints) {
      return { hits: [] };
    }
  }

  const relationCategories = Array.from(new Set([
    "interaction",
    ...(filters.relation_categories?.length ? filters.relation_categories : []),
  ])).filter((value) => value === "interaction");

  const { relations } = await searchRelations({
    filters: {
      relationCategories,
      entityPks,
      predicates: filters.predicates,
      interactionTypes: filters.interaction_types,
      sources: filters.sources,
      annotationTerms: filters.ontology_terms,
    },
    limit,
    offset,
  });

  const entityPksToHydrate = Array.from(
    new Set(relations.flatMap((relation) => [relation.subjectEntityPk, relation.objectEntityPk])),
  );
  const entities = entityPksToHydrate.length > 0 ? await getEntitiesByPks(entityPksToHydrate) : [];
  const entityByPk = new Map(entities.map((entity) => [entity.entityPk, entity]));

  const hits = relations.flatMap((relation) => {
    const subjectEntity = entityByPk.get(relation.subjectEntityPk);
    const objectEntity = entityByPk.get(relation.objectEntityPk);
    if (!subjectEntity || !objectEntity) return [];
    return [{ relation, subjectEntity, objectEntity }];
  });

  return { hits };
}

export function RelationsExploreTab({
  filters,
  onFilterChange,
  useInternalRefineLayout = true,
  scopedEntityIds,
  scopedAnnotationIds,
}: RelationsExploreTabProps) {
  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobile();
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effectiveFilters = useMemo<SearchFilters>(() => ({
    ...filters,
    ...(scopedEntityIds && scopedEntityIds.length > 0
      ? {
          entity_ids: scopedEntityIds,
          member_a_id: undefined,
          member_b_id: undefined,
        }
      : {}),
    ...(scopedAnnotationIds && scopedAnnotationIds.length > 0
      ? {
          ontology_terms: scopedAnnotationIds,
        }
      : {}),
  }), [filters, scopedAnnotationIds, scopedEntityIds]);

  // Infinite scroll hook
  const {
    data: results,
    loading,
    loadingMore,
    hasMore,
    error: infiniteScrollError,
    sentinelRef
  } = useInfiniteScroll<InteractionListRow>({
    fetchData: useCallback(async (offset: number, limit: number) => {
      const response = await searchInteractionRows({ filters: effectiveFilters, limit, offset });

      return {
        results: response.hits,
      };
    }, [effectiveFilters]),
    pageSize: RESULTS_PER_PAGE,
    dependencies: [effectiveFilters],
    root: rootElement
  });

  const [selectedInteraction, setSelectedInteraction] = useState<InteractionListRow | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("search");

  // Ontology browser is always available for searching terms
  const hasOntologyTerms = true;

  // Update error state from infinite scroll hook
  useEffect(() => {
    setError(infiniteScrollError?.message || null);
  }, [infiniteScrollError]);

  // Handler for clear filters
  const handleClearFilters = () => {
    onFilterChange({
      relation_categories: ["interaction"],
      ...(scopedEntityIds && scopedEntityIds.length > 0 ? { entity_ids: scopedEntityIds } : {}),
      ...(scopedAnnotationIds && scopedAnnotationIds.length > 0 ? { ontology_terms: scopedAnnotationIds } : {}),
    });
  };

  const handleRowClick = (row: InteractionListRow) => {
    setSelectedInteraction(row);
    setDetailsOpen(true);
  };

  // Handle export
  const handleExport = useCallback(async () => {
    try {
      setError(null);
      const date = new Date().toISOString().split('T')[0];
      const response = await fetch('/api/exports/relations/parquet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '',
          filters: await buildRelationExportFilters(effectiveFilters),
          filename: `relations_subset_${date}`,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || payload.error || `Export failed (${response.status})`);
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const contentDisposition = response.headers.get('Content-Disposition');
      const fileNameMatch = contentDisposition?.match(/filename="?([^";]+)"?/i);
      const fileName = fileNameMatch?.[1] || `relations_subset_${date}.parquet`;

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export relations');
    }
  }, [effectiveFilters]);

  const renderPredicate = (row: InteractionListRow) => {
    if (row.relation.predicate.trim()) {
      return <span className="text-sm text-muted-foreground">{row.relation.predicate}</span>;
    }
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const searchPanel = (
    <div className="h-full overflow-hidden p-4">
      <DataCard
        className={cn("h-full min-w-0 flex flex-col")}
        title="Relations"
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExport={handleExport}
      >
        {/* Mobile filter drawer */}
        <div className="lg:hidden p-4 border-b">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="w-full">
                <Filter className="h-4 w-4 mr-2" />
                Filters
                {Object.keys(filters).length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {Object.entries(filters).reduce((count, [, value]) => {
                      if (Array.isArray(value)) return count + value.length;
                      if (value !== null && value !== undefined) return count + 1;
                      return count;
                    }, 0)}
                  </Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85%] sm:w-[400px] p-0">
              <SheetHeader className="px-6 py-4 border-b">
                <div className="flex items-center justify-between">
                  <SheetTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5 text-primary" />
                    Filters
                  </SheetTitle>
                  {Object.keys(filters).length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearFilters}
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                      Clear all
                    </Button>
                  )}
                </div>
              </SheetHeader>
              <div className="h-[calc(100%-4rem)] overflow-y-auto">
                <FilterSidebar
                  filters={effectiveFilters}
                  onFilterChange={onFilterChange}
                  onClearFilters={handleClearFilters}
                  isMobile
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Results */}
        {viewMode === "table" ? (
          error ? (
            <div className="p-6">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : results.length > 0 ? (
            <div className="flex flex-col h-full">
              {/* Fixed Table Header */}
              <div className="border-b bg-background px-3 h-[57px] flex items-center flex-shrink-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[35%] py-2">Source</TableHead>
                      <TableHead className="w-[50px] text-center py-2">Predicate</TableHead>
                      <TableHead className="w-[35%] py-2">Target</TableHead>
                      <TableHead className="w-[20%] text-center py-2">Evidence</TableHead>
                    </TableRow>
                  </TableHeader>
                </Table>
              </div>

              {/* Scrollable Table Body */}
              <div
                ref={(el) => {
                  mainContentRef.current = el;
                  setRootElement(el);
                }}
                className="flex-1 min-h-0 overflow-y-auto"
              >
                <Table>
                  <TableBody>
                    {results.map((row) => {
                      const sourceEntity = row.subjectEntity;
                      const targetEntity = row.objectEntity;
                      const sourceId = getEntityPublicId(sourceEntity);
                      const targetId = getEntityPublicId(targetEntity);

                      return (
                        <TableRow
                          key={String(row.relation.relationPk)}
                          onClick={() => handleRowClick(row)}
                          className="cursor-pointer hover:bg-muted/50"
                        >
                          <TableCell className="w-[35%] max-w-0">
                            <EntityBadge
                              displayName={getEntityDisplayName(sourceEntity)}
                              canonicalIdentifier={getEntitySecondaryName(sourceEntity) || sourceEntity.canonicalIdentifier}
                              entityId={sourceId}
                              entityType={getEntityTypeLabel(sourceEntity)}
                            />
                          </TableCell>
                          <TableCell className="w-[50px] text-center">
                            <div className="flex justify-center">
                              {renderPredicate(row)}
                            </div>
                          </TableCell>
                          <TableCell className="w-[35%] max-w-0">
                            <EntityBadge
                              displayName={getEntityDisplayName(targetEntity)}
                              canonicalIdentifier={getEntitySecondaryName(targetEntity) || targetEntity.canonicalIdentifier}
                              entityId={targetId}
                              entityType={getEntityTypeLabel(targetEntity)}
                            />
                          </TableCell>
                          <TableCell className="w-[20%] text-center">
                            <Badge variant="outline">
                              {formatNumber(row.relation.evidenceCount || 0)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Infinite scroll trigger */}
                    <TableRow style={{ display: hasMore ? 'table-row' : 'none' }}>
                      <TableCell colSpan={4} className="p-0">
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
                          ) : (
                            <div className="h-4 w-4" />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

              </div>
            </div>
          ) : !loading && (
            <div className="p-6 flex-1 flex items-center justify-center">
              <p className="text-muted-foreground text-center">
                {Object.keys(effectiveFilters).length > 0
                  ? "No relations found matching your criteria."
                  : "Loading relations..."}
              </p>
            </div>
          )
        )  : null}
      </DataCard>
    </div>
  );

  const ontologyPanel = (
    <div className="h-full min-h-0 overflow-hidden p-4">
      <div className="h-full overflow-y-auto">
        <AnnotationFilterSidebar
          mode="interactions"
          filters={effectiveFilters}
          onFilterChange={onFilterChange}
        />
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden",
        useInternalRefineLayout ? "h-svh" : "h-full min-h-0",
      )}
    >
      <div className="flex-1 min-h-0">
        {!useInternalRefineLayout ? (
          isMobile ? (
            searchPanel
          ) : (
            <div className="h-full min-h-[60vh] overflow-hidden rounded-2xl border bg-background/30">
              <ResizablePanelGroup direction="horizontal" className="h-full">
                <ResizablePanel defaultSize={72} minSize={45} className="min-h-0 overflow-hidden">
                  {searchPanel}
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={28} minSize={22} className="min-h-0 border-l bg-background/40">
                  <div className="h-full overflow-y-auto p-4">
                    <FilterSidebar
                      filters={effectiveFilters}
                      onFilterChange={onFilterChange}
                      onClearFilters={handleClearFilters}
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          )
        ) : layoutMode === "split" && hasOntologyTerms ? (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={68} minSize={50} className="min-h-0">
              {searchPanel}
            </ResizablePanel>
            <ResizableHandle withHandle className="mx-3" />
            <ResizablePanel defaultSize={32} minSize={25} className="min-h-0">
              {ontologyPanel}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : layoutMode === "ontology" && hasOntologyTerms ? (
          ontologyPanel
        ) : (
          searchPanel
        )}
      </div>

      {/* Interaction Details Sheet */}
      <InteractionDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        interaction={selectedInteraction}
      />

      {/* Layout mode switcher - only show if refine content is available */}
      {useInternalRefineLayout && hasOntologyTerms && (
        <div className="fixed bottom-4 right-4 z-40">
          <div className="inline-flex items-center rounded-full border bg-background/90 p-1 shadow-sm">
            <Button
              size="sm"
              variant={layoutMode === "search" ? "default" : "ghost"}
              onClick={() => setLayoutMode("search")}
              className="rounded-full h-8"
            >
              Results
            </Button>
            <Button
              size="sm"
              variant={layoutMode === "split" ? "default" : "ghost"}
              onClick={() => setLayoutMode("split")}
              className="rounded-full h-8"
            >
              Both
            </Button>
            <Button
              size="sm"
              variant={layoutMode === "ontology" ? "default" : "ghost"}
              onClick={() => setLayoutMode("ontology")}
              className="rounded-full h-8"
            >
              Refine
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
