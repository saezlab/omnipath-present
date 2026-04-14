"use client"

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MeilisearchFilters } from "@/types/meilisearch"
import { X, Filter, Search, ArrowRight, Minus, Plus, Ban } from "lucide-react"
import { cn, formatNumber, getEntityTypeEmoji } from "@/lib/utils"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { EntityHoverCard, CvTermHoverCard } from "@/features/search/components/result-card"
import { useOntologyTerms } from "@/features/ontology/use-ontology-terms"

interface FilterOption {
  value: string;
  count: number;
  label?: string;
  icon?: ReactNode;
  prefix?: string;
  filterKey?: keyof MeilisearchFilters;
}


interface FilterSidebarProps {
  filters: MeilisearchFilters;
  filterCounts: Record<string, Record<string, number>>;
  onFilterChange: (filters: MeilisearchFilters) => void;
  onClearFilters: () => void;
  isMobile?: boolean;
}

function extractTermId(value: string): string | null {
  // Match ontology term IDs (PSI-MI, OmniPath, GO, HPO, ChEBI, etc.)
  // Also support WikiPathways (WP1234) and Reactome (R-HSA-12345) style accessions.
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

const ENTITY_ONTOLOGY_FACET_MAP: Record<string, keyof MeilisearchFilters> = {
  GO: "ontology_terms",
  MI: "ontology_terms",
  OM: "ontology_terms",
  HP: "ontology_terms",
  KW: "ontology_terms",
  CHEBI: "ontology_terms",
};

const PARTICIPANT_ONTOLOGY_FACET_MAP: Record<string, keyof MeilisearchFilters> = {
  GO: "participant_annotation_terms",
  MI: "participant_annotation_terms",
  OM: "participant_annotation_terms",
  HP: "participant_annotation_terms",
  KW: "participant_annotation_terms",
  CHEBI: "participant_annotation_terms",
};

type InteractionAnnotationScope = "interaction" | "participant";

function extractPrefix(termId: string): string {
  const resolved = extractTermId(termId) || termId;

  if (/^WP\d+$/i.test(resolved)) {
    return "WP";
  }

  if (/^R-[A-Z]+-\d+$/i.test(resolved)) {
    return "REACTOME";
  }

  const match = resolved.match(/^([A-Z]{2,}):/);
  return match ? match[1] : "OTHER";
}

function getEntityFilterKeyForValue(value: string): keyof MeilisearchFilters | null {
  const prefix = extractPrefix(value);
  return ENTITY_ONTOLOGY_FACET_MAP[prefix] ?? "ontology_terms";
}

function extractTermLabel(value: string): string {
  const termId = extractTermId(value);
  if (!termId) {
    return value.includes(":") ? value.split(":")[0] : value;
  }

  if (value === termId) {
    return termId;
  }

  const repeatedSuffix = `:${termId}:${termId}`;
  const singleSuffix = `:${termId}`;

  if (value.endsWith(repeatedSuffix)) {
    return value.slice(0, -repeatedSuffix.length);
  }

  if (value.endsWith(singleSuffix)) {
    return value.slice(0, -singleSuffix.length);
  }

  if (value.includes(":")) {
    return value.split(":")[0];
  }

  return value;
}

// Helper component for array filter sections
interface ArrayFilterSectionProps {
  title: string;
  filterKey: keyof MeilisearchFilters;
  options: FilterOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  showHoverCard?: boolean;
  showIcon?: boolean;
}

function ArrayFilterSection({
  title,
  filterKey,
  options,
  selectedValues,
  onToggle,
  showHoverCard = false,
  showIcon = false
}: ArrayFilterSectionProps) {
  if (options.length === 0) return null;

  return (
    <AccordionItem value={filterKey}>
      <AccordionTrigger>{title}</AccordionTrigger>
      <AccordionContent>
        <div className="space-y-1 max-h-64 overflow-y-auto pr-2">
          {options.map((option) => (
            <FilterOptionRow
              key={option.value}
              filterKey={filterKey}
              option={option}
              selectedValues={selectedValues}
              onToggle={onToggle}
              showHoverCard={showHoverCard}
              showIcon={showIcon}
            />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

interface FilterOptionRowProps {
  filterKey: keyof MeilisearchFilters;
  option: FilterOption;
  selectedValues: string[];
  onToggle: (value: string) => void;
  showHoverCard?: boolean;
  showIcon?: boolean;
  labelOverride?: string;
  highlighted?: boolean;
  hideCount?: boolean;
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
  hideCount = false,
}: FilterOptionRowProps) {
  const { value, count, label, icon } = option;
  const isSelected = selectedValues?.includes(value) || false;
  // Parse label and ID from "Label:ID" format if present
  // If the value matches the pattern "Label:Prefix:ID", we want to split correctly
  // Example: "Agonist:MI:0001" -> label="Agonist", id="MI:0001"
  let displayLabel = labelOverride || label;
  let entityId: string | null = extractTermId(value);

  if (!displayLabel) {
    // Try to parse from value string
    const parts = value.split(':');
    if (parts.length >= 2) {
      // Check if it looks like a CV term ID (MI:xxxx or OM:xxxx)
      const possiblePrefix = parts[parts.length - 2];
      if (['MI', 'OM'].includes(possiblePrefix)) {
        // Format: "Label:MI:0001"
        entityId = `${parts[parts.length - 2]}:${parts[parts.length - 1]}`;
        displayLabel = parts.slice(0, parts.length - 2).join(':');
      } else {
        // Format: "Label:ID" (standard entity)
        entityId = parts[parts.length - 1];
        displayLabel = parts.slice(0, parts.length - 1).join(':');
      }
    } else {
      displayLabel = value;
    }
  } else {
    // Label is provided, try to extract ID from value if it looks like an ID
    // If value already contains the ID (which is typical), we need to extract the ID part
    const parts = value.split(':');
    if (parts.length >= 2 && !entityId) {
      const possiblePrefix = parts[parts.length - 2];
      if (['MI', 'OM'].includes(possiblePrefix)) {
        entityId = `${parts[parts.length - 2]}:${parts[parts.length - 1]}`;
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
      {!hideCount ? (
        <Badge
          variant={isSelected ? "default" : "outline"}
          className={cn(
            "h-5 flex-shrink-0 px-1.5 py-0 text-[11px]",
            isSelected ? "bg-primary text-primary-foreground" : ""
          )}
        >
          {formatNumber(count)}
        </Badge>
      ) : null}
    </div>
  );
}

export function FilterSidebar({
  filters,
  filterCounts,
  onFilterChange,
  onClearFilters,
  isMobile = false,
}: FilterSidebarProps) {
  // Calculate active filter count
  const activeFilterCount = Object.entries(filters).reduce((count, [, value]) => {
    if (Array.isArray(value)) return count + value.length;
    if (value !== null && value !== undefined) return count + 1;
    return count;
  }, 0);

  // Handler for toggling array filters
  const handleArrayToggle = (filterKey: keyof MeilisearchFilters, value: string) => {
    const currentValues = (filters[filterKey] as string[]) || [];
    const newValues = currentValues.includes(value)
      ? currentValues.filter(v => v !== value)
      : [...currentValues, value];

    onFilterChange({
      ...filters,
      [filterKey]: newValues.length > 0 ? newValues : undefined,
    });
  };

  // Transform filter counts into FilterOption[] format
  const transformFilterCounts = (
    counts: Record<string, number> | undefined,
    filterKey?: string
  ): FilterOption[] => {
    if (!counts) return [];
    return Object.entries(counts)
      .map(([value, count]) => {
        const label = filterKey === 'interaction_type'
          ? value
            .split('|')
            .map((part) => {
              const typeLabel = part.split(':')[0]?.trim() || part;
              const emoji = getEntityTypeEmoji(typeLabel);
              return emoji ? `${emoji} ${typeLabel}` : typeLabel;
            })
            .join(' · ')
          : extractTermLabel(value);

        const icon = filterKey === 'sources' ? '📚' : undefined;

        return {
          value,
          count,
          label,
          icon
        };
      })
      .sort((a, b) => b.count - a.count);
  };

  const selectedPropertyValues = [
    ...(filters.is_directed === true ? ['directed'] : []),
    ...(filters.is_directed === false ? ['undirected'] : []),
    ...((filters.signs || []).map((sign) => String(sign))),
  ];

  const interactionPropertyOptions: FilterOption[] = [
    ...(filterCounts.is_directed?.true !== undefined ? [{
      value: 'directed',
      count: filterCounts.is_directed.true,
      label: 'Directed',
      icon: <ArrowRight className="h-3.5 w-3.5" />,
      filterKey: 'is_directed' as keyof MeilisearchFilters,
    }] : []),
    ...(filterCounts.is_directed?.false !== undefined ? [{
      value: 'undirected',
      count: filterCounts.is_directed.false,
      label: 'Undirected',
      icon: <Minus className="h-3.5 w-3.5" />,
      filterKey: 'is_directed' as keyof MeilisearchFilters,
    }] : []),
    ...(filterCounts.sign?.['1'] !== undefined ? [{
      value: '1',
      count: filterCounts.sign['1'],
      label: 'Activation',
      icon: <Plus className="h-3.5 w-3.5 text-green-600" />,
      filterKey: 'signs' as keyof MeilisearchFilters,
    }] : []),
    ...(filterCounts.sign?.['-1'] !== undefined ? [{
      value: '-1',
      count: filterCounts.sign['-1'],
      label: 'Inhibition',
      icon: <Ban className="h-3.5 w-3.5 text-red-600" />,
      filterKey: 'signs' as keyof MeilisearchFilters,
    }] : []),
    ...(filterCounts.sign?.['0'] !== undefined ? [{
      value: '0',
      count: filterCounts.sign['0'],
      label: 'Unsigned',
      icon: <Minus className="h-3.5 w-3.5 text-muted-foreground" />,
      filterKey: 'signs' as keyof MeilisearchFilters,
    }] : []),
  ];

  const handlePropertyToggle = (value: string) => {
    if (value === 'directed') {
      onFilterChange({
        ...filters,
        is_directed: filters.is_directed === true ? undefined : true,
      });
      return;
    }

    if (value === 'undirected') {
      onFilterChange({
        ...filters,
        is_directed: filters.is_directed === false ? undefined : false,
      });
      return;
    }

    const signValue = Number(value) as -1 | 0 | 1;
    const currentSigns = filters.signs || [];
    const nextSigns = currentSigns.includes(signValue)
      ? currentSigns.filter((sign) => sign !== signValue)
      : [...currentSigns, signValue];

    onFilterChange({
      ...filters,
      signs: nextSigns.length > 0 ? nextSigns : undefined,
    });
  };

  const content = (
    <div className="space-y-4">
      {interactionPropertyOptions.length > 0 ? (
        <div className="space-y-2">
          <div className="space-y-1">
            {interactionPropertyOptions.map((option) => {
              const filterKey = option.filterKey;
              if (!filterKey) return null;
              return (
                <FilterOptionRow
                  key={option.value}
                  filterKey={filterKey}
                  option={option}
                  selectedValues={selectedPropertyValues}
                  onToggle={handlePropertyToggle}
                  showIcon={true}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      <Accordion type="multiple" defaultValue={["interaction_types"]} className="w-full">
        {/* Interaction Type Filter */}
        <ArrayFilterSection
          title="Interaction Type"
          filterKey="interaction_types"
          options={transformFilterCounts(filterCounts.interaction_type, 'interaction_type')}
          selectedValues={filters.interaction_types || []}
          onToggle={(value) => handleArrayToggle("interaction_types", value)}
          showHoverCard={false}
          showIcon={true}
        />
        {/* Sources Filter */}
        <ArrayFilterSection
          title="Sources"
          filterKey="sources"
          options={transformFilterCounts(filterCounts.sources, 'sources')}
          selectedValues={filters.sources || []}
          onToggle={(value) => handleArrayToggle("sources", value)}
          showHoverCard={true}
          showIcon={true}
        />
      </Accordion>
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

type AnnotationFilterSidebarProps =
  | {
      mode: "entities";
      filters: MeilisearchFilters;
      onFilterChange: (filters: MeilisearchFilters) => void;
      ontologyFacetCountsByPrefix: Record<string, Record<string, number>>;
      isMobile?: boolean;
    }
  | {
      mode: "interactions";
      filters: MeilisearchFilters;
      filterCounts: Record<string, Record<string, number>>;
      onFilterChange: (filters: MeilisearchFilters) => void;
      isMobile?: boolean;
    };

interface OntologyGroup {
  prefix: string;
  name: string;
  termIds: string[];
  terms: FilterOption[];
  totalCount: number;
  unmatched: FilterOption[];
}

interface FilteredOntologyGroup extends OntologyGroup {
  filteredTerms?: FilterOption[];
  filteredUnmatched?: FilterOption[];
  hasMatches: boolean;
}

interface OntologySearchMatch {
  id: string;
  ontology_id: string;
  name?: string | null;
}

export function AnnotationFilterSidebar(props: AnnotationFilterSidebarProps) {
  const { mode, filters, onFilterChange, isMobile = false } = props;
  const ontologyFacetCountsByPrefix = mode === "entities" ? props.ontologyFacetCountsByPrefix : undefined;
  const interactionFilterCounts = mode === "interactions" ? props.filterCounts : undefined;
  const [annotationQuery, setAnnotationQuery] = useState("");
  const [interactionScope, setInteractionScope] = useState<InteractionAnnotationScope>("interaction");
  const [ontologySearchOptions, setOntologySearchOptions] = useState<FilterOption[]>([]);

  const ontologyTermIds = useMemo(() => {
    const values = new Set<string>();
    const pushCounts = (counts?: Record<string, number>) => {
      Object.keys(counts || {}).forEach((value) => {
        const termId = extractTermId(value);
        if (termId) values.add(termId);
      });
    };

    Object.values(ontologyFacetCountsByPrefix || {}).forEach(pushCounts);
    pushCounts(interactionFilterCounts?.interaction_annotation_terms);
    pushCounts(interactionFilterCounts?.participant_annotation_terms);
    ontologySearchOptions.forEach((option) => {
      const termId = extractTermId(option.value);
      if (termId) values.add(termId);
    });

    return Array.from(values);
  }, [interactionFilterCounts, ontologyFacetCountsByPrefix, ontologySearchOptions]);

  const ontologyTermsById = useOntologyTerms(ontologyTermIds);

  useEffect(() => {
    if (mode !== "interactions") return;

    const hasInteractionTerms = !!interactionFilterCounts?.interaction_annotation_terms &&
      Object.keys(interactionFilterCounts.interaction_annotation_terms).length > 0;
    const hasParticipantTerms = !!interactionFilterCounts?.participant_annotation_terms &&
      Object.keys(interactionFilterCounts.participant_annotation_terms).length > 0;

    if (!hasInteractionTerms && hasParticipantTerms && interactionScope !== "participant") {
      setInteractionScope("participant");
    }
    if (!hasParticipantTerms && hasInteractionTerms && interactionScope !== "interaction") {
      setInteractionScope("interaction");
    }
  }, [interactionFilterCounts, interactionScope, mode]);

  useEffect(() => {
    if (mode !== "interactions") return;
    setOntologySearchOptions([]);
  }, [interactionScope, mode]);

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

        const availableCounts = mode === "entities"
          ? Object.values(ontologyFacetCountsByPrefix || {}).reduce<Record<string, number>>((acc, counts) => {
              Object.entries(counts).forEach(([value, count]) => {
                const termId = extractTermId(value);
                if (termId && acc[termId] === undefined) acc[termId] = count;
              });
              return acc;
            }, {})
          : interactionScope === "participant"
            ? Object.entries(interactionFilterCounts?.participant_annotation_terms || {}).reduce<Record<string, number>>((acc, [value, count]) => {
                const termId = extractTermId(value);
                if (termId && acc[termId] === undefined) acc[termId] = count;
                return acc;
              }, {})
            : Object.entries(interactionFilterCounts?.interaction_annotation_terms || {}).reduce<Record<string, number>>((acc, [value, count]) => {
                const termId = extractTermId(value);
                if (termId && acc[termId] === undefined) acc[termId] = count;
                return acc;
              }, {});

        setOntologySearchOptions(
          matches.map((match) => {
            const termId = match.id || match.ontology_id;
            const prefix = extractPrefix(termId);
            const filterKey = mode === "entities"
              ? getEntityFilterKeyForValue(termId) || undefined
              : interactionScope === "participant"
                ? ("participant_annotation_terms" as keyof MeilisearchFilters)
                : ("interaction_annotation_terms" as keyof MeilisearchFilters);

            return {
              value: termId,
              count: availableCounts[termId] ?? 1,
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
  }, [annotationQuery, interactionFilterCounts, interactionScope, mode, ontologyFacetCountsByPrefix]);

  const annotationOptions = useMemo<FilterOption[]>(() => {
    const resolveLabel = (value: string) => {
      const termId = extractTermId(value);
      return (termId ? ontologyTermsById[termId]?.name : undefined) || extractTermLabel(value);
    };

    if (normalizedQuery) {
      return ontologySearchOptions.map((option) => ({
        ...option,
        label: option.label || resolveLabel(option.value),
      }));
    }

    if (mode === "entities") {
      const countsByPrefix = ontologyFacetCountsByPrefix || {};
      return Object.entries(countsByPrefix)
        .flatMap(([prefix, counts]) =>
          Object.entries(counts).map(([value, count]) => ({
            value,
            count,
            label: resolveLabel(value),
            icon: prefix,
          }))
        )
        .sort((a, b) => b.count - a.count);
    }

    if (interactionScope === "participant") {
      const counts = interactionFilterCounts?.participant_annotation_terms || {};

      return Object.entries(counts)
        .map(([value, count]) => {
          const prefix = extractPrefix(value);
          return {
            value,
            count,
            label: resolveLabel(value),
            icon: prefix,
            prefix,
            filterKey: "participant_annotation_terms" as keyof MeilisearchFilters,
          };
        })
        .sort((a, b) => b.count - a.count);
    }

    const counts = interactionFilterCounts?.interaction_annotation_terms;
    if (!counts) return [];
    return Object.entries(counts)
      .map(([value, count]) => ({
        value,
        count,
        label: resolveLabel(value),
        filterKey: "interaction_annotation_terms" as keyof MeilisearchFilters,
      }))
      .sort((a, b) => b.count - a.count);
  }, [interactionFilterCounts, interactionScope, mode, normalizedQuery, ontologyFacetCountsByPrefix, ontologySearchOptions, ontologyTermsById]);

  const annotationTermOptions = useMemo(() => {
    const mapped = new Map<string, FilterOption>();
    const unmatched: FilterOption[] = [];

    for (const option of annotationOptions) {
      const termId = extractTermId(option.value);
      if (termId) {
        const key = option.prefix ? `${option.prefix}|${termId}` : termId;
        mapped.set(key, option);
      } else if (mode === "interactions") {
        unmatched.push(option);
      }
    }

    return { mapped, unmatched };
  }, [annotationOptions, mode]);

  const termsByPrefix = useMemo(() => {
    if (mode === "entities") {
      const groups = new Map<string, { termIds: string[]; totalCount: number }>();

      if (normalizedQuery) {
        annotationOptions.forEach((option) => {
          const termId = extractTermId(option.value);
          if (!termId) return;
          const prefix = option.prefix || extractPrefix(termId);
          const mappedKey = option.prefix ? `${prefix}|${termId}` : termId;
          const group = groups.get(prefix) ?? { termIds: [], totalCount: 0 };
          group.termIds.push(mappedKey);
          group.totalCount += option.count;
          groups.set(prefix, group);
        });
        return groups;
      }

      const countsByPrefix = ontologyFacetCountsByPrefix || {};
      Object.entries(countsByPrefix).forEach(([prefix, counts]) => {
        const termIds = Object.keys(counts)
          .map((value) => extractTermId(value))
          .filter((value): value is string => !!value);
        if (termIds.length === 0) return;
        const totalCount = Object.entries(counts).reduce((sum, [value, count]) => {
          return extractTermId(value) ? sum + count : sum;
        }, 0);
        groups.set(prefix, { termIds, totalCount });
      });
      return groups;
    }

    const groups = new Map<string, { termIds: string[]; totalCount: number }>();
    for (const [mappedKey, option] of annotationTermOptions.mapped.entries()) {
      const termId = extractTermId(option.value) || mappedKey;
      const prefix = option.prefix || extractPrefix(termId);
      const group = groups.get(prefix) ?? { termIds: [], totalCount: 0 };
      group.termIds.push(mappedKey);
      group.totalCount += option.count;
      groups.set(prefix, group);
    }
    return groups;
  }, [annotationOptions, annotationTermOptions.mapped, mode, normalizedQuery, ontologyFacetCountsByPrefix]);

  const unmatchedTotalCount = useMemo(
    () => annotationTermOptions.unmatched.reduce((sum, option) => sum + option.count, 0),
    [annotationTermOptions.unmatched]
  );

  const ontologyGroups = useMemo(() => {
    const groups: OntologyGroup[] = [];

    for (const [prefix, group] of termsByPrefix.entries()) {
      if (group.totalCount <= 0 || group.termIds.length === 0) {
        continue;
      }
      const terms: FilterOption[] = [];

      group.termIds.forEach((termId) => {
        const option = annotationTermOptions.mapped.get(termId);
        if (option) {
          terms.push(option);
        }
      });

      groups.push({
        prefix,
        name: PREFIX_NAMES[prefix] || prefix,
        termIds: group.termIds,
        terms,
        totalCount: group.totalCount,
        unmatched: [],
      });
    }

    if (mode === "interactions" && annotationTermOptions.unmatched.length > 0) {
      groups.push({
        prefix: "OTHER",
        name: "Other",
        termIds: [],
        terms: [],
        totalCount: unmatchedTotalCount,
        unmatched: annotationTermOptions.unmatched,
      });
    }

    groups.sort((a, b) => {
      if (a.prefix === "OTHER") return 1;
      if (b.prefix === "OTHER") return -1;
      return b.totalCount - a.totalCount;
    });

    return groups;
  }, [annotationTermOptions.mapped, annotationTermOptions.unmatched, termsByPrefix, unmatchedTotalCount]);

  const matchesQuery = useCallback(
    (value?: string) => {
      if (!normalizedQuery) return false;
      return (value || "").toLowerCase().includes(normalizedQuery);
    },
    [normalizedQuery]
  );

  const filteredGroups = useMemo<FilteredOntologyGroup[]>(() => {
    return ontologyGroups.map((group) => {
      if (!normalizedQuery) {
        return {
          ...group,
          filteredTerms: group.terms,
          filteredUnmatched: group.unmatched,
          hasMatches: group.unmatched.length > 0 || group.terms.length > 0,
        };
      }

      return {
        ...group,
        filteredTerms: group.terms,
        filteredUnmatched: group.unmatched,
        hasMatches: group.unmatched.length > 0 || group.terms.length > 0,
      };
    });
  }, [normalizedQuery, ontologyGroups]);

  const visibleGroups = useMemo(
    () => (normalizedQuery ? filteredGroups.filter((group) => group.hasMatches) : filteredGroups),
    [filteredGroups, normalizedQuery]
  );

  const handleAnnotationToggle = (value: string, explicitFilterKey?: keyof MeilisearchFilters) => {
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

  const hasInteractionScopeTerms = !!interactionFilterCounts?.interaction_annotation_terms &&
    Object.keys(interactionFilterCounts.interaction_annotation_terms).length > 0;
  const hasParticipantScopeTerms = !!interactionFilterCounts?.participant_annotation_terms &&
    Object.keys(interactionFilterCounts.participant_annotation_terms).length > 0;

  const renderGroupContent = (group: FilteredOntologyGroup) => {
    const unmatched: FilterOption[] = group.filteredUnmatched ?? group.unmatched;
    const flatTerms: FilterOption[] = group.filteredTerms ?? group.terms;
    const hasFlatTerms = flatTerms.length > 0;
    const hasAnyContent = hasFlatTerms || unmatched.length > 0;

    if (!hasAnyContent) {
      return normalizedQuery ? (
        <div className="text-sm text-muted-foreground">
          No ontology terms match your search.
        </div>
      ) : null;
    }

    return (
      <>
        {hasFlatTerms ? (
          <div className="space-y-1">
            {flatTerms.map((option) => {
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
                  highlighted={matchesQuery(option.label || option.value)}
                  hideCount={!!normalizedQuery}
                />
              );
            })}
          </div>
        ) : null}

        {unmatched.length > 0 ? (
          <div className={cn("space-y-1", hasFlatTerms ? "pt-2 border-t border-muted/60" : "")}>
            {unmatched.map((option) => (
              <FilterOptionRow
                key={option.value}
                filterKey="interaction_annotation_terms"
                option={option}
                selectedValues={filters.interaction_annotation_terms || []}
                onToggle={(value) => handleAnnotationToggle(value, "interaction_annotation_terms")}
                showHoverCard={true}
                highlighted={matchesQuery(option.label || option.value)}
                hideCount={!!normalizedQuery}
              />
            ))}
          </div>
        ) : null}
      </>
    );
  };

  const content = (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter ontology terms"
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

      {mode === "interactions" ? (
        <Tabs value={interactionScope} onValueChange={(value) => setInteractionScope(value as InteractionAnnotationScope)}>
          <TabsList className="grid h-9 w-full grid-cols-2">
            <TabsTrigger value="interaction" disabled={!hasInteractionScopeTerms}>Interaction</TabsTrigger>
            <TabsTrigger value="participant" disabled={!hasParticipantScopeTerms}>Participant</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      {visibleGroups.length > 0 ? (
        <div className="space-y-5">
          {visibleGroups.map((group) => (
            <section key={group.prefix} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-medium text-foreground">{group.name}</h4>
                {!normalizedQuery ? (
                  <Badge variant="secondary" className="shrink-0">{formatNumber(group.totalCount)}</Badge>
                ) : null}
              </div>
              {renderGroupContent(group)}
            </section>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          {normalizedQuery ? "No ontology terms match your search." : "No ontology terms available."}
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
