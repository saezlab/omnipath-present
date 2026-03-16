"use client";

import { useEffect, useMemo, useState } from "react";
import { INDEXES } from "@/lib/meilisearch/client";
import { searchAssociationsMeilisearch } from "@/lib/meilisearch/search";
import { useSelectionUrlState } from "@/lib/navigation/url-state";
import { EntitiesRefinePanel } from "./entities-refine-panel";
import { InteractionsRefinePanel } from "./interactions-refine-panel";

export function SelectionRefinePanel() {
  const { entityIds, setEntityIds, tab } = useSelectionUrlState();
  const [associatedEntityIds, setAssociatedEntityIds] = useState<string[]>([]);

  const selectedEntityIds = useMemo(
    () => entityIds.map((id) => String(id).trim()).filter(Boolean),
    [entityIds],
  );

  useEffect(() => {
    async function loadAssociatedEntityIds() {
      if (tab !== "associations" || selectedEntityIds.length === 0) {
        setAssociatedEntityIds([]);
        return;
      }

      try {
        const [parentsResponse, membersResponse] = await Promise.all([
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

        const ids = new Set<string>();
        for (const hit of parentsResponse.hits) {
          const id = String(hit.parent_entity_id ?? "").trim();
          if (id) ids.add(id);
        }
        for (const hit of membersResponse.hits) {
          const id = String(hit.member_entity_id ?? "").trim();
          if (id) ids.add(id);
        }
        setAssociatedEntityIds(Array.from(ids));
      } catch {
        setAssociatedEntityIds([]);
      }
    }

    void loadAssociatedEntityIds();
  }, [selectedEntityIds, tab]);

  if (tab === "interactions") {
    return <InteractionsRefinePanel lockedEntityIds={selectedEntityIds} onLockedEntityIdsChange={setEntityIds} />;
  }

  if (tab === "associations") {
    return <EntitiesRefinePanel lockedEntityIds={associatedEntityIds} />;
  }

  return <EntitiesRefinePanel lockedEntityIds={selectedEntityIds} onLockedEntityIdsChange={setEntityIds} />;
}
