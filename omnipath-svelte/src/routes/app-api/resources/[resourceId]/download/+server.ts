import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { API_SERVICE_URL } from "$lib/server/api-config";

export const GET: RequestHandler = async ({ params }) => {
  const resourceId = params.resourceId;
  if (!resourceId?.trim()) {
    error(400, "Invalid resource ID");
  }

  try {
    const upstream = await fetch(`${API_SERVICE_URL}/resources/${encodeURIComponent(resourceId)}/download`);

    if (!upstream.ok) {
      const text = await upstream.text();
      error(upstream.status, text || "Download failed");
    }

    const blob = await upstream.blob();
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/zip",
        "Content-Disposition": upstream.headers.get("Content-Disposition") || `attachment; filename="${resourceId}.zip"`,
      },
    });
  } catch (e) {
    console.error("Resource download failed", e);
    error(500, "Download failed");
  }
};