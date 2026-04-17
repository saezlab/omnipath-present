"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { searchMeilisearch } from "@/features/search/api/queries";
import { EntityFilterSidebar } from "@/features/search/components/entity-filter-sidebar";
import type { SearchResult } from "@/features/search/components/result-card";
import { SearchResults } from "@/features/search/components/search-results";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useIsMobile } from "@/hooks/use-mobile";
import type { MeilisearchFilters } from "@/types/meilisearch";

interface EntitiesExploreTabProps {
  query: string;
  species?: string;
  filters: MeilisearchFilters;
  onFiltersChange: (filters: MeilisearchFilters) => void;
  scopedEntityIds?: string[];
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

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <div className="text-lg font-semibold">No entities found</div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Try a gene symbol, UniProt identifier, small molecule name, or broader text query.
        </p>
      </CardContent>
    </Card>
  );
}

export function EntitiesExploreTab({
  query,
  species,
  filters,
  onFiltersChange,
  scopedEntityIds,
}: EntitiesExploreTabProps) {
  const isMobile = useIsMobile();
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [filterCounts, setFilterCounts] = useState<{
    entity_type?: Record<string, number>;
    sources?: Record<string, number>;
    ncbi_tax_id?: Record<string, number>;
  }>({});

  const effectiveFilters = useMemo(() => ({
    ...filters,
    ...(species ? { ncbi_tax_id: filters.ncbi_tax_id ?? [species] } : {}),
    ...(scopedEntityIds && scopedEntityIds.length > 0 ? { entity_ids: scopedEntityIds } : {}),
  } satisfies MeilisearchFilters), [filters, scopedEntityIds, species]);

  useEffect(() => {
    if (!species || scopedEntityIds?.length) return;
    if ((filters.ncbi_tax_id || [])[0] === species) return;
    onFiltersChange({ ...filters, ncbi_tax_id: [species] });
  }, [filters, onFiltersChange, scopedEntityIds, species]);

  const handleFilterChange = useCallback((next: { entity_types?: string[]; sources?: string[]; ncbi_tax_id?: string[] }) => {
    const merged: MeilisearchFilters = {
      ...filters,
      ...next,
      ...(scopedEntityIds && scopedEntityIds.length > 0 ? { entity_ids: scopedEntityIds } : {}),
    };
    onFiltersChange(merged);
  }, [filters, onFiltersChange, scopedEntityIds]);

  const handleClearFilters = useCallback(() => {
    onFiltersChange({
      ...(species && !scopedEntityIds?.length ? { ncbi_tax_id: [species] } : {}),
      ...(scopedEntityIds && scopedEntityIds.length > 0 ? { entity_ids: scopedEntityIds } : {}),
    });
  }, [onFiltersChange, scopedEntityIds, species]);

  const {
    data: results,
    loading,
    loadingMore,
    hasMore,
    sentinelRef,
  } = useInfiniteScroll<SearchResult>({
    root: isMobile ? null : scrollRoot,
    fetchData: useCallback(async (offset: number, limit: number) => {
      const response = await searchMeilisearch({
        query: query || "",
        index: "search_entities",
        limit,
        offset,
        filters: effectiveFilters,
        facets: ["entity_type", "sources", "ncbi_tax_id"],
      });

      if (offset === 0) {
        const facetDistribution = response.facetDistribution || {};
        setFilterCounts({
          entity_type: facetDistribution.entity_type || {},
          sources: facetDistribution.sources || {},
          ncbi_tax_id: facetDistribution.ncbi_tax_id || {},
        });
      }

      return {
        results: (response.hits as SearchResult[]) || [],
        totalResults: response.estimatedTotalHits || 0,
      };
    }, [effectiveFilters, query]),
    pageSize: 20,
    dependencies: [query, effectiveFilters],
  });

  const filterPane = (
    <EntityFilterSidebar
      filters={{
        entity_types: filters.entity_types,
        sources: filters.sources,
        ncbi_tax_id: filters.ncbi_tax_id,
      }}
      filterCounts={filterCounts}
      onFilterChange={handleFilterChange}
      onClearFilters={handleClearFilters}
      isMobile={isMobile}
    />
  );

  const resultsPane = (
    <div ref={setScrollRoot} className="h-full overflow-y-auto p-4">
      {loading && results.length === 0 ? (
        <LoadingGrid />
      ) : results.length > 0 ? (
        <SearchResults
          results={results}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          sentinelRef={sentinelRef}
        />
      ) : (
        <EmptyState />
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
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85%] sm:w-[400px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Entity filters</SheetTitle>
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
