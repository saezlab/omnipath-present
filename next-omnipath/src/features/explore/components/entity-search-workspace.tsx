"use client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSidebarContent } from "@/contexts/sidebar-content-context";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode, type UIEvent } from "react";
import { getEntitiesByPublicIds, searchEntities } from "@/lib/queries/entity";
import { resolveEntityIdentifiers } from "@/lib/queries/entity-identifier";
import type { EntityLike } from "@/lib/entities/display";
import { EntityFilterSidebar } from "./entity-filter-sidebar";
import { SearchBar } from "./search-bar";
import { SearchResults } from "@/features/shared/entity-results/search-results";
import { IdentifierMatches, type IdentifierMatch } from "@/features/shared/entity-results/identifier-matches";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Download, MessageSquare, Search } from "lucide-react";
import { AnnotationFilterSidebar } from "@/features/interactions-search/components/filter-sidebar";
import { cn } from "@/lib/utils";
import type { SearchFilters } from "@/types/search";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useSearchUrlState } from "@/lib/navigation/url-state";
import { useSearchWorkspaceState, type SearchWorkspacePane } from "@/features/explore/use-entity-search-workspace-state";
import { SearchAssistantPane } from "@/features/chat/search-assistant-pane";


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

async function buildEntityExportFilters(filters: SearchFilters) {
  const { numeric, nonNumeric } = parseNumericIds(filters.entity_ids);
  const resolvedEntities = nonNumeric.length > 0 ? await getEntitiesByPublicIds(nonNumeric) : [];
  const entityPks = Array.from(new Set([...numeric, ...resolvedEntities.map((entity) => entity.entityPk)]));

  return {
    ...(entityPks.length > 0 ? { entity_pks: entityPks } : {}),
    ...(filters.entity_types?.length ? { entity_types: filters.entity_types } : {}),
    ...(filters.ncbi_tax_id?.length ? { taxonomy_ids: filters.ncbi_tax_id } : {}),
    ...(filters.sources?.length ? { sources: filters.sources } : {}),
  };
}

interface EntitySearchWorkspaceProps {
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
    ontology_terms?: string[];
  };
  // Whether to show filter sidebar even when embedded
  showFilters?: boolean;
  // Entity IDs that must always remain in the filter set (e.g. selection view)
  lockedEntityIds?: Array<string | number>;
}

type SearchMode = "full-text" | "identifier" | "batch";
type LayoutMode = "search" | "split" | "ontology";

const EMPTY_LOCKED_ENTITY_IDS: Array<string | number> = [];

export default function EntitySearchWorkspace({
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
}: EntitySearchWorkspaceProps = {}) {
  const {
    query: urlQuery,
    setQuery: setUrlQuery,
    mode: urlMode,
    setMode: setUrlMode,
    type: urlType,
    setType: setUrlType,
    species: urlSpecies,
    setSpecies: setUrlSpecies,
    filters: urlFilters,
    setFilters: setUrlFilters,
  } = useSearchUrlState();
  const [, startTransition] = useTransition();
  const [embeddedQuery, setEmbeddedQuery] = useState(initialQuery);
  const [embeddedSearchMode, setEmbeddedSearchMode] = useState<SearchMode>(initialSearchMode);
  const [embeddedSelectedSpecies, setEmbeddedSelectedSpecies] = useState<string>("9606");
  const normalizedLockedEntityIds = useMemo(
    () => lockedEntityIds.map((id) => String(id).trim()).filter((id) => id.length > 0),
    [lockedEntityIds]
  );
  const [embeddedFilters, setEmbeddedFilters] = useState<SearchFilters>(() => {
    const base = initialFilters || { ncbi_tax_id: ["9606"] };
    if (normalizedLockedEntityIds.length > 0) {
      return { ...base, entity_ids: normalizedLockedEntityIds };
    }
    return base;
  });

  const [lookupMatches, setLookupMatches] = useState<IdentifierMatch[]>([]);
  const [lookupEntities, setLookupEntities] = useState<EntityLike[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [identifierInput, setIdentifierInput] = useState(
    initialSearchMode === "identifier" ? initialIdentifiers?.[0] || initialQuery : ""
  );
  const [batchInput, setBatchInput] = useState(
    initialSearchMode === "batch" ? (initialIdentifiers || []).join("\n") : ""
  );
  const { setSidebarContent } = useSidebarContent();
  const { isMobile, desktopVisiblePanes, mobileActivePane, toggleDesktopPane, setMobileActivePane } = useSearchWorkspaceState();
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

  const query = embedded ? embeddedQuery : (urlQuery || initialQuery);
  const searchMode = embedded ? embeddedSearchMode : urlMode;
  const selectedSpecies = embedded ? embeddedSelectedSpecies : (urlSpecies || "9606");
  const filters = useMemo(() => {
    const base = embedded
      ? embeddedFilters
      : Object.keys(urlFilters).length > 0
        ? urlFilters
        : { ncbi_tax_id: [urlSpecies || "9606"] };

    if (normalizedLockedEntityIds.length > 0) {
      return { ...base, entity_ids: normalizedLockedEntityIds };
    }

    return base;
  }, [embedded, embeddedFilters, normalizedLockedEntityIds, urlFilters, urlSpecies]);

  const setQuery = useCallback((next: string) => {
    if (embedded) {
      setEmbeddedQuery(next);
      return;
    }
    setUrlQuery(next);
  }, [embedded, setUrlQuery]);

  const setSearchMode = useCallback((next: SearchMode) => {
    if (embedded) {
      setEmbeddedSearchMode(next);
      return;
    }
    setUrlMode(next);
  }, [embedded, setUrlMode]);

  const setSelectedSpecies = useCallback((next: string) => {
    if (embedded) {
      setEmbeddedSelectedSpecies(next);
      return;
    }
    setUrlSpecies(next);
  }, [embedded, setUrlSpecies]);

  const setFilters = useCallback((next: SearchFilters | ((prev: SearchFilters) => SearchFilters)) => {
    const resolved = typeof next === "function" ? next(filters) : next;
    if (embedded) {
      setEmbeddedFilters(resolved);
      return;
    }
    setUrlFilters(resolved);
  }, [embedded, filters, setUrlFilters]);

  useEffect(() => {
    if (embedded || urlType === initialSearchType) return;
    setUrlType(initialSearchType);
  }, [embedded, initialSearchType, setUrlType, urlType]);

  // Fetch function for infinite scroll
  const fetchSearchData = useCallback(
    async (cursor: number | null, limit: number) => {
      if (searchMode !== "full-text") {
        return { results: [] };
      }

      const response = await searchEntities({
        query: query || "",
        limit,
        cursor: cursor ?? undefined,
        filters,
      });

      const entities = response.entities || [];

      return {
        results: entities,
        nextPageParam: response.nextCursor ?? undefined,
      };
    },
    [query, searchMode, filters]
  );

  // Use infinite scroll hook for regular search
  const {
    data: results,
    loading,
    loadingMore,
    hasMore,
    sentinelRef
  } = useInfiniteScroll<import("@next-omnipath/drizzle").Entity, number | null>({
    fetchData: fetchSearchData,
    pageSize: 20,
    dependencies: [query, searchMode, initialSearchType, filters],
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextPageParam,
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

  const handleAnnotationFilterChange = useCallback((newFilters: SearchFilters) => {
    setFilters({
      ...newFilters,
      ...(normalizedLockedEntityIds.length > 0 ? { entity_ids: normalizedLockedEntityIds } : {}),
    });
  }, [normalizedLockedEntityIds]);

  const ontologyEnabled =
    (allowOntologyInEmbedded || !embedded) &&
    searchMode === "full-text" &&
    initialSearchType === "search_entities";

  const effectiveLayoutMode = embedded && !allowOntologyInEmbedded ? "search" : layoutMode;
  const availableDesktopPanes = useMemo<SearchWorkspacePane[]>(() => {
    const next = desktopVisiblePanes.filter((pane) => pane !== "ontology" || ontologyEnabled);
    return next.length > 0 ? next : [ontologyEnabled ? "ontology" : "search"];
  }, [desktopVisiblePanes, ontologyEnabled]);
  const effectiveMobilePane: SearchWorkspacePane = mobileActivePane === "ontology" && !ontologyEnabled
    ? "search"
    : mobileActivePane;
  const shouldUseWorkspaceLayout = !embedded;
  const searchPaneCompact = shouldUseWorkspaceLayout
    ? (!isMobile && availableDesktopPanes.length > 1)
    : effectiveLayoutMode === "split" && ontologyEnabled;

  useEffect(() => {
    if (!ontologyEnabled && layoutMode !== "search") {
      setLayoutMode("search");
      return;
    }

    if (ontologyEnabled && layoutMode === "search" && !layoutTouched) {
      setLayoutMode("split");
    }
  }, [layoutMode, layoutTouched, ontologyEnabled]);

  useEffect(() => {
    if (!shouldUseWorkspaceLayout || ontologyEnabled || mobileActivePane !== "ontology") return;
    setMobileActivePane("search");
  }, [mobileActivePane, ontologyEnabled, setMobileActivePane, shouldUseWorkspaceLayout]);

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

  // Set sidebar content (not in embedded mode unless showFilters is true)
  useEffect(() => {
    if ((!embedded || showFilters) && searchMode === "full-text" && initialSearchType === "search_entities") {
      setSidebarContent(
        <EntityFilterSidebar
          filters={filters}
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
  }, [embedded, showFilters, searchMode, initialSearchType, filters, handleFilterChange, handleClearFilters, setSidebarContent]);

  // Clear identifier results when returning to full-text mode
  useEffect(() => {
    if (searchMode === "full-text") {
      setLookupMatches([]);
      setLookupEntities([]);
      setLookupError(null);
    }
  }, [searchMode]);

  useEffect(() => {
    if (isMobile && searchMode === "batch") {
      setSearchMode("full-text");
    }
  }, [isMobile, searchMode, setSearchMode]);

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
          filters: await buildEntityExportFilters(filters),
          filename: `entities_subset_${date}`,
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
      const data = await resolveEntityIdentifiers(identifiers);
      setLookupMatches((data.matches || []) as IdentifierMatch[]);
      setLookupEntities((data.entities || []) as EntityLike[]);
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
    : searchPaneCompact
      ? "w-full h-full px-4 py-6"
      : "w-full max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-6";
  const ontologyContainerClass = searchPaneCompact
    ? "h-full"
    : "h-full max-w-md mx-auto lg:max-w-none";

  const renderSearchHeader = (inline: boolean) => (
    <div className="border-b bg-background/60 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className={cn(
        inline ? "w-full px-4 py-4 space-y-4" : "w-full max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4"
      )}>
        {/* Unified search module: active input on top + search mode switcher attached below */}
        <div className="w-full space-y-3 rounded-2xl border bg-background/60 p-3 shadow-sm backdrop-blur-sm">
          {searchMode === "full-text" && (
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
              {!isMobile && (
                <Button variant="outline" size="sm" onClick={handleEntityExport} className="h-10 rounded-full">
                  <Download className="h-4 w-4 mr-1.5" />
                  Export
                </Button>
              )}
            </div>
          )}

          {searchMode === "identifier" && (
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

          {!isMobile && searchMode === "batch" && (
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
              {!isMobile && <TabsTrigger value="batch" className="rounded-full">Batch identifiers</TabsTrigger>}
            </TabsList>
          </Tabs>
        </div>
      </div>
    </div>
  );

  // Render content based on embedded mode
  const searchContent = (
    <div className={cn("h-full min-h-0 flex flex-col relative")}>
      {!embedded && showFloatingSearchHeader ? (
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
        {!embedded ? renderSearchHeader(true) : null}
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
        />
      </div>
    </div>
  );

  const workspaceToolbar = !embedded ? (
    <div className="fixed bottom-4 right-4 z-40">
      <div className="inline-flex items-center rounded-full border bg-background/90 p-1 shadow-sm backdrop-blur">
        <Button
          size="sm"
          variant={isMobile ? (effectiveMobilePane === "search" ? "default" : "ghost") : (availableDesktopPanes.includes("search") ? "default" : "ghost")}
          onClick={() => (isMobile ? setMobileActivePane("search") : toggleDesktopPane("search"))}
          className="rounded-full h-8"
        >
          Search
        </Button>
        <Button
          size="sm"
          variant={isMobile ? (effectiveMobilePane === "ontology" ? "default" : "ghost") : (availableDesktopPanes.includes("ontology") ? "default" : "ghost")}
          onClick={() => (isMobile ? setMobileActivePane("ontology") : toggleDesktopPane("ontology"))}
          className="rounded-full h-8"
          disabled={!ontologyEnabled}
        >
          Ontology
        </Button>
        <Button
          size="sm"
          variant={isMobile ? (effectiveMobilePane === "chat" ? "default" : "ghost") : (availableDesktopPanes.includes("chat") ? "default" : "ghost")}
          onClick={() => (isMobile ? setMobileActivePane("chat") : toggleDesktopPane("chat"))}
          className="rounded-full h-8"
        >
          <MessageSquare className="mr-1.5 h-4 w-4" />
          Chat
        </Button>
      </div>
    </div>
  ) : null;

  const desktopPaneContent: Record<SearchWorkspacePane, ReactNode> = {
    search: searchContent,
    ontology: ontologyContent,
    chat: <SearchAssistantPane />,
  };

  const mobileContent = effectiveMobilePane === "search"
    ? searchContent
    : effectiveMobilePane === "ontology"
      ? ontologyContent
      : <SearchAssistantPane />;

  return (
    <div className={cn(
      embedded ? "h-full flex flex-col overflow-hidden" : "flex-1 flex flex-col h-svh overflow-hidden",
      "relative"
    )}>
      {workspaceToolbar}

      <div className="flex-1 min-h-0">
        {embedded ? (
          effectiveLayoutMode === "split" && ontologyEnabled ? (
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
          )
        ) : isMobile ? (
          <div className="h-full">{mobileContent}</div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {availableDesktopPanes.map((pane, index) => (
              <Fragment key={pane}>
                {index > 0 ? <ResizableHandle withHandle /> : null}
                <ResizablePanel
                  defaultSize={Math.floor(100 / availableDesktopPanes.length)}
                  minSize={availableDesktopPanes.length === 1 ? 100 : 20}
                  className="min-h-0"
                >
                  {desktopPaneContent[pane]}
                </ResizablePanel>
              </Fragment>
            ))}
          </ResizablePanelGroup>
        )}
      </div>

      {embedded && showLayoutSwitcherInEmbedded && ontologyEnabled && (
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
