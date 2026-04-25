import type { RequestHandler } from "./$types";
import { searchScopedOntologyTerms } from "$lib/server/queries/ontology-term";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get("q") || "";
  const entityIdsParam = url.searchParams.get("entityIds");
  const entityIds = entityIdsParam ? entityIdsParam.split(",") : [];
  const prefixesParam = url.searchParams.get("prefixes");
  const prefixes = prefixesParam ? prefixesParam.split(",") : undefined;
  const limit = Number(url.searchParams.get("limit") || "24");
  const offset = Number(url.searchParams.get("offset") || "0");

  const result = await searchScopedOntologyTerms({
    entityIds,
    query,
    prefixes,
    limit: Number.isFinite(limit) ? limit : 24,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  return jsonBigIntSafe(result);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    entityIds?: string[];
    query?: string;
    prefixes?: string[];
    limit?: number;
    offset?: number;
  };

  const result = await searchScopedOntologyTerms({
    entityIds: body.entityIds || [],
    query: body.query || "",
    prefixes: body.prefixes,
    limit: body.limit ?? 24,
    offset: body.offset ?? 0,
  });

  return jsonBigIntSafe(result);
};
