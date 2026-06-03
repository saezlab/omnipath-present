<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Card, CardContent } from '$lib/components/ui/card/index.js';
	import ExploreBrowserShell from '$lib/components/explore/ExploreBrowserShell.svelte';
	import AnnotationBrowserTab from '$lib/components/explore/AnnotationBrowserTab.svelte';
	import EntitiesExploreTab from '$lib/components/explore/EntitiesExploreTab.svelte';
	import RelationsExploreTab from '$lib/components/explore/RelationsExploreTab.svelte';
	import SelectionSheet from '$lib/components/selection/SelectionSheet.svelte';
	import { getSelectionStore } from '$lib/stores/selection.svelte';
	import { getSelectionScope, getSelectionScopeSettings } from '$lib/stores/selection-scope.svelte';
	import type { SearchFilters } from '$lib/types/search';
	import { formatNumber } from '$lib/utils/format';

	const selection = getSelectionStore();
	const scopeSettings = getSelectionScopeSettings();
	const rawTab = $derived($page.url.searchParams.get('tab') || 'entities');
	const tab = $derived(rawTab === 'relations' || rawTab === 'ontology' ? rawTab : rawTab === 'summary' ? 'ontology' : 'entities');
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
	const scopeAnnotationIds = $derived(Array.from(new Set([...selection.annotationIds, ...scope.ontologyTermIds])));
	const ontologySelectionScope = $derived({
		entityPks: selection.selectedEntityPks,
		annotationTermIds: selection.annotationIds,
		includeAssociatedEntities: scopeSettings.expandSelection,
		includeMembersParticipants: scopeSettings.expandSelection,
		mode: scopeSettings.mode
	});
	const hasEntityTabScope = $derived(entityTabScopePks.length > 0);
	const hasRelationScope = $derived(scope.scopedEntityPks.length > 0 || scopeAnnotationIds.length > 0);

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
		tab === 'relations'
			? hasRelationScope
			: tab === 'ontology'
				? hasEntityTabScope || scopeAnnotationIds.length > 0
				: hasEntityTabScope
	);
	const activeFilterCount = $derived(countActiveFilters(filters));
	const selectionSummary = $derived(
		`${formatNumber(selection.selectedEntities.length)} entities, ${formatNumber(selection.selectedAnnotations.length)} CV terms`
	);
	const scopeSummary = $derived(
		scope.isLoading
			? 'Resolving scope'
			: `${formatNumber(entityTabScopePks.length)} scoped entities, ${formatNumber(scopeAnnotationIds.length)} terms`
	);
	const explanationTitle = $derived(
		tab === 'relations'
			? 'Relations in your selection scope'
			: tab === 'ontology'
				? 'Ontology terms connected to your selection'
				: 'Entities in your selection scope'
	);
	const explanationText = $derived(
		tab === 'relations'
			? scopeSettings.mode === 'intersection'
				? 'The current selection is applied as an active scope. Intersection mode focuses relations on the overlap of selected entities and ontology-derived annotations, helping refine a subset before inspecting source-target evidence.'
				: 'The current selection is applied as an active scope. Union mode keeps relations connected to any selected entity or ontology term, so you can move from a broad selected context toward more specific evidence.'
			: tab === 'ontology'
				? 'Browse ontology and hierarchy terms associated with the scoped subset. Shared terms can be added back to the selection, then combined with intersection mode to focus on matching entities, relations, or annotations.'
				: 'Your selected entities and ontology terms define this scoped entity set. Search and facets refine only the selected, annotation-matched, or associated entities before you continue to relations or ontology summaries.'
	);
	const explanationFacts = $derived([
		`Selection: ${selectionSummary}`,
		`Scope: ${scopeSummary}`,
		scopeSettings.mode === 'intersection' ? 'Operator: intersection' : 'Operator: union',
		activeFilterCount > 0 ? `${formatNumber(activeFilterCount)} active filters` : 'No filters'
	]);

	function countActiveFilters(activeFilters: SearchFilters) {
		return Object.entries(activeFilters).reduce((count, [, value]) => {
			if (Array.isArray(value)) return count + value.length;
			if (value !== null && value !== undefined) return count + 1;
			return count;
		}, 0);
	}
</script>

{#if !(tab === 'relations' && scope.isLoading) && isSelectionEmpty}
	<div class="flex flex-1 items-center justify-center p-8">
		<Card class="w-full max-w-2xl border-dashed">
			<CardContent class="space-y-4 py-12 text-center">
				<h1 class="text-2xl font-semibold">Selection is empty</h1>
				<p class="text-muted-foreground">
					Use Explore to add entities or ontology terms. Selection will scope entities and relations to that shared subset.
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
		searchPlaceholder={tab === 'relations'
				? 'Search scoped relations…'
				: tab === 'ontology'
					? 'Search associated ontology terms…'
				: 'Search scoped entities…'}
		explanationTitle={explanationTitle}
		explanationText={explanationText}
		explanationFacts={explanationFacts}
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
							<h2 class="text-xl font-semibold">{tab === 'relations' ? 'No relation scope' : tab === 'ontology' ? 'No ontology scope' : 'No entities in scope'}</h2>
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
				/>
			{:else if tab === 'relations'}
				<RelationsExploreTab
					{query}
					{filters}
					onFilterChange={(f) => (filters = f)}
					scopedEntityIds={scope.scopedEntityPks}
					scopedAnnotationIds={scopeAnnotationIds}
					scopeEndpointMode={scopeEndpointMode}
					scopeMode={scopeSettings.mode}
				/>
			{:else if tab === 'ontology'}
				<AnnotationBrowserTab
					{query}
					{filters}
					onFiltersChange={(f) => (filters = f)}
					selectedEntityPks={entityTabScopePks}
					selectedAnnotationIds={scopeAnnotationIds}
					selectionScope={ontologySelectionScope}
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
