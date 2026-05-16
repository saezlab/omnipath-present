import type { RequestHandler } from "./$types";
import { getScopedRelationFacetCounts } from "$lib/server/queries/relation";
import { getEntitiesByPublicIds } from "$lib/server/queries/entity";
import { json } from "@sveltejs/kit";

function parseNumericIds(values: Array<string | number> | undefined): { numeric: number[]; nonNumeric: string[] } {
  const numeric: number[] = [];
  const nonNumeric: string[] = [];
  const seenNumeric = new Set<number>();
  const seenNonNumeric = new Set<string>();

  for (const value of values || []) {
    const text = String(value).trim();
    if (!text) continue;
    const parsed = Number(text);
    if (Number.isInteger(parsed)) {
      if (!seenNumeric.has(parsed)) {
        seenNumeric.add(parsed);
        numeric.push(parsed);
      }
    } else if (!seenNonNumeric.has(text)) {
      seenNonNumeric.add(text);
      nonNumeric.push(text);
    }
  }

  return { numeric, nonNumeric };
}

async function resolveEntityIds(entityIds?: Array<string | number>): Promise<number[] | undefined> {
  if (!entityIds?.length) return undefined;
  const { numeric, nonNumeric } = parseNumericIds(entityIds);
  if (nonNumeric.length > 0) {
    const resolved = await getEntitiesByPublicIds(nonNumeric);
    const resolvedPks = resolved.map((e) => e.entityPk);
    return Array.from(new Set([...numeric, ...resolvedPks]));
  }
  return numeric.length > 0 ? numeric : undefined;
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
