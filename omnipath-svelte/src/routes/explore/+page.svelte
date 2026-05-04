<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import ExploreBrowserShell from '$lib/components/explore/ExploreBrowserShell.svelte';
	import EntitiesExploreTab from '$lib/components/explore/EntitiesExploreTab.svelte';
	import RelationsExploreTab from '$lib/components/explore/RelationsExploreTab.svelte';
	import AnnotationBrowserTab from '$lib/components/explore/AnnotationBrowserTab.svelte';
	import SelectionSheet from '$lib/components/selection/SelectionSheet.svelte';
	import { getSelectionStore } from '$lib/stores/selection.svelte';
	import type { SearchFilters } from '$lib/types/search';

	const SPECIES_OPTIONS = [
		{ value: '9606', label: 'Human' },
		{ value: '10090', label: 'Mouse' },
		{ value: '10116', label: 'Rat' },
		{ value: '7227', label: 'Fruit fly' },
		{ value: '6239', label: 'C. elegans' },
		{ value: '7955', label: 'Zebrafish' }
	] as const;

	const selection = getSelectionStore();

	let inputRef = $state<HTMLInputElement | null>(null);
	let draftQuery = $state('');
	let entityFilters = $state<SearchFilters>({ ncbi_tax_id: ['9606'] });
	let interactionFilters = $state<SearchFilters>({ relation_categories: ['interaction'] });
	let annotationFilters = $state<SearchFilters>({});
	let selectionSheetOpen = $state(false);

	const tab = $derived($page.url.searchParams.get('tab') || 'entity');
	const query = $derived($page.url.searchParams.get('q') || '');
	const species = $derived($page.url.searchParams.get('species') || '9606');

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

	function setSpecies(value: string | null) {
		const url = new URL($page.url);
		if (value) {
			url.searchParams.set('species', value);
		} else {
			url.searchParams.delete('species');
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

	const searchPlaceholder = $derived(
		tab === 'ontology' ? 'Search ontology terms…' : tab === 'relations' ? 'Search relations…' : 'Search entities…'
	);
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
		{ value: 'relations', label: 'relations' },
		{ value: 'ontology', label: 'ontology' }
	]}
	searchPlaceholder={searchPlaceholder}
	bind:searchInputRef={inputRef}
	{species}
	onSpeciesChange={setSpecies}
	showSpeciesPicker={tab === 'entity'}
	speciesOptions={SPECIES_OPTIONS}
>
	{#snippet content()}
		{#if tab === 'entity'}
			<EntitiesExploreTab {query} {species} filters={entityFilters} onFiltersChange={(f) => (entityFilters = f)} />
		{:else if tab === 'relations'}
			<RelationsExploreTab {query} filters={interactionFilters} onFilterChange={(f) => (interactionFilters = f)} />
		{:else}
			<AnnotationBrowserTab {query} {species} filters={annotationFilters} onFiltersChange={(f) => (annotationFilters = f)} />
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
