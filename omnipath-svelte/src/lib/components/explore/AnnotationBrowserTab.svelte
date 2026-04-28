<script lang="ts">
  import { Check, Filter, Tag, X } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '$lib/components/ui/sheet/index.js';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import { fetchOntologySearch, fetchScopedOntologySearch, fetchScopedOntologySourceCounts } from '$lib/api/client';
  import { getSelectionStore } from '$lib/stores/selection.svelte';
  import type { SearchFilters } from '$lib/types/search';

  interface Props {
    query: string;
    species?: string;
    filters: SearchFilters;
    onFiltersChange: (filters: SearchFilters) => void;
    selectedEntityIds?: string[];
    selectedEntityPks?: number[];
    selectedAnnotationIds?: string[];
  }

  let { query, species, filters, onFiltersChange, selectedEntityIds, selectedEntityPks, selectedAnnotationIds }: Props = $props();

  const isMobile = new IsMobile();
  const selection = getSelectionStore();
  const RESULTS_PER_PAGE = 30;

  let results = $state<Array<{
    termId: string;
    ontologyPrefix: string | null;
    label: string | null;
    definition: string | null;
    synonyms: string[];
    sources: string[];
    annotatedEntityCount: number;
    annotatedRelationCount?: number;
    annotatedItemCount?: number;
  }>>([]);
  let loading = $state(false);
  let loadingMore = $state(false);
  let hasMore = $state(true);
  let offset = $state(0);
  let error = $state<string | null>(null);
  let sourceOptions = $state<Array<{ value: string; count: number }>>([]);
  let loadingSources = $state(true);

  const isScoped = $derived(!!(selectedEntityPks?.length || selectedAnnotationIds?.length));
  const selectedSources = $derived(filters.sources || []);

  // Fetch source counts from annotation terms available in the current scope.
  $effect(() => {
    const q = query;
    const ePks = selectedEntityPks || [];
    const tIds = selectedAnnotationIds || [];

    let cancelled = false;
    loadingSources = true;
    fetchScopedOntologySourceCounts({
      entityPks: ePks.length > 0 ? ePks : undefined,
      annotationTermIds: tIds.length > 0 ? tIds : undefined,
      query: q || undefined,
    })
      .then((counts) => {
        if (cancelled) return;
        sourceOptions = counts
          .map((c) => ({ value: c.source, count: c.scopedCount }));
      })
      .catch(() => {
        if (!cancelled) sourceOptions = [];
      })
      .finally(() => {
        if (!cancelled) loadingSources = false;
      });
    return () => { cancelled = true; };
  });

  // Reactive reset: only read external dependencies in the effect body.
  $effect(() => {
    const q = query;
    const sources = selectedSources;
    const scoped = isScoped;
    const ePks = selectedEntityPks || [];
    const tIds = selectedAnnotationIds || [];

    results = [];
    offset = 0;
    hasMore = true;
    loading = true;
    error = null;

    const fetcher = scoped
      ? fetchScopedOntologySearch({ entityPks: ePks, termIds: tIds, query: q, sources: sources.length > 0 ? sources : undefined, limit: RESULTS_PER_PAGE, offset: 0 })
      : fetchOntologySearch({ query: q, sources: sources.length > 0 ? sources : undefined, limit: RESULTS_PER_PAGE, offset: 0 });

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
            sources: selectedSources.length > 0 ? selectedSources : undefined,
            limit: RESULTS_PER_PAGE,
            offset,
          })
        : await fetchOntologySearch({
            query,
            sources: selectedSources.length > 0 ? selectedSources : undefined,
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

  function toggleSource(source: string) {
    const next = selectedSources.includes(source)
      ? selectedSources.filter((item) => item !== source)
      : [...selectedSources, source];
    onFiltersChange({
      ...filters,
      sources: next.length > 0 ? next : undefined,
    });
  }

  function handleClearFilters() {
    onFiltersChange({
      ...filters,
      sources: undefined,
    });
  }

  function formatCount(count: number, singular: string, plural: string = `${singular}s`) {
    return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
  }
</script>

{#snippet filterSidebarContent()}
  <div class="space-y-6">
    <div class="max-h-[calc(100vh-14rem)] space-y-1 overflow-y-auto pr-2">
      {#each sourceOptions as source}
        {@const selected = selectedSources.includes(source.value)}
        <div class="flex items-center justify-between gap-2 py-0.5">
          <Label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-normal leading-5 text-foreground {selected ? 'font-medium' : ''}">
            <Checkbox
              checked={selected}
              onCheckedChange={() => toggleSource(source.value)}
              class={selected ? 'h-4 w-4 flex-shrink-0 border-primary' : 'h-4 w-4 flex-shrink-0'}
            />
            <span class="truncate">{source.value}</span>
          </Label>
          <span class="text-xs text-muted-foreground tabular-nums flex-shrink-0">{source.count.toLocaleString()}</span>
        </div>
      {:else}
        {#if loadingSources}
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
          {#if selectedSources.length > 0}
            <Button
              variant="ghost"
              size="sm"
              onclick={handleClearFilters}
              class="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <X class="h-4 w-4" />
              Clear all ({selectedSources.length})
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
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {#each results as term}
            {@const selected = selection.isAnnotationSelected(term.termId)}
            <Card class="h-full transition-shadow hover:shadow-sm">
              <CardHeader class="space-y-3 pb-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="space-y-1 min-w-0">
                    <CardTitle class="text-base leading-tight">{term.label || term.termId}</CardTitle>
                    <CardDescription class="font-mono text-xs">{term.termId}</CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    onclick={() => {
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
                    class="shrink-0"
                  >
                    {#if selected}
                      <Check class="size-4 mr-1" />
                      Selected
                    {:else}
                      <Tag class="size-4 mr-1" />
                      Add
                    {/if}
                  </Button>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  {#if term.ontologyPrefix}
                    <Badge variant="outline">{term.ontologyPrefix}</Badge>
                  {/if}
                  {#if term.annotatedEntityCount !== undefined && term.annotatedEntityCount > 0}
                    <Badge variant="outline" class="border-primary/20 bg-primary/5 text-primary">
                      {formatCount(term.annotatedEntityCount, 'entity', 'entities')}
                    </Badge>
                  {:else if term.annotatedRelationCount !== undefined && term.annotatedRelationCount > 0}
                    <Badge variant="outline" class="border-primary/20 bg-primary/5 text-primary">
                      {formatCount(term.annotatedRelationCount, 'relation')}
                    </Badge>
                  {/if}
                </div>
              </CardHeader>
              <CardContent>
                <p class="max-h-24 overflow-y-auto text-sm text-muted-foreground">
                  {term.definition || 'No definition available for this ontology term.'}
                </p>
              </CardContent>
            </Card>
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
                Try a different ontology term, synonym, or ID such as GO:0005634 or MI:0217.
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
            {#if selectedSources.length > 0}
              <Badge variant="secondary" class="ml-2">{selectedSources.length}</Badge>
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
