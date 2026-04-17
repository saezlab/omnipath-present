"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Search, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEntitySelection } from "@/contexts/entity-selection-context";
import { browseTopOntologyTerms, searchOntologyTerms } from "@/features/explore/api/queries";
import { FilterSidebar } from "@/features/interactions-search/components/filter-sidebar";
import { InteractionsExploreTab } from "@/features/explore/components/interactions-explore-tab";
import { searchMeilisearch } from "@/features/search/api/queries";
import { EntityFilterSidebar } from "@/features/search/components/entity-filter-sidebar";
import type { SearchResult } from "@/features/search/components/result-card";
import { SearchResults } from "@/features/search/components/search-results";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useIsMobile } from "@/hooks/use-mobile";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { formatNumber } from "@/lib/utils";

const exploreTabParser = parseAsStringLiteral(["entities", "interactions", "annotations"] as const).withDefault("entities");
const speciesParser = parseAsString.withDefault("9606");
const queryParser = parseAsString.withDefault("");

const SPECIES_OPTIONS = [
  { value: "9606", label: "Human" },
  { value: "10090", label: "Mouse" },
  { value: "10116", label: "Rat" },
  { value: "7227", label: "Fruit fly" },
  { value: "6239", label: "C. elegans" },
  { value: "7955", label: "Zebrafish" },
] as const;

function buildSelectionHref(entityIds: string[], annotationIds: string[]) {
  const params = new URLSearchParams();
  if (entityIds.length > 0) params.set("entities", entityIds.join(","));
  if (annotationIds.length > 0) params.set("annotations", annotationIds.join(","));
  return `/selection${params.toString() ? `?${params.toString()}` : ""}`;
}

function LoadingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="h-48 rounded-2xl border bg-muted/30 animate-pulse" />
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

function AnnotationResults({ query }: { query: string }) {
  const { addAnnotation, isAnnotationSelected, removeAnnotation } = useEntitySelection();
  const { data, isLoading } = useQuery({
    queryKey: ["explore-annotations", query],
    queryFn: () => (query.trim().length > 0 ? searchOntologyTerms(query, 30) : browseTopOntologyTerms(undefined, 30)),
    staleTime: 60_000,
  });

  const results = data || [];

  if (isLoading) {
    return <LoadingGrid />;
  }

  if (results.length === 0) {
    return (
      <EmptyState
        title="No annotations found"
        description={query.trim().length > 0
          ? "Try a different ontology term, synonym, or ID such as GO:0005634 or MI:0217."
          : "No annotation terms are available to browse right now."}
      />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {results.map((term) => {
        const selected = isAnnotationSelected(term.id);

        return (
          <Card key={term.id} className="h-full transition-shadow hover:shadow-sm">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base leading-tight">{term.label}</CardTitle>
                  <CardDescription className="font-mono text-xs">{term.id}</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  onClick={() => {
                    if (selected) {
                      removeAnnotation(term.id);
                      return;
                    }
                    addAnnotation({
                      id: term.id,
                      label: term.label,
                      namespace: term.namespace || undefined,
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
                {term.namespace ? <Badge variant="outline">{term.namespace}</Badge> : null}
                {typeof term.entityCount === "number" ? <Badge variant="secondary">{formatNumber(term.entityCount)} entities</Badge> : null}
                {term.matchType ? <Badge variant="secondary">{term.matchType}</Badge> : null}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground line-clamp-4">
                {term.definition || "No definition available for this ontology term."}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function ExplorePage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [entitiesScrollRoot, setEntitiesScrollRoot] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useQueryState("tab", exploreTabParser);
  const [query, setQuery] = useQueryState("q", queryParser);
  const [species, setSpecies] = useQueryState("species", speciesParser);
  const [draftQuery, setDraftQuery] = useState(query);
  const {
    entityIds,
    annotationIds,
    totalSelectionCount,
  } = useEntitySelection();

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  const [entityFilters, setEntityFilters] = useState<MeilisearchFilters>({ ncbi_tax_id: [species || "9606"] });
  const [entityFilterCounts, setEntityFilterCounts] = useState<{
    entity_type?: Record<string, number>;
    sources?: Record<string, number>;
    ncbi_tax_id?: Record<string, number>;
  }>({});
  const [interactionFilters, setInteractionFilters] = useState<MeilisearchFilters>({});
  const [interactionFilterCounts, setInteractionFilterCounts] = useState<Record<string, Record<string, number>>>({});

  const submitSearch = useCallback(() => {
    void setQuery(draftQuery.trim() || null);
  }, [draftQuery, setQuery]);

  useEffect(() => {
    setEntityFilters((prev) => ({
      ...prev,
      ncbi_tax_id: species ? [species] : ["9606"],
    }));
  }, [species]);

  const handleEntityFilterChange = useCallback((next: { entity_types?: string[]; sources?: string[]; ncbi_tax_id?: string[] }) => {
    setEntityFilters(next);
    const nextSpecies = next.ncbi_tax_id?.[0];
    if (nextSpecies && nextSpecies !== species) {
      void setSpecies(nextSpecies);
    }
  }, [setSpecies, species]);

  const handleEntityClearFilters = useCallback(() => {
    const next = { ncbi_tax_id: [species || "9606"] };
    setEntityFilters(next);
  }, [species]);

  const handleInteractionFilterChange = useCallback((next: MeilisearchFilters) => {
    setInteractionFilters(next);
  }, []);

  const handleInteractionClearFilters = useCallback(() => {
    setInteractionFilters({});
  }, []);

  const {
    data: entityResults,
    loading: entitiesLoading,
    loadingMore: entitiesLoadingMore,
    hasMore: entitiesHasMore,
    sentinelRef: entitiesSentinelRef,
  } = useInfiniteScroll<SearchResult>({
    root: isMobile ? null : entitiesScrollRoot,
    fetchData: useCallback(async (offset: number, limit: number) => {
      if (tab !== "entities") {
        return { results: [], totalResults: 0 };
      }

      const response = await searchMeilisearch({
        query: query || "",
        index: "search_entities",
        limit,
        offset,
        filters: entityFilters,
        facets: ["entity_type", "sources", "ncbi_tax_id"],
      });

      if (offset === 0) {
        const facetDistribution = response.facetDistribution || {};
        setEntityFilterCounts({
          entity_type: facetDistribution.entity_type || {},
          sources: facetDistribution.sources || {},
          ncbi_tax_id: facetDistribution.ncbi_tax_id || {},
        });
      }

      return {
        results: (response.hits as SearchResult[]) || [],
        totalResults: response.estimatedTotalHits || 0,
      };
    }, [entityFilters, query, tab]),
    pageSize: 20,
    dependencies: [query, entityFilters, tab],
  });


  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isTypingTarget = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable;

      if (event.key === "/" && !isTypingTarget) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      if ((event.key === "s" || event.key === "S") && !isTypingTarget && totalSelectionCount > 0) {
        event.preventDefault();
        router.push(buildSelectionHref(entityIds, annotationIds));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [annotationIds, entityIds, router, totalSelectionCount]);

  const selectionHref = useMemo(() => buildSelectionHref(entityIds, annotationIds), [annotationIds, entityIds]);

  const entityFilterPane = (
    <div className="h-full overflow-y-auto p-4">
      <EntityFilterSidebar
        filters={{
          entity_types: entityFilters.entity_types,
          sources: entityFilters.sources,
          ncbi_tax_id: entityFilters.ncbi_tax_id,
        }}
        filterCounts={entityFilterCounts}
        onFilterChange={handleEntityFilterChange}
        onClearFilters={handleEntityClearFilters}
      />
    </div>
  );

  const interactionFilterPane = (
    <div className="h-full overflow-y-auto p-4">
      <FilterSidebar
        filters={interactionFilters}
        filterCounts={interactionFilterCounts}
        onFilterChange={handleInteractionFilterChange}
        onClearFilters={handleInteractionClearFilters}
      />
    </div>
  );

  return (
    <div className="relative mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 overflow-hidden px-4 py-4 md:px-6 md:py-5">
      <div className="shrink-0 space-y-3">
        <div className="rounded-[1.4rem] border bg-card p-2.5 shadow-sm">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground" />
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
                placeholder={tab === "annotations" ? "Search annotations…" : tab === "interactions" ? "Search interactions…" : "Search entities…"}
                className="h-11 rounded-[1rem] border-0 bg-muted/40 pl-10 text-sm shadow-none sm:text-base"
              />
            </div>

            <div className="flex items-center gap-2 lg:shrink-0">
              {tab !== "annotations" ? (
                <select
                  value={species}
                  onChange={(event) => void setSpecies(event.target.value || null)}
                  className="h-9 rounded-lg border bg-background px-3 text-sm"
                >
                  {SPECIES_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : null}
              <Button onClick={submitSearch} className="h-9 rounded-lg px-3.5 text-sm">
                Search
              </Button>
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <Tabs value={tab} onValueChange={(value) => void setTab(value as "entities" | "interactions" | "annotations") } className="min-w-0 flex-1">
              <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl bg-muted/60 p-1">
                <TabsTrigger value="entities" className="rounded-lg text-sm">Entities</TabsTrigger>
                <TabsTrigger value="interactions" className="rounded-lg text-sm">Interactions</TabsTrigger>
                <TabsTrigger value="annotations" className="rounded-lg text-sm">Annotations</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="hidden shrink-0 text-xs text-muted-foreground md:block">/ focuses search</div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

        <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "entities" ? (
          isMobile ? (
            <div
              ref={setEntitiesScrollRoot}
              className="h-full overflow-y-auto"
            >
              {entitiesLoading && entityResults.length === 0 ? (
                <LoadingGrid />
              ) : entityResults.length > 0 ? (
                <SearchResults
                  results={entityResults}
                  loading={entitiesLoading}
                  loadingMore={entitiesLoadingMore}
                  hasMore={entitiesHasMore}
                  sentinelRef={entitiesSentinelRef}
                />
              ) : (
                <EmptyState
                  title="No entities found"
                  description="Try a gene symbol, UniProt identifier, small molecule name, or broader text query."
                />
              )}
            </div>
          ) : (
            <div className="h-full min-h-[60vh] overflow-hidden rounded-2xl border bg-background/30">
              <ResizablePanelGroup direction="horizontal" className="h-full">
                <ResizablePanel defaultSize={72} minSize={45} className="min-h-0 overflow-hidden">
                  <div
                    ref={setEntitiesScrollRoot}
                    className="h-full overflow-y-auto p-4"
                  >
                    {entitiesLoading && entityResults.length === 0 ? (
                      <LoadingGrid />
                    ) : entityResults.length > 0 ? (
                      <SearchResults
                        results={entityResults}
                        loading={entitiesLoading}
                        loadingMore={entitiesLoadingMore}
                        hasMore={entitiesHasMore}
                        sentinelRef={entitiesSentinelRef}
                      />
                    ) : (
                      <EmptyState
                        title="No entities found"
                        description="Try a gene symbol, UniProt identifier, small molecule name, or broader text query."
                      />
                    )}
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={28} minSize={22} className="min-h-0 border-l bg-background/40">
                  {entityFilterPane}
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          )
        ) : null}

        {tab === "interactions" ? (
          isMobile ? (
            <div className="min-h-[60vh]">
              <InteractionsExploreTab
                filters={interactionFilters}
                onFilterChange={handleInteractionFilterChange}
                onFilterCountsUpdate={setInteractionFilterCounts}
                useInternalRefineLayout={false}
              />
            </div>
          ) : (
            <div className="h-full min-h-[60vh] overflow-hidden rounded-2xl border bg-background/30">
              <ResizablePanelGroup direction="horizontal" className="h-full">
                <ResizablePanel defaultSize={72} minSize={45} className="min-h-0 overflow-hidden">
                  <InteractionsExploreTab
                    filters={interactionFilters}
                    onFilterChange={handleInteractionFilterChange}
                    onFilterCountsUpdate={setInteractionFilterCounts}
                    useInternalRefineLayout={false}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={28} minSize={22} className="min-h-0 border-l bg-background/40">
                  {interactionFilterPane}
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          )
        ) : null}

        {tab === "annotations" ? (
          <div className="h-full overflow-y-auto">
            <AnnotationResults query={query} />
          </div>
        ) : null}
        </div>
      </div>

      {totalSelectionCount > 0 ? (
        <Button asChild size="lg" className="fixed bottom-6 right-6 z-40 h-12 rounded-full px-4 shadow-lg">
          <Link href={selectionHref} className="flex items-center gap-2">
            <span>Open Selection</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs">
              {totalSelectionCount}
            </Badge>
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
