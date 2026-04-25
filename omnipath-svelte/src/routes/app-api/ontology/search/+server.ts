import type { RequestHandler } from "./$types";
import { searchOntologyTerms } from "$lib/server/queries/ontology-term";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get("q") || "";
  const prefixesParam = url.searchParams.get("prefixes");
  const prefixes = prefixesParam ? prefixesParam.split(",") : undefined;
  const limit = Number(url.searchParams.get("limit") || "24");
  const offset = Number(url.searchParams.get("offset") || "0");

  const result = await searchOntologyTerms({
    query,
    prefixes,
    limit: Number.isFinite(limit) ? limit : 24,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  return jsonBigIntSafe(result);
};
