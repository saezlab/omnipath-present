<script lang="ts">
	import { ChevronDown, ChevronUp, Database, Download, ExternalLink, Layers3, Network, Search, Tags } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';
	import { formatNumber } from '$lib/utils/format.js';
	import type { ResourceRecord } from '$lib/server/resource';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let query = $state('');
	let selectedCategory = $state('all');
	let expandedIds = $state<Set<string>>(new Set());
	let downloadingIds = $state<Set<string>>(new Set());

	const categories = $derived([
		'all',
		...Object.keys(data.summary.categoryCounts).sort((a, b) => a.localeCompare(b))
	]);

	const filteredResources = $derived.by(() => {
		const normalizedQuery = query.trim().toLowerCase();

		return data.resources.filter((resource) => {
			const searchableText = [
				resource.resource_name,
				resource.resource_id,
				resource.description,
				...(resource.categories || []),
				...(resource.annotation_ontologies || [])
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();

			const matchesQuery = normalizedQuery.length === 0 || searchableText.includes(normalizedQuery);
			const matchesCategory = selectedCategory === 'all' || resource.categories.includes(selectedCategory);

			return matchesQuery && matchesCategory;
		});
	});

	function sentenceCase(value: string | null | undefined): string {
		if (!value) return 'Unknown';
		return value.replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
	}

	function formatFileSize(bytes: number | null | undefined): string {
		const value = bytes || 0;
		if (value < 1024) return `${value} B`;

		const units = ['KB', 'MB', 'GB', 'TB'];
		let size = value / 1024;
		let unitIndex = 0;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex += 1;
		}

		return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
	}

	function formatDate(value: string | null | undefined): string {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;

		return new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(date);
	}

	function iconForCategories(categories: string[]) {
		if (categories.includes('interaction')) return Network;
		if (categories.includes('annotation')) return Layers3;
		if (categories.includes('membership') || categories.includes('association')) return Tags;
		return Database;
	}

	function toggleExpanded(resourceId: string) {
		expandedIds = new Set(expandedIds).has(resourceId)
			? new Set([...expandedIds].filter((id) => id !== resourceId))
			: new Set(expandedIds).add(resourceId);
	}

	async function handleDownload(resource: ResourceRecord) {
		try {
			downloadingIds = new Set(downloadingIds).add(resource.resource_id);
			toast.info('Resource downloads will be wired to /app-api/resources/download in a follow-up milestone.');
		} finally {
			downloadingIds = new Set([...downloadingIds].filter((id) => id !== resource.resource_id));
		}
	}
</script>


<div class="relative mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 flex-col px-4 py-4 md:px-6 md:py-5">
	<div class="min-h-0 flex-1 overflow-y-auto pr-1">
		<div class="space-y-4">
			<div class="rounded-[1.4rem] border bg-card p-3 shadow-sm">
				<div class="flex flex-col gap-3">
					<div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
						<div class="min-w-0 flex-1">
							<div class="text-xl font-semibold tracking-tight">Resource catalog</div>
							<p class="mt-1 text-sm text-muted-foreground">
								Browse curated OmniPath resources directly from the local catalog table.
							</p>
						</div>

						<div class="relative w-full xl:max-w-xl">
							<Search class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								bind:value={query}
								placeholder="Search resources, IDs, categories, or ontologies…"
								class="h-11 rounded-[1rem] border-0 bg-muted/40 pl-10 text-sm shadow-none sm:text-base"
							/>
						</div>
					</div>

					<div class="flex flex-wrap gap-2">
						{#each categories as category (category)}
							<button
								type="button"
								onclick={() => (selectedCategory = category)}
								class={cn(
									'rounded-full border px-3.5 py-2 text-sm transition-colors',
									selectedCategory === category
										? 'border-primary bg-primary text-primary-foreground'
										: 'border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground'
								)}
							>
								{category === 'all' ? 'All categories' : sentenceCase(category)}
							</button>
						{/each}
					</div>

					<div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm text-muted-foreground">
						<span>{formatNumber(data.summary.totalResources)} resources</span>
						<span>•</span>
						<span>{formatNumber(data.summary.totalEntities)} entities</span>
						<span>•</span>
						<span>{formatNumber(data.summary.totalInteractions)} interactions</span>
						<span>•</span>
						<span>{formatNumber(data.summary.totalMemberships)} memberships</span>
						<span>•</span>
						<span>{formatNumber(data.summary.totalAnnotations)} annotations</span>
					</div>
				</div>
			</div>

			<section class="space-y-4">
				<div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
					<p class="text-sm text-muted-foreground">
						Showing {filteredResources.length} of {data.resources.length} resources.
					</p>
					<div class="text-sm text-muted-foreground">
						{formatNumber(data.summary.totalOntologyTerms)} ontology terms • {formatFileSize(data.summary.totalBytes)} total size
					</div>
				</div>

				{#if filteredResources.length > 0}
					<div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-2 2xl:grid-cols-3">
						{#each filteredResources as resource (resource.resource_id)}
							{@const expanded = expandedIds.has(resource.resource_id)}
							{@const downloading = downloadingIds.has(resource.resource_id)}
							{@const Icon = iconForCategories(resource.categories)}
							{@const stats = [
								{ label: 'Entities', value: resource.entity_count },
								{ label: 'Interactions', value: resource.interaction_count },
								{ label: 'Memberships', value: resource.membership_count },
								{ label: 'Annotations', value: resource.annotation_count },
								{ label: 'Ontology Terms', value: resource.ontology_term_count }
							].filter((stat) => stat.value > 0)}
							<article class="flex h-full flex-col rounded-[1.25rem] border border-border/50 bg-card/70 p-4 transition-all hover:bg-muted/[0.18]">
								<div class="flex items-start justify-between gap-3">
									<div class="flex min-w-0 items-start gap-3">
										<div class="rounded-xl border border-border/60 bg-muted/25 p-2.5">
											<Icon class="h-4 w-4 text-muted-foreground" />
										</div>
										<div class="min-w-0">
											<div class="truncate text-lg font-semibold tracking-tight">{resource.resource_name}</div>
										</div>
									</div>

									<span class={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium', resource.build_status === 'success' ? 'bg-secondary/15 text-secondary' : 'bg-muted text-muted-foreground')}>
										{sentenceCase(resource.build_status)}
									</span>
								</div>

								<div class="mt-3 flex flex-wrap gap-2">
									{#each resource.categories as category (`${resource.resource_id}-${category}`)}
										<span class="inline-flex items-center rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{sentenceCase(category)}</span>
									{/each}
									{#if !expanded}
										{#each resource.annotation_ontologies.slice(0, 1) as ontology (`${resource.resource_id}-${ontology}`)}
											<span class="inline-flex items-center rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{ontology}</span>
										{/each}
									{/if}
								</div>

								<div class="mt-3 rounded-xl bg-muted/18 px-3.5 py-3">
									<p class={cn('overflow-hidden text-sm leading-6 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical]', expanded ? '[-webkit-line-clamp:8]' : '[-webkit-line-clamp:2]')}>
										{resource.description || 'No description available.'}
									</p>
								</div>

								<div class="mt-auto flex flex-col pt-3">
									<div class="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
										<button type="button" onclick={() => toggleExpanded(resource.resource_id)} class="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
											{#if expanded}
												Hide details <ChevronUp class="h-4 w-4" />
											{:else}
												More details <ChevronDown class="h-4 w-4" />
											{/if}
										</button>

										<Button class="rounded-full" variant="outline" size="sm" onclick={() => handleDownload(resource)} disabled={downloading || resource.build_status !== 'success'} title={resource.build_status !== 'success' ? 'No download available for this resource' : undefined}>
											<Download class="h-4 w-4" />
											{downloading ? 'Downloading…' : 'Download'}
										</Button>
									</div>

									{#if expanded}
										<div class="mt-3 space-y-3 border-t border-border/50 pt-3">
											{#if resource.annotation_ontologies.length > 0}
												<div class="flex flex-wrap gap-2">
													{#each resource.annotation_ontologies as ontology (`${resource.resource_id}-${ontology}`)}
														<span class="inline-flex items-center rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{ontology}</span>
													{/each}
												</div>
											{/if}

											{#if stats.length > 0}
												<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
													{#each stats as stat (`${resource.resource_id}-${stat.label}`)}
														<div class="rounded-lg bg-muted/15 px-3 py-2">
															<div class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{stat.label}</div>
															<div class="mt-1 text-sm font-semibold">{formatNumber(stat.value)}</div>
														</div>
													{/each}
												</div>
											{/if}

											<dl class="grid gap-2 text-sm">
												<div class="flex items-start justify-between gap-4"><dt class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">Resource ID</dt><dd class="max-w-[65%] text-right font-mono break-words text-foreground/90">{resource.resource_id}</dd></div>
												<div class="flex items-start justify-between gap-4"><dt class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">License</dt><dd class="max-w-[65%] text-right break-words text-foreground/90">{resource.license || '—'}</dd></div>
												<div class="flex items-start justify-between gap-4"><dt class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">Last Downloaded</dt><dd class="text-right text-foreground/90">{formatDate(resource.last_downloaded_at)}</dd></div>
												<div class="flex items-start justify-between gap-4"><dt class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">Last Built</dt><dd class="text-right text-foreground/90">{formatDate(resource.last_built_at)}</dd></div>
												<div class="flex items-start justify-between gap-4"><dt class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">Snapshot Size</dt><dd class="text-right text-foreground/90">{formatFileSize(resource.total_size_bytes)}</dd></div>
											</dl>

											<div class="flex flex-wrap items-center gap-1">
												{#if resource.homepage_url}
													<a href={resource.homepage_url} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">Site <ExternalLink class="h-3.5 w-3.5" /></a>
												{/if}
												{#if resource.pubmed_id}
													<a href={`https://pubmed.ncbi.nlm.nih.gov/${resource.pubmed_id}/`} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">PMID <Tags class="h-3.5 w-3.5" /></a>
												{/if}
											</div>
										</div>
									{/if}
								</div>
							</article>
						{/each}
					</div>
				{:else}
					<div class="rounded-[1.25rem] border border-border/60 bg-card px-6 py-14 text-center text-muted-foreground shadow-sm">
						No resources matched the current search and filter settings.
					</div>
				{/if}
			</section>
		</div>
	</div>
</div>
