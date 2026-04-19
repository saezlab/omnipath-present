"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWindowSize } from "@/hooks/use-window-size";

export type SearchWorkspacePane = "search" | "ontology" | "chat";

const STORAGE_KEY = "omnipath-search-workspace";
const DESKTOP_DEFAULT_PANES: SearchWorkspacePane[] = ["search", "ontology"];
const MOBILE_DEFAULT_PANE: SearchWorkspacePane = "search";
const DESKTOP_ORDER: SearchWorkspacePane[] = ["search", "ontology", "chat"];

interface PersistedWorkspaceState {
  desktopVisiblePanes?: SearchWorkspacePane[];
  mobileActivePane?: SearchWorkspacePane;
}

export function useSearchWorkspaceState() {
  const { width } = useWindowSize();
  const isMobile = width > 0 && width < 1024;
  const [desktopVisiblePanes, setDesktopVisiblePanes] = useState<SearchWorkspacePane[]>(DESKTOP_DEFAULT_PANES);
  const [mobileActivePane, setMobileActivePane] = useState<SearchWorkspacePane>(MOBILE_DEFAULT_PANE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw) as PersistedWorkspaceState;
      if (Array.isArray(parsed.desktopVisiblePanes) && parsed.desktopVisiblePanes.length > 0) {
        const normalized = DESKTOP_ORDER.filter((pane) => parsed.desktopVisiblePanes?.includes(pane));
        if (normalized.length > 0) setDesktopVisiblePanes(normalized);
      }
      if (parsed.mobileActivePane && DESKTOP_ORDER.includes(parsed.mobileActivePane)) {
        setMobileActivePane(parsed.mobileActivePane);
      }
    } catch {
      // Ignore invalid persisted workspace state.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedWorkspaceState = {
      desktopVisiblePanes,
      mobileActivePane,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [desktopVisiblePanes, hydrated, mobileActivePane]);

  const toggleDesktopPane = useCallback((pane: SearchWorkspacePane) => {
    setDesktopVisiblePanes((prev) => {
      if (prev.includes(pane)) {
        if (prev.length === 1) return prev;
        return prev.filter((value) => value !== pane);
      }

      return DESKTOP_ORDER.filter((value) => value === pane || prev.includes(value));
    });
  }, []);

  const orderedDesktopVisiblePanes = useMemo(
    () => DESKTOP_ORDER.filter((pane) => desktopVisiblePanes.includes(pane)),
    [desktopVisiblePanes],
  );

  return {
    hydrated,
    isMobile,
    desktopVisiblePanes: orderedDesktopVisiblePanes,
    mobileActivePane,
    toggleDesktopPane,
    setMobileActivePane,
  };
}
