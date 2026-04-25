import type { RequestHandler } from "./$types";
import { resolveEntityIdentifiers } from "$lib/server/queries/entity-identifier";
import { jsonBigIntSafe } from "$lib/server/api-utils";

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { identifiers?: unknown };
  const identifiers = Array.isArray(body.identifiers) ? body.identifiers.map(String) : [];

  const result = await resolveEntityIdentifiers(identifiers);
  return jsonBigIntSafe(result);
};
