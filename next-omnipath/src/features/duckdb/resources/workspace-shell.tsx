"use client";

import { Fragment, useEffect, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { EntityDataSourceProvider } from "@/contexts/entity-data-source-context";
import { useFloatingNav } from "@/contexts/floating-nav-context";
import { DuckDbResourceChatPane } from "./chat-pane";
import { DuckDbResourceWorkspaceProvider, useDuckDbResourceWorkspace } from "./context";
import { DuckDbResourceRefinePane } from "./refine-pane";
import { DuckDbResourceResultsPane } from "./results-pane";
import { useWorkspaceUiState, type WorkspacePane } from "./use-duckdb-resource-workspace-ui-state";

function DuckDbResourceWorkspacePanels() {
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
  const { setWorkspaceControls } = useFloatingNav();
  const { getEntityById } = useDuckDbResourceWorkspace();

  const desktopPaneContent: Record<WorkspacePane, ReactNode> = {
    results: <DuckDbResourceResultsPane />,
    refine: <DuckDbResourceRefinePane />,
    chat: <DuckDbResourceChatPane />,
  };

  const mobileContent = desktopPaneContent[mobileActivePane];

  useEffect(() => {
    if (!hydrated) return;

    setWorkspaceControls({
      isMobile,
      desktopVisiblePanes,
      mobileActivePane,
      onDesktopToggle: toggleDesktopPane,
      onMobileSelect: setMobileActivePane,
    });

    return () => setWorkspaceControls(null);
  }, [
    desktopVisiblePanes,
    hydrated,
    isMobile,
    mobileActivePane,
    setMobileActivePane,
    setWorkspaceControls,
    toggleDesktopPane,
  ]);

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

export function DuckDbResourceWorkspaceShell() {
  return (
    <DuckDbResourceWorkspaceProvider>
      <DuckDbResourceWorkspacePanels />
    </DuckDbResourceWorkspaceProvider>
  );
}
