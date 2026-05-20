import { getPool } from '$lib/server/db/client';

export interface ResourceRecord {
	resource_id: string;
	resource_name: string;
	resource_kind: string | null;
	description: string | null;
	homepage_url: string | null;
	license: string | null;
	pubmed_id: string | null;
	input_module: string | null;
	input_module_commit: string | null;
	input_module_dirty: boolean;
	categories: string[];
	annotation_ontologies: string[];
	entity_count: number;
	interaction_count: number;
	association_count: number;
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
	totalAssociations: number;
	totalIdentifiers: number;
	totalOntologyTerms: number;
	totalBytes: number;
	buildStatusCounts: Record<string, number>;
	categoryCounts: Record<string, number>;
}

function normalizeTextArray(values: unknown): string[] {
	return Array.isArray(values) ? values.map(String).filter(Boolean) : [];
}

function normalizeNumber(value: unknown): number {
	const parsed = Number(value || 0);
	return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString();
	return typeof value === 'string' ? value : null;
}

const SEARCH_SCHEMA = () => process.env.OMNIPATH_PG_SCHEMA || 'public';

export async function listResources(): Promise<ResourceRecord[]> {
	const schema = SEARCH_SCHEMA();
	const client = await getPool().connect();
	try {
		const result = await client.query<Record<string, unknown>>(
			`SELECT
			   resource_id,
			   resource_name,
			   description,
			   homepage_url,
			   license,
			   pubmed_id,
			   resource_kind,
			   input_module,
			   input_module_commit,
			   input_module_dirty,
			   categories,
			   annotation_ontologies,
			   entity_count,
			   interaction_count,
			   association_count,
			   identifier_count,
			   ontology_term_count,
			   total_size_bytes,
			   last_downloaded_at,
			   last_built_at,
			   build_status
			 FROM ${schema}.resources
			 ORDER BY total_size_bytes DESC, resource_id`,
		);

		return result.rows
			.map((row) => ({
				resource_id: String(row.resource_id || ''),
				resource_name: String(row.resource_name || row.resource_id || ''),
				resource_kind: typeof row.resource_kind === 'string' ? row.resource_kind : null,
				description: typeof row.description === 'string' ? row.description : null,
				homepage_url: typeof row.homepage_url === 'string' ? row.homepage_url : null,
				license: typeof row.license === 'string' ? row.license : null,
				pubmed_id: typeof row.pubmed_id === 'string' ? row.pubmed_id : null,
				input_module: typeof row.input_module === 'string' ? row.input_module : null,
				input_module_commit:
					typeof row.input_module_commit === 'string' ? row.input_module_commit : null,
				input_module_dirty: row.input_module_dirty === true,
				categories: normalizeTextArray(row.categories),
				annotation_ontologies: normalizeTextArray(row.annotation_ontologies),
				entity_count: normalizeNumber(row.entity_count),
				interaction_count: normalizeNumber(row.interaction_count),
				association_count: normalizeNumber(row.association_count),
				identifier_count: normalizeNumber(row.identifier_count),
				ontology_term_count: normalizeNumber(row.ontology_term_count),
				total_size_bytes: normalizeNumber(row.total_size_bytes),
				last_downloaded_at: normalizeDate(row.last_downloaded_at),
				last_built_at: normalizeDate(row.last_built_at),
				build_status: typeof row.build_status === 'string' ? row.build_status : null
			}))
			.filter((row: ResourceRecord) => row.resource_id);
	} finally {
		client.release();
	}
}

export function summarizeResources(resources: ResourceRecord[]): ResourcesSummary {
	const buildStatusCounts = new Map<string, number>();
	const categoryCounts = new Map<string, number>();

	let totalEntities = 0;
	let totalInteractions = 0;
	let totalAssociations = 0;
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
		totalAssociations += resource.association_count || 0;
		totalIdentifiers += resource.identifier_count || 0;
		totalOntologyTerms += resource.ontology_term_count || 0;
		totalBytes += resource.total_size_bytes || 0;
	}

	return {
		totalResources: resources.length,
		totalEntities,
		totalInteractions,
		totalAssociations,
		totalIdentifiers,
		totalOntologyTerms,
		totalBytes,
		buildStatusCounts: Object.fromEntries(buildStatusCounts),
		categoryCounts: Object.fromEntries(categoryCounts)
	};
}
