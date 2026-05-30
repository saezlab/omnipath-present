import type { RequestHandler } from "./$types";
import { getOntologyHierarchyTree } from "$lib/server/queries/ontology-term";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    term_ids?: unknown;
    termIds?: unknown;
    ontologyId?: unknown;
  };
  const rawTermIds = Array.isArray(body.term_ids)
    ? body.term_ids
    : Array.isArray(body.termIds)
      ? body.termIds
      : [];
  const termId = rawTermIds.length > 0 ? String(rawTermIds[0]).trim() : "";
  const ontologyId =
    typeof body.ontologyId === "string" && body.ontologyId.trim()
      ? body.ontologyId.trim()
      : null;

  const root = termId
    ? await getOntologyHierarchyTree(termId, ontologyId)
    : null;
  return jsonBigIntSafe({ root });
};
