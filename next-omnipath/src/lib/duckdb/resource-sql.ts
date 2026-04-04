"use client";

import type { SearchResult } from "@/features/search/components/result-card";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { DuckDbFacetBucket, DuckDbFacetCounts, DuckDbInteractionsPage, InteractionLocalFilters } from "@/types/subsets";

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeStringArray(values: string[] | undefined): string[] {
  return (values || []).map((value) => value.trim()).filter(Boolean);
}

function stripAccessionSuffixSql(column: string): string {
  return `regexp_replace(CAST(${column} AS VARCHAR), ':[A-Z]+:[0-9]+$', '')`;
}

function participantTypePairSql(entityATypeColumn: string, entityBTypeColumn: string): string {
  const entityAType = `CAST(${entityATypeColumn} AS VARCHAR)`;
  const entityBType = `CAST(${entityBTypeColumn} AS VARCHAR)`;
  const entityATypeLabel = stripAccessionSuffixSql(entityATypeColumn);
  const entityBTypeLabel = stripAccessionSuffixSql(entityBTypeColumn);
  return `CASE
    WHEN ${entityAType} IS NULL OR ${entityAType} = '' THEN ${entityBType}
    WHEN ${entityBType} IS NULL OR ${entityBType} = '' THEN ${entityAType}
    WHEN ${entityATypeLabel} <= ${entityBTypeLabel} THEN ${entityAType} || '|' || ${entityBType}
    ELSE ${entityBType} || '|' || ${entityAType}
  END`;
}

function readableEntityType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const accessionFirst = normalized.match(/^[A-Z]+:\d+:(.+)$/);
  if (accessionFirst) return accessionFirst[1];
  return normalized.replace(/:[A-Z]+:\d+$/, "");
}

async function runRowsQuery(connection: AsyncDuckDBConnection, sql: string): Promise<Record<string, unknown>[]> {
  const result = await connection.query(sql);
  return result.toArray().map((row) => {
    if (typeof row === "object" && row !== null && "toJSON" in row && typeof row.toJSON === "function") {
      return row.toJSON() as Record<string, unknown>;
    }
    return row as unknown as Record<string, unknown>;
  });
}

function buildUnionQuery(selects: string[]): string {
  return selects.join(" UNION ALL ");
}

function buildInteractionWhereClause(filters: InteractionLocalFilters): string {
  const clauses: string[] = [];

  const interactionTypes = normalizeStringArray(filters.interaction_types);
  if (interactionTypes.length > 0) {
    clauses.push(`interaction_type IN (${interactionTypes.map(sqlString).join(", ")})`);
  }

  if (typeof filters.is_directed === "boolean") {
    clauses.push(`is_directed = ${filters.is_directed ? "TRUE" : "FALSE"}`);
  }

  if (filters.signs.length > 0) {
    clauses.push(`sign IN (${filters.signs.join(", ")})`);
  }

  const sources = normalizeStringArray(filters.sources);
  if (sources.length > 0) {
    clauses.push(`source IN (${sources.map(sqlString).join(", ")})`);
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

export async function mountResourceInteractions(
  connection: AsyncDuckDBConnection,
  files: Array<{ interactionFileName: string; entityFileName?: string; resourceId: string }>,
  viewName = "resource_interactions",
): Promise<void> {
  const query = buildUnionQuery(
    files.map(({ interactionFileName, entityFileName, resourceId }) => `
      SELECT
        interactions.interaction_id,
        CAST(interactions.entity_a_id AS VARCHAR) AS entity_a_id,
        CAST(interactions.entity_b_id AS VARCHAR) AS entity_b_id,
        interactions.direction,
        CAST(interactions.sign AS INTEGER) AS sign,
        ${entityFileName
          ? participantTypePairSql("entity_a.entity_type", "entity_b.entity_type")
          : "NULL"} AS interaction_type,
        CASE WHEN interactions.direction IS NULL OR interactions.direction = 0 THEN FALSE ELSE TRUE END AS is_directed,
        COALESCE(array_length(interactions.evidence), 0) AS evidence_count,
        CAST(interactions.source AS VARCHAR) AS source,
        ${sqlString(resourceId)} AS resource_id,
        interactions.record_attributes,
        interactions.entity_a_attributes,
        interactions.entity_b_attributes,
        interactions.evidence
      FROM read_parquet(${sqlString(interactionFileName)}) AS interactions
      ${entityFileName ? `LEFT JOIN read_parquet(${sqlString(entityFileName)}) AS entity_a
        ON interactions.entity_a_id = entity_a.entity_id
      LEFT JOIN read_parquet(${sqlString(entityFileName)}) AS entity_b
        ON interactions.entity_b_id = entity_b.entity_id` : ""}
    `),
  );

  await connection.query(`CREATE OR REPLACE VIEW ${viewName} AS ${query}`);
}

export async function mountResourceEntities(
  connection: AsyncDuckDBConnection,
  files: Array<{ fileName: string; resourceId: string }>,
  viewName = "resource_entities",
): Promise<void> {
  const query = buildUnionQuery(
    files.map(({ fileName, resourceId }) => `
      SELECT
        CAST(entity_id AS VARCHAR) AS entity_id,
        entity_type,
        display_name,
        canonical_identifier,
        canonical_identifier_type,
        taxonomy_id,
        source,
        entity_attributes,
        ${sqlString(resourceId)} AS resource_id
      FROM read_parquet(${sqlString(fileName)})
    `),
  );

  await connection.query(`CREATE OR REPLACE VIEW ${viewName} AS ${query}`);
}

export async function queryResourceInteractionPage(
  connection: AsyncDuckDBConnection,
  filters: InteractionLocalFilters,
  pageIndex: number,
  pageSize: number,
  viewName = "resource_interactions",
): Promise<DuckDbInteractionsPage> {
  const whereClause = buildInteractionWhereClause(filters);
  const offset = pageIndex * pageSize;

  const rows = await runRowsQuery(
    connection,
    `SELECT interaction_id, entity_a_id, entity_b_id, sign, is_directed, interaction_type, source, resource_id, evidence_count, record_attributes, entity_a_attributes, entity_b_attributes, evidence
     FROM ${viewName} ${whereClause}
     ORDER BY evidence_count DESC NULLS LAST, interaction_id
     LIMIT ${pageSize} OFFSET ${offset}`,
  );

  const countRows = await runRowsQuery(connection, `SELECT COUNT(*) AS total_count FROM ${viewName} ${whereClause}`);
  const totalCount = Number(countRows[0]?.total_count || 0);

  return { rows, totalCount };
}

async function runFacetQuery(connection: AsyncDuckDBConnection, sql: string): Promise<DuckDbFacetBucket[]> {
  const rows = await runRowsQuery(connection, sql);
  return rows
    .map((row) => ({ value: String(row.value ?? ""), count: Number(row.count ?? 0) }))
    .filter((row) => row.value.length > 0);
}

export async function queryResourceInteractionFacets(
  connection: AsyncDuckDBConnection,
  filters: InteractionLocalFilters,
  viewName = "resource_interactions",
): Promise<DuckDbFacetCounts> {
  const whereClause = buildInteractionWhereClause(filters);
  const [interaction_type, sign, is_directed, sources] = await Promise.all([
    runFacetQuery(connection, `SELECT CAST(interaction_type AS VARCHAR) AS value, COUNT(*) AS count FROM ${viewName} ${whereClause} GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 25`),
    runFacetQuery(connection, `SELECT CAST(sign AS VARCHAR) AS value, COUNT(*) AS count FROM ${viewName} ${whereClause} GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 25`),
    runFacetQuery(connection, `SELECT CAST(is_directed AS VARCHAR) AS value, COUNT(*) AS count FROM ${viewName} ${whereClause} GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 25`),
    runFacetQuery(connection, `SELECT CAST(source AS VARCHAR) AS value, COUNT(*) AS count FROM ${viewName} ${whereClause} GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 25`),
  ]);

  return {
    interaction_type,
    sign,
    is_directed,
    sources,
    interaction_annotation_terms: [],
    participant_annotation_terms: [],
  };
}

export async function queryResourceEntitySummaries(
  connection: AsyncDuckDBConnection,
  viewName = "resource_entities",
): Promise<Map<string, { id: string; canonical_identifier: string; display_name: string; entity_type_name?: string }>> {
  const rows = await runRowsQuery(
    connection,
    `SELECT entity_id, entity_type, display_name, canonical_identifier FROM ${viewName}`,
  );

  return new Map(
    rows.map((row) => {
      const id = String(row.entity_id ?? "");
      return [id, {
        id,
        canonical_identifier: String(row.canonical_identifier ?? id),
        display_name: String(row.display_name ?? row.canonical_identifier ?? id),
        entity_type_name: readableEntityType(row.entity_type),
      }];
    }),
  );
}

export async function queryResourceEntityById(
  connection: AsyncDuckDBConnection,
  entityId: string,
  viewName = "resource_entities",
): Promise<SearchResult | null> {
  const rows = await runRowsQuery(
    connection,
    `SELECT entity_id, entity_type, display_name, canonical_identifier, canonical_identifier_type, taxonomy_id, source FROM ${viewName} WHERE entity_id = ${sqlString(entityId)} LIMIT 1`,
  );

  if (rows.length === 0) return null;
  const row = rows[0];
  const displayName = String(row.display_name ?? row.canonical_identifier ?? row.entity_id ?? "");
  const canonicalIdentifier = String(row.canonical_identifier ?? row.entity_id ?? "");

  return {
    ...(row as SearchResult),
    id: String(row.entity_id ?? entityId),
    entity_id: String(row.entity_id ?? entityId),
    type: "entity",
    names: displayName ? [displayName] : [],
    gene_symbols: [],
    descriptions: [],
    references: [],
    sources: typeof row.source === "string" ? [row.source] : [],
    synonyms: [],
    ontology_terms: [],
    cv_terms: [],
    identifiers: canonicalIdentifier
      ? [{ key: String(row.canonical_identifier_type ?? "identifier"), value: canonicalIdentifier }]
      : [],
  };
}
