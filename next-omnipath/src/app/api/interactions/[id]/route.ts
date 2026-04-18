import { NextResponse } from "next/server";

import { getInteractionDetailsById } from "@/lib/queries";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const interactionId = Number(id);

  if (!Number.isFinite(interactionId)) {
    return NextResponse.json({ error: "Invalid interaction ID" }, { status: 400 });
  }

  const details = await getInteractionDetailsById(interactionId);
  if (!details) {
    return NextResponse.json({ error: "Interaction not found" }, { status: 404 });
  }

  return NextResponse.json(details);
}
