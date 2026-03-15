"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ExternalLink, GripHorizontal, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFloatingNav } from "@/contexts/floating-nav-context";
import type { WorkspacePane } from "@/features/workspace/use-workspace-ui-state";
import { useWindowSize } from "@/hooks/use-window-size";
import { buildInteractionsUrl, buildSearchUrl, buildSelectionUrl, type ResultsView } from "@/lib/navigation/url-codecs";
import { useWorkspaceUrlState } from "@/lib/navigation/workspace-url-state";
import { cn } from "@/lib/utils";
import { useEntitySelection } from "@/lib/navigation/url-state";

const STORAGE_KEY = "omnipath-floating-nav-left";
const DEFAULT_TOP_OFFSET = 20;
const EDGE_PADDING = 16;

function readStoredLeft(): number | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const PANE_LABELS: Record<WorkspacePane, string> = {
  results: "Results",
  refine: "Refine",
  chat: "Chat",
};

const VIEW_LABELS: Record<ResultsView, string> = {
  entities: "Entities",
  interactions: "Interactions",
  selection: "Selection",
};

interface DragState {
  offsetFromCenter: number;
}

export function OmniPathFloatingMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const { width } = useWindowSize();
  const { workspaceControls } = useFloatingNav();
  const { entityIds, selectionCount } = useEntitySelection();
  const { view, entitiesView, interactionsView, selectionView } = useWorkspaceUrlState();
  const { resolvedTheme, setTheme } = useTheme();
  const pillRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const [mounted, setMounted] = useState(false);
  const [dragLeft, setDragLeft] = useState<number | null>(null);
  const [storedLeft, setStoredLeft] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onWorkspaceRoute = pathname === "/workspace";
  const isDesktop = width >= 1024;

  const navigateToView = (nextView: ResultsView) => {
    if (nextView === "entities") {
      router.push(buildSearchUrl({
        query: entitiesView.query,
        mode: entitiesView.mode,
        type: entitiesView.type,
        species: entitiesView.species,
        filters: entitiesView.filters,
        entityIds,
      }));
      return;
    }

    if (nextView === "interactions") {
      router.push(buildInteractionsUrl({
        entityIds: interactionsView.entityIds.length > 0 ? interactionsView.entityIds : entityIds,
        filters: interactionsView.filters,
      }));
      return;
    }

    router.push(buildSelectionUrl({
      entityIds,
      tab: selectionView.tab,
      filters: selectionView.filters,
    }));
  };

  useEffect(() => {
    setStoredLeft(readStoredLeft());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || storedLeft === null) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(storedLeft));
    } catch {
      // Ignore localStorage errors.
    }
  }, [mounted, storedLeft]);

  useEffect(() => {
    if (!isDesktop) {
      setDragLeft(null);
      setIsDragging(false);
      dragStateRef.current = null;
    }
  }, [isDesktop]);

  useEffect(() => {
    if (!pillRef.current || storedLeft === null || width === 0) return;

    const rect = pillRef.current.getBoundingClientRect();
    const maxLeft = Math.max(EDGE_PADDING, width - EDGE_PADDING - rect.width);
    if (storedLeft > maxLeft) {
      setStoredLeft(maxLeft);
    }
  }, [storedLeft, width]);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      const rect = pillRef.current?.getBoundingClientRect();
      if (!rect || !dragStateRef.current) return;

      const minLeft = EDGE_PADDING;
      const maxLeft = window.innerWidth - EDGE_PADDING - rect.width;
      const nextLeft = event.clientX - dragStateRef.current.offsetFromCenter - rect.width / 2;
      setDragLeft(Math.min(maxLeft, Math.max(minLeft, nextLeft)));
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      setIsDragging(false);

      if (typeof dragLeft === "number") {
        setStoredLeft(dragLeft);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragLeft, isDragging]);

  const handleDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isDesktop || !pillRef.current) return;

    const rect = pillRef.current.getBoundingClientRect();
    dragStateRef.current = {
      offsetFromCenter: event.clientX - (rect.left + rect.width / 2),
    };
    setIsDragging(true);
    setDragLeft(rect.left);
  };

  const computedLeft = useMemo(() => {
    if (dragLeft !== null) return dragLeft;
    if (storedLeft !== null) return storedLeft;
    if (width === 0 || !pillRef.current) return null;

    const rect = pillRef.current.getBoundingClientRect();
    return Math.max(EDGE_PADDING, width / 2 - rect.width / 2);
  }, [dragLeft, storedLeft, width]);

  if (!mounted) {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-none z-50 transition-transform duration-200",
        isDesktop ? "fixed" : "sticky top-0 w-full px-3 pt-3",
        isDragging && "scale-[1.02]",
      )}
      style={isDesktop ? {
        top: `${DEFAULT_TOP_OFFSET}px`,
        left: computedLeft === null ? "50%" : `${computedLeft}px`,
        transform: computedLeft === null ? "translateX(-50%)" : undefined,
      } : undefined}
    >
      <div
        ref={pillRef}
        onPointerDown={handleDragStart}
        className={cn(
          "group pointer-events-auto items-center gap-1 border border-white/40 bg-background/80 p-1.5 shadow-lg backdrop-blur-xl supports-[backdrop-filter]:bg-background/70",
          isDesktop ? "inline-flex rounded-full cursor-grab" : "flex w-full rounded-2xl",
          isDragging && "cursor-grabbing shadow-2xl",
        )}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground lg:flex">
          <GripHorizontal className="h-3.5 w-3.5" />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 rounded-full px-2.5 hover:bg-background/80"
            >
              <span className="flex items-center gap-2">
                <Image
                  src="/omnipath-logo-gradient.svg"
                  alt="OmniPath Logo"
                  width={22}
                  height={22}
                  className="shrink-0"
                />
                <span className="hidden text-sm font-medium tracking-tight sm:inline">OmniPath</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </span>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={10}
            className="w-72 rounded-2xl border bg-background/95 p-2 shadow-2xl backdrop-blur-xl"
          >
            <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Navigate
            </DropdownMenuLabel>
            <DropdownMenuItem asChild className="rounded-xl">
              <Link href="/sources">Sources</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="rounded-xl">
              <Link href="/api-docs" className="flex items-center justify-between gap-2">
                <span>API Docs</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </DropdownMenuItem>

            {workspaceControls ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Workspace panes
                </DropdownMenuLabel>
                {(["results", "refine", "chat"] as WorkspacePane[]).map((pane) => {
                  const checked = workspaceControls.isMobile
                    ? workspaceControls.mobileActivePane === pane
                    : workspaceControls.desktopVisiblePanes.includes(pane);

                  return (
                    <DropdownMenuCheckboxItem
                      key={pane}
                      checked={checked}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={() => {
                        if (workspaceControls.isMobile) {
                          if (!checked) workspaceControls.onMobileSelect(pane);
                          return;
                        }
                        workspaceControls.onDesktopToggle(pane);
                      }}
                      className="rounded-xl"
                    >
                      {PANE_LABELS[pane]}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Theme
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={resolvedTheme === "dark" ? "dark" : "light"} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light" className="rounded-xl">
                <Sun className="h-4 w-4" />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark" className="rounded-xl">
                <Moon className="h-4 w-4" />
                Dark
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div
          className={cn(
            "overflow-hidden transition-all duration-200 ease-out",
            isDesktop
              ? isDragging
                ? "ml-1 max-w-[28rem] opacity-100"
                : "max-w-0 opacity-0 group-hover:ml-1 group-hover:max-w-[28rem] group-hover:opacity-100"
              : "min-w-0 flex-1 opacity-100",
          )}
        >
          <div className={cn("flex items-center gap-1 bg-muted/60 p-1", isDesktop ? "rounded-full" : "min-w-0 flex-1 rounded-xl")}>
            {(["entities", "interactions"] as ResultsView[]).map((item) => {
              const active = onWorkspaceRoute && view === item;

              return (
                <Button
                  key={item}
                  size="sm"
                  variant="ghost"
                  onClick={() => navigateToView(item)}
                  className={cn(
                    "h-9 px-3 text-sm",
                    isDesktop ? "rounded-full" : "flex-1 rounded-lg",
                    active && "bg-background shadow-sm hover:bg-background",
                  )}
                >
                  {VIEW_LABELS[item]}
                </Button>
              );
            })}
            {selectionCount > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigateToView("selection")}
                className={cn(
                  "h-9 px-3 text-sm",
                  isDesktop ? "rounded-full" : "flex-1 rounded-lg",
                  onWorkspaceRoute && view === "selection" && "bg-background shadow-sm hover:bg-background",
                )}
              >
                <span className="flex items-center gap-2">
                  <span>{VIEW_LABELS.selection}</span>
                  <Badge variant="secondary">{selectionCount}</Badge>
                </span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
