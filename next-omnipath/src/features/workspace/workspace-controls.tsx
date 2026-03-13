"use client";

import { Button } from "@/components/ui/button";
import type { WorkspacePane } from "./use-workspace-ui-state";

interface WorkspaceControlsProps {
  isMobile: boolean;
  desktopVisiblePanes: WorkspacePane[];
  mobileActivePane: WorkspacePane;
  onDesktopToggle: (pane: WorkspacePane) => void;
  onMobileSelect: (pane: WorkspacePane) => void;
}

const LABELS: Record<WorkspacePane, string> = {
  results: "Results",
  refine: "Refine",
  chat: "Chat",
};

export function WorkspaceControls({
  isMobile,
  desktopVisiblePanes,
  mobileActivePane,
  onDesktopToggle,
  onMobileSelect,
}: WorkspaceControlsProps) {
  return (
    <div className="fixed bottom-4 right-4 z-40">
      <div className="inline-flex items-center rounded-full border bg-background/90 p-1 shadow-sm backdrop-blur">
        {(["results", "refine", "chat"] as WorkspacePane[]).map((pane) => {
          const active = isMobile ? mobileActivePane === pane : desktopVisiblePanes.includes(pane);
          return (
            <Button
              key={pane}
              size="sm"
              variant={active ? "default" : "ghost"}
              onClick={() => (isMobile ? onMobileSelect(pane) : onDesktopToggle(pane))}
              className="h-8 rounded-full"
            >
              {LABELS[pane]}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
