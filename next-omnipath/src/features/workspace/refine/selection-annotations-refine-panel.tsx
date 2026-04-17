"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CvTermHoverCard } from "@/features/search/components/result-card";
import { searchMeilisearch } from "@/features/search/api/queries";
import { useOntologyTerms } from "@/features/ontology/use-ontology-terms";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { OntologyTermLabel } from "@/features/ontology/ontology-term-label";
import { RefinePanelLayout, RefineSection } from "./refine-panel-layout";
import { SelectedFiltersSection, type SelectedFilterItem } from "./selected-filters-section";
import { formatNumber } from "@/lib/utils";

interface SelectionAnnotationsRefinePanelProps {
  scopedEntityIds: string[];
  query: string;
  filters: MeilisearchFilters;
  setFilters: (filters: MeilisearchFilters) => void;
}

interface TreeNode {
  id: string;
  name?: string;
  children?: TreeNode[];
}

interface RootGroup {
  id: string;
  name: string;
  totalCount: number;
  termIds: string[];
}

function extractCanonicalOntologyId(value: string): string | null {
  const ontologyIdMatch = value.match(/(MI|OM|GO|HP|KW|DO|MP|CHEBI|CL|UBERON|MONDO):\d{4,}/);
  return ontologyIdMatch?.[0] || null;
}

function buildRootGroups(root: TreeNode | null, counts: Record<string, number>): RootGroup[] {
  const remaining = new Set(Object.keys(counts));
  const groups = new Map<string, RootGroup>();

  const ensureGroup = (id: string, name?: string) => {
    if (!groups.has(id)) {
      groups.set(id, { id, name: name || id, totalCount: 0, termIds: [] });
    }
    return groups.get(id)!;
  };

  const assignBranch = (node: TreeNode, rootId: string, rootName: string) => {
    if (counts[node.id] !== undefined) {
      const group = ensureGroup(rootId, rootName);
      group.termIds.push(node.id);
      group.totalCount += counts[node.id] || 0;
      remaining.delete(node.id);
    }

    node.children?.forEach((child) => assignBranch(child, rootId, rootName));
  };

  if (root?.children?.length) {
    root.children.forEach((child) => assignBranch(child, child.id, child.name || child.id));
  }

  if (remaining.size > 0) {
    const other = ensureGroup("other", "Other / unresolved roots");
    Array.from(remaining).forEach((termId) => {
      other.termIds.push(termId);
      other.totalCount += counts[termId] || 0;
    });
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, termIds: Array.from(new Set(group.termIds)).sort() }))
    .filter((group) => group.termIds.length > 0)
    .sort((a, b) => b.totalCount - a.totalCount || a.name.localeCompare(b.name));
}

export function SelectionAnnotationsRefinePanel({
  scopedEntityIds,
  query,
  filters,
  setFilters,
}: SelectionAnnotationsRefinePanelProps) {
  const [ontologyCounts, setOntologyCounts] = useState<Record<string, number>>({});
  const [treeRoot, setTreeRoot] = useState<TreeNode | null>(null);
  const [termQuery, setTermQuery] = useState("");

  const scopedFilters = useMemo<MeilisearchFilters>(
    () => ({ ...filters, entity_ids: scopedEntityIds }),
    [filters, scopedEntityIds],
  );

  useEffect(() => {
    async function loadFacets() {
      if (scopedEntityIds.length === 0) {
        setOntologyCounts({});
        return;
      }

      const response = await searchMeilisearch({
        query: query || "",
        index: "search_entities",
        limit: 1,
        offset: 0,
        filters: scopedFilters,
      });

      setOntologyCounts(response.facetDistribution?.ontology_terms || {});
    }

    void loadFacets();
  }, [query, scopedEntityIds, scopedFilters]);

  const allTermIds = useMemo(
    () => Object.keys(ontologyCounts).map((value) => extractCanonicalOntologyId(value) || value).filter(Boolean),
    [ontologyCounts],
  );

  useEffect(() => {
    if (allTermIds.length === 0) {
      setTreeRoot(null);
      return;
    }

    const controller = new AbortController();
    void fetch("/api/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term_ids: allTermIds }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Tree request failed (${response.status})`);
        return response.json() as Promise<{ root?: TreeNode | null }>;
      })
      .then((data) => setTreeRoot(data.root || null))
      .catch((error) => {
        if ((error as Error).name === "AbortError") return;
        setTreeRoot(null);
      });

    return () => controller.abort();
  }, [allTermIds]);

  const selectedOntologyTerms = filters.ontology_terms || [];
  const normalizedTermQuery = termQuery.trim().toLowerCase();
  const ontologyTermsById = useOntologyTerms(allTermIds);

  const rootGroups = useMemo(() => buildRootGroups(treeRoot, ontologyCounts), [ontologyCounts, treeRoot]);

  const filteredRootGroups = useMemo(() => {
    if (!normalizedTermQuery) return rootGroups;

    return rootGroups
      .map((group) => {
        const matchingTermIds = group.termIds.filter((termId) => {
          const label = ontologyTermsById[termId]?.name || termId;
          return termId.toLowerCase().includes(normalizedTermQuery) || label.toLowerCase().includes(normalizedTermQuery);
        });

        if (matchingTermIds.length === 0 && !group.name.toLowerCase().includes(normalizedTermQuery)) {
          return null;
        }

        return {
          ...group,
          termIds: matchingTermIds.length > 0 ? matchingTermIds : group.termIds,
        };
      })
      .filter((group): group is RootGroup => !!group);
  }, [normalizedTermQuery, ontologyTermsById, rootGroups]);

  const handleClearFilters = useCallback(() => {
    setFilters({});
  }, [setFilters]);

  const toggleTerm = useCallback((termId: string) => {
    const next = selectedOntologyTerms.includes(termId)
      ? selectedOntologyTerms.filter((value) => value !== termId)
      : [...selectedOntologyTerms, termId];
    setFilters({ ...filters, ontology_terms: next.length > 0 ? next : undefined });
  }, [filters, selectedOntologyTerms, setFilters]);

  const selectedFilterItems = useMemo<SelectedFilterItem[]>(() => {
    const grouped = new Map<string, string[]>();
    selectedOntologyTerms.forEach((value) => {
      const canonicalId = extractCanonicalOntologyId(value) || value;
      grouped.set(canonicalId, [...(grouped.get(canonicalId) || []), value]);
    });

    return Array.from(grouped.entries()).map(([canonicalId, groupValues]) => ({
      id: `ontology_terms:${canonicalId}`,
      label: (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Annotation</span>
          <CvTermHoverCard termId={canonicalId}>
            <span className="cursor-help underline decoration-dotted underline-offset-2">
              <OntologyTermLabel termId={canonicalId} />
            </span>
          </CvTermHoverCard>
        </div>
      ),
      onRemove: () => {
        const nextValues = selectedOntologyTerms.filter((value) => !groupValues.includes(value));
        setFilters({ ...filters, ontology_terms: nextValues.length > 0 ? nextValues : undefined });
      },
    }));
  }, [filters, selectedOntologyTerms, setFilters]);

  return (
    <RefinePanelLayout title="Annotation filters">
      {selectedFilterItems.length > 0 ? (
        <RefineSection title="Selected filters" defaultOpen={false}>
          <SelectedFiltersSection items={selectedFilterItems} onClearAll={handleClearFilters} />
        </RefineSection>
      ) : null}

      <RefineSection title="Ontology roots">
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Terms are grouped by ontology root within the current scoped entity set.
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={termQuery}
              onChange={(event) => setTermQuery(event.target.value)}
              placeholder="Search scoped annotation terms…"
              className="pl-9"
            />
          </div>
          <div className="space-y-4">
            {filteredRootGroups.length > 0 ? filteredRootGroups.map((group) => (
              <div key={group.id} className="rounded-xl border bg-card/40">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">{group.name}</div>
                    <div className="text-xs text-muted-foreground">{formatNumber(group.termIds.length)} scoped terms</div>
                  </div>
                  <div className="shrink-0 text-sm text-muted-foreground">{formatNumber(group.totalCount)} hits</div>
                </div>
                <div className="max-h-72 space-y-1 overflow-y-auto px-4 py-3">
                  {group.termIds.map((termId) => {
                    const checked = selectedOntologyTerms.includes(termId);
                    const count = ontologyCounts[termId] || 0;
                    return (
                      <div key={`${group.id}:${termId}`} className="flex items-center justify-between gap-3 py-1">
                        <Label htmlFor={`${group.id}:${termId}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-normal">
                          <Checkbox id={`${group.id}:${termId}`} checked={checked} onCheckedChange={() => toggleTerm(termId)} />
                          <CvTermHoverCard termId={termId}>
                            <span className="truncate cursor-help underline decoration-dotted underline-offset-2">
                              {ontologyTermsById[termId]?.name || termId}
                            </span>
                          </CvTermHoverCard>
                        </Label>
                        <div className="shrink-0 text-xs text-muted-foreground">{formatNumber(count)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )) : (
              <div className="text-sm text-muted-foreground">No scoped annotation roots found for the current filters.</div>
            )}
          </div>
        </div>
      </RefineSection>
    </RefinePanelLayout>
  );
}
