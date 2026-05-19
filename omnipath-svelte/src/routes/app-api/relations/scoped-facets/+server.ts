import type { RequestHandler } from "./$types";
import { getScopedRelationFacetCounts } from "$lib/server/queries/relation";
import { getEntitiesByPublicIds } from "$lib/server/queries/entity";
import { json } from "@sveltejs/kit";

function splitEntityIds(values: Array<string | number> | undefined): { ids: string[]; publicIds: string[] } {
  const ids: string[] = [];
  const publicIds: string[] = [];
  const seenIds = new Set<string>();
  const seenPublicIds = new Set<string>();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const value of values || []) {
    const text = String(value).trim();
    if (!text) continue;
    if (uuidPattern.test(text)) {
      if (!seenIds.has(text)) {
        seenIds.add(text);
        ids.push(text);
      }
    } else if (!seenPublicIds.has(text)) {
      seenPublicIds.add(text);
      publicIds.push(text);
    }
  }

  return { ids, publicIds };
}

async function resolveEntityIds(entityIds?: Array<string | number>): Promise<string[] | undefined> {
  if (!entityIds?.length) return undefined;
  const { ids, publicIds } = splitEntityIds(entityIds);
  if (publicIds.length > 0) {
    const resolved = await getEntitiesByPublicIds(publicIds);
    const resolvedPks = resolved.map((e) => e.entityPk);
    return Array.from(new Set([...ids, ...resolvedPks]));
  }
  return ids.length > 0 ? ids : undefined;
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    entityIds?: Array<string | number>;
    annotationTermIds?: string[];
    predicates?: string[];
    interactionTypes?: string[];
    sources?: string[];
    taxonomyIds?: string[];
  };

  const entityPks = await resolveEntityIds(body.entityIds);

  const counts = await getScopedRelationFacetCounts({
    entityPks: entityPks || [],
    annotationTermIds: body.annotationTermIds || [],
    predicates: body.predicates || [],
    interactionTypes: body.interactionTypes || [],
    sources: body.sources || [],
    taxonomyIds: body.taxonomyIds || [],
  });

  return json(counts);
};
