<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';
	import AppSidebar from '$lib/components/layout/AppSidebar.svelte';
	import { SidebarProvider } from '$lib/components/ui/sidebar/index.js';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/omnipath-logo-gradient.svg" />
	<title>OmniPath Explorer</title>
	<meta
		name="description"
		content="Explore molecular interactions, pathways, and biological annotations"
	/>
</svelte:head>

<ModeWatcher defaultMode="system" />
<SidebarProvider open class="h-full overflow-hidden">
	<AppSidebar />
	<main class="flex min-h-0 h-full w-full flex-1 overflow-hidden">
		{@render children()}
	</main>
</SidebarProvider>
<Toaster richColors />
