"use client";

import { useSidebarContent } from "@/contexts/sidebar-content-context";
import { SearchBar } from "@/features/search/components/search-bar";
import { ResultCard, type SearchResult } from "@/features/search/components/result-card";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import type { MeilisearchFilters, MeilisearchSource } from "@/types/meilisearch";
import { useCallback, useEffect, useMemo, useState } from "react";
import { searchSources } from "./api/queries";
import { SourceFilterSidebar } from "./components/source-filter-sidebar";

const PAGE_SIZE = 20;

function mapSourceToSearchResult(source: MeilisearchSource): SearchResult {
  return {
    id: source.__doc_id || source.source_ref,
    type: "source",
    name: source.source_name,
    source_name: source.source_name,
    source_ref: source.source_ref,
    source: source.source,
    source_accession: source.source_accession,
    resource_description: source.resource_description,
    resource_url: source.resource_url,
    function_records: source.function_records,
    function_names: source.function_names,
    content_category_cv_terms: source.content_category_cv_terms,
    total_records: source.total_records,
    license_cv: source.license_cv,
    update_category_cv: source.update_category_cv,
    pubmed: source.pubmed,
    finished_at: source.finished_at,
  };
}

export default function SourcesPage() {
  const { setSidebarContent } = useSidebarContent();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<MeilisearchFilters>({});
  const [filterCounts, setFilterCounts] = useState<{
    license_cv?: Record<string, number>;
    update_category_cv?: Record<string, number>;
    content_category_cv_terms?: Record<string, number>;
  }>({});

  const fetchData = useCallback(
    async (offset: number, limit: number) => {
      const response = await searchSources(query, filters, limit, offset);

      if (offset === 0 && response.facetDistribution) {
        setFilterCounts({
          license_cv: response.facetDistribution.license_cv || {},
          update_category_cv: response.facetDistribution.update_category_cv || {},
          content_category_cv_terms: response.facetDistribution.content_category_cv_terms || {},
        });
      }

      return {
        results: response.hits || [],
        totalResults: response.estimatedTotalHits || 0,
      };
    },
    [query, filters],
  );

  const { data, loading, loadingMore, hasMore, sentinelRef } = useInfiniteScroll<MeilisearchSource>({
    fetchData,
    pageSize: PAGE_SIZE,
    dependencies: [query, filters],
  });

  const mappedResults = useMemo(() => data.map(mapSourceToSearchResult), [data]);

  const handleFilterChange = useCallback((nextFilters: MeilisearchFilters) => {
    setFilters(nextFilters);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({});
  }, []);

  useEffect(() => {
    if (Object.keys(filterCounts).length > 0) {
      setSidebarContent(
        <SourceFilterSidebar
          filters={filters}
          filterCounts={filterCounts}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
          isMobile
        />,
      );
    } else {
      setSidebarContent(null);
    }

    return () => setSidebarContent(null);
  }, [filterCounts, filters, handleFilterChange, handleClearFilters, setSidebarContent]);

  return (
    <div className="flex-1 flex flex-col h-svh overflow-hidden">
      <div className="border-b bg-background/60 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <div className="w-full max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <SearchBar
            placeholder="Search by source name, slug, reference, or description…"
            onSearch={setQuery}
            initialQuery={query}
            showSpeciesSelector={false}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {!loading && mappedResults.length === 0 ? (
            <div className="pt-24 text-center">
              <svg className="w-16 h-16 text-slate-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <p className="text-xl text-slate-500">No results found for your search.</p>
              <p className="text-slate-400">Try refining your search terms.</p>
            </div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {mappedResults.map((result) => (
                <ResultCard key={result.id} result={result} />
              ))}
            </div>
          )}

          <div
            ref={sentinelRef as React.RefObject<HTMLDivElement>}
            className="flex justify-center py-8"
            style={{ visibility: hasMore ? "visible" : "hidden", height: hasMore ? "auto" : "0" }}
          >
            {loadingMore ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Loading more...
              </div>
            ) : (
              <div className="h-4" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
