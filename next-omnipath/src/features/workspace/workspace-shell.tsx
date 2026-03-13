"use client";

import { Fragment, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ChatPane } from "./chat-pane";
import { RefinePane } from "./refine-pane";
import { ResultsPane } from "./results-pane";
import { useWorkspaceUiState, type WorkspacePane } from "./use-workspace-ui-state";
import { WorkspaceControls } from "./workspace-controls";

export function WorkspaceShell() {
  const {
    hydrated,
    isMobile,
    desktopVisiblePanes,
    mobileActivePane,
    paneWidths,
    toggleDesktopPane,
    setMobileActivePane,
  } = useWorkspaceUiState();

  const desktopPaneContent: Record<WorkspacePane, ReactNode> = {
    results: <ResultsPane />,
    refine: <RefinePane />,
    chat: <ChatPane />,
  };

  const mobileContent = desktopPaneContent[mobileActivePane];

  if (!hydrated) {
    return <div className="flex h-svh flex-1" />;
  }

  return (
    <div className="relative flex h-svh flex-1 flex-col overflow-hidden">
      <WorkspaceControls
        isMobile={isMobile}
        desktopVisiblePanes={desktopVisiblePanes}
        mobileActivePane={mobileActivePane}
        onDesktopToggle={toggleDesktopPane}
        onMobileSelect={setMobileActivePane}
      />

      <div className="min-h-0 flex-1">
        {isMobile ? (
          <div className="h-full">{mobileContent}</div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {desktopVisiblePanes.map((pane, index) => (
              <Fragment key={pane}>
                {index > 0 ? <ResizableHandle withHandle /> : null}
                <ResizablePanel
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
