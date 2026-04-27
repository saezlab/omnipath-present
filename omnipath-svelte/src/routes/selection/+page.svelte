<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { ArrowRight, Database, Tag, Trash2, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent } from '$lib/components/ui/card/index.js';
	import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '$lib/components/ui/sheet/index.js';
	import ExploreBrowserShell from '$lib/components/explore/ExploreBrowserShell.svelte';
	import EntitiesExploreTab from '$lib/components/explore/EntitiesExploreTab.svelte';
	import RelationsExploreTab from '$lib/components/explore/RelationsExploreTab.svelte';
	import AnnotationBrowserTab from '$lib/components/explore/AnnotationBrowserTab.svelte';
	import { getSelectionStore } from '$lib/stores/selection.svelte';
	import { getSelectionScope } from '$lib/stores/selection-scope.svelte';
	import type { SearchFilters } from '$lib/types/search';

	const selection = getSelectionStore();
	const tab = $derived($page.url.searchParams.get('tab') || 'entities');
	const query = $derived($page.url.searchParams.get('q') || '');

	let inputRef = $state<HTMLInputElement | null>(null);
	let draftQuery = $state('');
	let filters = $state<SearchFilters>({ relation_categories: ['interaction'] });

	const shouldResolveAnnotationEntities = $derived(tab === 'interactions');
	const scope = $derived(
		getSelectionScope(selection.entityIds, selection.annotationIds, {
			resolveAnnotationEntities: shouldResolveAnnotationEntities
		})
	);

	$effect(() => {
		draftQuery = query;
	});

	function setTab(next: string) {
		if (next === 'interactions' && !filters.relation_categories?.length) {
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

	const isInteractionSelectionEmpty = $derived(
		scope.selectedEntityIds.length === 0 && scope.selectedAnnotationIds.length === 0
	);
	const hasSelection = $derived(selection.selectedEntities.length > 0 || selection.selectedAnnotations.length > 0);
	const isSelectionEmpty = $derived(
		tab === 'interactions'
			? isInteractionSelectionEmpty
			: selection.selectedEntities.length === 0 && selection.selectedAnnotations.length === 0
	);
</script>

{#if !(tab === 'interactions' && scope.isLoading) && isSelectionEmpty}
	<div class="flex flex-1 items-center justify-center p-8">
		<Card class="w-full max-w-2xl border-dashed">
			<CardContent class="space-y-4 py-12 text-center">
				<h1 class="text-2xl font-semibold">Selection is empty</h1>
				<p class="text-muted-foreground">
					Use Explore to add entities or annotations. Selection will scope entities, interactions, and
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
			{ value: 'interactions', label: 'Interactions' },
			{ value: 'annotations', label: 'Annotations' }
		]}
		searchPlaceholder={tab === 'annotations'
			? 'Search scoped annotations…'
			: tab === 'interactions'
				? 'Search scoped interactions…'
				: 'Search scoped entities…'}
		bind:searchInputRef={inputRef}
		showSpeciesPicker={false}
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
			{:else if tab === 'interactions'}
				<RelationsExploreTab {filters} onFilterChange={(f) => (filters = f)} scopedEntityIds={scope.scopedEntityIds} scopedAnnotationIds={scope.selectedAnnotationIds} />
			{:else}
				<AnnotationBrowserTab {query} {filters} onFiltersChange={(f) => (filters = f)} selectedEntityPks={selection.selectedEntityPks} selectedAnnotationIds={scope.selectedAnnotationIds} />
			{/if}
		{/snippet}

		{#snippet footerCta()}
			{#if hasSelection}
				<Sheet>
					<SheetTrigger>
						<Button size="lg" class="fixed bottom-6 right-6 z-40 h-12 rounded-full px-4 shadow-lg">
							<span>Open Selection</span>
							<Badge variant="secondary" class="ml-2 rounded-full px-2 py-0.5 text-xs">
								{selection.selectedEntities.length + selection.selectedAnnotations.length}
							</Badge>
							<ArrowRight class="ml-2 size-4" />
						</Button>
					</SheetTrigger>
					<SheetContent side="right" class="w-[92vw] gap-0 overflow-hidden p-0 sm:max-w-xl">
						<SheetHeader class="border-b px-6 py-5 pr-12">
							<SheetTitle class="text-xl">Current selection</SheetTitle>
							<SheetDescription>
								This selection scopes the entities, interactions, and annotations tabs.
							</SheetDescription>
						</SheetHeader>
						<div class="flex min-h-0 flex-1 flex-col">
							<div class="border-b bg-muted/20 px-6 py-4">
								<div class="grid grid-cols-2 gap-3">
									<div class="rounded-xl border bg-background/70 p-3">
										<div class="flex items-center gap-2 text-sm font-medium">
											<Database class="size-4 text-primary" />
											Entities
										</div>
										<div class="mt-1 text-2xl font-semibold tabular-nums">
											{selection.selectedEntities.length}
										</div>
									</div>
									<div class="rounded-xl border bg-background/70 p-3">
										<div class="flex items-center gap-2 text-sm font-medium">
											<Tag class="size-4 text-primary" />
											CV terms
										</div>
										<div class="mt-1 text-2xl font-semibold tabular-nums">
											{selection.selectedAnnotations.length}
										</div>
									</div>
								</div>
							</div>

							<div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
								<div class="mb-5 flex items-center justify-between gap-3">
									<div>
										<h3 class="text-sm font-semibold">Selected items</h3>
										<p class="text-xs text-muted-foreground">
											Remove individual entries or clear the whole selection.
										</p>
									</div>
									<Button
										variant="outline"
										size="sm"
										onclick={selection.clearSelection}
										class="h-8 shrink-0 gap-1.5"
									>
										<Trash2 class="size-3.5" />
										Clear all
									</Button>
								</div>

								<div class="space-y-6">
									{#if selection.selectedEntities.length > 0}
										<section class="space-y-2.5">
											<div
												class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
											>
												<Database class="size-3.5" />
												Entities
											</div>
											<div class="space-y-2">
												{#each selection.selectedEntities as entity}
													<div
														class="group flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30"
													>
														<div
															class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
														>
															{(entity.name || entity.id).slice(0, 2).toUpperCase()}
														</div>
														<div class="min-w-0 flex-1">
															<div class="truncate text-sm font-medium">
																{entity.name || entity.id}
															</div>
															<div class="mt-1 flex items-center gap-2">
																{#if entity.type}
																	<Badge
																		variant="secondary"
																		class="h-5 rounded-md px-1.5 text-[10px] uppercase"
																	>
																		{entity.type}
																	</Badge>
																{/if}
																<span class="truncate font-mono text-xs text-muted-foreground">
																	{entity.id}
																</span>
															</div>
														</div>
														<Button
															type="button"
															variant="ghost"
															size="icon"
															aria-label={`Remove ${entity.name || entity.id}`}
															onclick={() => selection.removeEntity(entity.id)}
															class="size-8 shrink-0 text-muted-foreground hover:text-foreground"
														>
															<X class="size-4" />
														</Button>
													</div>
												{/each}
											</div>
										</section>
									{/if}

									{#if selection.selectedAnnotations.length > 0}
										<section class="space-y-2.5">
											<div
												class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
											>
												<Tag class="size-3.5" />
												CV terms
											</div>
											<div class="space-y-2">
												{#each selection.selectedAnnotations as annotation}
													<div
														class="group flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30"
													>
														<div
															class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
														>
															{annotation.namespace?.slice(0, 2).toUpperCase() || 'CV'}
														</div>
														<div class="min-w-0 flex-1">
															<div class="truncate text-sm font-medium">
																{annotation.label || annotation.id}
															</div>
															<div class="mt-1 flex items-center gap-2">
																{#if annotation.namespace}
																	<Badge
																		variant="outline"
																		class="h-5 rounded-md px-1.5 font-mono text-[10px] uppercase"
																	>
																		{annotation.namespace}
																	</Badge>
																{/if}
																<span class="truncate font-mono text-xs text-muted-foreground">
																	{annotation.id}
																</span>
															</div>
														</div>
														<Button
															type="button"
															variant="ghost"
															size="icon"
															aria-label={`Remove ${annotation.label || annotation.id}`}
															onclick={() => selection.removeAnnotation(annotation.id)}
															class="size-8 shrink-0 text-muted-foreground hover:text-foreground"
														>
															<X class="size-4" />
														</Button>
													</div>
												{/each}
											</div>
										</section>
									{/if}
								</div>
							</div>
						</div>
					</SheetContent>
				</Sheet>
			{/if}
		{/snippet}
	</ExploreBrowserShell>
{/if}
