import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getRelationFilterOptions } from "$lib/server/queries/relation";

export const GET: RequestHandler = async () => {
  const options = await getRelationFilterOptions();
  return json(options);
};
