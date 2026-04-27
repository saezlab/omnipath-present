import type { RequestHandler } from "./$types";
import { getScopedOntologyPrefixCounts } from "$lib/server/queries/ontology-term";
import { json } from "@sveltejs/kit";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    entityPks?: number[];
    annotationTermIds?: string[];
    query?: string;
  };

  const counts = await getScopedOntologyPrefixCounts({
    entityPks: body.entityPks || [],
    annotationTermIds: body.annotationTermIds || [],
    query: body.query || "",
  });

  return json(counts);
};
