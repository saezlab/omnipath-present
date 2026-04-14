"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEntitySelection } from "@/contexts/entity-selection-context";
import { OntologyTermLabel } from "@/features/ontology/ontology-term-label";
import { CvTermHoverCard } from "@/features/search/components/result-card";
import { formatNumber } from "@/lib/utils";
import { useDuckDbAnnotationWorkspace } from "./context";

interface TreeNode {
  id: string;
  name?: string;
  children?: TreeNode[];
}

interface AnnotationParentGroup {
  id: string;
  name: string;
  terms: { termId: string; count: number }[];
}

interface AnnotationBranchGroup {
  id: string;
  name: string;
  parents: AnnotationParentGroup[];
}

export function DuckDbAnnotationResultsPane() {
  const {
    entitySummaries,
    focusedEntityKey,
    mode,
    pageIndex,
    pageSize,
    resourceIds,
    rows,
    selectedEntitiesTermCounts,
    selectedRowKeys,
    selectedTerms,
    selectionEntityIds,
    setFocusedEntityKey,
    setFocusedTermId,
    setPageIndex,
    toggleSelectedRow,
    totalCount,
  } = useDuckDbAnnotationWorkspace();
  const { addEntity } = useEntitySelection();
  const [treeRoot, setTreeRoot] = useState<TreeNode | null>(null);

  const pageStart = rows.length === 0 ? 0 : pageIndex * pageSize + 1;
  const pageEnd = pageIndex * pageSize + rows.length;
  const canPrev = pageIndex > 0;
  const canNext = pageEnd < totalCount;

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedRowKeys.includes(row.key)),
    [rows, selectedRowKeys],
  );

  const selectedTermIdsForEntitiesMode = useMemo(
    () => selectedEntitiesTermCounts.map((row) => row.cv_term),
    [selectedEntitiesTermCounts],
  );

  useEffect(() => {
    if (mode !== "entities_to_annotations" || selectedTermIdsForEntitiesMode.length === 0) {
      setTreeRoot(null);
      return;
    }

    const controller = new AbortController();
    void fetch("/api/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term_ids: selectedTermIdsForEntitiesMode }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load hierarchy (${response.status})`);
        return response.json() as Promise<{ root?: TreeNode | null }>;
      })
      .then((data) => setTreeRoot(data.root || null))
      .catch((error) => {
        if ((error as Error).name === "AbortError") return;
        setTreeRoot(null);
      });

    return () => controller.abort();
  }, [mode, selectedTermIdsForEntitiesMode]);

  const groupedEntityAnnotations = useMemo(() => {
    if (!treeRoot || selectedEntitiesTermCounts.length === 0) return null;

    const countByTerm = new Map(selectedEntitiesTermCounts.map((row) => [row.cv_term, row.entity_count]));
    const parentById = new Map<string, TreeNode>();
    const rootChildById = new Map<string, TreeNode>();
    const nameById = new Map<string, string>();

    const visit = (node: TreeNode, parent: TreeNode | null, rootChild: TreeNode | null) => {
      nameById.set(node.id, node.name || node.id);
      if (parent) parentById.set(node.id, parent);
      if (rootChild) rootChildById.set(node.id, rootChild);
      node.children?.forEach((child) => visit(child, node, rootChild ?? child));
    };
    visit(treeRoot, null, null);

    const branchMap = new Map<string, AnnotationBranchGroup>();
    const ensureBranch = (id: string, name: string) => {
      if (!branchMap.has(id)) branchMap.set(id, { id, name, parents: [] });
      return branchMap.get(id)!;
    };
    const ensureParent = (branch: AnnotationBranchGroup, id: string, name: string) => {
      const existing = branch.parents.find((parent) => parent.id === id);
      if (existing) return existing;
      const next = { id, name, terms: [] as { termId: string; count: number }[] };
      branch.parents.push(next);
      return next;
    };

    for (const termId of selectedTermIdsForEntitiesMode) {
      const count = countByTerm.get(termId) || 0;
      const parent = parentById.get(termId);
      const rootChild = rootChildById.get(termId);
      const branch = rootChild ? ensureBranch(rootChild.id, nameById.get(rootChild.id) || rootChild.id) : ensureBranch("other", "Other");
      if (parent) {
        ensureParent(branch, parent.id, nameById.get(parent.id) || parent.id).terms.push({ termId, count });
      } else {
        ensureParent(branch, "other", "Other").terms.push({ termId, count });
      }
    }

    const branches = Array.from(branchMap.values());
    const parentCount = (group: AnnotationParentGroup) => group.terms.reduce((sum, term) => sum + term.count, 0);
    const branchCount = (branch: AnnotationBranchGroup) => branch.parents.reduce((sum, parent) => sum + parentCount(parent), 0);

    branches.forEach((branch) => {
      branch.parents.forEach((parent) => parent.terms.sort((a, b) => b.count - a.count || a.termId.localeCompare(b.termId)));
      branch.parents.sort((a, b) => parentCount(b) - parentCount(a));
    });
    branches.sort((a, b) => {
      if (a.id === "other") return 1;
      if (b.id === "other") return -1;
      return branchCount(b) - branchCount(a);
    });

    return {
      rootName: treeRoot.name || treeRoot.id,
      branches,
    };
  }, [selectedEntitiesTermCounts, selectedTermIdsForEntitiesMode, treeRoot]);

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
        <Card className="min-h-0 flex-1 overflow-hidden">
          <CardHeader className="border-b">
            <CardTitle>Annotations across selected entities</CardTitle>
            <div className="text-sm text-muted-foreground">
              {selectionEntityIds.length > 0
                ? `${formatNumber(selectedEntitiesTermCounts.length)} annotation terms across ${formatNumber(selectionEntityIds.length)} selected entities`
                : "Add entities to your selection to summarize their annotations."}
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-auto p-4">
            {selectionEntityIds.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No entities are currently saved in selection.</div>
            ) : selectedEntitiesTermCounts.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No annotation terms found for the selected entities in the loaded resources.</div>
            ) : groupedEntityAnnotations ? (
              <Accordion type="multiple" defaultValue={groupedEntityAnnotations.branches.map((branch) => branch.id)} className="space-y-2">
                <div className="pb-2 text-lg font-semibold">{groupedEntityAnnotations.rootName}</div>
                {groupedEntityAnnotations.branches.map((branch) => (
                  <AccordionItem key={branch.id} value={branch.id} className="rounded-lg border px-4">
                    <AccordionTrigger className="py-3 hover:no-underline text-base font-medium">{branch.name}</AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="space-y-4 pl-2">
                        {branch.parents.map((parent) => (
                          <div key={parent.id} className="space-y-2">
                            {parent.id !== branch.id ? <div className="pl-2 py-1 text-sm font-medium text-muted-foreground">{parent.name}</div> : null}
                            <div className="ml-2 space-y-1 border-l-2 border-muted pl-3">
                              {parent.terms.map((term) => (
                                <button
                                  key={term.termId}
                                  type="button"
                                  onClick={() => setFocusedTermId(term.termId)}
                                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-muted/50"
                                >
                                  <CvTermHoverCard termId={term.termId}>
                                    <span className="text-sm cursor-help hover:underline">{term.termId}</span>
                                  </CvTermHoverCard>
                                  <Badge variant="outline" className="text-xs">{formatNumber(term.count)}</Badge>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              <div className="space-y-2">
                {selectedEntitiesTermCounts.map((term) => (
                  <button
                    key={term.cv_term}
                    type="button"
                    onClick={() => setFocusedTermId(term.cv_term)}
                    className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <div>
                      <div className="text-sm font-medium"><OntologyTermLabel termId={term.cv_term} /></div>
                      <div className="text-xs text-muted-foreground">{term.cv_term}</div>
                    </div>
                    <Badge variant="outline">{formatNumber(term.entity_count)}</Badge>
                  </button>
                ))}
              </div>
            )}
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
