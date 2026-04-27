<script lang="ts">
	import { Box, Check, Eye, Filter, Plus, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent } from '$lib/components/ui/card/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '$lib/components/ui/sheet/index.js';
	import EntityDetailsDialog from '$lib/components/entity/EntityDetailsDialog.svelte';
	import { fetchEntitiesSearch, fetchScopedEntityFacetCounts } from '$lib/api/client';
	import {
		getEntityDisplayName,
		getEntityPublicId,
		getEntitySecondaryName,
		getEntityTypeLabel
	} from '$lib/entities/display';
	import { getSelectionStore } from '$lib/stores/selection.svelte';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import type { SearchFilters } from '$lib/types/search';
	import type { EntityWithIdentifiers } from '$lib/types/entities';
	import { getEntityTypeEmoji } from '$lib/utils/entity-types';
	import { formatNumber } from '$lib/utils/format';

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
	const RESULTS_PER_PAGE = 20;

	interface FilterOption {
		value: string;
		displayName: string;
		icon?: string;
		id?: string | null;
	}

	type EntityResult = EntityWithIdentifiers;

	let results = $state<EntityResult[]>([]);
	let loading = $state(false);
	let loadingMore = $state(false);
	let hasMore = $state(true);
	let cursor = $state<number | null>(null);
	let facetCountsLoading = $state(true);
	let entityTypeOptions = $state<FilterOption[]>([]);
	let sourceOptions = $state<FilterOption[]>([]);
	let scopedFacetCounts = $state<Map<string, number>>(new Map());
	let detailsEntity = $state<EntityResult | null>(null);
	let detailsOpen = $state(false);

	const effectiveFilters = $derived({
		...filters,
		...(species ? { ncbi_tax_id: filters.ncbi_tax_id ?? [species] } : {}),
		...(selectedEntityPks && selectedEntityPks.length > 0 ? { entity_pks: selectedEntityPks } : {}),
		...(selectedAnnotationIds && selectedAnnotationIds.length > 0 ? { annotation_term_ids: selectedAnnotationIds } : {}),
	});

	const activeFilterCount = $derived(
		Object.entries(filters).reduce((count, [, value]) => {
			if (Array.isArray(value)) return count + value.length;
			if (value !== null && value !== undefined) return count + 1;
			return count;
		}, 0)
	);

	// Fetch facet counts (scoped when selection present, global otherwise) and build filter options.
	// Counts reflect the current scope AND query AND all OTHER active filters (cross-facet filtering).
	$effect(() => {
		const scope = {
			entityIds: selectedEntityPks?.length ? selectedEntityPks : undefined,
			annotationTermIds: selectedAnnotationIds?.length ? selectedAnnotationIds : undefined,
			entityTypes: filters.entity_types,
			sources: filters.sources,
			query: query || undefined,
		};

		let cancelled = false;
		facetCountsLoading = true;
		fetchScopedEntityFacetCounts(scope)
			.then((counts) => {
				if (cancelled) return;
				const map = new Map<string, number>();
				const types: FilterOption[] = [];
				const sources: FilterOption[] = [];
				for (const c of counts) {
					map.set(`${c.facetName}:${c.facetValue}`, c.scopedCount);
					if (c.facetName === 'entity_type') {
						types.push(mapEntityTypeOption(c.facetValue));
					} else if (c.facetName === 'source') {
						sources.push({ value: c.facetValue, displayName: c.facetValue, icon: '📚' });
					}
				}
				scopedFacetCounts = map;
				entityTypeOptions = types;
				sourceOptions = sources;
			})
			.catch(() => {
				if (!cancelled) {
					scopedFacetCounts = new Map();
					entityTypeOptions = [];
					sourceOptions = [];
				}
			})
			.finally(() => {
				if (!cancelled) facetCountsLoading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	// Only read external inputs in $effect; never read internal state (cursor, results, etc.)
	$effect(() => {
		// Capture external dependencies
		const q = query;
		const f = effectiveFilters;

		// Reset internal state
		results = [];
		cursor = null;
		hasMore = true;
		loading = true;
		loadingMore = true;

		fetchEntitiesSearch({ query: q || '', limit: RESULTS_PER_PAGE, cursor: null, filters: f })
			.then((data) => {
				results = data.entities as unknown as EntityResult[];
				cursor = data.nextCursor;
				hasMore = data.nextCursor !== null;
			})
			.catch(() => {
				hasMore = false;
			})
			.finally(() => {
				loading = false;
				loadingMore = false;
			});
	});

	async function loadMore() {
		if (loadingMore || !hasMore) return;
		loadingMore = true;
		try {
			const data = await fetchEntitiesSearch({
				query: query || '',
				limit: RESULTS_PER_PAGE,
				cursor,
				filters: effectiveFilters
			});
			results = [...results, ...(data.entities as unknown as EntityResult[])];
			cursor = data.nextCursor;
			hasMore = data.nextCursor !== null;
		} finally {
			loadingMore = false;
		}
	}

	function handleClearFilters() {
		onFiltersChange({
			...(species && !(selectedEntityPks?.length || selectedAnnotationIds?.length) ? { ncbi_tax_id: [species] } : {}),
			...(selectedEntityPks && selectedEntityPks.length > 0 ? { entity_pks: selectedEntityPks } : {}),
			...(selectedAnnotationIds && selectedAnnotationIds.length > 0 ? { annotation_term_ids: selectedAnnotationIds } : {}),
		});
	}

	function handleFilterChange(next: { entity_types?: string[]; sources?: string[] }) {
		onFiltersChange({
			...filters,
			...next,
			...(selectedEntityPks && selectedEntityPks.length > 0 ? { entity_pks: selectedEntityPks } : {}),
			...(selectedAnnotationIds && selectedAnnotationIds.length > 0 ? { annotation_term_ids: selectedAnnotationIds } : {}),
		});
	}

	function handleFilterToggle(filterKey: 'entity_types' | 'sources', value: string) {
		const currentValues = filters[filterKey] || [];
		const nextValues = currentValues.includes(value)
			? currentValues.filter((entry) => entry !== value)
			: [...currentValues, value];

		handleFilterChange({
			[filterKey]: nextValues.length > 0 ? nextValues : undefined
		});
	}

	function mapEntityTypeOption(value: string): FilterOption {
		// Handle raw format from DB: "MI:0326:Protein"
		const rawMatch = value.match(/^([A-Z]+):(\d+):(.+)$/);
		if (rawMatch) {
			const displayName = rawMatch[3];
			return {
				value,
				displayName,
				icon: getEntityTypeEmoji(displayName),
				id: `${rawMatch[1]}:${rawMatch[2]}`,
			};
		}

		// Handle old formatted value: "protein:MI:0326"
		const formattedMatch = value.match(/^(.+):([A-Z]+:\d+)$/);
		if (formattedMatch) {
			const displayName = formattedMatch[1];
			return {
				value,
				displayName,
				icon: getEntityTypeEmoji(displayName),
				id: formattedMatch[2],
			};
		}

		return {
			value,
			displayName: value,
			icon: getEntityTypeEmoji(value),
			id: null,
		};
	}


	function openDetails(entity: EntityResult) {
		detailsEntity = entity;
		detailsOpen = true;
	}
</script>

{#if isMobile.current}
	<div class="flex h-full min-h-0 flex-col overflow-hidden">
		<div class="border-b p-4">
			<Sheet>
				<SheetTrigger>
					<Button variant="outline" class="w-full">
						<Filter class="mr-2 size-4" />
						Filters
						{#if activeFilterCount > 0}
							<Badge variant="secondary" class="ml-2">{activeFilterCount}</Badge>
						{/if}
					</Button>
				</SheetTrigger>
				<SheetContent side="left" class="w-[85%] sm:w-[400px] overflow-y-auto p-0">
					<SheetHeader class="border-b px-6 py-4">
						<div class="flex items-center justify-between">
							<SheetTitle class="flex items-center gap-2">
								<Filter class="size-5 text-primary" />
								Filters
							</SheetTitle>
							{#if activeFilterCount > 0}
								<Button
									variant="ghost"
									size="sm"
									onclick={handleClearFilters}
									class="flex items-center gap-1 text-muted-foreground"
								>
									<X class="size-4" />
									Clear all
								</Button>
							{/if}
						</div>
					</SheetHeader>
					<div class="p-4">{@render filterSnippet(true)}</div>
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
				{@render filterSnippet(false)}
			</div>
		</div>
	</div>
{/if}

<EntityDetailsDialog bind:open={detailsOpen} entity={detailsEntity} />

{#snippet filterSnippet(mobile = false)}
	<div class={mobile ? 'space-y-6' : 'h-full overflow-hidden flex flex-col bg-transparent'}>
		{#if !mobile}
			<div class="h-[57px] flex-shrink-0 border-b px-3 py-3">
				<div class="flex h-full w-full items-center justify-between">
					<div class="flex items-center gap-2">
						<Filter class="size-5 text-primary" />
						<h3 class="text-lg font-semibold">Filters</h3>
					</div>
					{#if activeFilterCount > 0}
						<Button
							variant="ghost"
							size="sm"
							onclick={handleClearFilters}
							class="flex items-center gap-1 text-muted-foreground"
						>
							<X class="size-4" />
							Clear all ({formatNumber(activeFilterCount)})
						</Button>
					{/if}
				</div>
			</div>
		{/if}
		<div class={mobile ? 'space-y-6' : 'min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-4'} class:opacity-70={facetCountsLoading}>
			{@render filterSection('Entity Types', 'entity_types', entityTypeOptions, filters.entity_types || [])}
			{@render filterSection('Data Sources', 'sources', sourceOptions, filters.sources || [])}
		</div>
	</div>
{/snippet}

{#snippet filterSection(title: string, filterKey: 'entity_types' | 'sources', options: FilterOption[], selectedValues: string[])}
	{#if options.length > 0}
		<div>
			<h4 class="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
				{title}
			</h4>
			<div class="max-h-64 space-y-1 overflow-y-auto pr-2">
				{#each options as option}
					{@const selected = selectedValues.includes(option.value)}
					{@const count = scopedFacetCounts.get(`${filterKey === 'entity_types' ? 'entity_type' : 'source'}:${option.value}`)}
					<div class="flex items-center justify-between gap-2 py-0.5">
						<Label
							for={`${filterKey}-${option.value}`}
							class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-normal leading-5 text-foreground {selected ? 'font-medium' : ''}"
						>
							<Checkbox
								id={`${filterKey}-${option.value}`}
								checked={selected}
								onCheckedChange={() => handleFilterToggle(filterKey, option.value)}
								class={selected ? 'h-4 w-4 flex-shrink-0 border-primary' : 'h-4 w-4 flex-shrink-0'}
							/>
							<span class="truncate">
								{#if option.icon}<span class="mr-1.5">{option.icon}</span>{/if}
								{option.displayName}
							</span>
						</Label>
						{#if count != null}
							<span class="text-xs text-muted-foreground tabular-nums flex-shrink-0">
								{formatNumber(count)}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{:else if facetCountsLoading}
		<div class="space-y-2">
			<h4 class="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
				{title}
			</h4>
			<p class="text-sm text-muted-foreground">Loading filters...</p>
		</div>
	{/if}
{/snippet}

{#snippet resultsPane()}
	<div class="h-full overflow-y-auto p-4">
		{#if loading && results.length === 0}
			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{#each Array.from({ length: 6 }) as _, i}
					<div class="h-48 animate-pulse rounded-2xl border bg-muted/30"></div>
				{/each}
			</div>
		{:else if results.length > 0}
			<div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
				{#each results as result}
					{@render resultCard(result)}
				{/each}
			</div>
			{#if hasMore}
				<div class="flex justify-center py-8">
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
		{:else}
			<Card class="border-dashed">
				<CardContent class="flex flex-col items-center justify-center gap-2 py-16 text-center">
					<div class="text-lg font-semibold">No entities found</div>
					<p class="max-w-2xl text-sm text-muted-foreground">
						Try a gene symbol, UniProt identifier, small molecule name, or broader text query.
					</p>
				</CardContent>
			</Card>
		{/if}
	</div>
{/snippet}

{#snippet resultCard(result: typeof results[0])}
	{@const publicId = getEntityPublicId(result)}
	{@const displayName = getEntityDisplayName(result)}
	{@const secondaryName = getEntitySecondaryName(result)}
	{@const entityTypeLabel = getEntityTypeLabel(result)}
	{@const selected = selection.isSelected(publicId)}
	{@const entityTypeIcon = getEntityTypeEmoji(entityTypeLabel)}
	<div class="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card">
		<div class="flex items-center gap-3.5 px-4 py-3">
			{#if entityTypeIcon}
				<span class="flex size-5 shrink-0 items-center justify-center text-base leading-none" aria-hidden="true">
					{entityTypeIcon}
				</span>
			{:else}
				<Box class="size-5 shrink-0 text-muted-foreground" />
			{/if}
			<div class="flex min-w-0 flex-1 items-baseline gap-2">
				<h3 class="truncate text-base font-medium text-foreground">
					{displayName}
				</h3>
				{#if secondaryName && secondaryName !== displayName}
					<p class="truncate font-mono text-sm text-muted-foreground">
						{secondaryName}
					</p>
				{/if}
			</div>
		</div>
		<div class="flex border-t border-border">
			<button
				type="button"
				onclick={(event) => {
					event.stopPropagation();
					if (selected) {
						selection.removeEntity(publicId);
					} else {
						selection.addEntity({
							id: publicId,
							entityId: publicId,
							entityPk: result.entityPk,
							name: displayName,
							type: entityTypeLabel,
							fullResult: result
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
					openDetails(result);
				}}
				class="flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
			>
				<Eye class="size-4" />
				Details
			</button>
		</div>
	</div>
{/snippet}
