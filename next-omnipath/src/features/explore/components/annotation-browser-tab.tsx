"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { browseAnnotationTerms, type ExploreOntologyTerm } from "@/lib/annotation";
import { useEntitySelection } from "@/lib/navigation/url-state";
import type { SearchFilters } from "@/types/search";

interface AnnotationBrowserTabProps {
  query: string;
  species?: string;
  scopedEntityIds?: string[];
  entityFilters?: SearchFilters;
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

function AnnotationCards({ results }: { results: ExploreOntologyTerm[] }) {
  const { addAnnotation, isAnnotationSelected, removeAnnotation } = useEntitySelection();

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
                  {typeof term.annotatedEntityCount === "number" ? (
                    <CardDescription className="text-xs">
                      {term.annotatedEntityCount.toLocaleString()} annotated entities
                    </CardDescription>
                  ) : null}
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
                {term.matchType ? <Badge variant="secondary">{term.matchType}</Badge> : null}
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

export function AnnotationBrowserTab({ query, species, scopedEntityIds, entityFilters = {} }: AnnotationBrowserTabProps) {
  const isScoped = !!scopedEntityIds?.length;

  const { data, isLoading } = useQuery({
    queryKey: isScoped
      ? ["selection-scoped-annotations", query, scopedEntityIds, entityFilters]
      : ["explore-annotations", query, species],
    queryFn: () => browseAnnotationTerms({
      query,
      species,
      scopedEntityIds,
      entityFilters,
      limit: 30,
    }),
    enabled: !isScoped || (scopedEntityIds?.length || 0) > 0,
    staleTime: 60_000,
  });

  const results = data || [];

  if (isScoped && !(scopedEntityIds?.length)) {
    return (
      <EmptyState
        title="No scoped annotations"
        description="Add entities or annotations in Explore to build a scoped annotation set."
      />
    );
  }

  if (isLoading) {
    return <LoadingGrid />;
  }

  if (results.length === 0) {
    return (
      <EmptyState
        title={isScoped ? "No annotations found" : "No annotations found"}
        description={isScoped
          ? (query.trim() ? "No scoped annotations match this search." : "No annotations were found in the current scoped entity set.")
          : (query.trim().length > 0
            ? "Try a different ontology term, synonym, or ID such as GO:0005634 or MI:0217."
            : "No annotation terms are available to browse right now.")}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto p-1">
      <AnnotationCards results={results} />
    </div>
  );
}
