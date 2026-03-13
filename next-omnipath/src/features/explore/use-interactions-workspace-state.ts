"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWindowSize } from "@/hooks/use-window-size";

export type InteractionsWorkspacePane = "interactions" | "chat";

const STORAGE_KEY = "omnipath-interactions-workspace";
const DESKTOP_DEFAULT_PANES: InteractionsWorkspacePane[] = ["interactions"];
const MOBILE_DEFAULT_PANE: InteractionsWorkspacePane = "interactions";
const DESKTOP_ORDER: InteractionsWorkspacePane[] = ["interactions", "chat"];

interface PersistedWorkspaceState {
  desktopVisiblePanes?: InteractionsWorkspacePane[];
  mobileActivePane?: InteractionsWorkspacePane;
}

export function useInteractionsWorkspaceState() {
  const { width } = useWindowSize();
  const isMobile = width > 0 && width < 1024;
  const [desktopVisiblePanes, setDesktopVisiblePanes] = useState<InteractionsWorkspacePane[]>(DESKTOP_DEFAULT_PANES);
  const [mobileActivePane, setMobileActivePane] = useState<InteractionsWorkspacePane>(MOBILE_DEFAULT_PANE);
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

  const toggleDesktopPane = useCallback((pane: InteractionsWorkspacePane) => {
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
