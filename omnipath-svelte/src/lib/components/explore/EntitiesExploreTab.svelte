<script lang="ts">
	import { Box, Check, Eye, Filter, Plus, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent } from '$lib/components/ui/card/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '$lib/components/ui/sheet/index.js';
	import MoleculeStructure from '$lib/components/entity/MoleculeStructure.svelte';
	import { fetchEntitiesSearch, fetchEntityFilterOptions } from '$lib/api/client';
	import {
		getAllowedEntityDescriptions,
		getEntityDisplayName,
		getEntityIdentifiers,
		getEntityPublicId,
		getEntitySecondaryName,
		getEntitySmiles,
		getEntityTypeLabel,
		isSmallMoleculeEntity,
		type EntityLike
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
		scopedEntityIds?: string[];
	}

	let { query, species, filters, onFiltersChange, scopedEntityIds }: Props = $props();

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
	let filterOptionsLoading = $state(true);
	let entityTypeOptions = $state<FilterOption[]>([]);
	let sourceOptions = $state<FilterOption[]>([]);
	let detailsEntity = $state<EntityResult | null>(null);
	let detailsOpen = $state(false);

	const effectiveFilters = $derived({
		...filters,
		...(species ? { ncbi_tax_id: filters.ncbi_tax_id ?? [species] } : {}),
		...(scopedEntityIds && scopedEntityIds.length > 0 ? { entity_ids: scopedEntityIds } : {})
	});

	const activeFilterCount = $derived(
		Object.entries(filters).reduce((count, [, value]) => {
			if (Array.isArray(value)) return count + value.length;
			if (value !== null && value !== undefined) return count + 1;
			return count;
		}, 0)
	);

	$effect(() => {
		let cancelled = false;
		filterOptionsLoading = true;
		fetchEntityFilterOptions()
			.then((options) => {
				if (cancelled) return;
				entityTypeOptions = options.entity_types.map(mapEntityTypeOption);
				sourceOptions = options.sources.map((value) => ({
					value,
					displayName: value,
					icon: '📚'
				}));
			})
			.catch(() => {
				if (cancelled) return;
				entityTypeOptions = [];
				sourceOptions = [];
			})
			.finally(() => {
				if (!cancelled) filterOptionsLoading = false;
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
			...(species && !scopedEntityIds?.length ? { ncbi_tax_id: [species] } : {}),
			...(scopedEntityIds && scopedEntityIds.length > 0 ? { entity_ids: scopedEntityIds } : {})
		});
	}

	function handleFilterChange(next: { entity_types?: string[]; sources?: string[] }) {
		onFiltersChange({
			...filters,
			...next,
			...(scopedEntityIds && scopedEntityIds.length > 0 ? { entity_ids: scopedEntityIds } : {})
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
				const possiblePrefix = parts[parts.length - 2];
				if (['MI', 'OM'].includes(possiblePrefix)) {
					id = `${possiblePrefix}:${parts[parts.length - 1]}`;
				} else if ((parts[parts.length - 1] || '').length < 20) {
					id = parts[parts.length - 1];
				}
			}
		}

		return {
			value,
			displayName,
			icon: getEntityTypeEmoji(value),
			id
		};
	}

	function stripHtml(value: string) {
		return value.replace(/<[^>]*>/g, '');
	}

	const DESCRIPTION_SECTION_LABELS = [
		'FUNCTION',
		'DISEASE',
		'SUBCELLULAR LOCATION',
		'PATHWAY',
		'CATALYTIC ACTIVITY',
		'COFACTOR',
		'ACTIVITY REGULATION',
		'TISSUE SPECIFICITY',
		'SIMILARITY',
		'DEVELOPMENTAL STAGE',
		'INDUCTION',
		'DOMAIN',
		'NOTE'
	] as const;

	const sectionMatchPattern = `(${DESCRIPTION_SECTION_LABELS.map((label) => label.replace(/\s+/g, '\\s+')).join('|')}):`;

	function cleanDescriptionText(value: string) {
		return stripHtml(value)
			.replace(/\{[^{}]*(?:ECO:|PubMed:|UniProtKB:)[^{}]*\}/g, '')
			.replace(/\[[^\]]*(?:MIM:|PubMed:|UniProtKB:)[^\]]*\]/g, '')
			.replace(/\((?:[^)]*(?:PubMed:|ECO:|UniProtKB|MIM:)[^)]*)\)/g, '')
			.replace(/\b(?:PubMed|ECO|UniProtKB|MIM):[^\s;,.)]*/g, '')
			.replace(/\s+/g, ' ')
			.replace(/\s+([;,.])/g, '$1')
			.trim();
	}

	function getDescriptionSections(entity: EntityLike) {
		const grouped = new Map<string, string[]>();

		for (const description of getAllowedEntityDescriptions(entity)) {
			const normalized = stripHtml(description);
			const matches = Array.from(normalized.matchAll(new RegExp(sectionMatchPattern, 'gi')));

			if (matches.length === 0) {
				const cleaned = cleanDescriptionText(normalized);
				if (cleaned) grouped.set('DESCRIPTION', [...(grouped.get('DESCRIPTION') || []), cleaned]);
				continue;
			}

			for (let index = 0; index < matches.length; index += 1) {
				const current = matches[index];
				const next = matches[index + 1];
				const label = (current[1] || 'DESCRIPTION').toUpperCase();
				const start = (current.index ?? 0) + current[0].length;
				const end = next ? next.index ?? normalized.length : normalized.length;
				const cleaned = cleanDescriptionText(normalized.slice(start, end).replace(/^\s*[;,-]\s*/, '').trim());
				if (!cleaned) continue;

				const existing = grouped.get(label) || [];
				if (!existing.includes(cleaned)) {
					grouped.set(label, [...existing, cleaned]);
				}
			}
		}

		const sectionOrder = [
			'FUNCTION',
			'DISEASE',
			'SUBCELLULAR LOCATION',
			...DESCRIPTION_SECTION_LABELS.filter((label) => !['FUNCTION', 'DISEASE', 'SUBCELLULAR LOCATION'].includes(label)),
			'DESCRIPTION'
		];

		return Array.from(grouped.entries())
			.sort(([a], [b]) => {
				const aIndex = sectionOrder.indexOf(a);
				const bIndex = sectionOrder.indexOf(b);
				return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
			})
			.map(([label, items]) => ({ label, items }));
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

<Dialog bind:open={detailsOpen}>
	<DialogContent class="max-h-[85vh] overflow-hidden sm:max-w-2xl">
		{#if detailsEntity}
			{@const detailSections = getDescriptionSections(detailsEntity)}
			{@const detailIdentifiers = getEntityIdentifiers(detailsEntity)}
			{@const detailSmiles = getEntitySmiles(detailsEntity)}
			{@const showMoleculeStructure = isSmallMoleculeEntity(detailsEntity) && detailSmiles}
			<DialogHeader>
				<DialogTitle>{getEntityDisplayName(detailsEntity)}</DialogTitle>
			</DialogHeader>
			<div class="min-h-0 space-y-5 overflow-y-auto pr-2">
				<div class="flex flex-wrap items-center gap-2">
					<Badge variant="secondary">{getEntityTypeLabel(detailsEntity)}</Badge>
					<span class="font-mono text-xs text-muted-foreground">{getEntityPublicId(detailsEntity)}</span>
				</div>
				{#if showMoleculeStructure}
					<div class="rounded-lg border bg-muted/10 p-4">
						<div class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Molecule structure
						</div>
						<div class="flex justify-center">
							<MoleculeStructure smiles={detailSmiles} width={320} height={240} renderOnClick={false} />
						</div>
					</div>
				{/if}
				{#if detailSections.length > 0}
					<div class="space-y-4">
						{#each detailSections as section}
							<section class="space-y-1.5">
								<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									{section.label}
								</h3>
								{#each section.items as item}
									<p class="text-sm leading-relaxed text-foreground">{item}</p>
								{/each}
							</section>
						{/each}
					</div>
				{/if}
				{#if detailIdentifiers.length > 0}
					<div class="space-y-2">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Identifiers
						</h3>
						<div class="flex flex-wrap gap-1.5">
							{#each detailIdentifiers as identifier}
								<Badge variant="outline" class="font-mono text-[11px]">
									{identifier.value}
								</Badge>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</DialogContent>
</Dialog>

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
		<div class={mobile ? 'space-y-6' : 'min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-4'} class:opacity-70={filterOptionsLoading}>
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
					</div>
				{/each}
			</div>
		</div>
	{:else if filterOptionsLoading}
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
