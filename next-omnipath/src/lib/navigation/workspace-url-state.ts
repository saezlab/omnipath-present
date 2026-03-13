"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useSearchUrlState, useInteractionsUrlState, useSelectionUrlState } from "./url-state";

export type ResultsView = "entities" | "interactions" | "selection";

const viewParser = parseAsStringLiteral(["entities", "interactions", "selection"] as const).withDefault("entities");

export interface WorkspaceUrlState {
  view: ResultsView;
  setView: (view: ResultsView) => void;
  entitiesView: ReturnType<typeof useSearchUrlState>;
  interactionsView: ReturnType<typeof useInteractionsUrlState>;
  selectionView: ReturnType<typeof useSelectionUrlState>;
}

export function useWorkspaceUrlState(): WorkspaceUrlState {
  const [view, setViewState] = useQueryState("view", viewParser);
  const entitiesView = useSearchUrlState();
  const interactionsView = useInteractionsUrlState();
  const selectionView = useSelectionUrlState();

  return {
    view,
    setView: (next) => void setViewState(next),
    entitiesView,
    interactionsView,
    selectionView,
  };
}
