import type { RequestHandler } from "./$types";
import { searchScopedOntologyTerms } from "$lib/server/queries/ontology-term";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get("q") || "";
  const entityPksParam = url.searchParams.get("entityPks");
  const entityPks = entityPksParam ? entityPksParam.split(",").map((value) => value.trim()).filter(Boolean) : [];
  const termIdsParam = url.searchParams.get("termIds");
  const termIds = termIdsParam ? termIdsParam.split(",") : [];
  const prefixesParam = url.searchParams.get("prefixes");
  const prefixes = prefixesParam ? prefixesParam.split(",") : undefined;
  const ontologyIdsParam = url.searchParams.get("ontologyIds");
  const ontologyIds = ontologyIdsParam ? ontologyIdsParam.split(",") : undefined;
  const limit = Number(url.searchParams.get("limit") || "24");
  const offset = Number(url.searchParams.get("offset") || "0");

  const result = await searchScopedOntologyTerms({
    entityPks,
    termIds,
    query,
    prefixes,
    ontologyIds,
    limit: Number.isFinite(limit) ? limit : 24,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  return jsonBigIntSafe(result);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    entityPks?: Array<string | number>;
    termIds?: string[];
    selectionScope?: {
      entityPks?: Array<string | number>;
      annotationTermIds?: string[];
      includeAssociatedEntities?: boolean;
      includeMembersParticipants?: boolean;
      mode?: "union" | "intersection";
    };
    query?: string;
    prefixes?: string[];
    ontologyIds?: string[];
    limit?: number;
    offset?: number;
  };

  const result = await searchScopedOntologyTerms({
    entityPks: body.entityPks || [],
    termIds: body.termIds || [],
    selectionScope: body.selectionScope,
    query: body.query || "",
    prefixes: body.prefixes,
    ontologyIds: body.ontologyIds,
    limit: body.limit ?? 24,
    offset: body.offset ?? 0,
  });

  return jsonBigIntSafe(result);
};
