import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getRelationByPk } from "$lib/server/queries/relation";
import { getEntitiesByPks } from "$lib/server/queries/entity";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const GET: RequestHandler = async ({ params }) => {
  const relationPk = String(params.id || "").trim();

  if (!relationPk) {
    error(400, "Invalid relation ID");
  }

  const relation = await getRelationByPk(relationPk);
  if (!relation) {
    error(404, "Relation not found");
  }

  const entities = await getEntitiesByPks([relation.subjectEntityPk, relation.objectEntityPk]);
  const entityByPk = new Map(entities.map((e) => [e.entityPk, e]));

  return jsonBigIntSafe({
    relation,
    subjectEntity: entityByPk.get(relation.subjectEntityPk) ?? null,
    objectEntity: entityByPk.get(relation.objectEntityPk) ?? null,
  });
};
