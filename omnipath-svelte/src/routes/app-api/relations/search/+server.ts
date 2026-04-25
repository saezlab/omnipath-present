import type { RequestHandler } from "./$types";
import { searchRelations, countRelations } from "$lib/server/queries/relation";
import { getEntitiesByPublicIds } from "$lib/server/queries/entity";
import { jsonBigIntSafe } from "$lib/server/api-utils";

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

function mapRelationCategories(categories: unknown): string[] | undefined {
  if (!Array.isArray(categories)) return undefined;
  const valid = new Set(["interaction", "membership", "annotation"]);
  const filtered = categories.filter((c): c is string => typeof c === "string" && valid.has(c));
  return filtered.length > 0 ? filtered : undefined;
}

async function transformClientFilters(filters: Record<string, unknown>): Promise<NonNullable<Parameters<typeof searchRelations>[0]>["filters"]> {
  const [entityPks, scopeEntityPks] = await Promise.all([
    resolveEntityIds(filters.entity_ids as Array<string | number> | undefined),
    resolveEntityIds(filters.scope_entity_ids as Array<string | number> | undefined),
  ]);

  return {
    relationCategories: mapRelationCategories(filters.relation_categories),
    entityPks,
    scopeEntityPks,
    scopeAnnotationTerms: Array.isArray(filters.scope_annotation_ids)
      ? filters.scope_annotation_ids.filter((v): v is string => typeof v === "string")
      : undefined,
    predicates: Array.isArray(filters.predicates)
      ? filters.predicates.filter((v): v is string => typeof v === "string")
      : undefined,
    interactionTypes: Array.isArray(filters.interaction_types)
      ? filters.interaction_types.filter((v): v is string => typeof v === "string")
      : undefined,
    sources: Array.isArray(filters.sources)
      ? filters.sources.filter((v): v is string => typeof v === "string")
      : undefined,
    annotationTerms: Array.isArray(filters.ontology_terms)
      ? filters.ontology_terms.filter((v): v is string => typeof v === "string")
      : undefined,
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const filtersParam = url.searchParams.get("filters");
  const filters = filtersParam ? JSON.parse(filtersParam) : {};
  const limit = Number(url.searchParams.get("limit") || "20");
  const offset = Number(url.searchParams.get("offset") || "0");

  const serverFilters = await transformClientFilters(filters);

  const [relations, total] = await Promise.all([
    searchRelations({
      filters: serverFilters,
      limit: Number.isFinite(limit) ? limit : 20,
      offset: Number.isFinite(offset) ? offset : 0,
    }),
    countRelations(serverFilters),
  ]);

  return jsonBigIntSafe({ ...relations, total });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    filters?: Record<string, unknown>;
    limit?: number;
    offset?: number;
  };

  const serverFilters = await transformClientFilters(body.filters || {});

  const [relations, total] = await Promise.all([
    searchRelations({
      filters: serverFilters,
      limit: body.limit ?? 20,
      offset: body.offset ?? 0,
    }),
    countRelations(serverFilters),
  ]);

  return jsonBigIntSafe({ ...relations, total });
};
