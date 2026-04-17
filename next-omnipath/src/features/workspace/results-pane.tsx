"use client";

import { useWorkspaceUrlState } from "@/lib/navigation/workspace-url-state";
import { InteractionsResultsView } from "./views/interactions-results-view";
import { SelectionResultsView } from "./views/selection-results-view";
import { EntityWorkflowResultsView } from "./views/entity-workflow-results-view";

export function ResultsPane() {
  const { view } = useWorkspaceUrlState();

  if (view === "interactions") {
    return <InteractionsResultsView useEntityFilters={false} />;
  }

  if (view === "selection") {
    return <SelectionResultsView />;
  }

  return <EntityWorkflowResultsView />;
}
