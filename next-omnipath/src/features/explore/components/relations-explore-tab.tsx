"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRelationFilterOptions } from "@/lib/queries/relation";
import { cn, formatNumber } from "@/lib/utils";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

function LoadingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-64 animate-pulse rounded-2xl border bg-muted/30" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <div className="text-lg font-semibold">No relations found</div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          No predicate types are available to browse right now.
        </p>
      </CardContent>
    </Card>
  );
}

export function RelationsExploreTab() {
  const [filter, setFilter] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["predicates-by-relation-category"],
    queryFn: getRelationFilterOptions,
    staleTime: 60_000,
  });

  const groups = data
    ? Object.entries(data.predicatesByCategory).map(([relationCategory, predicates]) => ({
        relationCategory,
        predicates,
      }))
    : [];

  const filteredGroups = groups
    .map((group) => {
      const predicates = filter.trim()
        ? group.predicates.filter((p) => p.toLowerCase().includes(filter.toLowerCase()))
        : group.predicates;
      return { ...group, predicates };
    })
    .filter((group) => group.predicates.length > 0);

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      <div className="shrink-0 px-1 pt-1">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter predicates…"
            className="h-9 rounded-lg border-0 bg-muted/40 pl-9 text-sm shadow-none"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-1">
        {isLoading ? (
          <LoadingGrid />
        ) : filteredGroups.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredGroups.map((group) => (
              <Card key={group.relationCategory} className="h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base capitalize">{group.relationCategory}</CardTitle>
                    <Badge variant="secondary">{formatNumber(group.predicates.length)}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {group.predicates.map((predicate) => (
                      <Badge
                        key={predicate}
                        variant="outline"
                        className={cn(
                          "cursor-default px-2 py-0.5 text-xs font-normal",
                          filter.trim() && predicate.toLowerCase().includes(filter.toLowerCase()) && "bg-primary/10"
                        )}
                      >
                        {predicate}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}
