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

function normalizeIdentifierType(value: unknown): string {
  const label = readableEntityType(value) || (typeof value === "string" ? value : "");
  return label.trim().toLowerCase();
}

function classifyEntityType(value: unknown): "protein" | "small_molecule" | "other" {
  const normalized = (readableEntityType(value) || "").toLowerCase().replace(/[\s_]/g, "");
  if (normalized === "protein") return "protein";
  if (["smallmolecule", "compound", "metabolite", "drug", "lipid"].includes(normalized)) return "small_molecule";
  return "other";
}

function displayPriority(entityType: unknown, identifierType: unknown): number {
  const type = normalizeIdentifierType(identifierType);
  const category = classifyEntityType(entityType);
  if (category === "protein") {
    if (type.includes("gene name primary")) return 0;
    if (type.includes("gene name") || type.includes("hgnc symbol")) return 1;
    if (type.includes("systematic name")) return 2;
    if (type === "name" || type.includes("protein name")) return 20;
    if (type.includes("uniprot")) return 10;
  }
  if (category === "small_molecule") {
    if (type === "name" || type.includes("common name") || type.includes("preferred name")) return 0;
    if (type.includes("chebi")) return 1;
    if (type.includes("hmdb")) return 2;
    if (type.includes("chembl")) return 3;
    if (type.includes("pubchem")) return 4;
    if (type.includes("inchi")) return 10;
  }
  if (type === "name") return 0;
  if (type.includes("gene name")) return 1;
  return 100;
}

function secondaryPriority(entityType: unknown, identifierType: unknown): number {
  const type = normalizeIdentifierType(identifierType);
  const category = classifyEntityType(entityType);
  if (category === "protein") {
    if (type.includes("uniprot")) return 0;
    if (type.includes("ensembl")) return 1;
    if (type.includes("entrez")) return 2;
    return 100;
  }
  if (category === "small_molecule") {
    if (type.includes("chebi")) return 0;
    if (type.includes("hmdb")) return 1;
    if (type.includes("chembl")) return 2;
    if (type.includes("pubchem")) return 3;
    if (type.includes("inchi")) return 10;
    return 100;
  }
  if (type.includes("uniprot") || type.includes("chebi")) return 0;
  return 100;
}

function orderIdentifierRows(
  rows: Array<{ identifier: string; identifier_type: string }>,
  entityType: unknown,
): Array<{ identifier: string; identifier_type: string }> {
  return [...rows].sort((a, b) => {
    const aBest = Math.min(displayPriority(entityType, a.identifier_type), secondaryPriority(entityType, a.identifier_type));
    const bBest = Math.min(displayPriority(entityType, b.identifier_type), secondaryPriority(entityType, b.identifier_type));
    if (aBest !== bBest) return aBest - bBest;
    return a.identifier.localeCompare(b.identifier);
  });
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
        CASE
          WHEN interactions.sign IS NOT NULL THEN TRUE
          WHEN interactions.direction IS NULL OR interactions.direction = 0 THEN FALSE
          ELSE TRUE
        END AS is_directed,
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
        taxonomy_id,
        source,
        entity_attributes,
        ${sqlString(resourceId)} AS resource_id
      FROM read_parquet(${sqlString(fileName)})
    `),
  );

  await connection.query(`CREATE OR REPLACE VIEW ${viewName} AS ${query}`);
}

export async function mountResourceIdentifierRows(
  connection: AsyncDuckDBConnection,
  files: Array<{ fileName: string; resourceId: string }>,
  options: { includeCanonicalFlag: boolean; viewName: string },
): Promise<void> {
  const { includeCanonicalFlag, viewName } = options;
  if (files.length === 0) {
    await connection.query(`CREATE OR REPLACE VIEW ${viewName} AS SELECT
      CAST(NULL AS VARCHAR) AS entity_id,
      CAST(NULL AS VARCHAR) AS identifier,
      CAST(NULL AS VARCHAR) AS identifier_type,
      ${includeCanonicalFlag ? 'CAST(NULL AS BOOLEAN) AS is_canonical,' : ''}
      CAST(NULL AS VARCHAR) AS source,
      CAST(NULL AS VARCHAR) AS resource_id
    WHERE FALSE`);
    return;
  }

  const query = buildUnionQuery(
    files.map(({ fileName, resourceId }) => `
      SELECT
        CAST(entity_id AS VARCHAR) AS entity_id,
        CAST(identifier AS VARCHAR) AS identifier,
        CAST(identifier_type AS VARCHAR) AS identifier_type,
        ${includeCanonicalFlag ? 'CAST(is_canonical AS BOOLEAN) AS is_canonical,' : 'FALSE AS is_canonical,'}
        CAST(source AS VARCHAR) AS source,
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
  const [entityRows, sourceRows, resolvedRows] = await Promise.all([
    runRowsQuery(connection, `SELECT entity_id, entity_type FROM ${viewName}`),
    runRowsQuery(connection, `SELECT entity_id, identifier, identifier_type FROM resource_entity_identifiers_source`),
    runRowsQuery(connection, `SELECT entity_id, identifier, identifier_type, is_canonical FROM resource_entity_identifiers_resolved`),
  ]);

  const sourceByEntity = new Map<string, Array<{ identifier: string; identifier_type: string }>>();
  for (const row of sourceRows) {
    const entityId = String(row.entity_id ?? "");
    if (!entityId) continue;
    const items = sourceByEntity.get(entityId) || [];
    items.push({ identifier: String(row.identifier ?? ""), identifier_type: String(row.identifier_type ?? "") });
    sourceByEntity.set(entityId, items);
  }

  const resolvedByEntity = new Map<string, Array<{ identifier: string; identifier_type: string; is_canonical: boolean }>>();
  for (const row of resolvedRows) {
    const entityId = String(row.entity_id ?? "");
    if (!entityId) continue;
    const items = resolvedByEntity.get(entityId) || [];
    items.push({ identifier: String(row.identifier ?? ""), identifier_type: String(row.identifier_type ?? ""), is_canonical: Boolean(row.is_canonical) });
    resolvedByEntity.set(entityId, items);
  }

  return new Map(
    entityRows.map((row) => {
      const id = String(row.entity_id ?? "");
      const entityType = row.entity_type;
      const sourceIdentifiers = sourceByEntity.get(id) || [];
      const resolvedIdentifiers = (resolvedByEntity.get(id) || []).map((item) => ({ identifier: item.identifier, identifier_type: item.identifier_type }));
      const allIdentifiers = orderIdentifierRows(
        [...sourceIdentifiers, ...resolvedIdentifiers].filter((item, index, items) =>
          items.findIndex((other) => other.identifier === item.identifier && other.identifier_type === item.identifier_type) === index,
        ),
        entityType,
      );
      const canonicalResolved = (resolvedByEntity.get(id) || []).find((item) => item.is_canonical);
      const secondaryIdentifier = [...allIdentifiers].sort((a, b) => secondaryPriority(entityType, a.identifier_type) - secondaryPriority(entityType, b.identifier_type))[0]?.identifier;
      const displayName = [...allIdentifiers].sort((a, b) => displayPriority(entityType, a.identifier_type) - displayPriority(entityType, b.identifier_type))[0]?.identifier
        || canonicalResolved?.identifier
        || secondaryIdentifier
        || id;
      const canonicalIdentifier = secondaryIdentifier || canonicalResolved?.identifier || id;
      return [id, {
        id,
        canonical_identifier: canonicalIdentifier,
        display_name: displayName,
        entity_type_name: readableEntityType(entityType),
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
    `WITH source_rows AS (
      SELECT identifier, identifier_type, source
      FROM resource_entity_identifiers_source
      WHERE entity_id = ${sqlString(entityId)}
    ),
    resolved_rows AS (
      SELECT identifier, identifier_type, is_canonical, source
      FROM resource_entity_identifiers_resolved
      WHERE entity_id = ${sqlString(entityId)}
    ),
    source_names AS (
      SELECT coalesce(
        max(CASE WHEN lower(identifier_type) LIKE '%gene name primary%' THEN identifier END),
        max(CASE WHEN lower(identifier_type) LIKE '%name%' THEN identifier END),
        max(CASE WHEN lower(identifier_type) LIKE '%systematic name%' THEN identifier END)
      ) AS display_name
      FROM source_rows
    ),
    canonical AS (
      SELECT
        max(CASE WHEN is_canonical THEN identifier END) AS canonical_identifier,
        max(CASE WHEN is_canonical THEN identifier_type END) AS canonical_identifier_type
      FROM resolved_rows
    )
    SELECT
      entities.entity_id,
      entities.entity_type,
      entities.taxonomy_id,
      entities.source,
      source_names.display_name,
      canonical.canonical_identifier,
      canonical.canonical_identifier_type
    FROM ${viewName} AS entities
    LEFT JOIN source_names ON TRUE
    LEFT JOIN canonical ON TRUE
    WHERE entities.entity_id = ${sqlString(entityId)}
    LIMIT 1`,
  );

  if (rows.length === 0) return null;
  const row = rows[0];
  const displayName = String(row.display_name ?? row.canonical_identifier ?? row.entity_id ?? "");
  const canonicalIdentifier = String(row.canonical_identifier ?? row.entity_id ?? "");

  const identifierRows = orderIdentifierRows(
    await runRowsQuery(
      connection,
      `SELECT identifier, identifier_type FROM resource_entity_identifiers_resolved WHERE entity_id = ${sqlString(entityId)}
       UNION
       SELECT identifier, identifier_type FROM resource_entity_identifiers_source WHERE entity_id = ${sqlString(entityId)}`,
    ) as Array<{ identifier: string; identifier_type: string }>,
    row.entity_type,
  );

  const entityPayload = {
    ...(row as SearchResult),
    id: String(row.entity_id ?? entityId),
    entity_id: String(row.entity_id ?? entityId),
    type: "entity",
    names: [],
    gene_symbols: [],
    descriptions: [],
    references: [],
    sources: typeof row.source === "string" ? [row.source] : [],
    synonyms: [],
    ontology_terms: [],
    cv_terms: [],
    identifiers: identifierRows.map((identifierRow) => ({
      key: String(identifierRow.identifier_type ?? "identifier"),
      value: String(identifierRow.identifier ?? ""),
    })).filter((item) => item.value.length > 0),
  };

  if (typeof window !== 'undefined') {
    console.log('[DuckDB:queryResourceEntityById] entity payload', {
      entityId,
      entityType: entityPayload.entity_type,
      names: entityPayload.names,
      identifiers: entityPayload.identifiers,
    });
  }

  return entityPayload;
}
