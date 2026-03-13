"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import SearchPage from "@/features/search/page";
import InteractionsPage from "@/features/explore/interactions-page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemo, useState, useEffect } from "react";
import { searchInteractionsMeilisearch, searchAssociationsMeilisearch } from "@/lib/meilisearch/search";
import { INDEXES } from "@/lib/meilisearch/client";
import { useSelectionUrlState } from "@/lib/navigation/url-state";

export default function SelectionPage() {
  const { entityIds, tab, setTab, filters } = useSelectionUrlState();
  const [interactionsCount, setInteractionsCount] = useState<number | null>(null);
  const [associatedEntityIds, setAssociatedEntityIds] = useState<string[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);

  const selectedEntityIds = useMemo(
    () => entityIds.map((id) => String(id).trim()).filter((id) => id.length > 0),
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
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">No entities selected</h1>
          <p className="text-muted-foreground">
            Use the search page to find and add entities to your selection.
          </p>
          <Link href="/search">
            <Button>Go to Search</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <Tabs value={tab} onValueChange={(value) => setTab(value as "selection" | "interactions" | "associations")} className="flex-1 flex flex-col">
        <div className="sticky top-0 z-10 bg-background border-b">
          <div className="w-full max-w-screen-xl mx-auto px-4 py-4">
            <TabsList>
              <TabsTrigger value="selection" className="flex items-center gap-2">
                Selection
                <Badge variant="secondary" className="ml-1">
                  {selectedEntityIds.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="interactions"
                className="flex items-center gap-2"
                disabled={!loadingCounts && (interactionsCount ?? 0) === 0}
              >
                Interactions
                {loadingCounts ? (
                  <Badge variant="secondary" className="ml-1">...</Badge>
                ) : (
                  <Badge variant="secondary" className="ml-1">
                    {interactionsCount?.toLocaleString() || 0}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="associations"
                className="flex items-center gap-2"
                disabled={associatedEntityIds.length === 0}
              >
                Associations
                <Badge variant="secondary" className="ml-1">
                  {associatedEntityIds.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="selection" className="flex-1 overflow-hidden mt-0">
          <SearchPage
            key={`selection:${selectedEntityIds.join(",")}`}
            embedded={true}
            allowOntologyInEmbedded={true}
            showLayoutSwitcherInEmbedded={true}
            showFilters={true}
            initialFilters={{ ...filters, entity_ids: selectedEntityIds }}
            lockedEntityIds={selectedEntityIds}
          />
        </TabsContent>

        <TabsContent value="interactions" className="flex-1 overflow-hidden mt-0">
          <InteractionsPage lockedEntityIds={selectedEntityIds} />
        </TabsContent>

        <TabsContent value="associations" className="flex-1 overflow-hidden mt-0">
          {associatedEntityIds.length > 0 ? (
            <SearchPage
              key={`associations:${associatedEntityIds.join(",")}`}
              embedded={true}
              allowOntologyInEmbedded={true}
              showLayoutSwitcherInEmbedded={true}
              showFilters={true}
              initialFilters={{ ...filters, entity_ids: associatedEntityIds }}
              lockedEntityIds={associatedEntityIds}
            />
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
