import { NextResponse } from "next/server";

import { getEvidenceByRelationPk } from "@/lib/queries/relation-evidence";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const relationPk = Number(id);

  if (!Number.isFinite(relationPk)) {
    return NextResponse.json({ error: "Invalid relation ID" }, { status: 400 });
  }

  const evidence = await getEvidenceByRelationPk(relationPk);
  return NextResponse.json({ evidence });
}
