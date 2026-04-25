import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getEntityDetails } from "$lib/server/queries/entity-details";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const GET: RequestHandler = async ({ params }) => {
  const publicId = params.id;
  if (!publicId?.trim()) {
    error(400, "Invalid entity ID");
  }

  const details = await getEntityDetails(publicId);
  if (!details) {
    error(404, "Entity not found");
  }

  return jsonBigIntSafe(details);
};
