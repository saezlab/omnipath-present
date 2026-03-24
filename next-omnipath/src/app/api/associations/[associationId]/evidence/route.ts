import { NextRequest, NextResponse } from "next/server";
import { getApiServiceUrl } from "@/lib/api/config";

interface RouteContext {
  params: Promise<{ associationId: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { associationId } = await context.params;
    const response = await fetch(`${getApiServiceUrl()}/associations/${encodeURIComponent(associationId)}/evidence`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `API service error: ${response.status} ${text}` },
        { status: response.status === 404 ? 404 : 502 },
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
