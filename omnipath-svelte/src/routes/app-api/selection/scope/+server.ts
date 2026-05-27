import type { RequestHandler } from "./$types";
import { resolveSelectionScope, type SelectionScopeMode } from "$lib/server/queries/selection-scope";
import { json } from "@sveltejs/kit";

function stringValues(values: unknown): string[] {
  return Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : [];
}

function scopeMode(value: unknown): SelectionScopeMode {
  return value === "intersection" ? "intersection" : "union";
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as Record<string, unknown>;
  const scope = await resolveSelectionScope({
    entityPks: stringValues(body.entityPks),
    annotationTermIds: stringValues(body.annotationTermIds),
    includeAssociatedEntities: body.includeAssociatedEntities !== false,
    includeMembersParticipants: body.includeMembersParticipants !== false,
    mode: scopeMode(body.mode),
  });

  return json(scope);
};
