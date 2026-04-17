"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface BrowserTabConfig<TTab extends string> {
  value: TTab;
  label: string;
  badge?: ReactNode;
}

interface SpeciesOption {
  value: string;
  label: string;
}

interface ExploreBrowserShellProps<TTab extends string> {
  query: string;
  draftQuery: string;
  onDraftQueryChange: (value: string) => void;
  onSubmitSearch: () => void;
  tab: TTab;
  onTabChange: (tab: TTab) => void;
  tabs: BrowserTabConfig<TTab>[];
  content: ReactNode;
  searchPlaceholder: string;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  species?: string;
  onSpeciesChange?: (value: string | null) => void;
  showSpeciesPicker?: boolean;
  speciesOptions?: readonly SpeciesOption[];
  helperText?: ReactNode;
  footerCta?: ReactNode;
  summarySlot?: ReactNode;
}


export function ExploreBrowserShell<TTab extends string>({
  draftQuery,
  onDraftQueryChange,
  onSubmitSearch,
  tab,
  onTabChange,
  tabs,
  content,
  searchPlaceholder,
  searchInputRef,
  species,
  onSpeciesChange,
  showSpeciesPicker = false,
  speciesOptions = [],
  footerCta,
  summarySlot,
}: ExploreBrowserShellProps<TTab>) {
  return (
    <div className="relative mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 overflow-hidden px-4 py-4 md:px-6 md:py-5">
      <div className="shrink-0 space-y-3">
        <div className="rounded-[1.4rem] border bg-card p-2.5 shadow-sm">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="search"
                value={draftQuery}
                onChange={(event) => onDraftQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSubmitSearch();
                  }
                }}
                placeholder={searchPlaceholder}
                className="h-11 rounded-[1rem] border-0 bg-muted/40 pl-10 text-sm shadow-none sm:text-base"
              />
            </div>

            <div className="flex items-center gap-2 lg:shrink-0">
              {showSpeciesPicker && onSpeciesChange ? (
                <select
                  value={species}
                  onChange={(event) => onSpeciesChange(event.target.value || null)}
                  className="h-9 rounded-lg border bg-background px-3 text-sm"
                >
                  {speciesOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : null}
              <Button onClick={onSubmitSearch} className="h-9 rounded-lg px-3.5 text-sm">
                Search
              </Button>
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <Tabs value={tab} onValueChange={(value) => onTabChange(value as TTab)} className="min-w-0 flex-1">
              <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl bg-muted/60 p-1">
                {tabs.map((item) => (
                  <TabsTrigger key={item.value} value={item.value} className="rounded-lg text-sm">
                    <span className="flex items-center gap-2">
                      <span>{item.label}</span>
                      {item.badge}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        {summarySlot}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
      </div>

      {footerCta}
    </div>
  );
}
