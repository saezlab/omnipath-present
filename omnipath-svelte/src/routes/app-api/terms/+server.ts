import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getOntologyTermsByIds } from "$lib/server/queries/ontology-term";
import { extractOntologyTermId } from "$lib/ontology-term-id";

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json()) as { term_ids?: unknown; termIds?: unknown };
    const rawTermIds = Array.isArray(body.term_ids)
      ? body.term_ids
      : Array.isArray(body.termIds)
        ? body.termIds
        : [];

    const termIds = Array.from(new Set(
      rawTermIds
        .map((value) => extractOntologyTermId(String(value)) || String(value).trim())
        .filter((value) => value.length > 0),
    ));

    const rows = await getOntologyTermsByIds(termIds);
    const terms: Record<string, unknown | null> = Object.fromEntries(termIds.map((termId) => [termId, null]));

    for (const row of rows) {
      terms[row.termId] = {
        id: row.termId,
        termId: row.termId,
        name: row.label,
        label: row.label,
        definition: row.definition,
        namespace: row.ontologyPrefix,
        ontologyPrefix: row.ontologyPrefix,
        synonyms: row.synonyms,
        sources: row.sources,
      };
    }

    return json({ terms });
  } catch (error) {
    console.error("Failed to fetch ontology terms", error);
    return json({ error: "Failed to fetch ontology terms" }, { status: 500 });
  }
};
