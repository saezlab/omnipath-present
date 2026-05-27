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
	import { getSelectionScope, getSelectionScopeSettings } from '$lib/stores/selection-scope.svelte';
	import type { SearchFilters } from '$lib/types/search';

	const selection = getSelectionStore();
	const scopeSettings = getSelectionScopeSettings();
	const tab = $derived($page.url.searchParams.get('tab') || 'entities');
	const query = $derived($page.url.searchParams.get('q') || '');

	let inputRef = $state<HTMLInputElement | null>(null);
	let draftQuery = $state('');
	let filters = $state<SearchFilters>({});

	const scope = $derived(
		getSelectionScope(selection.entityIds, selection.selectedEntityPks, selection.annotationIds, {
			includeAssociatedEntities: scopeSettings.expandSelection,
			includeMembersParticipants: scopeSettings.expandSelection,
			mode: scopeSettings.mode,
			resolveAnnotationEntities: true
		})
	);
	const scopeEndpointMode = $derived(scopeSettings.mode === 'intersection' ? 'both' : 'any');
	const entityTabScopePks = $derived(Array.from(new Set([...scope.termEntityPks, ...scope.scopedEntityPks])));
	const hasEntityTabScope = $derived(entityTabScopePks.length > 0);
	const hasOntologyScope = $derived(scope.scopedEntityPks.length > 0);
	const hasRelationScope = $derived(scope.scopedEntityPks.length > 0 || selection.annotationIds.length > 0);

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
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	const hasSelection = $derived(selection.selectedEntities.length > 0 || selection.selectedAnnotations.length > 0);
	const isSelectionEmpty = $derived(!hasSelection);
	const hasResolvedScopeForTab = $derived(
		tab === 'relations' ? hasRelationScope : tab === 'entities' ? hasEntityTabScope : hasOntologyScope
	);
</script>

{#if !(tab === 'relations' && scope.isLoading) && isSelectionEmpty}
	<div class="flex flex-1 items-center justify-center p-8">
		<Card class="w-full max-w-2xl border-dashed">
			<CardContent class="space-y-4 py-12 text-center">
				<h1 class="text-2xl font-semibold">Selection is empty</h1>
				<p class="text-muted-foreground">
				Use Explore to add entities or ontology terms. Selection will scope entities, relations, and
				ontology to that shared subset.
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
			{ value: 'ontology', label: 'Ontology' }
		]}
		searchPlaceholder={tab === 'ontology'
			? 'Search scoped ontology…'
			: tab === 'relations'
				? 'Search scoped relations…'
				: 'Search scoped entities…'}
		bind:searchInputRef={inputRef}
	>
		{#snippet content()}
			{#if scope.isLoading}
				<div class="flex flex-1 items-center justify-center p-8">
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
						<span>Resolving selection scope...</span>
					</div>
				</div>
			{:else if !hasResolvedScopeForTab}
				<div class="flex flex-1 items-center justify-center p-8">
					<Card class="w-full max-w-2xl border-dashed">
						<CardContent class="space-y-3 py-10 text-center">
							<h2 class="text-xl font-semibold">{tab === 'relations' ? 'No relation scope' : 'No entities in scope'}</h2>
							<p class="text-sm text-muted-foreground">
								Change the scope options or add an explicit entity to the selection.
							</p>
						</CardContent>
					</Card>
				</div>
			{:else if tab === 'entities'}
				<EntitiesExploreTab
					{query}
					{filters}
					onFiltersChange={(f) => (filters = f)}
					selectedEntityPks={entityTabScopePks}
					includeCvTerms
				/>
			{:else if tab === 'relations'}
				<RelationsExploreTab
					{query}
					{filters}
					onFilterChange={(f) => (filters = f)}
					scopedEntityIds={scope.scopedEntityPks}
					scopedAnnotationIds={selection.annotationIds}
					scopeEndpointMode={scopeEndpointMode}
					scopeMode={scopeSettings.mode}
				/>
			{:else}
				<AnnotationBrowserTab
					{query}
					{filters}
					onFiltersChange={(f) => (filters = f)}
					selectedEntityPks={scope.scopedEntityPks}
				/>
			{/if}
		{/snippet}

		{#snippet footerCta()}
			{#if hasSelection}
				<SelectionSheet triggerClass="fixed bottom-6 right-6 z-40 h-12 rounded-full px-4 shadow-lg" />
			{/if}
		{/snippet}
	</ExploreBrowserShell>
{/if}
