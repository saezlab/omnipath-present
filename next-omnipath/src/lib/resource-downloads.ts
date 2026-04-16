function parseFileName(contentDisposition: string | null, fallback: string): string {
  const fileNameMatch = contentDisposition?.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
  if (!fileNameMatch?.[1]) return fallback;

  try {
    return decodeURIComponent(fileNameMatch[1]);
  } catch {
    return fileNameMatch[1];
  }
}

async function triggerBrowserDownload(response: Response, fallbackName: string) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Download failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = parseFileName(response.headers.get("Content-Disposition"), fallbackName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

export async function downloadResourceSelection(resourceIds: string[]) {
  const response = await fetch("/api/resources/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource_ids: resourceIds }),
    cache: "no-store",
  });

  await triggerBrowserDownload(response, "resources.zip");
}
