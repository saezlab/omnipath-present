import type { RequestHandler } from "./$types";
import { getEntitiesByPks } from "$lib/server/queries/entity";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { pks?: unknown };
  const pks = Array.isArray(body.pks)
    ? body.pks.map((value) => String(value).trim()).filter(Boolean)
    : [];

  const entities = await getEntitiesByPks(pks);
  return jsonBigIntSafe({ entities });
};
