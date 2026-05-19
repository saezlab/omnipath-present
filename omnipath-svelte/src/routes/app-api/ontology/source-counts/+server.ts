import type { RequestHandler } from "./$types";
import { getScopedOntologySourceCounts } from "$lib/server/queries/ontology-term";
import { json } from "@sveltejs/kit";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    entityPks?: Array<string | number>;
    annotationTermIds?: string[];
    query?: string;
  };

  const counts = await getScopedOntologySourceCounts({
    entityPks: body.entityPks || [],
    annotationTermIds: body.annotationTermIds || [],
    query: body.query || "",
  });

  return json(counts);
};
