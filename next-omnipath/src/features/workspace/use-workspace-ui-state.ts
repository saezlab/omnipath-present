"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWindowSize } from "@/hooks/use-window-size";

export type WorkspacePane = "results" | "refine" | "chat";

const STORAGE_KEY = "omnipath-workspace-ui";
const DESKTOP_ORDER: WorkspacePane[] = ["results", "refine", "chat"];
const DESKTOP_DEFAULT_PANES: WorkspacePane[] = ["results", "refine"];
const MOBILE_DEFAULT_PANE: WorkspacePane = "results";
const DEFAULT_WIDTHS: Record<WorkspacePane, number> = {
  results: 56,
  refine: 22,
  chat: 22,
};

interface PersistedWorkspaceState {
  desktopVisiblePanes?: WorkspacePane[];
  mobileActivePane?: WorkspacePane;
  paneWidths?: Partial<Record<WorkspacePane, number>>;
}

export interface WorkspaceUiState {
  hydrated: boolean;
  isMobile: boolean;
  desktopVisiblePanes: WorkspacePane[];
  mobileActivePane: WorkspacePane;
  paneWidths: Record<WorkspacePane, number>;
  setDesktopVisiblePanes: (panes: WorkspacePane[]) => void;
  toggleDesktopPane: (pane: WorkspacePane) => void;
  setMobileActivePane: (pane: WorkspacePane) => void;
  setPaneWidths: (widths: Partial<Record<WorkspacePane, number>>) => void;
}

export function useWorkspaceUiState(): WorkspaceUiState {
  const { width } = useWindowSize();
  const isMobile = width > 0 && width < 1024;
  const [hydrated, setHydrated] = useState(false);
  const [desktopVisiblePanes, setDesktopVisiblePanesState] = useState<WorkspacePane[]>(DESKTOP_DEFAULT_PANES);
  const [mobileActivePane, setMobileActivePaneState] = useState<WorkspacePane>(MOBILE_DEFAULT_PANE);
  const [paneWidths, setPaneWidthsState] = useState<Record<WorkspacePane, number>>(DEFAULT_WIDTHS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as PersistedWorkspaceState;
      if (Array.isArray(parsed.desktopVisiblePanes) && parsed.desktopVisiblePanes.length > 0) {
        const ordered = DESKTOP_ORDER.filter((pane) => parsed.desktopVisiblePanes?.includes(pane));
        if (ordered.length > 0) setDesktopVisiblePanesState(ordered);
      }
      if (parsed.mobileActivePane && DESKTOP_ORDER.includes(parsed.mobileActivePane)) {
        setMobileActivePaneState(parsed.mobileActivePane);
      }
      if (parsed.paneWidths) {
        setPaneWidthsState((prev) => ({ ...prev, ...parsed.paneWidths }));
      }
    } catch {
      // Ignore invalid local state.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedWorkspaceState = {
      desktopVisiblePanes,
      mobileActivePane,
      paneWidths,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [desktopVisiblePanes, hydrated, mobileActivePane, paneWidths]);

  const setDesktopVisiblePanes = useCallback((panes: WorkspacePane[]) => {
    const ordered = DESKTOP_ORDER.filter((pane) => panes.includes(pane));
    setDesktopVisiblePanesState(ordered.length > 0 ? ordered : ["results"]);
  }, []);

  const toggleDesktopPane = useCallback((pane: WorkspacePane) => {
    setDesktopVisiblePanesState((prev) => {
      if (prev.includes(pane)) {
        if (prev.length === 1) return prev;
        return prev.filter((entry) => entry !== pane);
      }

      return DESKTOP_ORDER.filter((entry) => entry === pane || prev.includes(entry));
    });
  }, []);

  const orderedDesktopVisiblePanes = useMemo(
    () => DESKTOP_ORDER.filter((pane) => desktopVisiblePanes.includes(pane)),
    [desktopVisiblePanes],
  );

  const setPaneWidths = useCallback((widths: Partial<Record<WorkspacePane, number>>) => {
    setPaneWidthsState((prev) => ({ ...prev, ...widths }));
  }, []);

  return {
    hydrated,
    isMobile,
    desktopVisiblePanes: orderedDesktopVisiblePanes,
    mobileActivePane,
    paneWidths,
    setDesktopVisiblePanes,
    toggleDesktopPane,
    setMobileActivePane: setMobileActivePaneState,
    setPaneWidths,
  };
}
