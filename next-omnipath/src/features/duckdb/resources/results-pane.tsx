"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, ArrowRight, Minus } from "lucide-react";
import { EntityBadge } from "@/components/entity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OntologyTermLabel } from "@/features/ontology/ontology-term-label";
import { CvTermHoverCard, ResultCard } from "@/features/search/components/result-card";
import { cn } from "@/lib/utils";
import { useDuckDbResourceWorkspace } from "./context";

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function toUnknownArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function") {
    return toUnknownArray(value.toJSON());
  }
  return [];
}

function splitLabelAndId(value: string): { label: string; id?: string } {
  const normalized = value.trim();
  const accessionFirst = normalized.match(/^([A-Z]+:\d+):(.+)$/);
  if (accessionFirst) return { id: accessionFirst[1], label: accessionFirst[2] };
  const accessionLast = normalized.match(/^(.*?):([A-Z]+:\d+)$/);
  if (accessionLast) return { label: accessionLast[1], id: accessionLast[2] };
  return { label: value };
}

function renderCvValue(value: unknown, fallback = "—"): ReactNode {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return fallback;
  if (value.trim().length === 0) return fallback;
  const { label, id } = splitLabelAndId(value);
  if (!id) return label;
  return (
    <CvTermHoverCard termId={id}>
      <span className="cursor-help underline decoration-dotted underline-offset-2">
        <OntologyTermLabel termId={id} />
      </span>
    </CvTermHoverCard>
  );
}

function renderInteractionType(value: unknown): ReactNode {
  if (typeof value !== "string" || value.trim().length === 0) return "—";
  const parts = value.split("|").map((part) => part.trim()).filter(Boolean);
  return (
    <span>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 ? " · " : null}
          {renderCvValue(part)}
        </span>
      ))}
    </span>
  );
}

function toAttributeRow(value: unknown): { term?: unknown; value?: unknown; unit?: unknown } {
  if (!value || typeof value !== "object") return { value };
  const entry = value as Record<string, unknown>;
  return {
    term: entry.term,
    value: entry.value,
    unit: entry.unit,
  };
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

export function DuckDbResourceResultsPane() {
  const {
    entitySummaries,
    error,
    getEntityById,
    loading,
    materialized,
    pageIndex,
    pageSize,
    rows,
    totalCount,
    setPageIndex,
  } = useDuckDbResourceWorkspace();

  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [selectedEntityA, setSelectedEntityA] = useState<any | null>(null);
  const [selectedEntityB, setSelectedEntityB] = useState<any | null>(null);

  useEffect(() => {
    if (!selectedRow) {
      setSelectedEntityA(null);
      setSelectedEntityB(null);
      return;
    }
    const entityAId = String(selectedRow.entity_a_id ?? "");
    const entityBId = String(selectedRow.entity_b_id ?? "");
    void Promise.all([
      entityAId ? getEntityById(entityAId) : Promise.resolve(null),
      entityBId ? getEntityById(entityBId) : Promise.resolve(null),
    ]).then(([entityA, entityB]) => {
      setSelectedEntityA(entityA);
      setSelectedEntityB(entityB);
    });
  }, [getEntityById, selectedRow]);

  const pageStart = rows.length === 0 ? 0 : pageIndex * pageSize + 1;
  const pageEnd = pageIndex * pageSize + rows.length;
  const canPrev = pageIndex > 0;
  const canNext = pageEnd < totalCount;

  const detailSections = useMemo(() => {
    if (!selectedRow) return [];
    return [
      { title: "Record attributes", items: toUnknownArray(selectedRow.record_attributes) },
      { title: "Entity A attributes", items: toUnknownArray(selectedRow.entity_a_attributes) },
      { title: "Entity B attributes", items: toUnknownArray(selectedRow.entity_b_attributes) },
      { title: "Evidence", items: toUnknownArray(selectedRow.evidence) },
    ].filter((section) => section.items.length > 0);
  }, [selectedRow]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4">
      <Card className="min-h-0 flex-1 overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>Resource interactions</CardTitle>
        </CardHeader>

        {error ? (
          <CardContent className="flex items-center gap-3 py-6 text-sm text-destructive">
            <AlertCircle className="size-4" />
            <span>{error}</span>
          </CardContent>
        ) : null}

        {!materialized && !loading && !error ? (
          <CardContent className="py-6 text-sm text-muted-foreground">
            Open one or more resources to begin querying with DuckDB.
          </CardContent>
        ) : null}

        <CardContent className="min-h-0 flex-1 overflow-hidden px-0">
          <ScrollArea className="h-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[38%]">Entity A</TableHead>
                  <TableHead className="w-[44px] text-center"></TableHead>
                  <TableHead className="w-[38%]">Entity B</TableHead>
                  <TableHead>Resource</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const sourceId = String(row.entity_a_id ?? "");
                  const targetId = String(row.entity_b_id ?? "");
                  const sourceEntity = entitySummaries.get(sourceId);
                  const targetEntity = entitySummaries.get(targetId);
                  const rowKey = String(row.interaction_id ?? `${sourceId}-${targetId}`);
                  const selectedRowKey = selectedRow ? String(selectedRow.interaction_id ?? `${selectedRow.entity_a_id ?? ""}-${selectedRow.entity_b_id ?? ""}`) : null;
                  const isOpen = selectedRowKey === rowKey;

                  return (
                    <Fragment key={rowKey}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setSelectedRow(isOpen ? null : row)}
                      >
                        <TableCell className="max-w-0">
                          <div className="max-w-[260px] min-w-0">
                            <EntityBadge
                              displayName={safeText(sourceEntity?.display_name, sourceId || "—")}
                              canonicalIdentifier={safeText(sourceEntity?.canonical_identifier, sourceId || "—")}
                              entityId={sourceEntity?.id || sourceId || undefined}
                              entityType={typeof sourceEntity?.entity_type_name === "string" ? sourceEntity.entity_type_name : undefined}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center">{renderSignIndicator(row.sign, row.is_directed)}</div>
                        </TableCell>
                        <TableCell className="max-w-0">
                          <div className="max-w-[260px] min-w-0">
                            <EntityBadge
                              displayName={safeText(targetEntity?.display_name, targetId || "—")}
                              canonicalIdentifier={safeText(targetEntity?.canonical_identifier, targetId || "—")}
                              entityId={targetEntity?.id || targetId || undefined}
                              entityType={typeof targetEntity?.entity_type_name === "string" ? targetEntity.entity_type_name : undefined}
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{safeText(row.resource_id, safeText(row.source, "—"))}</Badge>
                        </TableCell>
                      </TableRow>
                      {isOpen ? (
                        <TableRow key={`${rowKey}-details`} className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={4} className="p-4 align-top">
                            <div className="space-y-1 pb-4">
                              <h3 className="font-semibold">Interaction details</h3>
                              <p className="text-sm text-muted-foreground">
                                Evidence and attribute payloads from the selected gold interaction row.
                              </p>
                            </div>

                            {(selectedEntityA || selectedEntityB) ? (
                              <div className="grid gap-4 pb-4 md:grid-cols-2">
                                {selectedEntityA ? <ResultCard result={selectedEntityA} /> : <div className="text-sm text-muted-foreground">No entity A details available.</div>}
                                {selectedEntityB ? <ResultCard result={selectedEntityB} /> : <div className="text-sm text-muted-foreground">No entity B details available.</div>}
                              </div>
                            ) : null}

                            {detailSections.length > 0 ? detailSections.map((section) => (
                              <div key={section.title} className="space-y-2 pb-4 last:pb-0">
                                <h3 className="text-sm font-semibold">{section.title}</h3>
                                <div className="overflow-hidden rounded-lg border bg-background">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="w-[34%]">Term</TableHead>
                                        <TableHead>Value</TableHead>
                                        <TableHead className="w-[20%]">Unit</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {section.items.map((item, index) => {
                                        const detailRow = toAttributeRow(item);
                                        return (
                                          <TableRow key={`${section.title}-${index}`}>
                                            <TableCell>{renderCvValue(detailRow.term)}</TableCell>
                                            <TableCell>{renderCvValue(detailRow.value)}</TableCell>
                                            <TableCell>{renderCvValue(detailRow.unit)}</TableCell>
                                          </TableRow>
                                        );
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>
                              </div>
                            )) : (
                              <div className="text-sm text-muted-foreground">No evidence or attribute payloads available for this row.</div>
                            )}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
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
            {totalCount > 0 ? `Showing ${pageStart}-${pageEnd} of ${totalCount.toLocaleString()} rows` : "No rows"}
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
