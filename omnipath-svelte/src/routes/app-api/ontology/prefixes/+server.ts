import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getOntologyPrefixes } from "$lib/server/queries/ontology-term";

export const GET: RequestHandler = async () => {
  const prefixes = await getOntologyPrefixes();
  return json({ prefixes });
};
