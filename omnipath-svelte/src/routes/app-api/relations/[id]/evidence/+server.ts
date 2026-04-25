import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getEvidenceByRelationPk } from "$lib/server/queries/relation-evidence";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const GET: RequestHandler = async ({ params }) => {
  const relationPk = Number(params.id);

  if (!Number.isFinite(relationPk)) {
    error(400, "Invalid relation ID");
  }

  const evidence = await getEvidenceByRelationPk(relationPk);
  return jsonBigIntSafe({ evidence });
};
