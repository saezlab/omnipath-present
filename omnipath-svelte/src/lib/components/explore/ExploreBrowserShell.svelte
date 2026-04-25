<script lang="ts">
	import { Search } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs/index.js';

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

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			onSubmitSearch();
		}
	}
</script>

<div class="relative mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 overflow-hidden px-4 py-4 md:px-6 md:py-5">
	<div class="shrink-0 space-y-3">
		<div class="rounded-[1.4rem] border bg-card p-2.5 shadow-sm">
			<div class="flex flex-col gap-2.5 lg:flex-row lg:items-center">
				<div class="relative min-w-0 flex-1">
					<Search class="absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						type="search"
						bind:ref={searchInputRef}
						value={draftQuery}
						oninput={(e) => onDraftQueryChange(e.currentTarget.value)}
						onkeydown={handleKeyDown}
						placeholder={searchPlaceholder}
						class="h-11 rounded-[1rem] border-0 bg-muted/40 pl-10 text-sm shadow-none sm:text-base"
					/>
				</div>

				<div class="flex items-center gap-2 lg:shrink-0">
					{#if showSpeciesPicker && onSpeciesChange}
						<select
							value={species}
							onchange={(e) => onSpeciesChange(e.currentTarget.value || null)}
							class="h-9 rounded-lg border bg-background px-3 text-sm"
						>
							{#each speciesOptions as option}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					{/if}
					<Button onclick={onSubmitSearch} class="h-9 rounded-lg px-3.5 text-sm">Search</Button>
				</div>
			</div>

			<div class="mt-2.5 flex items-center justify-between gap-3">
				<Tabs value={tab} onValueChange={(value) => onTabChange(value)} class="min-w-0 flex-1">
					<TabsList class="grid h-auto w-full grid-cols-3 rounded-xl bg-muted/60 p-1">
						{#each tabs as item}
							<TabsTrigger value={item.value} class="rounded-lg text-sm">
								<span class="flex items-center gap-2">
									<span>{item.label}</span>
									{#if item.badge}
										<span class="text-xs text-muted-foreground">({item.badge})</span>
									{/if}
								</span>
							</TabsTrigger>
						{/each}
					</TabsList>
				</Tabs>
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
