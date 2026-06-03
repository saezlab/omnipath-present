<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import ExploreBrowserShell from '$lib/components/explore/ExploreBrowserShell.svelte';
	import EntitiesExploreTab from '$lib/components/explore/EntitiesExploreTab.svelte';
	import RelationsExploreTab from '$lib/components/explore/RelationsExploreTab.svelte';
	import SelectionSheet from '$lib/components/selection/SelectionSheet.svelte';
	import { getSelectionStore } from '$lib/stores/selection.svelte';
	import type { SearchFilters } from '$lib/types/search';
	import { formatNumber } from '$lib/utils/format';

	const selection = getSelectionStore();

	let inputRef = $state<HTMLInputElement | null>(null);
	let draftQuery = $state('');
	let entityFilters = $state<SearchFilters>({});
	let interactionFilters = $state<SearchFilters>({});
	let selectionSheetOpen = $state(false);

	const rawTab = $derived($page.url.searchParams.get('tab') || 'entity');
	const tab = $derived(rawTab === 'relations' ? 'relations' : 'entity');
	const query = $derived($page.url.searchParams.get('q') || '');
	const entityMatchFilters = $derived(entityFilters);

	$effect(() => {
		draftQuery = query;
	});

	function setTab(next: string) {
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
				return;
			}

			if ((event.key === 's' || event.key === 'S') && !isTypingTarget && selection.totalSelectionCount > 0) {
				event.preventDefault();
				selectionSheetOpen = true;
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	const searchPlaceholder = $derived(tab === 'relations' ? 'Search relations…' : 'Search entities…');
	const activeEntityFilterCount = $derived(countActiveFilters(entityFilters));
	const activeRelationFilterCount = $derived(countActiveFilters(interactionFilters));
	const explanationTitle = $derived(tab === 'relations' ? 'Global relation search' : 'Global entity search');
	const explanationText = $derived(
		tab === 'relations'
			? 'Explore interactions and associations between entities. Search text resolves to matching endpoint entities; relation filters then narrow source-target rows by evidence, participant, predicate, and data-source context.'
			: 'Search the OmniPath entity index for genes, proteins, chemicals, complexes, pathways, and other biological objects. Facets narrow results by entity type, taxonomy, and data source; cards expose identifiers, relation counts, and hierarchy links where available.'
	);
	const explanationFacts = $derived(
		tab === 'relations'
			? [
					query.trim() ? `Query: ${query.trim()}` : 'No query text',
					activeRelationFilterCount > 0 ? `${formatNumber(activeRelationFilterCount)} relation filters` : 'No relation filters',
					activeEntityFilterCount > 0 ? `${formatNumber(activeEntityFilterCount)} endpoint match filters` : 'No endpoint match filters'
				]
			: [
					query.trim() ? `Query: ${query.trim()}` : 'No query text',
					activeEntityFilterCount > 0 ? `${formatNumber(activeEntityFilterCount)} entity filters` : 'No entity filters',
					selection.totalSelectionCount > 0 ? `${formatNumber(selection.totalSelectionCount)} selected` : 'Selection empty'
				]
	);

	function countActiveFilters(filters: SearchFilters) {
		return Object.entries(filters).reduce((count, [, value]) => {
			if (Array.isArray(value)) return count + value.length;
			if (value !== null && value !== undefined) return count + 1;
			return count;
		}, 0);
	}
</script>

<svelte:window />

<ExploreBrowserShell
	{query}
	{draftQuery}
	onDraftQueryChange={(value) => (draftQuery = value)}
	onSubmitSearch={submitSearch}
	{tab}
	onTabChange={setTab}
	tabs={[
		{ value: 'entity', label: 'entity' },
		{ value: 'relations', label: 'relations' }
	]}
	searchPlaceholder={searchPlaceholder}
	explanationTitle={explanationTitle}
	explanationText={explanationText}
	explanationFacts={explanationFacts}
	bind:searchInputRef={inputRef}
>
	{#snippet content()}
		{#if tab === 'entity'}
			<EntitiesExploreTab {query} filters={entityFilters} onFiltersChange={(f) => (entityFilters = f)} />
		{:else}
			<RelationsExploreTab {query} entitySearchFilters={entityMatchFilters} filters={interactionFilters} onFilterChange={(f) => (interactionFilters = f)} />
		{/if}
	{/snippet}

	{#snippet footerCta()}
		{#if selection.totalSelectionCount > 0}
			<SelectionSheet
				bind:open={selectionSheetOpen}
				triggerClass="fixed bottom-6 right-6 z-40 h-12 rounded-full px-4 shadow-lg"
			/>
		{/if}
	{/snippet}
</ExploreBrowserShell>
