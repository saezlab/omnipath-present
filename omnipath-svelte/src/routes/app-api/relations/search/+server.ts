import type { RequestHandler } from "./$types";
import { searchRelations } from "$lib/server/queries/relation";
import { getEntitiesByPublicIds } from "$lib/server/queries/entity";
import { jsonBigIntSafe } from "$lib/server/api-utils";

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

function mapRelationCategories(categories: unknown): string[] | undefined {
  if (!Array.isArray(categories)) return undefined;
  const valid = new Set(["interaction", "association"]);
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
    scopeEndpointMode: filters.scope_endpoint_mode === "both" ? "both" : "any",
    scopeMode: filters.selection_scope_mode === "intersection" ? "intersection" : "union",
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
    taxonomyIds: Array.isArray(filters.ncbi_tax_id)
      ? filters.ncbi_tax_id.filter((v): v is string => typeof v === "string")
      : Array.isArray(filters.taxonomy_ids)
        ? filters.taxonomy_ids.filter((v): v is string => typeof v === "string")
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

  const result = await searchRelations({
    filters: serverFilters,
    limit: Number.isFinite(limit) ? limit : 20,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  return jsonBigIntSafe(result);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    filters?: Record<string, unknown>;
    limit?: number;
    offset?: number;
  };

  const serverFilters = await transformClientFilters(body.filters || {});

  const result = await searchRelations({
    filters: serverFilters,
    limit: body.limit ?? 20,
    offset: body.offset ?? 0,
  });

  return jsonBigIntSafe(result);
};
