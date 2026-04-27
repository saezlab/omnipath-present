<script lang="ts">
  import { Filter, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import type { SearchFilters } from '$lib/types/search';
  import { fetchScopedRelationFacetCounts } from '$lib/api/client';
  import { getEntityTypeEmoji } from '$lib/utils/entity-types';
  import { formatNumber } from '$lib/utils/format';

  interface Props {
    filters: SearchFilters;
    onFilterChange: (filters: SearchFilters) => void;
    onClearFilters?: () => void;
    isMobile?: boolean;
    scopedEntityIds?: string[];
    scopedAnnotationIds?: string[];
    queryEntityIds?: string[];
  }

  let { filters, onFilterChange, onClearFilters, isMobile = false, scopedEntityIds, scopedAnnotationIds, queryEntityIds }: Props = $props();

  let predicatesByCategory = $state<Record<string, string[]>>({});
  let interactionTypeOptions = $state<string[]>([]);
  let sourceOptions = $state<string[]>([]);
  let scopedFacetCounts = $state<Map<string, { count: number; category?: string | null }>>(new Map());
  let loading = $state(true);

  // Fetch facet counts (scoped when selection present, global otherwise) and build filter options.
  // Counts reflect the current scope AND all OTHER active filters (cross-facet filtering).
  $effect(() => {
    const mergedEntityIds = [
      ...(scopedEntityIds || []),
      ...(queryEntityIds || []),
    ];
    const scope = {
      entityIds: mergedEntityIds.length ? mergedEntityIds : undefined,
      annotationTermIds: scopedAnnotationIds?.length ? scopedAnnotationIds : undefined,
      predicates: filters.predicates,
      interactionTypes: filters.interaction_types,
      sources: filters.sources,
    };

    let cancelled = false;
    loading = true;
    fetchScopedRelationFacetCounts(scope)
      .then((counts) => {
        if (cancelled) return;
        const map = new Map<string, { count: number; category?: string | null }>();
        const categories: Record<string, string[]> = {};
        const types: string[] = [];
        const sources: string[] = [];

        for (const c of counts) {
          map.set(`${c.facetName}:${c.facetValue}`, { count: c.scopedCount, category: c.facetCategory });
          if (c.facetName === 'predicate' && c.facetCategory) {
            if (!categories[c.facetCategory]) categories[c.facetCategory] = [];
            categories[c.facetCategory].push(c.facetValue);
          } else if (c.facetName === 'participant_type') {
            types.push(c.facetValue);
          } else if (c.facetName === 'source') {
            sources.push(c.facetValue);
          }
        }

        scopedFacetCounts = map;
        predicatesByCategory = categories;
        interactionTypeOptions = types;
        sourceOptions = sources;
      })
      .catch(() => {
        if (!cancelled) {
          scopedFacetCounts = new Map();
          predicatesByCategory = {};
          interactionTypeOptions = [];
          sourceOptions = [];
        }
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => { cancelled = true; };
  });

  const activeFilterCount = $derived(
    Object.entries(filters).reduce((count, [, value]) => {
      if (Array.isArray(value)) return count + value.length;
      if (value !== null && value !== undefined) return count + 1;
      return count;
    }, 0)
  );

  function handleArrayToggle(filterKey: keyof SearchFilters, value: string) {
    const currentValues = (filters[filterKey] as string[] | undefined) || [];
    const newValues = currentValues.includes(value)
      ? currentValues.filter((v) => v !== value)
      : [...currentValues, value];

    onFilterChange({
      ...filters,
      [filterKey]: newValues.length > 0 ? newValues : undefined,
    });
  }

  function handlePredicateToggle(category: string, predicate: string) {
    const currentPredicates = filters.predicates || [];
    const isSelected = currentPredicates.includes(predicate);
    const nextPredicates = isSelected
      ? currentPredicates.filter((value) => value !== predicate)
      : [...currentPredicates, predicate];
    const currentCategories = filters.relation_categories || [];
    const nextCategories = !isSelected && !currentCategories.includes(category)
      ? [...currentCategories, category]
      : currentCategories;

    onFilterChange({
      ...filters,
      predicates: nextPredicates.length > 0 ? nextPredicates : undefined,
      relation_categories: nextCategories.length > 0 ? nextCategories : undefined,
    });
  }

  function formatParticipantType(value: string) {
    const parts = value.split(':');
    const label = parts.length >= 3 ? parts.slice(2).join(':') : value;
    return {
      label,
      icon: getEntityTypeEmoji(label),
    };
  }

  function getCount(filterName: string, value: string): number | undefined {
    return scopedFacetCounts.get(`${filterName}:${value}`)?.count;
  }
</script>

{#snippet filterOptionRow(filterKey: keyof SearchFilters, value: string, label: string, selectedValues: string[], onToggle: () => void, icon?: string, count?: number)}
  <div class="flex items-center justify-between py-0.5 gap-2">
    <Label
      for={`${filterKey}-${value}`}
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-normal leading-5 text-foreground {selectedValues?.includes(value) ? 'font-medium' : ''}"
    >
      <Checkbox
        id={`${filterKey}-${value}`}
        checked={selectedValues?.includes(value) || false}
        onCheckedChange={onToggle}
        class="h-4 w-4 flex-shrink-0"
      />
      <span class="truncate">
        {#if icon}<span class="mr-1.5">{icon}</span>{/if}
        {label}
      </span>
    </Label>
    {#if count != null}
      <span class="text-xs text-muted-foreground tabular-nums flex-shrink-0">
        {formatNumber(count)}
      </span>
    {/if}
  </div>
{/snippet}

{#snippet content()}
  <div class="space-y-6" class:opacity-70={loading}>
    {#if Object.keys(predicatesByCategory).length > 0}
      <div class="space-y-2">
        <h4 class="text-sm font-semibold">Relation types</h4>
        <div class="space-y-2">
          {#each Object.entries(predicatesByCategory) as [category, predicates]}
            <div class="space-y-2">
              {@render filterOptionRow('relation_categories', category, category, filters.relation_categories || [], () => handleArrayToggle('relation_categories', category))}
              <div class="space-y-1 max-h-64 overflow-y-auto pr-2 pl-4">
                {#each predicates as predicate}
                  {@render filterOptionRow('predicates', predicate, predicate, filters.predicates || [], () => handlePredicateToggle(category, predicate), undefined, getCount('predicate', predicate))}
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if interactionTypeOptions.length > 0}
      <div class="space-y-2">
        <h4 class="text-sm font-semibold">Participant types</h4>
        <div class="space-y-1 max-h-64 overflow-y-auto pr-2">
          {#each interactionTypeOptions as option}
            {@const participantType = formatParticipantType(option)}
            {@render filterOptionRow('interaction_types', option, participantType.label, filters.interaction_types || [], () => handleArrayToggle('interaction_types', option), participantType.icon, getCount('participant_type', option))}
          {/each}
        </div>
      </div>
    {/if}

    <div class="space-y-2">
      <h4 class="text-sm font-semibold">Sources</h4>
      <div class="space-y-1 max-h-64 overflow-y-auto pr-2">
        {#each sourceOptions as option}
          {@render filterOptionRow('sources', option, option, filters.sources || [], () => handleArrayToggle('sources', option), '📚', getCount('source', option))}
        {/each}
      </div>
    </div>
  </div>
{/snippet}

{#if isMobile}
  {@render content()}
{:else}
  <div class="h-full overflow-hidden flex flex-col bg-transparent">
    <div class="border-b flex-shrink-0 h-[57px] flex items-center px-3 py-3">
      <div class="flex items-center justify-between w-full">
        <div class="flex items-center gap-2">
          <Filter class="h-5 w-5 text-primary" />
          <h3 class="font-semibold text-lg">Filters</h3>
        </div>
        {#if activeFilterCount > 0 && onClearFilters}
          <Button
            variant="ghost"
            size="sm"
            onclick={onClearFilters}
            class="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <X class="h-4 w-4" />
            Clear all ({activeFilterCount})
          </Button>
        {/if}
      </div>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto px-3 py-4">
      {@render content()}
    </div>
  </div>
{/if}
