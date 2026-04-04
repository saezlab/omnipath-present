import type { SubsetArtifact } from "@/types/subsets";

export interface ResourceWorkspaceManifestResource {
  resource_id: string;
  version: string;
  artifacts: string[];
}

export interface ResourceWorkspaceManifest {
  resource_ids: string[];
  resources: ResourceWorkspaceManifestResource[];
  available_artifacts: string[];
}

async function readResponseBlob(response: Response): Promise<Blob> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Download failed with status ${response.status}`);
  }
  return response.blob();
}

function parseFileName(contentDisposition: string | null, fallback: string): string {
  const fileNameMatch = contentDisposition?.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
  if (!fileNameMatch?.[1]) return fallback;

  try {
    return decodeURIComponent(fileNameMatch[1]);
  } catch {
    return fileNameMatch[1];
  }
}

export async function fetchResourceWorkspaceManifest(resourceIds: string[]): Promise<ResourceWorkspaceManifest> {
  const response = await fetch("/api/resources/workspace/manifest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource_ids: resourceIds }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to load resource workspace manifest (${response.status})`);
  }

  return response.json() as Promise<ResourceWorkspaceManifest>;
}

export async function fetchResourceWorkspaceArtifact(resourceId: string, artifactName: string): Promise<SubsetArtifact> {
  const response = await fetch(`/api/resources/${encodeURIComponent(resourceId)}/artifacts/${encodeURIComponent(artifactName)}`, {
    method: "GET",
    cache: "no-store",
  });

  const blob = await readResponseBlob(response);
  const objectUrl = URL.createObjectURL(blob);
  const fallbackName = `${resourceId}_${artifactName}`;

  return {
    resource: artifactName.includes("entity") ? "entities" : artifactName.includes("association") ? "associations" : "interactions",
    blob,
    objectUrl,
    fileName: parseFileName(response.headers.get("Content-Disposition"), fallbackName),
  };
}
