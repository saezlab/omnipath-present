"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Search, Download } from "lucide-react";
import { SearchBar } from "@/features/search/components/search-bar";
import { SearchResults } from "@/features/search/components/search-results";
import { IdentifierMatches, type IdentifierMatch } from "@/features/search/components/identifier-matches";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { searchMeilisearch } from "@/features/search/api/queries";
import { useSearchUrlState } from "@/lib/navigation/url-state";
import type { SearchResult } from "@/features/search/components/result-card";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { cn } from "@/lib/utils";

interface EntitiesResultsViewProps {
  lockedEntityIds?: Array<string | number>;
}

type SearchMode = "full-text" | "identifier" | "batch";

export function EntitiesResultsView({ lockedEntityIds = [] }: EntitiesResultsViewProps) {
  const {
    query,
    setQuery,
    mode,
    setMode,
    species,
    setSpecies,
    filters: urlFilters,
  } = useSearchUrlState();
  const [, startTransition] = useTransition();
  const normalizedLockedEntityIds = useMemo(
    () => lockedEntityIds.map((id) => String(id).trim()).filter(Boolean),
    [lockedEntityIds],
  );
  const defaultFilters = useMemo<MeilisearchFilters>(
    () => ({ ncbi_tax_id: [species || "9606"] }),
    [species],
  );
  const filters = useMemo<MeilisearchFilters>(() => {
    const base = Object.keys(urlFilters).length > 0 ? urlFilters : defaultFilters;
    return normalizedLockedEntityIds.length > 0 ? { ...base, entity_ids: normalizedLockedEntityIds } : base;
  }, [defaultFilters, normalizedLockedEntityIds, urlFilters]);

  const [lookupMatches, setLookupMatches] = useState<IdentifierMatch[]>([]);
  const [lookupEntities, setLookupEntities] = useState<SearchResult[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [identifierInput, setIdentifierInput] = useState(query || "");
  const [batchInput, setBatchInput] = useState("");

  const fetchSearchData = useCallback(async (offset: number, limit: number) => {
    if (mode !== "full-text") {
      return { results: [], totalResults: 0 };
    }

    const response = await searchMeilisearch({
      query: query || "",
      index: "search_entities",
      limit,
      offset,
      filters,
    });

    return {
      results: (response.hits as SearchResult[]) || [],
      totalResults: ("estimatedTotalHits" in response ? response.estimatedTotalHits as number : 0) || 0,
    };
  }, [filters, mode, query]);

  const { data: results, loading, loadingMore, hasMore, sentinelRef } = useInfiniteScroll<SearchResult>({
    fetchData: fetchSearchData,
    pageSize: 20,
    dependencies: [query, mode, filters],
  });

  const handleSpeciesChange = useCallback((nextSpecies: string) => {
    setSpecies(nextSpecies);
  }, [setSpecies]);

  const handleEntityExport = useCallback(async () => {
    try {
      setLookupError(null);
      const date = new Date().toISOString().split("T")[0];
      const response = await fetch("/api/exports/entities/parquet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query || "",
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
      const contentDisposition = response.headers.get("Content-Disposition");
      const fileNameMatch = contentDisposition?.match(/filename="?([^";]+)"?/i);
      const fileName = fileNameMatch?.[1] || `entities_subset_${date}.parquet`;
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Failed to export entities");
    }
  }, [filters, query]);

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
    startTransition(() => void runLookup([trimmed]));
  }, [identifierInput, runLookup, startTransition]);

  const handleBatchLookup = useCallback(() => {
    const ids = batchInput.split(/[\n,]/).map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) {
      setLookupError("Please enter at least one identifier.");
      return;
    }
    startTransition(() => void runLookup(ids));
  }, [batchInput, runLookup, startTransition]);

  useEffect(() => {
    if (mode === "full-text") {
      setLookupMatches([]);
      setLookupEntities([]);
      setLookupError(null);
    }
  }, [mode]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b bg-background/60 backdrop-blur-md">
        <div className="w-full px-4 py-4 space-y-4">
          <div className="w-full space-y-3 rounded-2xl border bg-background/60 p-3 shadow-sm">
            {mode === "full-text" && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <SearchBar
                    placeholder="Search proteins, molecules, ontology terms…"
                    onSearch={setQuery}
                    initialQuery={query}
                    autoFocus={false}
                    selectedSpecies={species}
                    onSpeciesChange={handleSpeciesChange}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={handleEntityExport} className="h-10 rounded-full">
                  <Download className="mr-1.5 h-4 w-4" />
                  Export
                </Button>
              </div>
            )}

            {mode === "identifier" && (
              <div className="relative rounded-full border bg-background">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Enter one identifier"
                  className="h-12 rounded-full border-0 pl-12 pr-[100px] text-lg focus-visible:ring-0"
                  value={identifierInput}
                  onChange={(e) => setIdentifierInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleIdentifierLookup()}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <Button onClick={handleIdentifierLookup} disabled={lookupLoading} className="h-8 rounded-full px-4">
                    Look up
                  </Button>
                </div>
              </div>
            )}

            {mode === "batch" && (
              <div className="flex flex-col gap-3 rounded-xl border bg-background/50 p-1 shadow-sm">
                <Textarea
                  placeholder="Paste comma or newline separated identifiers"
                  value={batchInput}
                  onChange={(e) => setBatchInput(e.target.value)}
                  rows={4}
                  className="min-h-[100px] resize-none border-0 bg-transparent focus-visible:ring-0"
                />
                <div className="flex items-center justify-between px-3 pb-2">
                  <p className="text-xs text-muted-foreground">We will look up all identifiers and group candidate entities for each.</p>
                  <Button onClick={handleBatchLookup} disabled={lookupLoading} size="sm" className="rounded-full">
                    Run lookup
                  </Button>
                </div>
              </div>
            )}

            <Tabs value={mode} onValueChange={(value) => setMode(value as SearchMode)} className="w-full">
              <TabsList className="h-auto w-full justify-start rounded-full bg-muted/60 p-1">
                <TabsTrigger value="full-text" className="rounded-full">Full text</TabsTrigger>
                <TabsTrigger value="identifier" className="rounded-full">Identifier lookup</TabsTrigger>
                <TabsTrigger value="batch" className="rounded-full">Batch identifiers</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      <div className={cn("min-h-0 flex-1 overflow-y-auto p-4")}>
        {mode === "full-text" ? (
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
  );
}
