import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getEntityIdsForAnnotationTerms } from "$lib/server/queries/ontology-term";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { termIds?: string[] };
  const termIds = body.termIds || [];
  const entityIds = await getEntityIdsForAnnotationTerms(termIds);
  return json({ entityIds });
};
