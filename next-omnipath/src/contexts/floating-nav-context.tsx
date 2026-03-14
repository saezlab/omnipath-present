"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { WorkspacePane } from "@/features/workspace/use-workspace-ui-state";

export interface WorkspaceMenuControls {
  isMobile: boolean;
  desktopVisiblePanes: WorkspacePane[];
  mobileActivePane: WorkspacePane;
  onDesktopToggle: (pane: WorkspacePane) => void;
  onMobileSelect: (pane: WorkspacePane) => void;
}

interface FloatingNavContextValue {
  workspaceControls: WorkspaceMenuControls | null;
  setWorkspaceControls: (controls: WorkspaceMenuControls | null) => void;
}

const FloatingNavContext = createContext<FloatingNavContextValue | null>(null);

export function FloatingNavProvider({ children }: { children: ReactNode }) {
  const [workspaceControls, setWorkspaceControls] = useState<WorkspaceMenuControls | null>(null);

  const value = useMemo(
    () => ({ workspaceControls, setWorkspaceControls }),
    [workspaceControls],
  );

  return <FloatingNavContext.Provider value={value}>{children}</FloatingNavContext.Provider>;
}

export function useFloatingNav() {
  const context = useContext(FloatingNavContext);

  if (!context) {
    throw new Error("useFloatingNav must be used within FloatingNavProvider.");
  }

  return context;
}
