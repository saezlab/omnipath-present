"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export interface SelectedFilterItem {
  id: string;
  label: ReactNode;
  onRemove?: () => void;
}

interface SelectedFiltersSectionProps {
  items: SelectedFilterItem[];
  onClearAll: () => void;
}

export function SelectedFiltersSection({ items, onClearAll }: SelectedFiltersSectionProps) {
  if (items.length === 0) return null;

  const removableCount = items.filter((item) => !!item.onRemove).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {items.length} selected {items.length === 1 ? "filter" : "filters"}
          {removableCount !== items.length ? ` · ${removableCount} removable` : ""}
        </p>
        {removableCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={onClearAll} className="h-7 px-2 text-muted-foreground">
            Clear all
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-secondary/50 px-2 py-1 text-xs font-medium text-secondary-foreground"
          >
            <div className="min-w-0">{item.label}</div>
            {item.onRemove ? (
              <button
                type="button"
                onClick={item.onRemove}
                className="shrink-0 rounded-full p-0.5 transition-colors hover:bg-black/10 dark:hover:bg-white/10"
                aria-label="Remove filter"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
