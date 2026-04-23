import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env"), quiet: true });

async function main() {
  const { searchEntities } = await import("@/lib/queries/entity");
  const cases = [
    { query: "PLN", limit: 10 },
    { query: "PLN", limit: 10, filters: { entity_types: ["protein:MI:0326"] } },
    { query: "PLN", limit: 10, filters: { sources: ["uniprot"] } },
    { query: "PLN", limit: 10, filters: { ncbi_tax_id: ["9606"] } },
    { query: "PLN", limit: 10, filters: { ontology_terms: ["CHEBI:10036"] } },
  ];

  for (const input of cases) {
    try {
      const res = await searchEntities(input);
      console.log("OK", JSON.stringify(input), JSON.stringify({ entities: res.entities.length, total: res.total, nextCursor: res.nextCursor }));
    } catch (e) {
      console.log("ERR", JSON.stringify(input), e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
