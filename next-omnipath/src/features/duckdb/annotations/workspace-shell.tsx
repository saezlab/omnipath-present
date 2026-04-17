"use client";

import { Fragment, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useWorkspaceUiState, type WorkspacePane } from "@/features/workspace/use-workspace-ui-state";
import { DuckDbAnnotationWorkspaceProvider } from "./context";
import { DuckDbAnnotationDetailsPane } from "./details-pane";
import { DuckDbAnnotationRefinePane } from "./refine-pane";
import { DuckDbAnnotationResultsPane } from "./results-pane";

function DuckDbAnnotationWorkspacePanels() {
  const {
    hydrated,
    isMobile,
    desktopVisiblePanes,
    mobileActivePane,
    paneWidths,
    toggleDesktopPane,
    setMobileActivePane,
    setPaneWidths,
  } = useWorkspaceUiState();

  const desktopPaneContent: Record<WorkspacePane, ReactNode> = {
    results: <DuckDbAnnotationResultsPane />,
    refine: <DuckDbAnnotationRefinePane />,
    chat: <DuckDbAnnotationDetailsPane />,
  };

  if (!hydrated) {
    return <div className="flex h-svh flex-1" />;
  }

  return (
    <div className="relative flex h-svh flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        {isMobile ? (
          <div className="h-full">{desktopPaneContent[mobileActivePane]}</div>
        ) : (
          <ResizablePanelGroup
            direction="horizontal"
            className="h-full"
            onLayoutChanged={(layout) => {
              const nextWidths = desktopVisiblePanes.reduce<Partial<Record<WorkspacePane, number>>>((acc, pane) => {
                const size = layout[pane];
                if (typeof size === "number") {
                  acc[pane] = size;
                }
                return acc;
              }, {});
              setPaneWidths(nextWidths);
            }}
          >
            {desktopVisiblePanes.map((pane, index) => (
              <Fragment key={pane}>
                {index > 0 ? <ResizableHandle withHandle /> : null}
                <ResizablePanel
                  id={pane}
                  defaultSize={paneWidths[pane]}
                  minSize={desktopVisiblePanes.length === 1 ? 100 : pane === "results" ? 35 : 20}
                  className="min-h-0"
                >
                  {desktopPaneContent[pane]}
                </ResizablePanel>
              </Fragment>
            ))}
          </ResizablePanelGroup>
        )}
      </div>
    </div>
  );
}

export function DuckDbAnnotationWorkspaceShell() {
  return (
    <DuckDbAnnotationWorkspaceProvider>
      <DuckDbAnnotationWorkspacePanels />
    </DuckDbAnnotationWorkspaceProvider>
  );
}
