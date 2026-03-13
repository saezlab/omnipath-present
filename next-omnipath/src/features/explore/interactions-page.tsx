"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useSidebarContent } from "@/contexts/sidebar-content-context";
import { InteractionsExploreTab } from "./components/interactions-explore-tab";
import { FilterSidebar } from "@/features/interactions-search/components/filter-sidebar";
import type { MeilisearchFilters } from "@/types/meilisearch";
import { useEntitySelection, useInteractionsUrlState } from "@/lib/navigation/url-state";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SearchAssistantPane } from "@/features/chat/search-assistant-pane";
import { useInteractionsWorkspaceState, type InteractionsWorkspacePane } from "./use-interactions-workspace-state";

interface InteractionsPageProps {
  useEntityFilters?: boolean;
  lockedEntityIds?: Array<string | number>;
}

const EMPTY_LOCKED_ENTITY_IDS: Array<string | number> = [];

export default function InteractionsPage({ useEntityFilters = true, lockedEntityIds = EMPTY_LOCKED_ENTITY_IDS }: InteractionsPageProps) {
  const { setSidebarContent } = useSidebarContent();
  const { entityIds: urlEntityIds, filters: urlFilters, setFilters: setUrlFilters } = useInteractionsUrlState();
  const { entityIds: selectedEntityIds } = useEntitySelection();
  const { isMobile, desktopVisiblePanes, mobileActivePane, toggleDesktopPane, setMobileActivePane } = useInteractionsWorkspaceState();
  const [filterCounts, setFilterCounts] = useState<Record<string, Record<string, number>>>({});

  const normalizedLockedEntityIds = useMemo(
    () => lockedEntityIds.map((id) => String(id).trim()).filter((id) => id.length > 0),
    [lockedEntityIds],
  );

  const scopedEntityIds = useMemo(() => {
    if (normalizedLockedEntityIds.length > 0) return normalizedLockedEntityIds;
    if (urlEntityIds.length > 0) return urlEntityIds;
    if (selectedEntityIds.length > 0) return selectedEntityIds;
    return [];
  }, [normalizedLockedEntityIds, selectedEntityIds, urlEntityIds]);

  const enforceEntityScope = useCallback((next: MeilisearchFilters): MeilisearchFilters => {
    if (!useEntityFilters || scopedEntityIds.length === 0) {
      return next;
    }

    return {
      ...next,
      entity_ids: scopedEntityIds,
      member_a_id: undefined,
      member_b_id: undefined,
    };
  }, [scopedEntityIds, useEntityFilters]);

  const filters = useMemo(() => enforceEntityScope(urlFilters), [enforceEntityScope, urlFilters]);

  const handleFilterChange = useCallback((newFilters: MeilisearchFilters) => {
    setUrlFilters(enforceEntityScope(newFilters));
  }, [enforceEntityScope, setUrlFilters]);

  const handleClearFilters = useCallback(() => {
    setUrlFilters(enforceEntityScope({}));
  }, [enforceEntityScope, setUrlFilters]);

  const handleFilterCountsUpdate = useCallback((counts: Record<string, Record<string, number>>) => {
    setFilterCounts(counts);
  }, []);

  useEffect(() => {
    if (Object.keys(filterCounts).length > 0) {
      setSidebarContent(
        <FilterSidebar
          filters={filters}
          filterCounts={filterCounts}
          onFilterChange={handleFilterChange}
          onClearFilters={handleClearFilters}
          isMobile
        />,
      );
    } else {
      setSidebarContent(null);
    }

    return () => {
      setSidebarContent(null);
    };
  }, [filters, filterCounts, handleFilterChange, handleClearFilters, setSidebarContent]);

  const interactionsContent = (
    <div className="flex-1 overflow-y-auto">
      <div className="w-full px-4">
        <InteractionsExploreTab
          filters={filters}
          onFilterChange={handleFilterChange}
          onFilterCountsUpdate={handleFilterCountsUpdate}
        />
      </div>
    </div>
  );

  const workspaceToolbar = (
    <div className="fixed bottom-4 right-4 z-40">
      <div className="inline-flex items-center rounded-full border bg-background/90 p-1 shadow-sm backdrop-blur">
        <Button
          size="sm"
          variant={isMobile ? (mobileActivePane === "interactions" ? "default" : "ghost") : (desktopVisiblePanes.includes("interactions") ? "default" : "ghost")}
          onClick={() => (isMobile ? setMobileActivePane("interactions") : toggleDesktopPane("interactions"))}
          className="rounded-full h-8"
        >
          Interactions
        </Button>
        <Button
          size="sm"
          variant={isMobile ? (mobileActivePane === "chat" ? "default" : "ghost") : (desktopVisiblePanes.includes("chat") ? "default" : "ghost")}
          onClick={() => (isMobile ? setMobileActivePane("chat") : toggleDesktopPane("chat"))}
          className="rounded-full h-8"
        >
          <MessageSquare className="mr-1.5 h-4 w-4" />
          Chat
        </Button>
      </div>
    </div>
  );

  const desktopPaneContent: Record<InteractionsWorkspacePane, React.ReactNode> = {
    interactions: interactionsContent,
    chat: <SearchAssistantPane />,
  };

  const mobileContent = mobileActivePane === "interactions"
    ? interactionsContent
    : <SearchAssistantPane />;

  return (
    <div className="flex-1 flex flex-col relative h-svh overflow-hidden">
      {workspaceToolbar}

      <div className="flex-1 min-h-0">
        {isMobile ? (
          <div className="h-full">{mobileContent}</div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {desktopVisiblePanes.map((pane, index) => (
              <Fragment key={pane}>
                {index > 0 ? <ResizableHandle withHandle /> : null}
                <ResizablePanel
                  defaultSize={Math.floor(100 / desktopVisiblePanes.length)}
                  minSize={desktopVisiblePanes.length === 1 ? 100 : 20}
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
