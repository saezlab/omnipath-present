import type { RequestHandler } from "./$types";
import { getScopedOntologyIdCounts } from "$lib/server/queries/ontology-term";
import { json } from "@sveltejs/kit";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    entityPks?: Array<string | number>;
    annotationTermIds?: string[];
    selectionScope?: {
      entityPks?: Array<string | number>;
      annotationTermIds?: string[];
      includeAssociatedEntities?: boolean;
      includeMembersParticipants?: boolean;
      mode?: "union" | "intersection";
    };
    query?: string;
  };

  const counts = await getScopedOntologyIdCounts({
    entityPks: body.entityPks || [],
    annotationTermIds: body.annotationTermIds || [],
    selectionScope: body.selectionScope,
    query: body.query || "",
  });

  return json(counts);
};
