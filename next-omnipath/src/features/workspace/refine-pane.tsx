"use client";

import { useWorkspaceUrlState } from "@/lib/navigation/workspace-url-state";
import { EntityWorkflowRefinePanel } from "./refine/entity-workflow-refine-panel";
import { InteractionsRefinePanel } from "./refine/interactions-refine-panel";
import { SelectionRefinePanel } from "./refine/selection-refine-panel";

export function RefinePane() {
  const { view } = useWorkspaceUrlState();

  if (view === "interactions") {
    return <InteractionsRefinePanel useEntityFilters={false} />;
  }

  if (view === "selection") {
    return <SelectionRefinePanel />;
  }

  return <EntityWorkflowRefinePanel />;
}
