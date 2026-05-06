<script lang="ts">
  import { Box, Check, Filter, Link, Network, Plus, X } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Card, CardContent } from '$lib/components/ui/card/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '$lib/components/ui/sheet/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import { fetchOntologySearch, fetchScopedOntologySearch, fetchScopedOntologyIdCounts } from '$lib/api/client';
  import { getSelectionStore } from '$lib/stores/selection.svelte';
  import OntologyHierarchyDialog from './OntologyHierarchyDialog.svelte';
  import type { SearchFilters } from '$lib/types/search';

  interface Props {
    query: string;
    filters: SearchFilters;
    onFiltersChange: (filters: SearchFilters) => void;
    selectedEntityIds?: string[];
    selectedEntityPks?: number[];
    selectedAnnotationIds?: string[];
  }

  let { query, filters, onFiltersChange, selectedEntityIds, selectedEntityPks, selectedAnnotationIds }: Props = $props();

  const isMobile = new IsMobile();
  const selection = getSelectionStore();
  const RESULTS_PER_PAGE = 30;

  let results = $state<Array<{
    termId: string;
    ontologyPrefix: string | null;
    label: string | null;
    definition: string | null;
    synonyms: string[];
    ontologyId: string | null;
    sources: string[];
    annotatedEntityCount: number;
    annotatedRelationCount: number;
    annotatedItemCount?: number;
  }>>([]);
  let loading = $state(false);
  let loadingMore = $state(false);
  let hasMore = $state(true);
  let offset = $state(0);
  let error = $state<string | null>(null);
  let ontologyOptions = $state<Array<{ value: string; count: number }>>([]);
  let loadingOntologies = $state(true);
  let hierarchyOpen = $state(false);
  let hierarchyTerm = $state<(typeof results)[number] | null>(null);

  const isScoped = $derived(!!(selectedEntityPks?.length || selectedAnnotationIds?.length));
  const selectedOntologyIds = $derived(filters.ontology_ids || []);

  // Fetch ontology-id counts from annotation terms available in the current scope.
  $effect(() => {
    const q = query;
    const ePks = selectedEntityPks || [];
    const tIds = selectedAnnotationIds || [];

    let cancelled = false;
    loadingOntologies = true;
    fetchScopedOntologyIdCounts({
      entityPks: ePks.length > 0 ? ePks : undefined,
      annotationTermIds: tIds.length > 0 ? tIds : undefined,
      query: q || undefined,
    })
      .then((counts) => {
        if (cancelled) return;
        ontologyOptions = counts
          .map((c) => ({ value: c.ontologyId, count: c.scopedCount }));
      })
      .catch(() => {
        if (!cancelled) ontologyOptions = [];
      })
      .finally(() => {
        if (!cancelled) loadingOntologies = false;
      });
    return () => { cancelled = true; };
  });

  // Reactive reset: only read external dependencies in the effect body.
  $effect(() => {
    const q = query;
    const ontologyIds = selectedOntologyIds;
    const scoped = isScoped;
    const ePks = selectedEntityPks || [];
    const tIds = selectedAnnotationIds || [];

    results = [];
    offset = 0;
    hasMore = true;
    loading = true;
    error = null;

    const fetcher = scoped
      ? fetchScopedOntologySearch({ entityPks: ePks, termIds: tIds, query: q, ontologyIds: ontologyIds.length > 0 ? ontologyIds : undefined, limit: RESULTS_PER_PAGE, offset: 0 })
      : fetchOntologySearch({ query: q, ontologyIds: ontologyIds.length > 0 ? ontologyIds : undefined, limit: RESULTS_PER_PAGE, offset: 0 });

    fetcher
      .then((page) => {
        results = page;
        hasMore = page.length === RESULTS_PER_PAGE;
        offset = RESULTS_PER_PAGE;
      })
      .catch((err) => {
        error = err instanceof Error ? err.message : 'Failed to load ontology terms';
        hasMore = false;
      })
      .finally(() => {
        loading = false;
      });
  });

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    try {
      const page = isScoped
        ? await fetchScopedOntologySearch({
            entityPks: selectedEntityPks || [],
            termIds: selectedAnnotationIds || [],
            query,
            ontologyIds: selectedOntologyIds.length > 0 ? selectedOntologyIds : undefined,
            limit: RESULTS_PER_PAGE,
            offset,
          })
        : await fetchOntologySearch({
            query,
            ontologyIds: selectedOntologyIds.length > 0 ? selectedOntologyIds : undefined,
            limit: RESULTS_PER_PAGE,
            offset,
          });
      results = [...results, ...page];
      hasMore = page.length === RESULTS_PER_PAGE;
      offset += RESULTS_PER_PAGE;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load more ontology terms';
    } finally {
      loadingMore = false;
    }
  }

  function toggleOntologyId(ontologyId: string) {
    const next = selectedOntologyIds.includes(ontologyId)
      ? selectedOntologyIds.filter((item) => item !== ontologyId)
      : [...selectedOntologyIds, ontologyId];
    onFiltersChange({
      ...filters,
      ontology_ids: next.length > 0 ? next : undefined,
    });
  }

  function handleClearFilters() {
    onFiltersChange({
      ...filters,
      ontology_ids: undefined,
    });
  }

  function openHierarchy(term: (typeof results)[number]) {
    hierarchyTerm = term;
    hierarchyOpen = true;
  }

  function entityCountTooltip(scoped: boolean) {
    return scoped
      ? 'Entities in the current scope annotated with this term'
      : 'Entities annotated with this term';
  }

  function relationCountTooltip(scoped: boolean) {
    return scoped
      ? 'Relations in the current scope annotated with this term'
      : 'Relations annotated with this term';
  }
</script>

{#snippet filterSidebarContent()}
  <div class="space-y-6">
    <div class="max-h-[calc(100vh-14rem)] space-y-1 overflow-y-auto pr-2">
      {#each ontologyOptions as ontology}
        {@const selected = selectedOntologyIds.includes(ontology.value)}
        <div class="flex items-center justify-between gap-2 py-0.5">
          <Label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-normal leading-5 text-foreground {selected ? 'font-medium' : ''}">
            <Checkbox
              checked={selected}
              onCheckedChange={() => toggleOntologyId(ontology.value)}
              class={selected ? 'h-4 w-4 flex-shrink-0 border-primary' : 'h-4 w-4 flex-shrink-0'}
            />
            <span class="truncate">{ontology.value}</span>
          </Label>
          <span class="text-xs text-muted-foreground tabular-nums flex-shrink-0">{ontology.count.toLocaleString()}</span>
        </div>
      {:else}
        {#if loadingOntologies}
          <p class="text-sm text-muted-foreground">Loading filters...</p>
        {:else}
          <p class="text-sm text-muted-foreground">No filters available</p>
        {/if}
      {/each}
    </div>
  </div>
{/snippet}

{#snippet filterSidebar()}
  {#if isMobile.current}
    {@render filterSidebarContent()}
  {:else}
    <div class="h-full overflow-hidden flex flex-col bg-transparent">
      <div class="border-b flex-shrink-0 h-[57px] flex items-center px-3 py-3">
        <div class="flex items-center justify-between w-full">
          <div class="flex items-center gap-2">
            <Filter class="h-5 w-5 text-primary" />
            <h3 class="font-semibold text-lg">Filters</h3>
          </div>
          {#if selectedOntologyIds.length > 0}
            <Button
              variant="ghost"
              size="sm"
              onclick={handleClearFilters}
              class="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <X class="h-4 w-4" />
              Clear all ({selectedOntologyIds.length})
            </Button>
          {/if}
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-3 py-4">
        {@render filterSidebarContent()}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet resultsPane()}
  <div class="h-full overflow-y-auto p-4">
    {#if error}
      <div class="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
    {/if}

    {#if loading && results.length === 0}
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {#each Array.from({ length: 6 }) as _, i}
          <div class="h-48 animate-pulse rounded-2xl border bg-muted/30"></div>
        {/each}
      </div>
    {:else if results.length > 0}
      <div class="space-y-4">
        <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
          {#each results as term}
            {@const selected = selection.isAnnotationSelected(term.termId)}
            <div class="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card">
              <div class="flex items-center gap-3 px-4 py-3">
                <Network class="size-5 shrink-0 text-muted-foreground" />
                <div class="flex min-w-0 flex-1 items-center gap-2">
                  <h3 class="truncate text-base font-medium text-foreground">
                    {term.label || term.termId}
                  </h3>
                </div>
                <div class="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  {#if term.annotatedEntityCount > 0}
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}
                          <span {...props} class="flex items-center gap-0.5">
                            <Box class="size-3.5" />
                            {term.annotatedEntityCount.toLocaleString()}
                          </span>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content sideOffset={6}>{entityCountTooltip(isScoped)}</Tooltip.Content>
                    </Tooltip.Root>
                  {/if}
                  {#if !isScoped && term.annotatedRelationCount > 0}
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}
                          <span {...props} class="flex items-center gap-0.5">
                            <Link class="size-3.5" />
                            {term.annotatedRelationCount.toLocaleString()}
                          </span>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content sideOffset={6}>{relationCountTooltip(isScoped)}</Tooltip.Content>
                    </Tooltip.Root>
                  {/if}
                </div>
              </div>
              <div class="flex border-t border-border">
                <button
                  type="button"
                  onclick={(event) => {
                    event.stopPropagation();
                    if (selected) {
                      selection.removeAnnotation(term.termId);
                    } else {
                      selection.addAnnotation({
                        id: term.termId,
                        label: term.label || term.termId,
                        namespace: term.ontologyPrefix || undefined,
                        definition: term.definition,
                      });
                    }
                  }}
                  class="flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  {#if selected}
                    <Check class="size-4" />
                    Selected
                  {:else}
                    <Plus class="size-4" />
                    Add
                  {/if}
                </button>
                <div class="w-px bg-border"></div>
                <button
                  type="button"
                  onclick={(event) => {
                    event.stopPropagation();
                    openHierarchy(term);
                  }}
                  class="flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <Network class="size-4" />
                  Explore
                </button>
              </div>
            </div>
          {/each}
        </div>

        {#if hasMore}
          <div class="flex justify-center py-4" style="min-height: 40px;">
            <Button variant="outline" onclick={loadMore} disabled={loadingMore}>
              {#if loadingMore}
                <div class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent mr-2"></div>
                <span>Loading...</span>
              {:else}
                <span>Load more</span>
              {/if}
            </Button>
          </div>
        {/if}
      </div>
    {:else}
      <Card class="border-dashed">
        <CardContent class="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <div class="text-lg font-semibold">No annotations found</div>
          <p class="max-w-2xl text-sm text-muted-foreground">
            {#if query.trim().length > 0}
              {#if isScoped}
                Try a different ontology term, synonym, or ID within the current entity scope.
              {:else}
                Try a different ontology term, synonym, or ID such as GO:0005634, KW-0001, or MI:0217.
              {/if}
            {:else}
              {#if isScoped}
                No annotation terms are available for the current entity scope.
              {:else}
                No annotation terms are available to browse right now.
              {/if}
            {/if}
          </p>
        </CardContent>
      </Card>
    {/if}
  </div>
{/snippet}

{#if isMobile.current}
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="border-b p-4">
      <Sheet>
        <SheetTrigger>
          <Button variant="outline" class="w-full">
            <Filter class="mr-2 size-4" />
            Filters
            {#if selectedOntologyIds.length > 0}
              <Badge variant="secondary" class="ml-2">{selectedOntologyIds.length}</Badge>
            {/if}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" class="w-[85%] overflow-y-auto sm:w-[400px]">
          <SheetHeader>
            <SheetTitle>Annotation filters</SheetTitle>
          </SheetHeader>
          <div class="pt-4">{@render filterSidebarContent()}</div>
        </SheetContent>
      </Sheet>
    </div>
    <div class="min-h-0 flex-1 overflow-hidden">
      {@render resultsPane()}
    </div>
  </div>
{:else}
  <div class="h-full min-h-[60vh] overflow-hidden rounded-2xl border bg-background/30">
    <div class="flex h-full">
      <div class="min-h-0 flex-1 overflow-hidden">
        {@render resultsPane()}
      </div>
      <div class="w-72 border-l bg-background/40 overflow-y-auto">
        {@render filterSidebar()}
      </div>
    </div>
  </div>
{/if}

<OntologyHierarchyDialog bind:open={hierarchyOpen} term={hierarchyTerm} />
