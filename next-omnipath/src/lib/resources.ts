import { getApiServiceUrl } from "@/lib/api/config";

export interface ResourceRecord {
  resource_id: string;
  resource_name: string;
  description: string | null;
  homepage_url: string | null;
  license: string | null;
  pubmed_id: string | null;
  categories: string[];
  annotation_ontologies: string[];
  entity_count: number;
  interaction_count: number;
  association_count: number;
  annotation_count: number;
  identifier_count: number;
  ontology_term_count: number;
  total_size_bytes: number;
  download_archive_exists: boolean;
  download_archive_name: string | null;
  download_archive_size_bytes: number | null;
  last_downloaded_at: string | null;
  last_built_at: string | null;
  build_status: string | null;
}

export async function getResources(): Promise<ResourceRecord[]> {
  const apiServiceUrl = getApiServiceUrl();
  const response = await fetch(`${apiServiceUrl}/resources`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API resources error: ${response.status} ${text}`);
  }

  const rows = await response.json() as ResourceRecord[];
  return rows.sort((a, b) => a.resource_name.localeCompare(b.resource_name));
}

export function summarizeResources(resources: ResourceRecord[]) {
  const buildStatusCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  let totalEntities = 0;
  let totalInteractions = 0;
  let totalAssociations = 0;
  let totalAnnotations = 0;
  let totalIdentifiers = 0;
  let totalOntologyTerms = 0;
  let totalBytes = 0;

  for (const resource of resources) {
    const status = resource.build_status || "unknown";
    buildStatusCounts.set(status, (buildStatusCounts.get(status) || 0) + 1);

    for (const category of resource.categories || []) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }

    totalEntities += resource.entity_count || 0;
    totalInteractions += resource.interaction_count || 0;
    totalAssociations += resource.association_count || 0;
    totalAnnotations += resource.annotation_count || 0;
    totalIdentifiers += resource.identifier_count || 0;
    totalOntologyTerms += resource.ontology_term_count || 0;
    totalBytes += resource.total_size_bytes || 0;
  }

  return {
    totalResources: resources.length,
    totalEntities,
    totalInteractions,
    totalAssociations,
    totalAnnotations,
    totalIdentifiers,
    totalOntologyTerms,
    totalBytes,
    buildStatusCounts: Object.fromEntries(buildStatusCounts),
    categoryCounts: Object.fromEntries(categoryCounts),
  };
}
