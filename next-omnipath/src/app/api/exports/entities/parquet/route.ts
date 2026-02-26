import { NextRequest, NextResponse } from "next/server";
import { getOntologyServiceUrl } from "@/lib/api/config";

interface ExportRequestPayload {
  query?: string;
  filters?: Record<string, unknown>;
  filename?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportRequestPayload;

    const ontologyServiceUrl = getOntologyServiceUrl();
    const upstream = await fetch(`${ontologyServiceUrl}/exports/entities/parquet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: body.query || "",
        filters: body.filters || {},
        filename: body.filename,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `Ontology export error: ${upstream.status} ${text}` },
        { status: 502 }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/x-parquet");
    const contentDisposition = upstream.headers.get("Content-Disposition");
    if (contentDisposition) headers.set("Content-Disposition", contentDisposition);
    const rowCount = upstream.headers.get("X-Export-Row-Count");
    if (rowCount) headers.set("X-Export-Row-Count", rowCount);

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
