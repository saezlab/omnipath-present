<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Card, CardContent } from '$lib/components/ui/card/index.js';
	import ExploreBrowserShell from '$lib/components/explore/ExploreBrowserShell.svelte';
	import EntitiesExploreTab from '$lib/components/explore/EntitiesExploreTab.svelte';
	import RelationsExploreTab from '$lib/components/explore/RelationsExploreTab.svelte';
	import AnnotationBrowserTab from '$lib/components/explore/AnnotationBrowserTab.svelte';
	import SelectionSheet from '$lib/components/selection/SelectionSheet.svelte';
	import { getSelectionStore } from '$lib/stores/selection.svelte';
	import { getSelectionScope } from '$lib/stores/selection-scope.svelte';
	import type { SearchFilters } from '$lib/types/search';

	const selection = getSelectionStore();
	const tab = $derived($page.url.searchParams.get('tab') || 'entities');
	const query = $derived($page.url.searchParams.get('q') || '');

	let inputRef = $state<HTMLInputElement | null>(null);
	let draftQuery = $state('');
	let filters = $state<SearchFilters>({ relation_categories: ['interaction'] });

	const shouldResolveAnnotationEntities = $derived(tab === 'relations');
	const scope = $derived(
		getSelectionScope(selection.entityIds, selection.annotationIds, {
			resolveAnnotationEntities: shouldResolveAnnotationEntities
		})
	);

	$effect(() => {
		draftQuery = query;
	});

	function setTab(next: string) {
		if (next === 'relations' && !filters.relation_categories?.length) {
			filters = { ...filters, relation_categories: ['interaction'] };
		}
		const url = new URL($page.url);
		url.searchParams.set('tab', next);
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function setQuery(next: string) {
		const url = new URL($page.url);
		if (next.trim()) {
			url.searchParams.set('q', next.trim());
		} else {
			url.searchParams.delete('q');
		}
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function submitSearch() {
		setQuery(draftQuery);
	}

	$effect(() => {
		if (!browser) return;
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const tagName = target?.tagName;
			const isTypingTarget =
				tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target?.isContentEditable;

			if (event.key === '/' && !isTypingTarget) {
				event.preventDefault();
				inputRef?.focus();
				inputRef?.select();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	const isRelationSelectionEmpty = $derived(
		scope.selectedEntityIds.length === 0 && scope.selectedAnnotationIds.length === 0
	);
	const hasSelection = $derived(selection.selectedEntities.length > 0 || selection.selectedAnnotations.length > 0);
	const isSelectionEmpty = $derived(
		tab === 'relations'
			? isRelationSelectionEmpty
			: selection.selectedEntities.length === 0 && selection.selectedAnnotations.length === 0
	);
</script>

{#if !(tab === 'relations' && scope.isLoading) && isSelectionEmpty}
	<div class="flex flex-1 items-center justify-center p-8">
		<Card class="w-full max-w-2xl border-dashed">
			<CardContent class="space-y-4 py-12 text-center">
				<h1 class="text-2xl font-semibold">Selection is empty</h1>
				<p class="text-muted-foreground">
				Use Explore to add entities or annotations. Selection will scope entities, relations, and
				annotations to that shared subset.
				</p>
				{#if selection.selectedAnnotations.length > 0}
					<div class="flex flex-wrap justify-center gap-2">
						{#each selection.selectedAnnotations.slice(0, 8) as annotation}
							<Badge variant="secondary">{annotation.label}</Badge>
						{/each}
					</div>
				{/if}
			</CardContent>
		</Card>
	</div>
{:else}
	<ExploreBrowserShell
		{query}
		{draftQuery}
		onDraftQueryChange={(value) => (draftQuery = value)}
		onSubmitSearch={submitSearch}
		{tab}
		onTabChange={setTab}
		tabs={[
			{ value: 'entities', label: 'Entities' },
			{ value: 'relations', label: 'Relations' },
			{ value: 'annotations', label: 'Annotations' }
		]}
		searchPlaceholder={tab === 'annotations'
			? 'Search scoped annotations…'
			: tab === 'relations'
				? 'Search scoped relations…'
				: 'Search scoped entities…'}
		bind:searchInputRef={inputRef}
	>
		{#snippet content()}
			{#if tab === 'entities'}
				<EntitiesExploreTab
					{query}
					{filters}
					onFiltersChange={(f) => (filters = f)}
					selectedEntityPks={selection.selectedEntityPks}
					selectedAnnotationIds={scope.selectedAnnotationIds}
				/>
			{:else if tab === 'relations'}
				<RelationsExploreTab {filters} onFilterChange={(f) => (filters = f)} scopedEntityIds={selection.entityIds} scopedAnnotationIds={scope.selectedAnnotationIds} />
			{:else}
				<AnnotationBrowserTab {query} {filters} onFiltersChange={(f) => (filters = f)} selectedEntityPks={selection.selectedEntityPks} selectedAnnotationIds={scope.selectedAnnotationIds} />
			{/if}
		{/snippet}

		{#snippet footerCta()}
			{#if hasSelection}
				<SelectionSheet triggerClass="fixed bottom-6 right-6 z-40 h-12 rounded-full px-4 shadow-lg" />
			{/if}
		{/snippet}
	</ExploreBrowserShell>
{/if}
