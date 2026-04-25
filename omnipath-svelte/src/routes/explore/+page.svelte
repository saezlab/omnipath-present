<script lang="ts">
	import { Search } from '@lucide/svelte';
</script>

<section class="flex h-full w-full flex-col overflow-auto p-6">
	<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
		<div class="space-y-2">
			<p class="text-sm font-medium text-primary">SvelteKit migration</p>
			<h1 class="text-3xl font-bold tracking-tight">Explore OmniPath</h1>
			<p class="max-w-2xl text-muted-foreground">
				Search shell placeholder for entities, relations, and ontology annotations. Feature tabs will be
				ported in later milestones.
			</p>
		</div>

		<div class="rounded-xl border bg-card p-6 shadow-sm">
			<div class="flex items-center gap-3 rounded-lg border bg-background px-4 py-3 text-muted-foreground">
				<Search class="h-5 w-5" />
				<span>Search OmniPath data…</span>
			</div>
		</div>
	</div>
</section>
