<script lang="ts">
  import { Filter, Minus, X } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Alert, AlertDescription } from '$lib/components/ui/alert/index.js';
  import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '$lib/components/ui/sheet/index.js';
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table/index.js';
  import EntityBadge from '$lib/components/entity/EntityBadge.svelte';
  import EntityDetailsDialog from '$lib/components/entity/EntityDetailsDialog.svelte';
  import InteractionFilterSidebar from '$lib/components/interactions/InteractionFilterSidebar.svelte';
  import InteractionDetailsSheet from '$lib/components/interactions/InteractionDetailsSheet.svelte';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import { fetchRelationsSearch, fetchEntitiesByPks, fetchEntitiesSearch } from '$lib/api/client';
  import {
    getEntityDisplayName,
    getEntityPublicId,
    getEntitySecondaryName,
    getEntityTypeLabel,
    type EntityLike,
  } from '$lib/entities/display';
  import type { SearchFilters } from '$lib/types/search';
  import type { InteractionListRow } from '$lib/types/interactions';
  import { formatNumber } from '$lib/utils/format';

  interface Props {
    filters: SearchFilters;
    onFilterChange: (filters: SearchFilters) => void;
    query?: string;
    entitySearchFilters?: SearchFilters;
    scopedEntityIds?: string[];
    scopedAnnotationIds?: string[];
  }

  let { filters, onFilterChange, query = '', entitySearchFilters = {}, scopedEntityIds, scopedAnnotationIds }: Props = $props();

  const isMobile = new IsMobile();
  const RESULTS_PER_PAGE = 20;

  let results = $state<InteractionListRow[]>([]);
  let loading = $state(false);
  let loadingMore = $state(false);
  let hasMore = $state(true);
  let offset = $state(0);
  let error = $state<string | null>(null);
  let selectedInteraction = $state<InteractionListRow | null>(null);
  let detailsOpen = $state(false);
  let detailsEntity = $state<EntityLike | null>(null);
  let entityDetailsOpen = $state(false);

  let queryEntityIds = $state<string[]>([]);
  let queryEntityIdsLoading = $state(false);

  const activeFilterCount = $derived(
    Object.entries(filters).reduce((count, [, value]) => {
      if (Array.isArray(value)) return count + value.length;
      if (value !== null && value !== undefined) return count + 1;
      return count;
    }, 0)
  );

  const effectiveFilters = $derived({
    ...filters,
    ...(query.trim() && queryEntityIds.length > 0 ? { entity_ids: queryEntityIds } : {}),
    ...(scopedEntityIds && scopedEntityIds.length > 0 ? { scope_entity_ids: scopedEntityIds } : {}),
    ...(scopedAnnotationIds && scopedAnnotationIds.length > 0 ? { scope_annotation_ids: scopedAnnotationIds } : {}),
  });

  // Resolve query text to entity IDs for relation scoping.
  $effect(() => {
    const q = query.trim();
    if (!q) {
      queryEntityIds = [];
      return;
    }

    let cancelled = false;
    queryEntityIds = [];
    queryEntityIdsLoading = true;
    fetchEntitiesSearch({ query: q, limit: 200, cursor: null, filters: entitySearchFilters })
      .then((data) => {
        if (cancelled) return;
        queryEntityIds = data.entities.map((e) => `${e.canonicalIdentifierType}|${e.canonicalIdentifier}`);
      })
      .catch(() => {
        if (!cancelled) queryEntityIds = [];
      })
      .finally(() => {
        if (!cancelled) queryEntityIdsLoading = false;
      });
    return () => { cancelled = true; };
  });

  // Reactive reset: only read external dependencies in the effect body.
  // Capture them into local consts, reset internal state, then fetch.
  $effect(() => {
    const f = effectiveFilters;
    const q = query.trim();
    const resolvingQueryEntities = queryEntityIdsLoading;
    const queryHasNoEntityMatches = !!q && !resolvingQueryEntities && queryEntityIds.length === 0;

    results = [];
    offset = 0;
    hasMore = true;
    loading = true;
    error = null;

    if (resolvingQueryEntities) {
      return;
    }

    if (queryHasNoEntityMatches) {
      loading = false;
      hasMore = false;
      return;
    }

    (async () => {
      try {
        const data = await fetchRelationsSearch({ filters: f, limit: RESULTS_PER_PAGE, offset: 0 });

        const entityPksToHydrate = Array.from(
          new Set(data.relations.flatMap((r) => [r.subjectEntityPk, r.objectEntityPk]))
        );
        const entityData = entityPksToHydrate.length > 0
          ? await fetchEntitiesByPks(entityPksToHydrate)
          : { entities: [] };
        const entityByPk = new Map(entityData.entities.map((e) => [e.entityPk, e]));

        const hits = data.relations.flatMap((relation) => {
          const subjectEntity = entityByPk.get(relation.subjectEntityPk);
          const objectEntity = entityByPk.get(relation.objectEntityPk);
          if (!subjectEntity || !objectEntity) return [];
          return [{ relation, subjectEntity, objectEntity }];
        });

        results = hits;
        hasMore = hits.length === RESULTS_PER_PAGE;
        offset = RESULTS_PER_PAGE;
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load relations';
        hasMore = false;
      } finally {
        loading = false;
      }
    })();
  });

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    try {
      const data = await fetchRelationsSearch({
        filters: effectiveFilters,
        limit: RESULTS_PER_PAGE,
        offset,
      });

      const entityPksToHydrate = Array.from(
        new Set(data.relations.flatMap((r) => [r.subjectEntityPk, r.objectEntityPk]))
      );
      const entityData = entityPksToHydrate.length > 0
        ? await fetchEntitiesByPks(entityPksToHydrate)
        : { entities: [] };
      const entityByPk = new Map(entityData.entities.map((e) => [e.entityPk, e]));

      const hits = data.relations.flatMap((relation) => {
        const subjectEntity = entityByPk.get(relation.subjectEntityPk);
        const objectEntity = entityByPk.get(relation.objectEntityPk);
        if (!subjectEntity || !objectEntity) return [];
        return [{ relation, subjectEntity, objectEntity }];
      });

      results = [...results, ...hits];
      hasMore = hits.length === RESULTS_PER_PAGE;
      offset += RESULTS_PER_PAGE;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load more relations';
    } finally {
      loadingMore = false;
    }
  }

  function handleClearFilters() {
    onFilterChange({ relation_categories: ['interaction'] });
  }

  function handleRowClick(row: InteractionListRow) {
    selectedInteraction = row;
    detailsOpen = true;
  }

  function openEntityDetails(entity: EntityLike) {
    detailsEntity = entity;
    entityDetailsOpen = true;
  }
</script>

{#snippet searchPanel()}
  <div class="relative h-full overflow-hidden">
    {#if isMobile.current}
      <div class="lg:hidden p-4 border-b">
        <Sheet>
          <SheetTrigger>
            <Button variant="outline" class="w-full">
              <Filter class="h-4 w-4 mr-2" />
              Filters
              {#if activeFilterCount > 0}
                <Badge variant="secondary" class="ml-2">
                  {activeFilterCount}
                </Badge>
              {/if}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" class="w-[85%] sm:w-[400px] p-0">
            <SheetHeader class="px-6 py-4 border-b">
              <div class="flex items-center justify-between">
                <SheetTitle class="flex items-center gap-2">
                  <Filter class="h-5 w-5 text-primary" />
                  Filters
                </SheetTitle>
                {#if activeFilterCount > 0}
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={handleClearFilters}
                    class="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <X class="h-4 w-4" />
                    Clear all
                  </Button>
                {/if}
              </div>
            </SheetHeader>
            <div class="h-[calc(100%-4rem)] overflow-y-auto">
              <InteractionFilterSidebar
                filters={effectiveFilters}
                onFilterChange={onFilterChange}
                onClearFilters={handleClearFilters}
                isMobile
                scopedEntityIds={scopedEntityIds}
                scopedAnnotationIds={scopedAnnotationIds}
                queryEntityIds={queryEntityIds}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    {/if}

    {#if error}
      <div class="p-6">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    {:else if loading && results.length === 0}
      <div class="flex items-center justify-center h-full">
        <div class="flex items-center gap-2">
          <div class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
          <span class="text-sm text-muted-foreground">Loading relations...</span>
        </div>
      </div>
    {:else if results.length > 0}
      <div class="flex flex-col h-full">
        <!-- Fixed Table Header -->
        <div class="relative border-b bg-background px-3 h-[57px] flex items-center flex-shrink-0">
          <Table class="pr-28">
            <TableHeader>
              <TableRow>
                <TableHead class="w-[35%] py-2">Source</TableHead>
                <TableHead class="w-[50px] text-center py-2">Predicate</TableHead>
                <TableHead class="w-[35%] py-2">Target</TableHead>
                <TableHead class="w-[20%] text-center py-2 pr-28">Evidence</TableHead>
              </TableRow>
            </TableHeader>
          </Table>
        </div>

        <!-- Scrollable Table Body -->
        <div class="flex-1 min-h-0 overflow-y-auto">
          <Table>
            <TableBody>
              {#each results as row}
                {@const sourceEntity = row.subjectEntity}
                {@const targetEntity = row.objectEntity}
                {@const sourceId = getEntityPublicId(sourceEntity)}
                {@const targetId = getEntityPublicId(targetEntity)}
                <TableRow
                  onclick={() => handleRowClick(row)}
                  class="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell class="w-[35%] max-w-0">
                    <button
                      type="button"
                      onclick={(event) => {
                        event.stopPropagation();
                        openEntityDetails(sourceEntity);
                      }}
                      class="block w-full cursor-pointer rounded-lg p-0.5 text-left transition-all hover:bg-primary/10 hover:ring-2 hover:ring-primary/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <EntityBadge
                        displayName={getEntityDisplayName(sourceEntity)}
                        canonicalIdentifier={getEntitySecondaryName(sourceEntity) || sourceEntity.canonicalIdentifier}
                        entityType={getEntityTypeLabel(sourceEntity)}
                      />
                    </button>
                  </TableCell>
                  <TableCell class="w-[50px] text-center">
                    <div class="flex justify-center">
                      {#if row.relation.predicate.trim()}
                        <span class="text-sm text-muted-foreground">{row.relation.predicate}</span>
                      {:else}
                        <Minus class="h-4 w-4 text-muted-foreground" />
                      {/if}
                    </div>
                  </TableCell>
                  <TableCell class="w-[35%] max-w-0">
                    <button
                      type="button"
                      onclick={(event) => {
                        event.stopPropagation();
                        openEntityDetails(targetEntity);
                      }}
                      class="block w-full cursor-pointer rounded-lg p-0.5 text-left transition-all hover:bg-primary/10 hover:ring-2 hover:ring-primary/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <EntityBadge
                        displayName={getEntityDisplayName(targetEntity)}
                        canonicalIdentifier={getEntitySecondaryName(targetEntity) || targetEntity.canonicalIdentifier}
                        entityType={getEntityTypeLabel(targetEntity)}
                      />
                    </button>
                  </TableCell>
                  <TableCell class="w-[20%] text-center">
                    <Badge variant="outline">
                      {formatNumber(row.relation.evidenceCount || 0)}
                    </Badge>
                  </TableCell>
                </TableRow>
              {/each}
              {#if hasMore}
                <TableRow>
                  <TableCell colspan={4} class="p-0">
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
                  </TableCell>
                </TableRow>
              {/if}
            </TableBody>
          </Table>
        </div>
      </div>
    {:else if !loading && results.length === 0}
      <div class="p-6 flex-1 flex items-center justify-center">
        <p class="text-muted-foreground text-center">
          {Object.keys(effectiveFilters).length > 0
            ? "No relations found matching your criteria."
            : "Select filters to explore relations."}
        </p>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet desktopSidebar()}
  <div class="h-full min-h-[60vh] overflow-hidden rounded-2xl border bg-background/30">
    <div class="flex h-full">
      <div class="min-h-0 flex-1 overflow-hidden">
        {@render searchPanel()}
      </div>
      <div class="w-72 border-l bg-background/40 overflow-y-auto">
        <InteractionFilterSidebar
          filters={effectiveFilters}
          onFilterChange={onFilterChange}
          onClearFilters={handleClearFilters}
          scopedEntityIds={scopedEntityIds}
          scopedAnnotationIds={scopedAnnotationIds}
          queryEntityIds={queryEntityIds}
        />
      </div>
    </div>
  </div>
{/snippet}

<div class="relative flex flex-col overflow-hidden h-full min-h-0">
  <div class="flex-1 min-h-0">
    {#if isMobile.current}
      {@render searchPanel()}
    {:else}
      {@render desktopSidebar()}
    {/if}
  </div>

  <!-- Interaction Details Sheet -->
  <InteractionDetailsSheet
    open={detailsOpen}
    onOpenChange={(open) => { detailsOpen = open; }}
    interaction={selectedInteraction}
  />

  <EntityDetailsDialog bind:open={entityDetailsOpen} entity={detailsEntity} />
</div>
