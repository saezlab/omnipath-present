"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Filter, X } from "lucide-react"
import { cn, formatNumber, getEntityTypeEmoji } from "@/lib/utils"
import { useEffect, useState } from "react"
import { EntityHoverCard, CvTermHoverCard } from "@/features/shared/entity-results/result-card"
import { getEntityFilterOptions } from "@/lib/queries/entity"

interface FilterOption {
  value: string;
  displayName?: string;
  icon?: string;
  id?: string | null;
}

interface EntityFilterSidebarProps {
  filters: {
    entity_types?: string[];
    sources?: string[];
  };
  onFilterChange: (filters: { entity_types?: string[]; sources?: string[] }) => void;
  onClearFilters: () => void;
  isMobile?: boolean;
}

function FilterSection({
  title,
  filterKey,
  options,
  selectedValues,
  onToggle,
}: {
  title: string;
  filterKey: 'entity_types' | 'sources';
  options: FilterOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div>
      <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h4>
      <div className="space-y-1 max-h-64 overflow-y-auto pr-2">
        {options.map(({ value, displayName, icon, id }) => {
          const isSelected = selectedValues?.includes(value) || false;

          const labelContent = (
            <span className="truncate">
              {icon && <span className="mr-1.5">{icon}</span>}
              {displayName || value}
            </span>
          );

          return (
            <div key={value} className="flex items-center justify-between py-0.5 gap-2">
              <Label
                htmlFor={`${filterKey}-${value}`}
                className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-normal leading-5 ${isSelected ? "text-foreground font-medium" : "text-foreground"}`}
              >
                <Checkbox
                  id={`${filterKey}-${value}`}
                  checked={isSelected}
                  onCheckedChange={() => onToggle(value)}
                  className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isSelected ? "border-primary" : ""
                  )}
                />
                {id ? (
                  id.startsWith('MI:') || id.startsWith('OM:') ? (
                    <CvTermHoverCard termId={id}>
                      {labelContent}
                    </CvTermHoverCard>
                  ) : (
                    <EntityHoverCard entityId={id}>
                      {labelContent}
                    </EntityHoverCard>
                  )
                ) : (
                  labelContent
                )}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EntityFilterSidebar({
  filters,
  onFilterChange,
  onClearFilters,
  isMobile = false,
}: EntityFilterSidebarProps) {
  const [entityTypeOptions, setEntityTypeOptions] = useState<FilterOption[]>([]);
  const [sourceOptions, setSourceOptions] = useState<FilterOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getEntityFilterOptions()
      .then((options) => {
        if (cancelled) return;
        setEntityTypeOptions(
          options.entity_types.map((value) => {
            const match = value.match(/^(.+):([A-Z]+:\d+)$/);
            let displayName = value;
            let id: string | null = null;
            if (match) {
              displayName = match[1];
              id = match[2];
            } else {
              const parts = value.split(':');
              if (parts.length > 1) {
                displayName = parts.slice(0, -1).join(':');
                const potentialId = parts[parts.length - 1];
                if (potentialId.length < 20) {
                  const possiblePrefix = parts[parts.length - 2];
                  if (['MI', 'OM'].includes(possiblePrefix)) {
                    id = `${possiblePrefix}:${parts[parts.length - 1]}`;
                  } else {
                    id = parts[parts.length - 1];
                  }
                }
              }
            }
            return {
              value,
              displayName,
              icon: getEntityTypeEmoji(value),
              id,
            };
          })
        );
        setSourceOptions(
          options.sources.map((value) => ({
            value,
            displayName: value,
            icon: '📚',
          }))
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const activeFilterCount = Object.entries(filters).reduce((count, [, value]) => {
    if (Array.isArray(value)) return count + value.length;
    if (value !== null && value !== undefined) return count + 1;
    return count;
  }, 0);

  const handleToggle = (filterKey: 'entity_types' | 'sources', value: string) => {
    const currentValues = (filters[filterKey] as string[]) || [];
    const newValues = currentValues.includes(value)
      ? currentValues.filter(v => v !== value)
      : [...currentValues, value];

    onFilterChange({
      ...filters,
      [filterKey]: newValues.length > 0 ? newValues : undefined,
    });
  };

  const content = (
    <div className={cn("space-y-6", loading && "opacity-70")}>
      <FilterSection
        title="Entity Types"
        filterKey="entity_types"
        options={entityTypeOptions}
        selectedValues={filters.entity_types || []}
        onToggle={(value) => handleToggle("entity_types", value)}
      />
      <FilterSection
        title="Data Sources"
        filterKey="sources"
        options={sourceOptions}
        selectedValues={filters.sources || []}
        onToggle={(value) => handleToggle("sources", value)}
      />
    </div>
  );

  if (isMobile) {
    return content;
  }

  return (
    <Card className="h-full overflow-hidden flex flex-col">
      <CardHeader className="border-b flex-shrink-0 h-[57px] flex items-center py-3">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">Filters</h3>
          </div>
          {activeFilterCount > 0 && onClearFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="flex items-center gap-1 text-muted-foreground"
            >
              <X className="h-4 w-4" />
              Clear all ({formatNumber(activeFilterCount)})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto py-4">
        {content}
      </CardContent>
    </Card>
  );
}
