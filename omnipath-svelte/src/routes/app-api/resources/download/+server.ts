import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { API_SERVICE_URL } from "$lib/server/api-config";

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json()) as { resource_ids?: string[] };
    const resourceIds = body.resource_ids || [];

    const upstream = await fetch(`${API_SERVICE_URL}/resources/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource_ids: resourceIds }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      error(upstream.status, text || "Download failed");
    }

    const blob = await upstream.blob();
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/zip",
        "Content-Disposition": upstream.headers.get("Content-Disposition") || 'attachment; filename="resources.zip"',
      },
    });
  } catch (e) {
    console.error("Resource download failed", e);
    error(500, "Download failed");
  }
};
