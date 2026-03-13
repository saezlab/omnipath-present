"use client";

import { useWorkspaceUrlState } from "@/lib/navigation/workspace-url-state";
import { EntitiesResultsView } from "./views/entities-results-view";
import { InteractionsResultsView } from "./views/interactions-results-view";
import { SelectionResultsView } from "./views/selection-results-view";

export function ResultsPane() {
  const { view } = useWorkspaceUrlState();

  if (view === "interactions") {
    return <InteractionsResultsView useEntityFilters={false} />;
  }

  if (view === "selection") {
    return <SelectionResultsView />;
  }

  return <EntitiesResultsView />;
}
