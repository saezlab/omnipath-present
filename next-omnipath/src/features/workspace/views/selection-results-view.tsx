"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { INDEXES } from "@/lib/meilisearch/client";
import { searchAssociationsMeilisearch, searchInteractionsMeilisearch } from "@/lib/meilisearch/search";
import { useSelectionUrlState } from "@/lib/navigation/url-state";
import { EntitiesResultsView } from "./entities-results-view";
import { InteractionsResultsView } from "./interactions-results-view";

export function SelectionResultsView() {
  const { entityIds, tab, setTab } = useSelectionUrlState();
  const [interactionsCount, setInteractionsCount] = useState<number | null>(null);
  const [associatedEntityIds, setAssociatedEntityIds] = useState<string[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);

  const selectedEntityIds = useMemo(
    () => entityIds.map((id) => String(id).trim()).filter(Boolean),
    [entityIds],
  );

  useEffect(() => {
    async function fetchCounts() {
      if (selectedEntityIds.length === 0) {
        setInteractionsCount(0);
        setAssociatedEntityIds([]);
        setLoadingCounts(false);
        return;
      }

      setLoadingCounts(true);
      try {
        const [interactionsResponse, parentsResponse, membersResponse] = await Promise.all([
          searchInteractionsMeilisearch({
            query: "",
            index: INDEXES.INTERACTIONS,
            limit: 1,
            offset: 0,
            filters: { entity_ids: selectedEntityIds },
          }),
          searchAssociationsMeilisearch({
            query: "",
            index: INDEXES.ASSOCIATIONS,
            limit: 10000,
            offset: 0,
            filters: { member_entity_ids: selectedEntityIds },
          }),
          searchAssociationsMeilisearch({
            query: "",
            index: INDEXES.ASSOCIATIONS,
            limit: 10000,
            offset: 0,
            filters: { parent_entity_ids: selectedEntityIds },
          }),
        ]);

        setInteractionsCount(interactionsResponse.estimatedTotalHits || 0);

        const entityIdSet = new Set<string>();
        for (const hit of parentsResponse.hits) {
          const id = String(hit.parent_entity_id ?? "").trim();
          if (id) entityIdSet.add(id);
        }
        for (const hit of membersResponse.hits) {
          const id = String(hit.member_entity_id ?? "").trim();
          if (id) entityIdSet.add(id);
        }
        setAssociatedEntityIds(Array.from(entityIdSet));
      } catch (error) {
        console.error("Error fetching selection counts:", error);
        setInteractionsCount(0);
        setAssociatedEntityIds([]);
      } finally {
        setLoadingCounts(false);
      }
    }

    void fetchCounts();
  }, [selectedEntityIds]);

  if (selectedEntityIds.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <div className="space-y-4 text-center">
          <h1 className="text-2xl font-bold">No entities selected</h1>
          <p className="text-muted-foreground">Use the entities results view to add entities to your selection.</p>
          <Link href="/workspace?view=entities">
            <Button>Open entities</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <Tabs value={tab} onValueChange={(value) => setTab(value as "selection" | "interactions" | "associations")} className="flex min-h-0 flex-1 flex-col">
        <div className="sticky top-0 z-10 bg-background">
          <div className="w-full px-4 pt-4">
            <TabsList>
              <TabsTrigger value="selection" className="flex items-center gap-2">
                Selection
                <Badge variant="secondary">{selectedEntityIds.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="interactions" className="flex items-center gap-2" disabled={!loadingCounts && (interactionsCount ?? 0) === 0}>
                Interactions
                <Badge variant="secondary">{loadingCounts ? "..." : interactionsCount?.toLocaleString() || 0}</Badge>
              </TabsTrigger>
              <TabsTrigger value="associations" className="flex items-center gap-2" disabled={associatedEntityIds.length === 0}>
                Associations
                <Badge variant="secondary">{associatedEntityIds.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="selection" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <EntitiesResultsView lockedEntityIds={selectedEntityIds} hideSearchArea />
        </TabsContent>

        <TabsContent value="interactions" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <InteractionsResultsView lockedEntityIds={selectedEntityIds} />
        </TabsContent>

        <TabsContent value="associations" className="mt-0 min-h-0 flex-1 overflow-hidden">
          {associatedEntityIds.length > 0 ? (
            <EntitiesResultsView lockedEntityIds={associatedEntityIds} hideSearchArea />
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-muted-foreground">No associated entities found</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
