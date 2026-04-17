"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Tag } from "lucide-react";
import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveOntologyTerms } from "@/features/explore/api/queries";
import { searchMeilisearch } from "@/features/search/api/queries";
import { useEntitySelection } from "@/lib/navigation/url-state";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { formatNumber } from "@/lib/utils";

interface SelectionAnnotationsViewProps {
  scopedEntityIds: string[];
  query: string;
  filters?: MeilisearchFilters;
}

interface ScopedAnnotationTerm {
  id: string;
  label: string;
  namespace?: string | null;
  definition?: string | null;
  entityCount: number;
}

async function fetchScopedAnnotationTerms(scopedEntityIds: string[], filters: MeilisearchFilters = {}): Promise<ScopedAnnotationTerm[]> {
  if (scopedEntityIds.length === 0) return [];

  const pageSize = 250;
  const counts = new Map<string, number>();

  for (let index = 0; index < scopedEntityIds.length; index += pageSize) {
    const batch = scopedEntityIds.slice(index, index + pageSize);
    const response = await searchMeilisearch({
      query: "",
      index: "search_entities",
      limit: batch.length,
      offset: 0,
      filters: { ...filters, entity_ids: batch },
    });

    for (const hit of response.hits || []) {
      const rawTerms = Array.isArray(hit.ontology_terms)
        ? hit.ontology_terms
        : Array.isArray(hit.cv_terms)
          ? hit.cv_terms
          : [];

      const uniqueTerms = new Set(rawTerms.map((term) => String(term).trim()).filter(Boolean));
      uniqueTerms.forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
    }
  }

  const termIds = Array.from(counts.keys());
  if (termIds.length === 0) return [];

  const resolved = await resolveOntologyTerms(termIds);
  return termIds
    .map((termId) => ({
      id: termId,
      label: resolved[termId]?.label || termId,
      namespace: resolved[termId]?.namespace,
      definition: resolved[termId]?.definition,
      entityCount: counts.get(termId) || 0,
    }))
    .sort((a, b) => b.entityCount - a.entityCount || a.label.localeCompare(b.label));
}

export function SelectionAnnotationsView({ scopedEntityIds, query, filters = {} }: SelectionAnnotationsViewProps) {
  const { addAnnotation, isAnnotationSelected, removeAnnotation } = useEntitySelection();

  const { data, isLoading } = useQuery({
    queryKey: ["selection-scoped-annotations", scopedEntityIds, filters],
    queryFn: () => fetchScopedAnnotationTerms(scopedEntityIds, filters),
    enabled: scopedEntityIds.length > 0,
    staleTime: 60_000,
  });

  const filteredTerms = useMemo(() => {
    const terms = data || [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return terms;

    return terms.filter((term) =>
      term.id.toLowerCase().includes(normalizedQuery)
      || term.label.toLowerCase().includes(normalizedQuery)
      || term.namespace?.toLowerCase().includes(normalizedQuery)
      || term.definition?.toLowerCase().includes(normalizedQuery),
    );
  }, [data, query]);

  if (scopedEntityIds.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          Add entities or annotations in Explore to build a scoped annotation set.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-48 animate-pulse rounded-2xl border bg-muted/30" />)}</div>;
  }

  if (filteredTerms.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          {query.trim() ? "No scoped annotations match this search." : "No annotations were found in the current scoped entity set."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {filteredTerms.map((term) => {
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
                <Badge variant="secondary">{formatNumber(term.entityCount)} entities</Badge>
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
