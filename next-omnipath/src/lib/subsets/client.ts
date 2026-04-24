import type { EntitySubsetFilters, InteractionSubsetFilters, RelationSubsetFilters, SubsetArtifact, SubsetMaterializeRequest, SubsetResource } from "@/types/subsets";

interface MaterializeSubsetProgress {
  stage: "requesting" | "downloading" | "complete";
  loadedBytes: number;
  totalBytes?: number;
  progressPercent?: number;
}

interface MaterializeSubsetOptions {
  onProgress?: (progress: MaterializeSubsetProgress) => void;
}

function getExportRoute(resource: SubsetResource): string {
  return `/api/exports/${resource}/parquet`;
}

function getDefaultFileName(resource: SubsetResource): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${resource}_subset_${stamp}.parquet`;
}

async function readResponseBlob(
  response: Response,
  onProgress?: (progress: MaterializeSubsetProgress) => void,
): Promise<Blob> {
  const totalBytesHeader = response.headers.get("Content-Length");
  const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : undefined;

  if (!response.body) {
    const blob = await response.blob();
    onProgress?.({
      stage: "complete",
      loadedBytes: blob.size,
      totalBytes,
      progressPercent: totalBytes ? 100 : undefined,
    });
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let loadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    chunks.push(value.slice().buffer as ArrayBuffer);
    loadedBytes += value.byteLength;
    onProgress?.({
      stage: "downloading",
      loadedBytes,
      totalBytes,
      progressPercent: totalBytes && totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : undefined,
    });
  }

  const blob = new Blob(chunks, {
    type: response.headers.get("Content-Type") || "application/x-parquet",
  });

  onProgress?.({
    stage: "complete",
    loadedBytes,
    totalBytes,
    progressPercent: totalBytes ? 100 : undefined,
  });

  return blob;
}

export async function materializeSubset<TFilters extends object>(
  request: SubsetMaterializeRequest<TFilters>,
  options: MaterializeSubsetOptions = {},
): Promise<SubsetArtifact> {
  options.onProgress?.({ stage: "requesting", loadedBytes: 0 });

  const response = await fetch(getExportRoute(request.resource), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: request.query || "",
      filters: request.filters || {},
      filename: request.filename,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to materialize ${request.resource} subset: ${response.status} ${text}`);
  }

  const blob = await readResponseBlob(response, options.onProgress);
  const objectUrl = URL.createObjectURL(blob);
  const contentDisposition = response.headers.get("Content-Disposition");
  const fileNameMatch = contentDisposition?.match(/filename="?([^\";]+)"?/i);

  return {
    resource: request.resource,
    blob,
    objectUrl,
    fileName: fileNameMatch?.[1] || request.filename || getDefaultFileName(request.resource),
    rowCount: parseOptionalNumber(response.headers.get("X-Export-Row-Count")),
    durationMs: parseOptionalNumber(response.headers.get("X-Export-Duration-Ms")),
  };
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function materializeRelationsSubset(
  filters: RelationSubsetFilters,
  query = "",
  options?: MaterializeSubsetOptions,
) {
  return materializeSubset<RelationSubsetFilters>(
    {
      resource: "relations",
      query,
      filters,
      filename: getDefaultFileName("relations"),
    },
    options,
  );
}

export async function materializeInteractionsSubset(
  filters: InteractionSubsetFilters,
  query = "",
  options?: MaterializeSubsetOptions,
) {
  return materializeRelationsSubset(
    {
      ...filters,
      relation_categories: filters.relation_categories?.length ? filters.relation_categories : ["interaction"],
    },
    query,
    options,
  );
}

export async function materializeEntitiesSubset(
  filters: EntitySubsetFilters,
  query = "",
  options?: MaterializeSubsetOptions,
) {
  return materializeSubset<EntitySubsetFilters>(
    {
      resource: "entities",
      query,
      filters,
      filename: getDefaultFileName("entities"),
    },
    options,
  );
}
