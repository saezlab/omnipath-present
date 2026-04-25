<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';
	import AppSidebar from '$lib/components/layout/AppSidebar.svelte';
	import { SidebarProvider } from '$lib/components/ui/sidebar/index.js';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>OmniPath Explorer</title>
	<meta
		name="description"
		content="Explore molecular interactions, pathways, and biological annotations"
	/>
</svelte:head>

<ModeWatcher defaultMode="system" />
<SidebarProvider open>
	<AppSidebar />
	<main class="flex min-h-0 w-full flex-1 overflow-hidden">
		{@render children()}
	</main>
</SidebarProvider>
<Toaster richColors />
