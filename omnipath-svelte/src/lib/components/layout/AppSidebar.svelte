<script lang="ts">
	import { page } from '$app/state';
	import { mode, setMode } from 'mode-watcher';
	import { Database, ExternalLink, ListChecks, MessageSquare, Moon, Search, Sun } from '@lucide/svelte';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import {
		Sidebar,
		SidebarContent,
		SidebarFooter,
		SidebarGroup,
		SidebarGroupContent,
		SidebarHeader,
		SidebarMenu,
		SidebarMenuBadge,
		SidebarMenuButton,
		SidebarMenuItem,
		SidebarRail,
		SidebarSeparator
	} from '$lib/components/ui/sidebar/index.js';
	import { useSidebarContent } from '$lib/stores/sidebar.svelte.js';

	const navigationItems = [
		{ title: 'Explore', url: '/explore', icon: Search },
		{ title: 'Selection', url: '/selection', icon: ListChecks },
		{ title: 'Resources', url: '/resources', icon: Database },
		{ title: 'API Docs', url: '/api/docs', icon: ExternalLink, external: true }
	];

	const sidebarContent = useSidebarContent();
	let darkMode = $state(false);

	$effect(() => {
		darkMode = mode.current === 'dark';
	});

	function isPathActive(url: string) {
		return page.url.pathname === url || page.url.pathname.startsWith(`${url}/`);
	}
</script>

<Sidebar>
	<SidebarHeader class="border-b">
		<SidebarMenu>
			<SidebarMenuItem>
				<SidebarMenuButton size="lg">
					{#snippet child({ props })}
						<a href="/explore" class="flex items-center gap-2" {...props}>
							<img src="/omnipath-logo-gradient.svg" alt="OmniPath Logo" width="40" height="40" />
							<div class="grid flex-1 text-left text-sm leading-tight">
								<span class="truncate bg-gradient-to-r from-[#007B7F] via-[#6EA945] to-[#FCCC06] bg-clip-text text-lg font-bold text-transparent">
									OmniPath
								</span>
							</div>
						</a>
					{/snippet}
				</SidebarMenuButton>
			</SidebarMenuItem>
		</SidebarMenu>
	</SidebarHeader>

	<SidebarContent>
		<SidebarGroup class="px-2">
			<SidebarGroupContent>
				<SidebarMenu>
					{#each navigationItems as item (item.title)}
						<SidebarMenuItem>
							<SidebarMenuButton isActive={isPathActive(item.url)}>
								{#snippet child({ props })}
									<a
										href={item.url}
										target={item.external ? '_blank' : undefined}
										rel={item.external ? 'noopener noreferrer' : undefined}
										{...props}
									>
										<item.icon class="h-5 w-5" />
										<span>{item.title}</span>
									</a>
								{/snippet}
							</SidebarMenuButton>
						</SidebarMenuItem>
					{/each}
					<SidebarMenuItem>
						<SidebarMenuButton class="opacity-60" aria-disabled="true">
							<MessageSquare class="h-5 w-5" />
							<span>AI Assistant</span>
						</SidebarMenuButton>
						<SidebarMenuBadge class="text-[10px]">Soon</SidebarMenuBadge>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>

		{#if (page.url.pathname === '/selection' || page.url.pathname.startsWith('/explore') || page.url.pathname === '/resources') && sidebarContent.content}
			<div class="px-3">
				<SidebarSeparator />
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
				{@render sidebarContent.content()}
			</div>
		{/if}
	</SidebarContent>

	<SidebarFooter class="border-t">
		<div class="flex items-center justify-center px-4 py-2">
			<div class="flex items-center gap-3">
				<div class="flex items-center gap-1">
					<Sun class="h-3 w-3 text-muted-foreground" />
					<span class="text-xs font-medium text-muted-foreground">Light</span>
				</div>
				<Switch
					checked={darkMode}
					onCheckedChange={(checked) => setMode(checked ? 'dark' : 'light')}
					class="data-[state=checked]:bg-primary"
				/>
				<div class="flex items-center gap-1">
					<span class="text-xs font-medium text-muted-foreground">Dark</span>
					<Moon class="h-3 w-3 text-muted-foreground" />
				</div>
			</div>
		</div>
	</SidebarFooter>
	<SidebarRail />
</Sidebar>
