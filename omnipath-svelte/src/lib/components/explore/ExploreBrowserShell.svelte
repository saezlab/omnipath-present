<script lang="ts">
	import { Info, Search } from '@lucide/svelte';
	import { getUiPreferences } from '$lib/stores/ui-preferences.svelte';

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
		footerCta?: import('svelte').Snippet;
		summarySlot?: import('svelte').Snippet;
		explanationTitle?: string;
		explanationText?: string;
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
		footerCta,
		summarySlot,
		explanationTitle = '',
		explanationText = ''
	}: Props = $props();

	const uiPreferences = getUiPreferences();

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
											? 'bg-[#FCCC06]/35 text-[#5F4A00] dark:bg-[#A88C32] dark:text-[#1F1A00]'
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

		{#if uiPreferences.showExplanations && explanationText}
			<div class="rounded-lg border bg-muted/25 px-4 py-3">
				<div class="flex gap-3">
					<Info class="mt-0.5 size-4 shrink-0 text-primary" />
					<div class="min-w-0 space-y-1.5">
						{#if explanationTitle}
							<h2 class="text-sm font-semibold leading-5 text-foreground">{explanationTitle}</h2>
						{/if}
						<p class="text-sm leading-6 text-muted-foreground">{explanationText}</p>
					</div>
				</div>
			</div>
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
