<script lang="ts">
	import { ChevronDown, Search } from '@lucide/svelte';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu/index.js';

	interface SpeciesOption {
		value: string;
		label: string;
	}

	interface Props {
		query: string;
		draftQuery: string;
		onDraftQueryChange: (value: string) => void;
		onSubmitSearch: () => void;
		tab: string;
		onTabChange: (tab: string) => void;
		tabs: Array<{ value: string; label: string; badge?: string | number | null }>;
		content: import('svelte').Snippet;
		searchPlaceholder: string;
		searchInputRef?: HTMLInputElement | null;
		species?: string;
		onSpeciesChange?: (value: string | null) => void;
		showSpeciesPicker?: boolean;
		speciesOptions?: readonly SpeciesOption[];
		footerCta?: import('svelte').Snippet;
		summarySlot?: import('svelte').Snippet;
	}

	let {
		draftQuery,
		onDraftQueryChange,
		onSubmitSearch,
		tab,
		onTabChange,
		tabs,
		content,
		searchPlaceholder,
		searchInputRef = $bindable(null),
		species,
		onSpeciesChange,
		showSpeciesPicker = false,
		speciesOptions = [],
		footerCta,
		summarySlot
	}: Props = $props();

	const selectedFilterLabel = $derived(
		showSpeciesPicker
			? (speciesOptions.find((option) => option.value === species)?.label ?? 'Human')
			: 'All'
	);

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			onSubmitSearch();
		}
	}
</script>

<div class="relative mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 overflow-hidden px-4 py-4 md:px-6 md:py-5">
	<div class="shrink-0 space-y-3">
		<div class="w-full">
			<div class="overflow-hidden rounded-2xl border border-border bg-card transition-all">
				<div class="flex h-11 items-center">
					<div class="flex min-w-0 flex-1 items-center gap-3 px-4">
						<Search class="h-5 w-5 shrink-0 text-muted-foreground" />
						<input
							type="text"
							bind:this={searchInputRef}
							value={draftQuery}
							oninput={(e) => onDraftQueryChange(e.currentTarget.value)}
							onkeydown={handleKeyDown}
							placeholder={searchPlaceholder}
							class="min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
						/>
					</div>

					<DropdownMenu>
						<DropdownMenuTrigger class="flex h-11 items-center gap-2 px-4 text-sm text-foreground transition-colors hover:bg-muted/50 focus:outline-none">
							<span>{selectedFilterLabel}</span>
							<ChevronDown class="h-4 w-4 text-muted-foreground" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" class="min-w-[120px]">
							{#if showSpeciesPicker && onSpeciesChange}
								{#each speciesOptions as option}
									<DropdownMenuItem
										onclick={() => onSpeciesChange(option.value)}
										class={option.value === species ? 'bg-accent' : ''}
									>
										{option.label}
									</DropdownMenuItem>
								{/each}
							{:else}
								<DropdownMenuItem class="bg-accent">All</DropdownMenuItem>
							{/if}
						</DropdownMenuContent>
					</DropdownMenu>

					<button
						type="button"
						onclick={onSubmitSearch}
						class="flex h-11 items-center gap-2 bg-primary px-5 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						<Search class="h-4 w-4" />
						<span>Search</span>
					</button>
				</div>

				<div class="flex items-center bg-muted/25">
					{#each tabs as item}
						<button
							type="button"
							onclick={() => onTabChange(item.value)}
							class={`h-11 flex-1 text-sm font-medium capitalize transition-all ${
								tab === item.value
									? 'bg-secondary text-foreground'
									: 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
							}`}
						>
							<span class="inline-flex items-center gap-2">
								<span>{item.label}</span>
								{#if item.badge}
									<span class="text-xs text-muted-foreground">({item.badge})</span>
								{/if}
							</span>
						</button>
					{/each}
				</div>
			</div>
		</div>

		{#if summarySlot}
			{@render summarySlot()}
		{/if}
	</div>

	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		<div class="min-h-0 flex-1 overflow-hidden">
			{@render content()}
		</div>
	</div>

	{#if footerCta}
		{@render footerCta()}
	{/if}
</div>
