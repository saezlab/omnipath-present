"use client";

import { useMemo } from "react";
import { useSelectionUrlState } from "@/lib/navigation/url-state";
import { EntitiesRefinePanel } from "./entities-refine-panel";
import { InteractionsRefinePanel } from "./interactions-refine-panel";

export function SelectionRefinePanel() {
  const { entityIds, setEntityIds, tab } = useSelectionUrlState();

  const selectedEntityIds = useMemo(
    () => entityIds.map((id) => String(id).trim()).filter(Boolean),
    [entityIds],
  );

  if (tab === "interactions") {
    return <InteractionsRefinePanel lockedEntityIds={selectedEntityIds} onLockedEntityIdsChange={setEntityIds} />;
  }

  return <EntitiesRefinePanel lockedEntityIds={selectedEntityIds} onLockedEntityIdsChange={setEntityIds} />;
}
