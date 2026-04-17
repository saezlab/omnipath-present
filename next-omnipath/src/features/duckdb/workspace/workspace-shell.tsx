"use client";

import { Fragment, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { EntityDataSourceProvider } from "@/contexts/entity-data-source-context";
import { DuckDbChatPane } from "./chat-pane";
import { DuckDbWorkspaceProvider, useDuckDbWorkspace } from "./context";
import { DuckDbRefinePane } from "./refine-pane";
import { DuckDbResultsPane } from "./results-pane";
import { useWorkspaceUiState, type WorkspacePane } from "./use-duckdb-workspace-ui-state";

function DuckDbWorkspacePanels() {
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
  const { getEntityById } = useDuckDbWorkspace();

  const desktopPaneContent: Record<WorkspacePane, ReactNode> = {
    results: <DuckDbResultsPane />,
    refine: <DuckDbRefinePane />,
    chat: <DuckDbChatPane />,
  };

  const mobileContent = desktopPaneContent[mobileActivePane];

  if (!hydrated) {
    return <div className="flex h-svh flex-1" />;
  }

  return (
    <EntityDataSourceProvider value={{ getEntity: getEntityById }}>
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
    </EntityDataSourceProvider>
  );
}

export function DuckDbWorkspaceShell() {
  return (
    <DuckDbWorkspaceProvider>
      <DuckDbWorkspacePanels />
    </DuckDbWorkspaceProvider>
  );
}
