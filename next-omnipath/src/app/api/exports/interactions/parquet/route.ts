import { NextRequest, NextResponse } from "next/server";
import { getApiServiceUrl } from "@/lib/api/config";

interface ExportRequestPayload {
  query?: string;
  filters?: Record<string, unknown>;
  filename?: string;
}

function parseGetPayload(req: NextRequest): ExportRequestPayload {
  const query = req.nextUrl.searchParams.get("query") || "";
  const filename = req.nextUrl.searchParams.get("filename") || undefined;
  const filtersRaw = req.nextUrl.searchParams.get("filters");

  let filters: Record<string, unknown> = {};
  if (filtersRaw) {
    filters = JSON.parse(filtersRaw) as Record<string, unknown>;
  }

  return { query, filename, filters };
}

async function forwardExport(payload: ExportRequestPayload) {
  const apiServiceUrl = getApiServiceUrl();
  const upstream = await fetch(`${apiServiceUrl}/exports/interactions/parquet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: payload.query || "",
      filters: payload.filters || {},
      filename: payload.filename,
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return NextResponse.json(
      { error: `API export error: ${upstream.status} ${text}` },
      { status: 502 }
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/x-parquet");
  const contentDisposition = upstream.headers.get("Content-Disposition");
  if (contentDisposition) headers.set("Content-Disposition", contentDisposition);
  const rowCount = upstream.headers.get("X-Export-Row-Count");
  if (rowCount) headers.set("X-Export-Row-Count", rowCount);
  const durationMs = upstream.headers.get("X-Export-Duration-Ms");
  if (durationMs) headers.set("X-Export-Duration-Ms", durationMs);

  return new NextResponse(upstream.body, { status: 200, headers });
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as ExportRequestPayload;
    return await forwardExport(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const payload = parseGetPayload(req);
    return await forwardExport(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
