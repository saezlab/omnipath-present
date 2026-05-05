<script lang="ts">
	import { Check, Copy, Download, FileText, Sparkles } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let copiedSkill = $state<string | null>(null);

	async function copySkill(name: string, content: string) {
		try {
			await navigator.clipboard.writeText(content);
			copiedSkill = name;
			toast.success('Skill copied to clipboard');
			window.setTimeout(() => {
				if (copiedSkill === name) copiedSkill = null;
			}, 1800);
		} catch (error) {
			toast.error('Could not copy skill');
		}
	}
</script>

<svelte:head>
	<title>OmniPath Skills</title>
	<meta
		name="description"
		content="Download or copy OmniPath coding-agent skills for subset exports and resource zip workflows."
	/>
</svelte:head>

<div class="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 md:px-6">
	<div class="grid gap-5">
		{#each data.skills as skill}
			<article class="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
				<div class="flex flex-col gap-4 border-b bg-muted/20 p-5 md:flex-row md:items-start md:justify-between">
					<div class="flex gap-3">
						<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
							<FileText class="h-5 w-5" />
						</div>
						<div class="min-w-0 space-y-1">
							<h2 class="text-xl font-semibold">{skill.title}</h2>
							<p class="break-all font-mono text-xs text-muted-foreground">{skill.name}/SKILL.md</p>
							<p class="max-w-3xl text-sm text-muted-foreground">{skill.description}</p>
						</div>
					</div>

					<div class="flex shrink-0 flex-wrap gap-2">
						<Button variant="outline" size="sm" onclick={() => copySkill(skill.name, skill.content)}>
							{#if copiedSkill === skill.name}
								<Check class="h-4 w-4" />
								Copied
							{:else}
								<Copy class="h-4 w-4" />
								Copy
							{/if}
						</Button>
						<Button variant="default" size="sm" href={skill.href} download="SKILL.md">
							<Download class="h-4 w-4" />
							Download
						</Button>
					</div>
				</div>

				<div class="max-h-[34rem] overflow-auto bg-zinc-950 p-5 text-zinc-100">
					<pre class="whitespace-pre-wrap break-words text-xs leading-relaxed"><code>{skill.content}</code></pre>
				</div>
			</article>
		{/each}
	</div>
</div>
