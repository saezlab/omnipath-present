<script lang="ts">
	import { getIdentifierTypeLabel } from '$lib/entities/display';

	interface Props {
		identifierType: string;
		value: string;
		variant?: 'default' | 'subtle' | 'compact';
		class?: string;
	}

	let { identifierType, value, variant = 'default', class: className = '' }: Props = $props();

	const typeLabel = $derived(getIdentifierTypeLabel(identifierType));
	const rootClass = $derived(
		variant === 'compact'
			? 'inline-flex max-w-full items-center overflow-hidden rounded-md border border-border/80 bg-background/70 text-[10px] leading-none shadow-sm'
			: variant === 'subtle'
				? 'inline-flex max-w-full items-center overflow-hidden rounded-lg border border-border/70 bg-muted/30 text-xs shadow-sm'
				: 'inline-flex max-w-full items-center overflow-hidden rounded-lg border border-border bg-card text-xs shadow-sm'
	);
</script>

<span class={`${rootClass} ${className}`} title={`${typeLabel}: ${value}`}>
	<span class="shrink-0 border-r border-border/70 bg-muted/60 px-2 py-1 font-medium text-muted-foreground">
		{typeLabel}
	</span>
	<span class="min-w-0 truncate px-2 py-1 font-mono text-foreground">
		{value}
	</span>
</span>
