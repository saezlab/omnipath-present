import { NextResponse } from "next/server";

import { getRelationByPk } from "@/lib/queries/relation";
import { getEntitiesByPks } from "@/lib/queries/entity";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const relationPk = Number(id);

  if (!Number.isFinite(relationPk)) {
    return NextResponse.json({ error: "Invalid relation ID" }, { status: 400 });
  }

  const relation = await getRelationByPk(relationPk);
  if (!relation) {
    return NextResponse.json({ error: "Relation not found" }, { status: 404 });
  }

  const entities = await getEntitiesByPks([relation.subjectEntityPk, relation.objectEntityPk]);
  const entityByPk = new Map(entities.map((e) => [e.entityPk, e]));

  return NextResponse.json({
    relation,
    subjectEntity: entityByPk.get(relation.subjectEntityPk) ?? null,
    objectEntity: entityByPk.get(relation.objectEntityPk) ?? null,
  });
}
