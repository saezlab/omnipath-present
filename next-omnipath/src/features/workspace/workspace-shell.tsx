"use client";

import { Fragment, useEffect, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ChatPane } from "./chat-pane";
import { RefinePane } from "./refine-pane";
import { ResultsPane } from "./results-pane";
import { useWorkspaceUiState, type WorkspacePane } from "./use-workspace-ui-state";

export function WorkspaceShell() {
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
    results: <ResultsPane />,
    refine: <RefinePane />,
    chat: <ChatPane />,
  };

  const mobileContent = desktopPaneContent[mobileActivePane];

  useEffect(() => {
    // Floating nav controls removed
  }, [
    desktopVisiblePanes,
    hydrated,
    isMobile,
    mobileActivePane,
    setMobileActivePane,
    toggleDesktopPane,
  ]);

  if (!hydrated) {
    return <div className="flex h-svh flex-1" />;
  }

  return (
    <div className="relative flex h-svh flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        {isMobile ? (
          <div className="h-full">{mobileContent}</div>
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
