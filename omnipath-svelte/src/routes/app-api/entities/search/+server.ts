import type { RequestHandler } from "./$types";
import { searchEntities, getEntityFilterOptions } from "$lib/server/queries/entity";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get("q") || "";
  const limit = Number(url.searchParams.get("limit") || "20");
  const cursor = url.searchParams.get("cursor");
  const filtersParam = url.searchParams.get("filters");
  const filters = filtersParam ? JSON.parse(filtersParam) : {};

  const result = await searchEntities({
    query,
    limit: Number.isFinite(limit) ? limit : 20,
    cursor: cursor ? Number(cursor) : undefined,
    filters,
  });

  return jsonBigIntSafe(result);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    query?: string;
    limit?: number;
    cursor?: number;
    filters?: Record<string, unknown>;
  };

  const result = await searchEntities({
    query: body.query || "",
    limit: body.limit ?? 20,
    cursor: body.cursor,
    filters: body.filters || {},
  });

  return jsonBigIntSafe(result);
};
