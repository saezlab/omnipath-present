"use client"

import { type ReactNode, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchFilters } from "@/types/search"
import { X, Filter, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { EntityHoverCard, CvTermHoverCard } from "@/features/shared/entity-results/result-card"
import { useOntologyTerms } from "@/features/ontology/use-ontology-terms"
import { getRelationFilterOptions } from "@/lib/queries/relation"
import { getOntologyPrefixes, searchOntologyTerms } from "@/lib/queries/ontology-term"

interface FilterOption {
  value: string;
  label?: string;
  icon?: ReactNode;
  prefix?: string;
  filterKey?: keyof SearchFilters;
}

interface FilterSidebarProps {
  filters: SearchFilters;
  onFilterChange: (filters: SearchFilters) => void;
  onClearFilters: () => void;
  isMobile?: boolean;
}

function extractTermId(value: string): string | null {
  const match = value.match(/(MI|OM|GO|HP|KW|DO|MP|CHEBI|CL|UBERON|MONDO):\d{4,}|WP\d+|R-[A-Z]+-\d+/);
  return match ? match[0] : null;
}

const PREFIX_NAMES: Record<string, string> = {
  GO: "Gene Ontology",
  MI: "Molecular Interactions",
  OM: "OmniPath Terms",
  KW: "UniProt Keywords",
  DO: "Disease Ontology",
  HP: "Human Phenotype",
  CHEBI: "ChEBI",
  CL: "Cell Ontology",
  UBERON: "Uberon",
  MONDO: "Mondo",
  WP: "WikiPathways",
  REACTOME: "Reactome",
};

const ENTITY_ONTOLOGY_FACET_MAP: Record<string, keyof SearchFilters> = {
  GO: "ontology_terms",
  MI: "ontology_terms",
  OM: "ontology_terms",
  HP: "ontology_terms",
  KW: "ontology_terms",
  CHEBI: "ontology_terms",
};

function extractPrefix(termId: string): string {
  const resolved = extractTermId(termId) || termId;
  if (/^WP\d+$/i.test(resolved)) return "WP";
  if (/^R-[A-Z]+-\d+$/i.test(resolved)) return "REACTOME";
  const match = resolved.match(/^([A-Z]{2,}):/);
  return match ? match[1] : "OTHER";
}

function getEntityFilterKeyForValue(value: string): keyof SearchFilters | null {
  const prefix = extractPrefix(value);
  return ENTITY_ONTOLOGY_FACET_MAP[prefix] ?? "ontology_terms";
}

function extractTermLabel(value: string): string {
  const termId = extractTermId(value);
  if (!termId) return value.includes(":") ? value.split(":")[0] : value;
  if (value === termId) return termId;
  const repeatedSuffix = `:${termId}:${termId}`;
  const singleSuffix = `:${termId}`;
  if (value.endsWith(repeatedSuffix)) return value.slice(0, -repeatedSuffix.length);
  if (value.endsWith(singleSuffix)) return value.slice(0, -singleSuffix.length);
  if (value.includes(":")) return value.split(":")[0];
  return value;
}

interface FilterOptionRowProps {
  filterKey: keyof SearchFilters;
  option: FilterOption;
  selectedValues: string[];
  onToggle: (value: string) => void;
  showHoverCard?: boolean;
  showIcon?: boolean;
  labelOverride?: string;
  highlighted?: boolean;
}

function FilterOptionRow({
  filterKey,
  option,
  selectedValues,
  onToggle,
  showHoverCard = false,
  showIcon = false,
  labelOverride,
  highlighted = false,
}: FilterOptionRowProps) {
  const { value, label, icon } = option;
  const isSelected = selectedValues?.includes(value) || false;
  let displayLabel = labelOverride || label;
  let entityId: string | null = extractTermId(value);

  if (!displayLabel) {
    const parts = value.split(':');
    if (parts.length >= 2) {
      const possiblePrefix = parts[parts.length - 2];
      if (['MI', 'OM'].includes(possiblePrefix)) {
        entityId = `${parts[parts.length - 2]}:${parts[parts.length - 1]}`;
        displayLabel = parts.slice(0, parts.length - 2).join(':');
      } else {
        entityId = parts[parts.length - 1];
        displayLabel = parts.slice(0, parts.length - 1).join(':');
      }
    } else {
      displayLabel = value;
    }
  } else {
    const parts = value.split(':');
    if (parts.length >= 2 && !entityId) {
      const possiblePrefix = parts[parts.length - 2];
      if (['MI', 'OM'].includes(possiblePrefix)) {
        entityId = `${possiblePrefix}:${parts[parts.length - 1]}`;
      } else {
        entityId = parts[parts.length - 1];
      }
    }
  }

  const labelContent = (
    <span className={cn(
      "truncate inline-flex items-center",
      highlighted ? "font-medium" : ""
    )}>
      {showIcon && icon && <span className="mr-1.5 inline-flex items-center">{icon}</span>}
      {displayLabel}
    </span>
  );

  const isCvTerm = !!(entityId && extractTermId(entityId));

  return (
    <div className="flex items-center justify-between py-0.5 gap-2">
      <Label
        htmlFor={`${filterKey}-${value}`}
        className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-normal leading-5 text-foreground ${isSelected ? "font-medium" : ""}`}
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
        {showHoverCard && entityId ? (
          isCvTerm ? (
            <CvTermHoverCard termId={entityId}>
              {labelContent}
            </CvTermHoverCard>
          ) : (
            <EntityHoverCard entityId={entityId}>
              {labelContent}
            </EntityHoverCard>
          )
        ) : (
          labelContent
        )}
      </Label>
    </div>
  );
}

export function FilterSidebar({
  filters,
  onFilterChange,
  onClearFilters,
  isMobile = false,
}: FilterSidebarProps) {
  const [predicatesByCategory, setPredicatesByCategory] = useState<Record<string, string[]>>({});
  const [sourceOptions, setSourceOptions] = useState<FilterOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRelationFilterOptions()
      .then((options) => {
        if (cancelled) return;
        setPredicatesByCategory(options.predicatesByCategory);
        setSourceOptions(
          options.sources.map((value) => ({
            value,
            label: value,
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

  const handleArrayToggle = (filterKey: keyof SearchFilters, value: string) => {
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
      {Object.entries(predicatesByCategory).map(([category, predicates]) => (
        <div key={category} className="space-y-2">
          <FilterOptionRow
            filterKey="relation_categories"
            option={{ value: category, label: category }}
            selectedValues={filters.relation_categories || []}
            onToggle={(value) => handleArrayToggle("relation_categories", value)}
          />
          <div className="space-y-1 max-h-64 overflow-y-auto pr-2 pl-4">
            {predicates.map((predicate) => (
              <FilterOptionRow
                key={predicate}
                filterKey="predicates"
                option={{ value: predicate, label: predicate }}
                selectedValues={filters.predicates || []}
                onToggle={(value) => handleArrayToggle("predicates", value)}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Sources</h4>
        <div className="space-y-1 max-h-64 overflow-y-auto pr-2">
          {sourceOptions.map((option) => (
            <FilterOptionRow
              key={option.value}
              filterKey="sources"
              option={option}
              selectedValues={filters.sources || []}
              onToggle={(value) => handleArrayToggle("sources", value)}
              showIcon={true}
            />
          ))}
        </div>
      </div>
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
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
              Clear all ({activeFilterCount})
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

interface OntologySearchMatch {
  id: string;
  ontology_id: string;
  name?: string | null;
}

interface AnnotationFilterSidebarProps {
  mode: "entities" | "interactions";
  filters: SearchFilters;
  onFilterChange: (filters: SearchFilters) => void;
  isMobile?: boolean;
}

export function AnnotationFilterSidebar({
  mode,
  filters,
  onFilterChange,
  isMobile = false,
}: AnnotationFilterSidebarProps) {
  const [annotationQuery, setAnnotationQuery] = useState("");
  const [ontologySearchOptions, setOntologySearchOptions] = useState<FilterOption[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [selectedPrefixes, setSelectedPrefixes] = useState<string[]>([]);
  const [prefixTerms, setPrefixTerms] = useState<Record<string, FilterOption[]>>({});
  const [loadingPrefixes, setLoadingPrefixes] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingPrefixes(true);
    getOntologyPrefixes()
      .then((data) => {
        if (cancelled) return;
        setPrefixes(data);
      })
      .finally(() => {
        if (!cancelled) setLoadingPrefixes(false);
      });
    return () => { cancelled = true; };
  }, []);

  const ontologyTermIds = useMemo(() => {
    const values = new Set<string>();
    ontologySearchOptions.forEach((option) => {
      const termId = extractTermId(option.value);
      if (termId) values.add(termId);
    });
    Object.values(prefixTerms).forEach((terms) => {
      terms.forEach((option) => {
        const termId = extractTermId(option.value);
        if (termId) values.add(termId);
      });
    });
    return Array.from(values);
  }, [ontologySearchOptions, prefixTerms]);

  const ontologyTermsById = useOntologyTerms(ontologyTermIds);

  const normalizedQuery = annotationQuery.trim().toLowerCase();

  useEffect(() => {
    const query = annotationQuery.trim();
    if (!query) {
      setOntologySearchOptions([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/terms/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queries: [query],
            limit: 25,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Ontology search failed (${response.status})`);
        }

        const data = (await response.json()) as {
          results?: Record<string, OntologySearchMatch[]>;
        };
        const matches = data.results?.[query] || [];

        setOntologySearchOptions(
          matches.map((match) => {
            const termId = match.id || match.ontology_id;
            const prefix = extractPrefix(termId);
            const filterKey = mode === "entities"
              ? getEntityFilterKeyForValue(termId) || undefined
              : ("interaction_annotation_terms" as keyof SearchFilters);

            return {
              value: termId,
              label: match.name || termId,
              icon: prefix,
              prefix,
              filterKey,
            };
          })
        );
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.error("Ontology search failed:", error);
        setOntologySearchOptions([]);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [annotationQuery, mode]);

  useEffect(() => {
    let cancelled = false;
    if (selectedPrefixes.length === 0) {
      setPrefixTerms({});
      return;
    }

    Promise.all(
      selectedPrefixes.map(async (prefix) => {
        try {
          const terms = await searchOntologyTerms({ prefixes: [prefix], limit: 50 });
          return {
            prefix,
            options: terms.map((term) => ({
              value: term.termId,
              label: term.label || term.termId,
              icon: prefix,
              prefix,
              filterKey: mode === "entities"
                ? getEntityFilterKeyForValue(term.termId) || undefined
                : ("interaction_annotation_terms" as keyof SearchFilters),
            })),
          };
        } catch {
          return { prefix, options: [] as FilterOption[] };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const byPrefix: Record<string, FilterOption[]> = {};
      results.forEach(({ prefix, options }) => {
        byPrefix[prefix] = options;
      });
      setPrefixTerms(byPrefix);
    });

    return () => { cancelled = true; };
  }, [selectedPrefixes, mode]);

  const annotationOptions = useMemo<FilterOption[]>(() => {
    const resolveLabel = (value: string) => {
      const termId = extractTermId(value);
      return (termId ? ontologyTermsById[termId]?.name : undefined) || extractTermLabel(value);
    };

    return ontologySearchOptions.map((option) => ({
      ...option,
      label: option.label || resolveLabel(option.value),
    }));
  }, [ontologySearchOptions, ontologyTermsById]);

  const handleAnnotationToggle = (value: string, explicitFilterKey?: keyof SearchFilters) => {
    let filterKey = explicitFilterKey;
    if (!filterKey) {
      if (mode === "entities") {
        filterKey = getEntityFilterKeyForValue(value) || undefined;
      } else {
        filterKey = "interaction_annotation_terms";
      }
    }
    if (!filterKey) return;

    const currentValues = (filters[filterKey] as string[] | undefined) || [];
    const newValues = currentValues.includes(value)
      ? currentValues.filter((v) => v !== value)
      : [...currentValues, value];

    onFilterChange({
      ...filters,
      [filterKey]: newValues.length > 0 ? newValues : undefined,
    });
  };

  const togglePrefix = (prefix: string) => {
    setSelectedPrefixes((prev) =>
      prev.includes(prefix) ? prev.filter((p) => p !== prefix) : [...prev, prefix]
    );
  };

  const content = (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search ontology terms"
            value={annotationQuery}
            onChange={(event) => setAnnotationQuery(event.target.value)}
            className="pl-9 pr-9 h-9"
          />
          {annotationQuery ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setAnnotationQuery("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Prefix chips */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Filter by prefix</h4>
        <div className="flex flex-wrap gap-1.5">
          {prefixes.map((prefix) => (
            <Button
              key={prefix}
              size="sm"
              variant={selectedPrefixes.includes(prefix) ? "default" : "outline"}
              onClick={() => togglePrefix(prefix)}
              className="h-7 text-xs px-2.5"
            >
              {prefix}
            </Button>
          ))}
          {loadingPrefixes && (
            <span className="text-xs text-muted-foreground">Loading prefixes...</span>
          )}
        </div>
      </div>

      {/* Search results */}
      {annotationOptions.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Search results</h4>
          {annotationOptions.map((option) => {
            const filterKey = option.filterKey || (mode === "entities"
              ? getEntityFilterKeyForValue(option.value)
              : "interaction_annotation_terms");
            if (!filterKey) return null;

            return (
              <FilterOptionRow
                key={option.value}
                filterKey={filterKey}
                option={option}
                selectedValues={(filters[filterKey] as string[] | undefined) || []}
                onToggle={(value) => handleAnnotationToggle(value, filterKey)}
                showHoverCard={true}
              />
            );
          })}
        </div>
      )}

      {/* Prefix browse results */}
      {selectedPrefixes.length > 0 && (
        <div className="space-y-4">
          {selectedPrefixes.map((prefix) => {
            const terms = prefixTerms[prefix] || [];
            return (
              <div key={prefix} className="space-y-1">
                <h4 className="text-sm font-medium text-foreground">
                  {PREFIX_NAMES[prefix] || prefix}
                </h4>
                {terms.length > 0 ? (
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-2">
                    {terms.map((option) => {
                      const filterKey = option.filterKey || (mode === "entities"
                        ? getEntityFilterKeyForValue(option.value)
                        : "interaction_annotation_terms");
                      if (!filterKey) return null;

                      return (
                        <FilterOptionRow
                          key={option.value}
                          filterKey={filterKey}
                          option={option}
                          selectedValues={(filters[filterKey] as string[] | undefined) || []}
                          onToggle={(value) => handleAnnotationToggle(value, filterKey)}
                          showHoverCard={true}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Loading terms...</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {normalizedQuery && annotationOptions.length === 0 && selectedPrefixes.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No ontology terms match your search.
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return content;
  }

  return (
    <Card className="h-full overflow-hidden flex flex-col">
      <CardHeader className="border-b flex-shrink-0 h-[57px] flex items-center py-3">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Ontology Browser</h3>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto py-4">
        {content}
      </CardContent>
    </Card>
  );
}
