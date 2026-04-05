"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEntitySelection } from "@/contexts/entity-selection-context";
import { OntologyTermLabel } from "@/features/ontology/ontology-term-label";
import { formatNumber } from "@/lib/utils";
import { useDuckDbAnnotationWorkspace } from "./context";

export function DuckDbAnnotationResultsPane() {
  const {
    entitySummaries,
    focusedEntityKey,
    mode,
    pageIndex,
    pageSize,
    resourceIds,
    rows,
    selectedRowKeys,
    selectedTerms,
    setFocusedEntityKey,
    setPageIndex,
    toggleSelectedRow,
    totalCount,
  } = useDuckDbAnnotationWorkspace();
  const { addEntity } = useEntitySelection();

  const pageStart = rows.length === 0 ? 0 : pageIndex * pageSize + 1;
  const pageEnd = pageIndex * pageSize + rows.length;
  const canPrev = pageIndex > 0;
  const canNext = pageEnd < totalCount;

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedRowKeys.includes(row.key)),
    [rows, selectedRowKeys],
  );

  function saveRows(targetRows: typeof rows) {
    targetRows.forEach((row) => {
      const summary = entitySummaries.get(row.key);
      addEntity({
        id: row.key,
        entityId: row.entity_id,
        name: summary?.display_name || summary?.canonical_identifier || row.entity_id,
        type: summary?.entity_type_name || row.entity_type || undefined,
        cv_terms: row.matched_terms,
      });
    });
  }

  if (mode === "entities_to_annotations") {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden p-4">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle>Entities → Annotations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Entity-set enrichment is coming next.</p>
            <p>For now, switch back to <span className="font-medium text-foreground">Annotations → Entities</span> to search ontology terms and collect matching entities.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4">
      <Card className="min-h-0 flex-1 overflow-hidden">
        <CardHeader className="border-b space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Matching entities</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                {selectedTerms.length > 0
                  ? `${formatNumber(totalCount)} entity rows across ${formatNumber(resourceIds.length)} selected resources`
                  : "Select ontology terms to query matching entities."}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => saveRows(selectedRows)} disabled={selectedRows.length === 0}>
                Save selected rows
              </Button>
              <Button size="sm" onClick={() => saveRows(rows)} disabled={rows.length === 0}>
                Save visible rows
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/selection">Open selection</Link>
              </Button>
            </div>
          </div>
          {selectedTerms.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedTerms.map((termId) => <Badge key={termId} variant="secondary"><OntologyTermLabel termId={termId} /></Badge>)}
            </div>
          ) : null}
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-hidden px-0">
          <ScrollArea className="h-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Identifier</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Taxonomy</TableHead>
                  <TableHead className="text-right">Matched terms</TableHead>
                  <TableHead>Resource</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const summary = entitySummaries.get(row.key);
                  const isSelected = selectedRowKeys.includes(row.key);
                  const isFocused = focusedEntityKey === row.key;
                  return (
                    <TableRow
                      key={row.key}
                      className={isFocused ? "bg-muted/30" : undefined}
                      onClick={() => setFocusedEntityKey(row.key)}
                    >
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleSelectedRow(row.key)} aria-label={`Select ${row.key}`} />
                      </TableCell>
                      <TableCell className="font-medium">{summary?.display_name || row.entity_id}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{summary?.canonical_identifier || row.entity_id}</TableCell>
                      <TableCell>{summary?.entity_type_name || row.entity_type || "—"}</TableCell>
                      <TableCell>{row.taxonomy_id || "—"}</TableCell>
                      <TableCell className="text-right">{formatNumber(row.matched_term_count)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.resource_id}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      {selectedTerms.length > 0 ? "No entities match the current term selection." : "Add ontology terms to begin."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>

        <div className="flex items-center justify-between border-t px-6 py-3 text-sm">
          <div className="text-muted-foreground">
            {totalCount > 0 ? `Showing ${pageStart}-${pageEnd} of ${formatNumber(totalCount)} rows` : "No rows"}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPageIndex(pageIndex - 1)} disabled={!canPrev}>
              Previous
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPageIndex(pageIndex + 1)} disabled={!canNext}>
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
