import { execFileSync } from "node:child_process";
import path from "node:path";

export interface ResourceRecord {
  resource_id: string;
  resource_name: string;
  description: string | null;
  homepage_url: string | null;
  license: string | null;
  pubmed_id: string | null;
  primary_category: string | null;
  top_level_category: string | null;
  supports_interactions?: boolean;
  supports_annotations?: boolean;
  supports_ontology?: boolean;
  data_modalities: string[];
  interaction_participant_types: string[];
  entity_count: number;
  interaction_count: number;
  association_count: number;
  annotation_count: number;
  identifier_count: number;
  ontology_term_count: number;
  total_size_bytes: number;
  last_downloaded_at: string | null;
  last_built_at: string | null;
  build_status: string | null;
}

const OMNIPATH_BUILD_ROOT = path.resolve(process.cwd(), "../../omnipath_build");

const DEFAULT_RESOURCES_PARQUET_PATH = path.join(
  OMNIPATH_BUILD_ROOT,
  "data_v2/gold/resources.parquet",
);

function getResourcesParquetPath(): string {
  return process.env.OMNIPATH_RESOURCES_PARQUET_PATH || DEFAULT_RESOURCES_PARQUET_PATH;
}

function runPythonReader(parquetPath: string): ResourceRecord[] {
  const script = String.raw`
from pathlib import Path
import json
import sys

import polars as pl

parquet_path = Path(sys.argv[1])
if not parquet_path.exists():
    raise FileNotFoundError(f"Resources parquet not found: {parquet_path}")

df = pl.read_parquet(parquet_path)
rows = []
for row in df.to_dicts():
    normalized = {}
    for key, value in row.items():
        if isinstance(value, list):
            normalized[key] = value
        elif value is None:
            normalized[key] = None
        else:
            normalized[key] = value
    rows.append(normalized)

print(json.dumps(rows))
`;

  const stdout = execFileSync("uv", ["run", "--project", OMNIPATH_BUILD_ROOT, "python", "-c", script, parquetPath], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout) as ResourceRecord[];
}

export async function getResources(): Promise<ResourceRecord[]> {
  const parquetPath = getResourcesParquetPath();
  const rows = runPythonReader(parquetPath);

  return rows.sort((a, b) => a.resource_name.localeCompare(b.resource_name));
}

export function summarizeResources(resources: ResourceRecord[]) {
  const buildStatusCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const topLevelCategoryCounts = new Map<string, number>();
  const modalityCounts = new Map<string, number>();

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

    if (resource.primary_category) {
      categoryCounts.set(resource.primary_category, (categoryCounts.get(resource.primary_category) || 0) + 1);
    }

    if (resource.top_level_category) {
      topLevelCategoryCounts.set(resource.top_level_category, (topLevelCategoryCounts.get(resource.top_level_category) || 0) + 1);
    }

    for (const modality of resource.data_modalities || []) {
      modalityCounts.set(modality, (modalityCounts.get(modality) || 0) + 1);
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
    topLevelCategoryCounts: Object.fromEntries(topLevelCategoryCounts),
    modalityCounts: Object.fromEntries(modalityCounts),
  };
}
