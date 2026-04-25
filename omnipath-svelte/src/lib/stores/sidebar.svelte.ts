import type { Snippet } from 'svelte';

let sidebarContent = $state<Snippet | null>(null);

export function useSidebarContent() {
	return {
		get content() {
			return sidebarContent;
		},
		setContent(content: Snippet | null) {
			sidebarContent = content;
		},
		clear() {
			sidebarContent = null;
		}
	};
}
