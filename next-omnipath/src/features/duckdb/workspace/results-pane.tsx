"use client";

import { AlertCircle, ArrowRight, Database, LoaderCircle, Minus } from "lucide-react";
import { EntityBadge } from "@/components/entity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useDuckDbWorkspace } from "./context";

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function renderSignIndicator(sign: unknown, isDirected: unknown) {
  const signValue = Number(sign);

  if (isDirected === true) {
    return (
      <ArrowRight
        className={cn(
          "h-4 w-4",
          signValue === 1 ? "text-green-500" : signValue === -1 ? "text-red-500" : "text-muted-foreground",
        )}
      />
    );
  }

  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

export function DuckDbResultsPane() {
  const {
    entitySummaries,
    datasetSource,
    error,
    loading,
    loadingLabel,
    loadingProgress,
    materialized,
    pageIndex,
    pageSize,
    refreshSubset,
    rows,
    rowCount,
    totalCount,
    setPageIndex,
  } = useDuckDbWorkspace();

  const pageStart = rows.length === 0 ? 0 : pageIndex * pageSize + 1;
  const pageEnd = pageIndex * pageSize + rows.length;
  const canPrev = pageIndex > 0;
  const canNext = pageEnd < totalCount;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4">
      <Card className="min-h-0 flex-1 overflow-hidden">

        {error ? (
          <CardContent className="flex items-center gap-3 py-6 text-sm text-destructive">
            <AlertCircle className="size-4" />
            <span>{error}</span>
          </CardContent>
        ) : null}

        {!materialized && !loading && !error ? (
          <CardContent className="py-6 text-sm text-muted-foreground">
            Materialize a subset to begin querying with DuckDB.
          </CardContent>
        ) : null}

        <CardContent className="min-h-0 flex-1 overflow-hidden px-0">
          <ScrollArea className="h-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[35%]">Source</TableHead>
                  <TableHead className="w-[50px] text-center"></TableHead>
                  <TableHead className="w-[35%]">Target</TableHead>
                  <TableHead className="w-[20%] text-center">Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const sourceId = String(row.member_a_id ?? "");
                  const targetId = String(row.member_b_id ?? "");
                  const sourceEntity = entitySummaries.get(sourceId);
                  const targetEntity = entitySummaries.get(targetId);

                  const sourceDisplayName = safeText(sourceEntity?.display_name, sourceId || "—");
                  const sourceCanonicalIdentifier = safeText(sourceEntity?.canonical_identifier, sourceId || "—");
                  const targetDisplayName = safeText(targetEntity?.display_name, targetId || "—");
                  const targetCanonicalIdentifier = safeText(targetEntity?.canonical_identifier, targetId || "—");

                  return (
                    <TableRow key={String(row.interaction_key ?? `${sourceId}-${targetId}`)}>
                      <TableCell className="max-w-0 w-[35%]">
                        <EntityBadge
                          displayName={sourceDisplayName}
                          canonicalIdentifier={sourceCanonicalIdentifier}
                          entityId={sourceEntity?.id || sourceId || undefined}
                          entityType={typeof sourceEntity?.entity_type_name === "string" ? sourceEntity.entity_type_name : undefined}
                        />
                      </TableCell>
                      <TableCell className="w-[50px] text-center">
                        <div className="flex justify-center">{renderSignIndicator(row.sign, row.is_directed)}</div>
                      </TableCell>
                      <TableCell className="max-w-0 w-[35%]">
                        <EntityBadge
                          displayName={targetDisplayName}
                          canonicalIdentifier={targetCanonicalIdentifier}
                          entityId={targetEntity?.id || targetId || undefined}
                          entityType={typeof targetEntity?.entity_type_name === "string" ? targetEntity.entity_type_name : undefined}
                        />
                      </TableCell>
                      <TableCell className="w-[20%] text-center">
                        <Badge variant="outline">{Number(row.evidence_count ?? 0).toLocaleString()}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!loading && rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      No rows match the current local filters.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>

        <div className="flex items-center justify-between border-t px-6 py-3 text-sm">
          <div className="text-muted-foreground">
            {totalCount > 0 ? `Showing ${pageStart}-${pageEnd} of ${totalCount.toLocaleString()} locally filtered rows` : "No rows"}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPageIndex(pageIndex - 1)} disabled={!canPrev || loading}>
              Previous
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPageIndex(pageIndex + 1)} disabled={!canNext || loading}>
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
