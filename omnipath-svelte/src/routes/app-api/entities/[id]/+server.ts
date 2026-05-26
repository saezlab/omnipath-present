import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getEntityDetails } from "$lib/server/queries/entity-details";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const GET: RequestHandler = async ({ params, url }) => {
  const publicId = params.id;
  if (!publicId?.trim()) {
    error(400, "Invalid entity ID");
  }

  const identifierLimit = Number(url.searchParams.get("identifierLimit") || "20");
  const details = await getEntityDetails(publicId, {
    identifierLimit: Number.isFinite(identifierLimit) ? identifierLimit : 20,
  });
  if (!details) {
    error(404, "Entity not found");
  }

  return jsonBigIntSafe(details);
};
