import { NextRequest, NextResponse } from "next/server";
import { getApiServiceUrl } from "@/lib/api/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: NextRequest, context: { params: Promise<{ resourceId: string }> }) {
  try {
    const { resourceId } = await context.params;
    const apiServiceUrl = getApiServiceUrl();
    const upstream = await fetch(`${apiServiceUrl}/resources/${encodeURIComponent(resourceId)}/download`, {
      cache: "no-store",
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json({ error: `API resource download error: ${upstream.status} ${text}` }, { status: 502 });
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/octet-stream");
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");

    const contentDisposition = upstream.headers.get("Content-Disposition");
    if (contentDisposition) headers.set("Content-Disposition", contentDisposition);

    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
