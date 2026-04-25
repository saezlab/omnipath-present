import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getEntityFilterOptions } from "$lib/server/queries/entity";

export const GET: RequestHandler = async () => {
  const options = await getEntityFilterOptions();
  return json(options);
};
