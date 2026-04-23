import { config } from "dotenv";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env"), quiet: true });

type MeasureResult = { name: string; avgMs: number; minMs: number; maxMs: number };

async function measure(name: string, fn: () => Promise<unknown>, runs = 5): Promise<MeasureResult> {
  await fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  return {
    name,
    avgMs: times.reduce((sum, value) => sum + value, 0) / times.length,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
  };
}

async function main() {
  const { searchEntities } = await import("@/lib/queries/entity");
  const { resolveEntityIdentifiers } = await import("@/lib/queries/entity-identifier");
  const { countRelations, searchRelations, getAssociatedEntityIds } = await import("@/lib/queries/relation");
  const { getEntityIdsForAnnotationTerms } = await import("@/lib/queries/ontology-term");

  const results = await Promise.all([
    measure("searchEntities exact PLN", () => searchEntities({ query: "PLN", limit: 10 })),
    measure(
      "searchEntities exact PLN + entity_types",
      () => searchEntities({ query: "PLN", limit: 10, filters: { entity_types: ["protein:MI:0326"] } }),
    ),
    measure(
      "searchEntities exact PLN + sources",
      () => searchEntities({ query: "PLN", limit: 10, filters: { sources: ["uniprot"] } }),
    ),
    measure(
      "searchEntities exact PLN + ncbi_tax_id",
      () => searchEntities({ query: "PLN", limit: 10, filters: { ncbi_tax_id: ["9606"] } }),
    ),
    measure(
      "searchEntities exact PLN + ontology_terms",
      () => searchEntities({ query: "PLN", limit: 10, filters: { ontology_terms: ["CHEBI:10036"] } }),
    ),
    measure(
      "searchEntities filters only + entity_types",
      () => searchEntities({ limit: 10, filters: { entity_types: ["protein:MI:0326"] } }),
    ),
    measure(
      "searchEntities filters only + sources",
      () => searchEntities({ limit: 10, filters: { sources: ["uniprot"] } }),
    ),
    measure(
      "searchEntities filters only + ncbi_tax_id",
      () => searchEntities({ limit: 10, filters: { ncbi_tax_id: ["9606"] } }),
    ),
    measure("resolveEntityIdentifiers exact", () => resolveEntityIdentifiers(["112268293", "A0A024R1R8"])),
    measure("resolveEntityIdentifiers lowercase fallback", () => resolveEntityIdentifiers(["a0a024r1r8"])),
    measure("countRelations annotation+predicate", () => countRelations({ relationCategories: ["annotation"], predicates: ["has_annotation"] })),
    measure(
      "searchRelations sources only",
      () => searchRelations({ filters: { sources: ["uniprot"] }, limit: 10, offset: 0 }),
    ),
    measure(
      "getEntityIdsForAnnotationTerms",
      () => getEntityIdsForAnnotationTerms(["CHEBI:10036", "CHEBI:102167"]),
    ),
    measure("getAssociatedEntityIds", () => getAssociatedEntityIds([321, 434])),
  ]);

  for (const result of results) {
    console.log(`${result.name}: avg=${result.avgMs.toFixed(2)}ms min=${result.minMs.toFixed(2)}ms max=${result.maxMs.toFixed(2)}ms`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
