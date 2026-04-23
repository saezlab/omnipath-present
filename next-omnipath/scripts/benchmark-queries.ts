import { config } from "dotenv";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

config({ path: resolve(process.cwd(), ".env"), quiet: true });


type Samples = {
  publicId: string;
  publicIds: string[];
  entityPk: number;
  entityPks: number[];
  identifierSamples: string[];
  entityTypeFilter: string;
  entitySource: string;
  taxonomyId: string;
  annotationTermIds: string[];
  ontologyPrefixes: string[];
  relationPk: number;
  relationPks: number[];
  relationCategory: string;
  relationPredicate: string;
  relationSource: string;
  membershipObjectEntityPks: number[];
};

type BenchmarkRow = {
  file: string;
  query: string;
  example: string;
  durationMs: number | null;
  resultSummary: string;
};

function toPublicId(row: { canonical_identifier_type: string; canonical_identifier: string }) {
  return `${row.canonical_identifier_type}|${row.canonical_identifier}`;
}

function normalizeEntityTypeFilter(entityType: string): string {
  const parts = entityType.split(":");
  if (parts.length < 3) return entityType.toLowerCase();
  return `${parts[2].toLowerCase()}:${parts[0]}:${parts[1]}`;
}

function summarizeResult(result: unknown): string {
  if (result == null) return "null";
  if (Array.isArray(result)) return `array(length=${result.length})`;
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    const parts: string[] = [];
    if (Array.isArray(obj.entities)) parts.push(`entities=${obj.entities.length}`);
    if (Array.isArray(obj.relations)) parts.push(`relations=${obj.relations.length}`);
    if (Array.isArray(obj.matches)) parts.push(`matches=${obj.matches.length}`);
    if (Array.isArray(obj.annotations)) parts.push(`annotations=${obj.annotations.length}`);
    if (typeof obj.total === "number") parts.push(`total=${obj.total}`);
    if (obj.nextCursor === null) parts.push("nextCursor=null");
    else if (typeof obj.nextCursor === "number") parts.push(`nextCursor=${obj.nextCursor}`);
    if (obj.summary && typeof obj.summary === "object") {
      const summary = obj.summary as Record<string, unknown>;
      if (typeof summary.interactionCount === "number") parts.push(`interactionCount=${summary.interactionCount}`);
    }
    return parts.length ? parts.join(", ") : `object(keys=${Object.keys(obj).join(",")})`;
  }
  return String(result);
}

async function benchmark(
  file: string,
  query: string,
  example: string,
  fn: () => Promise<unknown>,
): Promise<BenchmarkRow> {
  try {
    await fn();
    const started = performance.now();
    const result = await fn();
    const durationMs = performance.now() - started;
    return {
      file,
      query,
      example,
      durationMs,
      resultSummary: summarizeResult(result),
    };
  } catch (error) {
    return {
      file,
      query,
      example,
      durationMs: null,
      resultSummary: `ERROR: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    };
  }
}

async function loadSamples(): Promise<Samples> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const entityRows = await client.query(`
      SELECT entity_pk, canonical_identifier_type, canonical_identifier, entity_type, taxonomy_id, sources
      FROM public.entity
      WHERE array_length(sources, 1) > 0
      ORDER BY entity_pk
      LIMIT 2
    `);
    const firstEntity = entityRows.rows[0];
    const secondEntity = entityRows.rows[1] ?? firstEntity;

    const identifierRows = await client.query(`
      SELECT identifier
      FROM public.entity_identifier
      ORDER BY entity_pk, identifier
      LIMIT 2
    `);

    const annotationTermRows = await client.query(`
      SELECT DISTINCT eo.canonical_identifier AS term_id
      FROM public.entity_relation er
      JOIN public.entity eo ON eo.entity_pk = er.object_entity_pk
      WHERE er.relation_category = 'annotation'
      ORDER BY eo.canonical_identifier
      LIMIT 2
    `);

    const ontologyPrefixRows = await client.query(`
      SELECT DISTINCT ontology_prefix
      FROM public.ontology_term
      WHERE ontology_prefix IS NOT NULL
      ORDER BY ontology_prefix
      LIMIT 2
    `);

    const relationRows = await client.query(`
      SELECT relation_pk, relation_category, predicate, subject_entity_pk, object_entity_pk, sources
      FROM public.entity_relation
      WHERE array_length(sources, 1) > 0
      ORDER BY relation_pk
      LIMIT 2
    `);
    const firstRelation = relationRows.rows[0];
    const secondRelation = relationRows.rows[1] ?? firstRelation;

    const evidenceRows = await client.query(`
      SELECT DISTINCT relation_pk
      FROM public.entity_relation_evidence
      ORDER BY relation_pk
      LIMIT 2
    `);

    const membershipRows = await client.query(`
      SELECT DISTINCT object_entity_pk
      FROM public.entity_relation
      WHERE relation_category = 'membership'
      ORDER BY object_entity_pk
      LIMIT 2
    `);

    return {
      publicId: toPublicId(firstEntity),
      publicIds: [toPublicId(firstEntity), toPublicId(secondEntity)],
      entityPk: Number(firstEntity.entity_pk),
      entityPks: [Number(firstEntity.entity_pk), Number(secondEntity.entity_pk)],
      identifierSamples: identifierRows.rows.map((row) => String(row.identifier)),
      entityTypeFilter: normalizeEntityTypeFilter(String(firstEntity.entity_type)),
      entitySource: String(firstEntity.sources[0]),
      taxonomyId: String(firstEntity.taxonomy_id),
      annotationTermIds: annotationTermRows.rows.map((row) => String(row.term_id)),
      ontologyPrefixes: ontologyPrefixRows.rows.map((row) => String(row.ontology_prefix)),
      relationPk: Number(evidenceRows.rows[0]?.relation_pk ?? firstRelation.relation_pk),
      relationPks: evidenceRows.rows.map((row) => Number(row.relation_pk)),
      relationCategory: String(firstRelation.relation_category),
      relationPredicate: String(firstRelation.predicate),
      relationSource: String(firstRelation.sources[0]),
      membershipObjectEntityPks: membershipRows.rows.map((row) => Number(row.object_entity_pk)),
    };
  } finally {
    await client.end();
  }
}

function renderMarkdown(rows: BenchmarkRow[], samples: Samples): string {
  const generatedAt = new Date().toISOString();
  const lines = [
    "# Query benchmark notes",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Method",
    "",
    "- Script: `scripts/benchmark-queries.ts`",
    "- Runtime: `NODE_PATH=./scripts/shims npx tsx scripts/benchmark-queries.ts`",
    "- Each query is executed once as a warmup and once as the recorded measurement.",
    "- Timings are wall-clock milliseconds from a local run against the configured PostgreSQL database.",
    "- These numbers are useful for relative comparison only; rerun after schema or query changes.",
    "- `scripts/shims/server-only.js` is a tiny local shim so these server-only modules can be imported from a standalone script.",
    "",
    "## Sample inputs used",
    "",
    `- publicId: \`${samples.publicId}\``,
    `- publicIds: \`${samples.publicIds.join("`, `")}\``,
    `- entityPk: \`${samples.entityPk}\``,
    `- entityPks: \`${samples.entityPks.join(", ")}\``,
    `- identifiers: \`${samples.identifierSamples.join("`, `")}\``,
    `- annotation terms: \`${samples.annotationTermIds.join("`, `")}\``,
    `- ontology prefixes: \`${samples.ontologyPrefixes.join("`, `")}\``,
    `- relationPk: \`${samples.relationPk}\``,
    `- relationPks: \`${samples.relationPks.join(", ")}\``,
    `- relation category/predicate/source: \`${samples.relationCategory}\` / \`${samples.relationPredicate}\` / \`${samples.relationSource}\``,
    `- membership object entity pks: \`${samples.membershipObjectEntityPks.join(", ")}\``,
    "",
    "## Results",
    "",
    "| File | Query | Example | Time (ms) | Result summary |",
    "| --- | --- | --- | ---: | --- |",
    ...rows.map((row) => {
      const escapedExample = row.example.replace(/\|/g, "\\|");
      return `| \`${row.file}\` | \`${row.query}\` | \`${escapedExample}\` | ${row.durationMs === null ? "failed" : row.durationMs.toFixed(2)} | ${row.resultSummary} |`;
    }),
    "",
  ];

  return lines.join("\n");
}

let cleanup = async () => {};

async function main() {
  const { getPool } = await import("@/lib/db/client");
  const { getEntityDetails } = await import("@/lib/queries/entity-details");
  const {
    getIdentifiersByEntityPk,
    getIdentifiersByEntityPks,
    resolveEntityIdentifiers,
  } = await import("@/lib/queries/entity-identifier");
  const {
    getEntityByPublicId,
    getEntitiesByPublicIds,
    getEntitiesByPks,
    getEntityFilterOptions,
    searchEntities,
  } = await import("@/lib/queries/entity");
  const {
    getEntityIdsForAnnotationTerms,
    getOntologyPrefixes,
    getOntologyTermsByIds,
    searchOntologyTerms,
  } = await import("@/lib/queries/ontology-term");
  const { getEvidenceByRelationPk, getEvidenceByRelationPks } = await import("@/lib/queries/relation-evidence");
  const {
    countRelations,
    getAssociatedEntityIds,
    getRelationByPk,
    getRelationFilterOptions,
    getRelationsByPks,
    searchRelations,
  } = await import("@/lib/queries/relation");

  cleanup = async () => {
    await getPool().end();
  };

  const samples = await loadSamples();

  const rows: BenchmarkRow[] = [];

  rows.push(
    await benchmark(
      "entity-details.ts",
      "getEntityDetails",
      `getEntityDetails(\"${samples.publicId}\")`,
      () => getEntityDetails(samples.publicId),
    ),
  );

  rows.push(
    await benchmark(
      "entity-identifier.ts",
      "getIdentifiersByEntityPk",
      `getIdentifiersByEntityPk(${samples.entityPk})`,
      () => getIdentifiersByEntityPk(samples.entityPk),
    ),
    await benchmark(
      "entity-identifier.ts",
      "getIdentifiersByEntityPks",
      `getIdentifiersByEntityPks([${samples.entityPks.join(", ")}])`,
      () => getIdentifiersByEntityPks(samples.entityPks),
    ),
    await benchmark(
      "entity-identifier.ts",
      "resolveEntityIdentifiers",
      `resolveEntityIdentifiers([\"${samples.identifierSamples.join('\", \"')}\"])`,
      () => resolveEntityIdentifiers(samples.identifierSamples),
    ),
  );

  rows.push(
    await benchmark(
      "entity.ts",
      "getEntityByPublicId",
      `getEntityByPublicId(\"${samples.publicId}\")`,
      () => getEntityByPublicId(samples.publicId),
    ),
    await benchmark(
      "entity.ts",
      "getEntitiesByPublicIds",
      `getEntitiesByPublicIds([\"${samples.publicIds.join('\", \"')}\"])`,
      () => getEntitiesByPublicIds(samples.publicIds),
    ),
    await benchmark(
      "entity.ts",
      "getEntitiesByPks",
      `getEntitiesByPks([${samples.entityPks.join(", ")}])`,
      () => getEntitiesByPks(samples.entityPks),
    ),
    await benchmark(
      "entity.ts",
      "searchEntities",
      'searchEntities({ query: "PLN", limit: 10 })',
      () => searchEntities({ query: "PLN", limit: 10 }),
    ),
    await benchmark(
      "entity.ts",
      "getEntityFilterOptions",
      "getEntityFilterOptions()",
      () => getEntityFilterOptions(),
    ),
  );

  rows.push(
    await benchmark(
      "ontology-term.ts",
      "getOntologyTermsByIds",
      `getOntologyTermsByIds([\"${samples.annotationTermIds.join('\", \"')}\"])`,
      () => getOntologyTermsByIds(samples.annotationTermIds),
    ),
    await benchmark(
      "ontology-term.ts",
      "searchOntologyTerms",
      `searchOntologyTerms({ query: \"${samples.annotationTermIds[0].split(":")[0]}\", prefixes: [\"${samples.ontologyPrefixes[0]}\"], limit: 10 })`,
      () => searchOntologyTerms({
        query: samples.annotationTermIds[0].split(":")[0],
        prefixes: [samples.ontologyPrefixes[0]],
        limit: 10,
      }),
    ),
    await benchmark(
      "ontology-term.ts",
      "getOntologyPrefixes",
      "getOntologyPrefixes()",
      () => getOntologyPrefixes(),
    ),
    await benchmark(
      "ontology-term.ts",
      "getEntityIdsForAnnotationTerms",
      `getEntityIdsForAnnotationTerms([\"${samples.annotationTermIds.join('\", \"')}\"])`,
      () => getEntityIdsForAnnotationTerms(samples.annotationTermIds),
    ),
  );

  rows.push(
    await benchmark(
      "relation-evidence.ts",
      "getEvidenceByRelationPk",
      `getEvidenceByRelationPk(${samples.relationPk})`,
      () => getEvidenceByRelationPk(samples.relationPk),
    ),
    await benchmark(
      "relation-evidence.ts",
      "getEvidenceByRelationPks",
      `getEvidenceByRelationPks([${samples.relationPks.join(", ")}])`,
      () => getEvidenceByRelationPks(samples.relationPks),
    ),
  );

  rows.push(
    await benchmark(
      "relation.ts",
      "getRelationByPk",
      `getRelationByPk(${samples.relationPk})`,
      () => getRelationByPk(samples.relationPk),
    ),
    await benchmark(
      "relation.ts",
      "getRelationsByPks",
      `getRelationsByPks([${samples.relationPks.join(", ")}])`,
      () => getRelationsByPks(samples.relationPks),
    ),
    await benchmark(
      "relation.ts",
      "searchRelations",
      `searchRelations({ filters: { relationCategories: [\"${samples.relationCategory}\"], predicates: [\"${samples.relationPredicate}\"], subjectEntityPks: [${samples.entityPk}], entityPks: [${samples.entityPk}], sources: [\"${samples.relationSource}\"] }, limit: 10, offset: 0 })`,
      () => searchRelations({
        filters: {
          relationCategories: [samples.relationCategory],
          predicates: [samples.relationPredicate],
          subjectEntityPks: [samples.entityPk],
          entityPks: [samples.entityPk],
          sources: [samples.relationSource],
        },
        limit: 10,
        offset: 0,
      }),
    ),
    await benchmark(
      "relation.ts",
      "countRelations",
      `countRelations({ relationCategories: [\"${samples.relationCategory}\"], predicates: [\"${samples.relationPredicate}\"] })`,
      () => countRelations({
        relationCategories: [samples.relationCategory],
        predicates: [samples.relationPredicate],
      }),
    ),
    await benchmark(
      "relation.ts",
      "getRelationFilterOptions",
      "getRelationFilterOptions()",
      () => getRelationFilterOptions(),
    ),
    await benchmark(
      "relation.ts",
      "getAssociatedEntityIds",
      `getAssociatedEntityIds([${samples.membershipObjectEntityPks.join(", ")}])`,
      () => getAssociatedEntityIds(samples.membershipObjectEntityPks),
    ),
  );

  const markdown = renderMarkdown(rows, samples);
  await mkdir(resolve(process.cwd(), "docs"), { recursive: true });
  await writeFile(resolve(process.cwd(), "docs/query-benchmarks.md"), markdown, "utf8");

  await cleanup();
  console.log(`Wrote docs/query-benchmarks.md with ${rows.length} benchmark rows.`);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
  } catch {}
  process.exit(1);
});
