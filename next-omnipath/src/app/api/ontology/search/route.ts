import { NextRequest, NextResponse } from "next/server";
import { getApiServiceUrl } from "@/lib/api/config";

interface TermSearchRequestPayload {
  queries?: string[];
  prefixes?: string[];
  limit?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TermSearchRequestPayload;
    const queries = (body.queries || []).map((query) => query.trim()).filter((query) => query.length > 0);
    const prefixes = (body.prefixes || []).map((prefix) => prefix.trim()).filter((prefix) => prefix.length > 0);
    const limit = typeof body.limit === "number" ? body.limit : 20;

    if (queries.length === 0) {
      return NextResponse.json({ error: "No queries provided" }, { status: 400 });
    }

    const response = await fetch(`${getApiServiceUrl()}/terms/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries, prefixes, limit }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `API service error: ${response.status} ${text}` },
        { status: 502 },
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
