import { listResources, summarizeResources } from '$lib/server/resource';

export async function load() {
	const resources = await listResources();
	return {
		resources,
		summary: summarizeResources(resources)
	};
}
