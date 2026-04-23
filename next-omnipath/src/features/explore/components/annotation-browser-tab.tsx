"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { searchOntologyTerms, searchScopedOntologyTerms, getOntologyPrefixes, type ScopedOntologyTerm } from "@/lib/queries/ontology-term";
import type { OntologyTerm } from "@next-omnipath/drizzle";
import { useEntitySelection } from "@/lib/navigation/url-state";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useCallback, useState } from "react";

interface AnnotationBrowserTabProps {
  query: string;
  species?: string;
  scopedEntityIds?: string[];
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

export function AnnotationBrowserTab({ query, scopedEntityIds }: AnnotationBrowserTabProps) {
  const isScoped = !!scopedEntityIds?.length;
  const [selectedPrefixes, setSelectedPrefixes] = useState<string[]>([]);

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
  });

  const togglePrefix = (prefix: string) => {
    setSelectedPrefixes((prev) =>
      prev.includes(prefix) ? prev.filter((p) => p !== prefix) : [...prev, prefix]
    );
  };

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Prefix chips */}
      <div className="shrink-0 px-1 pt-1">
        <div className="flex flex-wrap gap-1.5">
          {(prefixes || []).map((prefix) => (
            <Button
              key={prefix}
              size="sm"
              variant={selectedPrefixes.includes(prefix) ? "default" : "outline"}
              onClick={() => togglePrefix(prefix)}
              className="h-7 text-xs px-2.5"
            >
              {prefix}
            </Button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1">
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
    </div>
  );
}
