import type { RequestHandler } from "./$types";
import { searchScopedOntologyTerms } from "$lib/server/queries/ontology-term";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get("q") || "";
  const entityPksParam = url.searchParams.get("entityPks");
  const entityPks = entityPksParam ? entityPksParam.split(",").map(Number).filter(Number.isFinite) : [];
  const termIdsParam = url.searchParams.get("termIds");
  const termIds = termIdsParam ? termIdsParam.split(",") : [];
  const prefixesParam = url.searchParams.get("prefixes");
  const prefixes = prefixesParam ? prefixesParam.split(",") : undefined;
  const limit = Number(url.searchParams.get("limit") || "24");
  const offset = Number(url.searchParams.get("offset") || "0");

  const result = await searchScopedOntologyTerms({
    entityPks,
    termIds,
    query,
    prefixes,
    limit: Number.isFinite(limit) ? limit : 24,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  return jsonBigIntSafe(result);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    entityPks?: number[];
    termIds?: string[];
    query?: string;
    prefixes?: string[];
    limit?: number;
    offset?: number;
  };

  const result = await searchScopedOntologyTerms({
    entityPks: body.entityPks || [],
    termIds: body.termIds || [],
    query: body.query || "",
    prefixes: body.prefixes,
    limit: body.limit ?? 24,
    offset: body.offset ?? 0,
  });

  return jsonBigIntSafe(result);
};
