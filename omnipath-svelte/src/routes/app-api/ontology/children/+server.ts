import type { RequestHandler } from "./$types";
import { getOntologyChildren } from "$lib/server/queries/ontology-term";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const GET: RequestHandler = async ({ url }) => {
  const termId = url.searchParams.get("termId")?.trim() || "";
  const ontologyId = url.searchParams.get("ontologyId")?.trim() || null;
  const limitParam = Number(url.searchParams.get("limit") || "200");
  const limit = Number.isFinite(limitParam) ? limitParam : 200;
  const children = termId
    ? await getOntologyChildren(termId, ontologyId, limit)
    : [];

  return jsonBigIntSafe({
    termId,
    children,
  });
};
