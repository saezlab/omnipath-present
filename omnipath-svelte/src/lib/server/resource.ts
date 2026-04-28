import { asc } from 'drizzle-orm';
import { resources } from '$lib/drizzle';
import { getDb } from '$lib/server/db/client';

export interface ResourceRecord {
	resource_id: string;
	resource_name: string;
	resource_kind: string | null;
	description: string | null;
	homepage_url: string | null;
	license: string | null;
	pubmed_id: string | null;
	categories: string[];
	annotation_ontologies: string[];
	entity_count: number;
	interaction_count: number;
	membership_count: number;
	annotation_count: number;
	identifier_count: number;
	ontology_term_count: number;
	total_size_bytes: number;
	last_downloaded_at: string | null;
	last_built_at: string | null;
	build_status: string | null;
}

export interface ResourcesSummary {
	totalResources: number;
	totalEntities: number;
	totalInteractions: number;
	totalMemberships: number;
	totalAnnotations: number;
	totalIdentifiers: number;
	totalOntologyTerms: number;
	totalBytes: number;
	buildStatusCounts: Record<string, number>;
	categoryCounts: Record<string, number>;
}

function normalizeTextArray(values: string[] | null | undefined): string[] {
	return (values || []).filter(Boolean);
}

export async function listResources(): Promise<ResourceRecord[]> {
	const db = getDb();
	const rows = await db.select().from(resources).orderBy(asc(resources.resourceName), asc(resources.resourceId));

	return rows.map((row) => ({
		resource_id: row.resourceId,
		resource_name: row.resourceName || row.resourceId,
		resource_kind: row.resourceKind,
		description: row.description,
		homepage_url: row.homepageUrl,
		license: row.license,
		pubmed_id: row.pubmedId,
		categories: normalizeTextArray(row.categories),
		annotation_ontologies: normalizeTextArray(row.annotationOntologies),
		entity_count: row.entityCount || 0,
		interaction_count: row.interactionCount || 0,
		membership_count: row.membershipCount || 0,
		annotation_count: row.annotationCount || 0,
		identifier_count: row.identifierCount || 0,
		ontology_term_count: row.ontologyTermCount || 0,
		total_size_bytes: row.totalSizeBytes || 0,
		last_downloaded_at: row.lastDownloadedAt,
		last_built_at: row.lastBuiltAt,
		build_status: row.buildStatus
	}));
}

export function summarizeResources(resources: ResourceRecord[]): ResourcesSummary {
	const buildStatusCounts = new Map<string, number>();
	const categoryCounts = new Map<string, number>();

	let totalEntities = 0;
	let totalInteractions = 0;
	let totalMemberships = 0;
	let totalAnnotations = 0;
	let totalIdentifiers = 0;
	let totalOntologyTerms = 0;
	let totalBytes = 0;

	for (const resource of resources) {
		const status = resource.build_status || 'unknown';
		buildStatusCounts.set(status, (buildStatusCounts.get(status) || 0) + 1);

		for (const category of resource.categories || []) {
			categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
		}

		totalEntities += resource.entity_count || 0;
		totalInteractions += resource.interaction_count || 0;
		totalMemberships += resource.membership_count || 0;
		totalAnnotations += resource.annotation_count || 0;
		totalIdentifiers += resource.identifier_count || 0;
		totalOntologyTerms += resource.ontology_term_count || 0;
		totalBytes += resource.total_size_bytes || 0;
	}

	return {
		totalResources: resources.length,
		totalEntities,
		totalInteractions,
		totalMemberships,
		totalAnnotations,
		totalIdentifiers,
		totalOntologyTerms,
		totalBytes,
		buildStatusCounts: Object.fromEntries(buildStatusCounts),
		categoryCounts: Object.fromEntries(categoryCounts)
	};
}
