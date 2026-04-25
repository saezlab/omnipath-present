import type { RequestHandler } from "./$types";
import { getEntitiesByPublicIds } from "$lib/server/queries/entity";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { publicIds?: unknown };
  const publicIds = Array.isArray(body.publicIds) ? body.publicIds.map(String) : [];

  const entities = await getEntitiesByPublicIds(publicIds);
  return jsonBigIntSafe({ entities });
};
