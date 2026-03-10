"use client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSidebarContent } from "@/contexts/sidebar-content-context";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type UIEvent } from "react";
import { searchMeilisearch } from "./api/queries";
import { EntityFilterSidebar } from "./components/entity-filter-sidebar";
import type { SearchResult } from "./components/result-card";
import { SearchBar } from "./components/search-bar";
import { SearchResults } from "./components/search-results";
import { IdentifierMatches, type IdentifierMatch } from "./components/identifier-matches";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Download, Search } from "lucide-react";
import { AnnotationFilterSidebar } from "@/features/interactions-search/components/filter-sidebar";
import { cn } from "@/lib/utils";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

interface SearchPageProps {
  // Props for embedded mode (like in AI dialogs)
  embedded?: boolean;
  // Allow ontology browser when embedded (e.g. selection tab)
  allowOntologyInEmbedded?: boolean;
  // Show the layout switcher in embedded mode when ontology is available
  showLayoutSwitcherInEmbedded?: boolean;
  initialQuery?: string;
  initialSearchType?: "search_entities" | "cv_terms";
  initialSearchMode?: SearchMode;
  initialIdentifiers?: string[];
  initialFilters?: {
    entity_ids?: Array<string | number>;
    entity_types?: string[];
    sources?: string[];
    ncbi_tax_id?: string[];
    cv_terms_go?: string[];
    cv_terms_mi?: string[];
    cv_terms_om?: string[];
    cv_terms_hp?: string[];
    cv_terms_kw?: string[];
  };
  // Whether to show filter sidebar even when embedded
  showFilters?: boolean;
  // Entity IDs that must always remain in the filter set (e.g. selection view)
  lockedEntityIds?: Array<string | number>;
}

type SearchMode = "full-text" | "identifier" | "batch";
type LayoutMode = "search" | "split" | "ontology";

const EMPTY_LOCKED_ENTITY_IDS: Array<string | number> = [];

export default function SearchPage({
  embedded = false,
  allowOntologyInEmbedded = false,
  showLayoutSwitcherInEmbedded = false,
  initialQuery = "",
  initialSearchType = "search_entities",
  initialSearchMode = "full-text",
  initialIdentifiers,
  initialFilters,
  showFilters = false,
  lockedEntityIds = EMPTY_LOCKED_ENTITY_IDS
}: SearchPageProps = {}) {
  const [query, setQuery] = useState(initialQuery);
  const [, startTransition] = useTransition();
  const [searchMode, setSearchMode] = useState<SearchMode>(initialSearchMode);
  const [selectedSpecies, setSelectedSpecies] = useState<string>("9606"); // Default to Human
  const normalizedLockedEntityIds = useMemo(
    () => lockedEntityIds.map((id) => String(id).trim()).filter((id) => id.length > 0),
    [lockedEntityIds]
  );
  const [filters, setFilters] = useState<MeilisearchFilters>(() => {
    const base = initialFilters || { ncbi_tax_id: ["9606"] };
    if (normalizedLockedEntityIds.length > 0) {
      return { ...base, entity_ids: normalizedLockedEntityIds };
    }
    return base;
  });
  const [filterCounts, setFilterCounts] = useState<{ entity_type?: Record<string, number>; sources?: Record<string, number>; ncbi_tax_id?: Record<string, number>; cv_terms?: Record<string, number> }>({});
  const [ontologyFacetCountsByPrefix, setOntologyFacetCountsByPrefix] = useState<Record<string, Record<string, number>>>({});
  const [lookupMatches, setLookupMatches] = useState<IdentifierMatch[]>([]);
  const [lookupEntities, setLookupEntities] = useState<SearchResult[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [identifierInput, setIdentifierInput] = useState(
    initialSearchMode === "identifier" ? initialIdentifiers?.[0] || initialQuery : ""
  );
  const [batchInput, setBatchInput] = useState(
    initialSearchMode === "batch" ? (initialIdentifiers || []).join("\n") : ""
  );
  const { setSidebarContent } = useSidebarContent();
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("split");
  const [layoutTouched, setLayoutTouched] = useState(false);
  const [showFloatingSearchHeader, setShowFloatingSearchHeader] = useState(false);
  const lastSearchScrollTopRef = useRef(0);
  const upScrollAccumulatorRef = useRef(0);
  const downScrollAccumulatorRef = useRef(0);
  const initialIdentifiersKey = useMemo(
    () => (initialIdentifiers || []).map((identifier) => identifier.trim()).filter((identifier) => identifier.length > 0).join("\n"),
    [initialIdentifiers]
  );

  // Fetch function for infinite scroll
  const fetchSearchData = useCallback(
    async (offset: number, limit: number) => {
      if (searchMode !== "full-text") {
        return { results: [], totalResults: 0 };
      }

      const response = await searchMeilisearch({
        query: query || "", // Allow empty query to fetch all results
        index: "search_entities",
        limit,
        offset,
        filters
      });

      // Update filter counts from facet distribution (only on first page)
      if (offset === 0 && 'facetDistribution' in response && response.facetDistribution && initialSearchType === "search_entities") {
        const facetDistribution = response.facetDistribution || {};
        const perOntologyCounts: Record<string, Record<string, number>> = {
          GO: facetDistribution.cv_terms_go || {},
          MI: facetDistribution.cv_terms_mi || {},
          OM: facetDistribution.cv_terms_om || {},
          HP: facetDistribution.cv_terms_hp || {},
          KW: facetDistribution.cv_terms_kw || {},
        };
        setOntologyFacetCountsByPrefix(perOntologyCounts);
        setFilterCounts({
          entity_type: response.facetDistribution.entity_type || {},
          sources: response.facetDistribution.sources || {},
          ncbi_tax_id: response.facetDistribution.ncbi_tax_id || {},
        });
      }

      // The API returns estimatedTotalHits for the total count
      const hits = response.hits as SearchResult[] || [];
      const estimatedTotalHits = ('estimatedTotalHits' in response ? response.estimatedTotalHits as number : 0) || hits.length || 0;

      return {
        results: hits,
        totalResults: estimatedTotalHits
      };
    },
    [query, searchMode, initialSearchType, filters]
  );

  // Use infinite scroll hook for regular search
  const {
    data: results,
    loading,
    loadingMore,
    hasMore,
    sentinelRef
  } = useInfiniteScroll<SearchResult>({
    fetchData: fetchSearchData,
    pageSize: 20,
    dependencies: [query, searchMode, initialSearchType, filters]
  });

  // Keep locked entity IDs enforced
  useEffect(() => {
    if (normalizedLockedEntityIds.length === 0) return;
    setFilters((prev) => {
      const prevIds = (prev.entity_ids || []).map((id) => String(id));
      const sameLength = prevIds.length === normalizedLockedEntityIds.length;
      const sameValues = sameLength && prevIds.every((id, idx) => id === normalizedLockedEntityIds[idx]);
      if (sameValues) return prev;
      return { ...prev, entity_ids: normalizedLockedEntityIds };
    });
  }, [normalizedLockedEntityIds]);

  // Handlers for filters
  const handleFilterChange = useCallback((newFilters: { entity_types?: string[]; sources?: string[]; ncbi_tax_id?: string[] }) => {
    setFilters({
      ...newFilters,
      ...(normalizedLockedEntityIds.length > 0 ? { entity_ids: normalizedLockedEntityIds } : {}),
    });
  }, [normalizedLockedEntityIds]);

  const handleClearFilters = useCallback(() => {
    if (normalizedLockedEntityIds.length > 0) {
      setFilters({ entity_ids: normalizedLockedEntityIds });
      return;
    }
    setFilters({ ncbi_tax_id: [selectedSpecies] });
  }, [normalizedLockedEntityIds, selectedSpecies]);

  // Handler for species change
  const handleSpeciesChange = useCallback((species: string) => {
    setSelectedSpecies(species);
    setFilters(prev => ({
      ...prev,
      ncbi_tax_id: [species],
      ...(normalizedLockedEntityIds.length > 0 ? { entity_ids: normalizedLockedEntityIds } : {}),
    }));
  }, [normalizedLockedEntityIds]);

  const handleAnnotationFilterChange = useCallback((newFilters: MeilisearchFilters) => {
    setFilters({
      ...newFilters,
      ...(normalizedLockedEntityIds.length > 0 ? { entity_ids: normalizedLockedEntityIds } : {}),
    });
  }, [normalizedLockedEntityIds]);

  const hasOntologyTerms = Object.values(ontologyFacetCountsByPrefix).some(
    (counts) => Object.keys(counts).length > 0
  );
  const ontologyEnabled =
    (allowOntologyInEmbedded || !embedded) &&
    searchMode === "full-text" &&
    initialSearchType === "search_entities" &&
    hasOntologyTerms;

  const effectiveLayoutMode = embedded && !allowOntologyInEmbedded ? "search" : layoutMode;

  useEffect(() => {
    if (!ontologyEnabled && layoutMode !== "search") {
      setLayoutMode("search");
      return;
    }

    if (ontologyEnabled && layoutMode === "search" && !layoutTouched) {
      setLayoutMode("split");
    }
  }, [layoutMode, layoutTouched, ontologyEnabled]);

  const handleLayoutChange = useCallback((mode: LayoutMode) => {
    setLayoutTouched(true);
    setLayoutMode(mode);
  }, []);

  const handleSearchScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (embedded) return;

    const REVEAL_ENABLE_SCROLL_TOP = 480;
    const HIDE_WHEN_ORIGINAL_VISIBLE_SCROLL_TOP = 140;
    const REVEAL_UP_SCROLL_THRESHOLD = 72;
    const HIDE_DOWN_SCROLL_THRESHOLD = 28;
    const IGNORE_DELTA = 2;

    const nextScrollTop = event.currentTarget.scrollTop;
    const delta = nextScrollTop - lastSearchScrollTopRef.current;

    if (Math.abs(delta) < IGNORE_DELTA) {
      lastSearchScrollTopRef.current = nextScrollTop;
      return;
    }

    if (nextScrollTop <= HIDE_WHEN_ORIGINAL_VISIBLE_SCROLL_TOP) {
      upScrollAccumulatorRef.current = 0;
      downScrollAccumulatorRef.current = 0;
      if (showFloatingSearchHeader) {
        setShowFloatingSearchHeader(false);
      }
      lastSearchScrollTopRef.current = nextScrollTop;
      return;
    }

    if (delta > 0) {
      upScrollAccumulatorRef.current = 0;
      if (showFloatingSearchHeader) {
        downScrollAccumulatorRef.current += delta;
        if (downScrollAccumulatorRef.current > HIDE_DOWN_SCROLL_THRESHOLD) {
          setShowFloatingSearchHeader(false);
          downScrollAccumulatorRef.current = 0;
        }
      }
    } else {
      downScrollAccumulatorRef.current = 0;
      if (!showFloatingSearchHeader && nextScrollTop >= REVEAL_ENABLE_SCROLL_TOP) {
        upScrollAccumulatorRef.current += Math.abs(delta);
        if (upScrollAccumulatorRef.current > REVEAL_UP_SCROLL_THRESHOLD) {
          setShowFloatingSearchHeader(true);
          upScrollAccumulatorRef.current = 0;
        }
      }
    }

    lastSearchScrollTopRef.current = nextScrollTop;
  }, [embedded, showFloatingSearchHeader]);

  // Set sidebar content when filter counts are available (not in embedded mode unless showFilters is true)
  useEffect(() => {
    if ((!embedded || showFilters) && searchMode === "full-text" && initialSearchType === "search_entities" && Object.keys(filterCounts).length > 0) {
      setSidebarContent(
        <EntityFilterSidebar
          filters={filters}
          filterCounts={filterCounts}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
          isMobile
        />
      );
    } else {
      setSidebarContent(null);
    }

    // Cleanup on unmount
    return () => {
      setSidebarContent(null);
    };
  }, [embedded, showFilters, searchMode, initialSearchType, filterCounts, filters, handleFilterChange, handleClearFilters, setSidebarContent]);

  // Clear identifier results when returning to full-text mode
  useEffect(() => {
    if (searchMode === "full-text") {
      setLookupMatches([]);
      setLookupEntities([]);
      setLookupError(null);
    }
  }, [searchMode]);

  useEffect(() => {
    setShowFloatingSearchHeader(false);
    lastSearchScrollTopRef.current = 0;
    upScrollAccumulatorRef.current = 0;
    downScrollAccumulatorRef.current = 0;
  }, [searchMode, effectiveLayoutMode]);

  // Debounced search - This will be passed directly to SearchBar's onSearch
  const doSearch = useCallback((q: string) => {
    setQuery(q);
  }, []);

  const handleEntityExport = useCallback(async () => {
    try {
      setLookupError(null);
      const date = new Date().toISOString().split('T')[0];
      const response = await fetch('/api/exports/entities/parquet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query || '',
          filters,
          filename: `entities_subset_${date}`,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Export failed (${response.status})`);
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const contentDisposition = response.headers.get('Content-Disposition');
      const fileNameMatch = contentDisposition?.match(/filename="?([^";]+)"?/i);
      const fileName = fileNameMatch?.[1] || `entities_subset_${date}.parquet`;

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Failed to export entities');
    }
  }, [query, filters]);

  // Identifier lookup helpers
  const runLookup = useCallback(async (identifiers: string[]) => {
    setLookupLoading(true);
    setLookupError(null);
    try {
      const response = await fetch("/api/entity-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Lookup failed with status ${response.status}`);
      }

      const data = await response.json();
      setLookupMatches((data.matches || []) as IdentifierMatch[]);
      setLookupEntities((data.entities || []) as SearchResult[]);
    } catch (err) {
      console.error("Identifier lookup error", err);
      setLookupMatches([]);
      setLookupEntities([]);
      setLookupError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  }, []);

  const handleIdentifierLookup = useCallback(() => {
    const trimmed = identifierInput.trim();
    if (!trimmed) {
      setLookupError("Please enter an identifier to look up.");
      return;
    }
    startTransition(() => runLookup([trimmed]));
  }, [identifierInput, runLookup]);

  const handleBatchLookup = useCallback(() => {
    const ids = batchInput
      .split(/[\n,]/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (ids.length === 0) {
      setLookupError("Please enter at least one identifier.");
      return;
    }
    startTransition(() => runLookup(ids));
  }, [batchInput, runLookup]);

  useEffect(() => {
    if (!initialIdentifiersKey || initialSearchMode === "full-text") {
      return;
    }

    const normalized = initialIdentifiersKey.split("\n");

    if (initialSearchMode === "identifier") {
      setIdentifierInput(normalized[0] || "");
    } else {
      setBatchInput(normalized.join("\n"));
    }

    startTransition(() => {
      void runLookup(normalized);
    });
  }, [initialIdentifiersKey, initialSearchMode, runLookup, startTransition]);

  const isSplitLayout = effectiveLayoutMode === "split" && ontologyEnabled;
  const searchContainerClass = embedded
    ? "w-full min-h-full"
    : isSplitLayout
      ? "w-full h-full px-4 py-6"
      : "w-full max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-6";
  const ontologyContainerClass = isSplitLayout
    ? "h-full"
    : "h-full max-w-md mx-auto lg:max-w-none";

  const renderSearchHeader = (inline: boolean) => (
    <div className="border-b bg-background/60 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className={cn(
        inline ? "w-full px-4 py-4 space-y-4" : "w-full max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4"
      )}>
        {/* Unified search module: active input on top + search mode switcher attached below */}
        <div className="w-full space-y-3 rounded-2xl border bg-background/60 p-3 shadow-sm backdrop-blur-sm">
          {searchMode === "full-text" && effectiveLayoutMode !== "ontology" && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <SearchBar
                  placeholder="Search proteins, molecules, ontology terms…"
                  onSearch={doSearch}
                  initialQuery={query}
                  autoFocus={false}
                  selectedSpecies={selectedSpecies}
                  onSpeciesChange={handleSpeciesChange}
                />
              </div>
              <Button variant="outline" size="sm" onClick={handleEntityExport} className="h-10 rounded-full">
                <Download className="h-4 w-4 mr-1.5" />
                Export
              </Button>
            </div>
          )}

          {searchMode === "identifier" && effectiveLayoutMode !== "ontology" && (
            <div className="relative group backdrop-blur-sm rounded-full transition-all focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/20 bg-background border">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary z-10" />
              <Input
                placeholder="Enter one identifier (e.g. UniProt, gene symbol, etc.)"
                className="w-full pl-12 pr-[100px] h-12 text-lg rounded-full shadow-sm border-0 focus-visible:ring-0"
                value={identifierInput}
                onChange={(e) => setIdentifierInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleIdentifierLookup()}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10">
                <Button
                  onClick={handleIdentifierLookup}
                  disabled={lookupLoading}
                  className="h-8 px-4 rounded-full shadow-sm transition-all hover:shadow-md"
                >
                  Look up
                </Button>
              </div>
            </div>
          )}

          {searchMode === "batch" && effectiveLayoutMode !== "ontology" && (
            <div className="flex flex-col gap-3 rounded-xl border bg-background/50 p-1 shadow-sm focus-within:ring-2 focus-within:ring-primary/20 transition-all backdrop-blur-sm">
              <Textarea
                placeholder="Paste comma or newline separated identifiers"
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                rows={4}
                className="resize-none border-0 focus-visible:ring-0 bg-transparent min-h-[100px]"
              />
              <div className="flex items-center justify-between px-3 pb-2">
                <p className="text-xs text-muted-foreground">
                  We will look up all identifiers and group candidate entities for each.
                </p>
                <Button
                  onClick={handleBatchLookup}
                  disabled={lookupLoading}
                  size="sm"
                  className="rounded-full"
                >
                  Run lookup
                </Button>
              </div>
            </div>
          )}

          <Tabs
            value={searchMode}
            onValueChange={(value) => {
              setSearchMode(value as SearchMode);
              setLookupError(null);
            }}
            className="w-full"
          >
            <TabsList className="h-auto w-full justify-start rounded-full bg-muted/60 p-1">
              <TabsTrigger value="full-text" className="rounded-full">Full text</TabsTrigger>
              <TabsTrigger value="identifier" className="rounded-full">Identifier lookup</TabsTrigger>
              <TabsTrigger value="batch" className="rounded-full">Batch identifiers</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
    </div>
  );

  // Render content based on embedded mode
  const searchContent = (
    <div className={cn("h-full min-h-0 flex flex-col relative")}>
      {!embedded && effectiveLayoutMode !== "ontology" && showFloatingSearchHeader ? (
        <div className="absolute inset-x-0 top-0 z-30 animate-in fade-in-0 duration-150">
          {renderSearchHeader(true)}
        </div>
      ) : null}

      <div
        className={cn(
          embedded ? "flex-1 overflow-y-auto p-4" : "flex-1 overflow-y-auto",
          "min-h-0"
        )}
        onScroll={handleSearchScroll}
      >
        {!embedded && effectiveLayoutMode !== "ontology" ? renderSearchHeader(true) : null}
        <div className={searchContainerClass}>
          {searchMode === "full-text" ? (
            <SearchResults
              results={results}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              sentinelRef={sentinelRef}
            />
          ) : (
            <IdentifierMatches
              matches={lookupMatches}
              entities={lookupEntities}
              loading={lookupLoading}
              error={lookupError}
            />
          )}
        </div>
      </div>
    </div>
  );

  const ontologyContent = (
    <div className="h-full overflow-y-auto p-4">
      <div className={ontologyContainerClass}>
        <AnnotationFilterSidebar
          mode="entities"
          filters={filters}
          onFilterChange={handleAnnotationFilterChange}
          ontologyFacetCountsByPrefix={ontologyFacetCountsByPrefix}
        />
      </div>
    </div>
  );

  return (
    <div className={cn(
      embedded ? "h-full flex flex-col overflow-hidden" : "flex-1 flex flex-col h-svh overflow-hidden",
      "relative"
    )}>
      <div className="flex-1 min-h-0">
        {effectiveLayoutMode === "split" && ontologyEnabled ? (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={68} minSize={50} className="min-h-0">
              {searchContent}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={32} minSize={25} className="min-h-0">
              {ontologyContent}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : effectiveLayoutMode === "ontology" && ontologyEnabled ? (
          <div className="h-full">
            {ontologyContent}
          </div>
        ) : (
          <div className="h-full">
            {searchContent}
          </div>
        )}
      </div>

      {(!embedded || (showLayoutSwitcherInEmbedded && ontologyEnabled)) && (
        <div className="fixed bottom-4 right-4 z-40">
          <div className="inline-flex items-center rounded-full border bg-background/90 p-1 shadow-sm">
            <Button
              size="sm"
              variant={effectiveLayoutMode === "search" ? "default" : "ghost"}
              onClick={() => handleLayoutChange("search")}
              className="rounded-full h-8"
            >
              Search
            </Button>
            <Button
              size="sm"
              variant={effectiveLayoutMode === "split" ? "default" : "ghost"}
              onClick={() => handleLayoutChange("split")}
              className="rounded-full h-8"
              disabled={!ontologyEnabled}
            >
              Both
            </Button>
            <Button
              size="sm"
              variant={effectiveLayoutMode === "ontology" ? "default" : "ghost"}
              onClick={() => handleLayoutChange("ontology")}
              className="rounded-full h-8"
              disabled={!ontologyEnabled}
            >
              Ontology
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
