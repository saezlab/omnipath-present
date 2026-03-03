"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/utils";
import { Filter, X } from "lucide-react";
import type { MeilisearchFilters } from "@/types/meilisearch";

interface SourceFilterSidebarProps {
  filters: MeilisearchFilters;
  filterCounts: {
    license_cv?: Record<string, number>;
    update_category_cv?: Record<string, number>;
    content_category_cv_terms?: Record<string, number>;
  };
  onFilterChange: (filters: MeilisearchFilters) => void;
  onClearFilters: () => void;
  isMobile?: boolean;
}

interface FilterSectionProps {
  title: string;
  filterKey: keyof MeilisearchFilters;
  selectedValues: string[];
  options: Array<{ value: string; count: number }>;
  onToggle: (value: string) => void;
}

function displayCvLabel(value: string): string {
  // Convert "label:PREFIX:1234" -> "label"
  const match = value.match(/^(.+):([A-Z]{2,}:\d+)$/);
  return match ? match[1] : value;
}

function FilterSection({ title, filterKey, selectedValues, options, onToggle }: FilterSectionProps) {
  if (options.length === 0) return null;

  return (
    <div>
      <h4 className="text-sm font-medium mb-3">{title}</h4>
      <div className="space-y-1 max-h-64 overflow-y-auto pr-2">
        {options.map(({ value, count }) => {
          const isSelected = selectedValues.includes(value);
          return (
            <div key={`${String(filterKey)}-${value}`} className="flex items-center justify-between gap-2 py-0.5">
              <Label
                htmlFor={`${String(filterKey)}-${value}`}
                className={`flex items-center gap-1.5 text-xs font-normal cursor-pointer min-w-0 flex-1 ${isSelected ? "text-primary font-medium" : ""}`}
              >
                <Checkbox
                  id={`${String(filterKey)}-${value}`}
                  checked={isSelected}
                  onCheckedChange={() => onToggle(value)}
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
                <span className="truncate">{displayCvLabel(value)}</span>
              </Label>
              <Badge variant={isSelected ? "default" : "outline"} className="text-xs h-5 px-1.5 py-0">
                {formatNumber(count)}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SourceFilterSidebar({
  filters,
  filterCounts,
  onFilterChange,
  onClearFilters,
  isMobile = false,
}: SourceFilterSidebarProps) {
  const activeFilterCount = Object.entries(filters).reduce((count, [, value]) => {
    if (Array.isArray(value)) return count + value.length;
    if (value !== null && value !== undefined) return count + 1;
    return count;
  }, 0);

  const handleToggle = (filterKey: keyof MeilisearchFilters, value: string) => {
    const currentValues = (filters[filterKey] as string[] | undefined) || [];
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((v) => v !== value)
      : [...currentValues, value];

    onFilterChange({
      ...filters,
      [filterKey]: nextValues.length > 0 ? nextValues : undefined,
    });
  };

  const toOptions = (values?: Record<string, number>) =>
    Object.entries(values || {})
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);

  const content = (
    <div className="space-y-6">
      <FilterSection
        title="Content categories"
        filterKey="content_category_cv_terms"
        selectedValues={filters.content_category_cv_terms || []}
        options={toOptions(filterCounts.content_category_cv_terms)}
        onToggle={(value) => handleToggle("content_category_cv_terms", value)}
      />

      <FilterSection
        title="License"
        filterKey="license_cv"
        selectedValues={filters.license_cv || []}
        options={toOptions(filterCounts.license_cv)}
        onToggle={(value) => handleToggle("license_cv", value)}
      />

      <FilterSection
        title="Update category"
        filterKey="update_category_cv"
        selectedValues={filters.update_category_cv || []}
        options={toOptions(filterCounts.update_category_cv)}
        onToggle={(value) => handleToggle("update_category_cv", value)}
      />
    </div>
  );

  if (isMobile) return content;

  return (
    <Card className="h-full overflow-hidden flex flex-col">
      <CardHeader className="border-b flex-shrink-0 h-[57px] flex items-center py-3">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">Filters</h3>
          </div>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearFilters} className="flex items-center gap-1 text-muted-foreground">
              <X className="h-4 w-4" />
              Clear all ({formatNumber(activeFilterCount)})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto py-4">{content}</CardContent>
    </Card>
  );
}
