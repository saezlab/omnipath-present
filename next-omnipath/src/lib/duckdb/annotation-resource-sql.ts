"use client";

import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "")).filter((entry) => entry.length > 0);
}

export interface AnnotationTermCountRow {
  cv_term: string;
  entity_count: number;
  annotation_count: number;
  resource_count: number;
}

export interface AnnotationEntitySummary {
  key: string;
  entity_id: string;
  resource_id: string;
  canonical_identifier: string;
  display_name: string;
  entity_type_name?: string;
}

export interface AnnotationEntityPageRow {
  key: string;
  entity_id: string;
  resource_id: string;
  source: string;
  taxonomy_id: string | null;
  entity_type: string | null;
  matched_term_count: number;
  annotation_count: number;
  matched_terms: string[];
  supporting_resources: string[];
}

export async function mountResourceAnnotations(
  connection: AsyncDuckDBConnection,
  files: Array<{ fileName: string; resourceId: string }>,
  viewName = "resource_annotations",
): Promise<void> {
  if (files.length === 0) {
    await connection.query(`CREATE OR REPLACE VIEW ${viewName} AS SELECT
      CAST(NULL AS VARCHAR) AS subject_type,
      CAST(NULL AS VARCHAR) AS subject_id,
      CAST(NULL AS VARCHAR) AS cv_term,
      CAST(NULL AS VARCHAR) AS source,
      CAST(NULL AS VARCHAR) AS resource_id
    WHERE FALSE`);
    return;
  }

  const query = buildUnionQuery(
    files.map(({ fileName, resourceId }) => `
      SELECT
        CAST(subject_type AS VARCHAR) AS subject_type,
        CAST(subject_id AS VARCHAR) AS subject_id,
        CAST(cv_term AS VARCHAR) AS cv_term,
        CAST(source AS VARCHAR) AS source,
        ${sqlString(resourceId)} AS resource_id
      FROM read_parquet(${sqlString(fileName)})
    `),
  );

  await connection.query(`CREATE OR REPLACE VIEW ${viewName} AS ${query}`);
}

export async function queryAnnotationTermCounts(
  connection: AsyncDuckDBConnection,
  limit = 200,
  viewName = "resource_annotations",
): Promise<AnnotationTermCountRow[]> {
  const rows = await runRowsQuery(
    connection,
    `SELECT
      cv_term,
      COUNT(DISTINCT resource_id || ':' || subject_id) AS entity_count,
      COUNT(*) AS annotation_count,
      COUNT(DISTINCT resource_id) AS resource_count
     FROM ${viewName}
     WHERE subject_type = 'entity' AND cv_term IS NOT NULL AND cv_term <> ''
     GROUP BY 1
     ORDER BY entity_count DESC, cv_term ASC
     LIMIT ${limit}`,
  );

  return rows.map((row) => ({
    cv_term: String(row.cv_term ?? ""),
    entity_count: Number(row.entity_count ?? 0),
    annotation_count: Number(row.annotation_count ?? 0),
    resource_count: Number(row.resource_count ?? 0),
  }));
}

export async function queryAnnotationEntitySummaries(
  connection: AsyncDuckDBConnection,
  entityViewName = "resource_entities",
): Promise<Map<string, AnnotationEntitySummary>> {
  const [entityRows, sourceRows, resolvedRows] = await Promise.all([
    runRowsQuery(connection, `SELECT resource_id, entity_id, entity_type FROM ${entityViewName}`),
    runRowsQuery(connection, "SELECT resource_id, entity_id, identifier, identifier_type FROM resource_entity_identifiers_source"),
    runRowsQuery(connection, "SELECT resource_id, entity_id, identifier, identifier_type, is_canonical FROM resource_entity_identifiers_resolved"),
  ]);

  const sourceByEntity = new Map<string, Array<{ identifier: string; identifier_type: string }>>();
  for (const row of sourceRows) {
    const key = `${String(row.resource_id ?? "")}:${String(row.entity_id ?? "")}`;
    const items = sourceByEntity.get(key) || [];
    items.push({ identifier: String(row.identifier ?? ""), identifier_type: String(row.identifier_type ?? "") });
    sourceByEntity.set(key, items);
  }

  const resolvedByEntity = new Map<string, Array<{ identifier: string; identifier_type: string; is_canonical: boolean }>>();
  for (const row of resolvedRows) {
    const key = `${String(row.resource_id ?? "")}:${String(row.entity_id ?? "")}`;
    const items = resolvedByEntity.get(key) || [];
    items.push({
      identifier: String(row.identifier ?? ""),
      identifier_type: String(row.identifier_type ?? ""),
      is_canonical: Boolean(row.is_canonical),
    });
    resolvedByEntity.set(key, items);
  }

  return new Map(entityRows.map((row) => {
    const resourceId = String(row.resource_id ?? "");
    const entityId = String(row.entity_id ?? "");
    const key = `${resourceId}:${entityId}`;
    const entityType = row.entity_type;
    const sourceIdentifiers = sourceByEntity.get(key) || [];
    const resolvedIdentifiers = (resolvedByEntity.get(key) || []).map((item) => ({ identifier: item.identifier, identifier_type: item.identifier_type }));
    const allIdentifiers = orderIdentifierRows(
      [...sourceIdentifiers, ...resolvedIdentifiers].filter((item, index, items) =>
        items.findIndex((other) => other.identifier === item.identifier && other.identifier_type === item.identifier_type) === index,
      ),
      entityType,
    );
    const canonicalResolved = (resolvedByEntity.get(key) || []).find((item) => item.is_canonical);
    const secondaryIdentifier = [...allIdentifiers].sort((a, b) => secondaryPriority(entityType, a.identifier_type) - secondaryPriority(entityType, b.identifier_type))[0]?.identifier;
    const displayName = [...allIdentifiers].sort((a, b) => displayPriority(entityType, a.identifier_type) - displayPriority(entityType, b.identifier_type))[0]?.identifier
      || canonicalResolved?.identifier
      || secondaryIdentifier
      || entityId;
    const canonicalIdentifier = secondaryIdentifier || canonicalResolved?.identifier || entityId;
    return [key, {
      key,
      entity_id: entityId,
      resource_id: resourceId,
      canonical_identifier: canonicalIdentifier,
      display_name: displayName,
      entity_type_name: readableEntityType(entityType),
    } satisfies AnnotationEntitySummary];
  }));
}

export async function queryAnnotationEntityPage(
  connection: AsyncDuckDBConnection,
  selectedTerms: string[],
  matchMode: "any" | "all",
  pageIndex: number,
  pageSize: number,
): Promise<{ rows: AnnotationEntityPageRow[]; totalCount: number }> {
  if (selectedTerms.length === 0) {
    return { rows: [], totalCount: 0 };
  }

  const selectedTermsSql = selectedTerms.map((term) => `SELECT ${sqlString(term)} AS cv_term`).join(" UNION ALL ");
  const requiredDistinctCount = new Set(selectedTerms).size;
  const matchConstraint = matchMode === "all"
    ? `HAVING COUNT(DISTINCT matches.cv_term) = ${requiredDistinctCount}`
    : "";
  const offset = pageIndex * pageSize;

  const sql = `
    WITH selected_terms AS (${selectedTermsSql}),
    matches AS (
      SELECT annotations.resource_id, annotations.subject_id AS entity_id, annotations.cv_term
      FROM resource_annotations AS annotations
      INNER JOIN selected_terms ON annotations.cv_term = selected_terms.cv_term
      WHERE annotations.subject_type = 'entity'
    ),
    entity_matches AS (
      SELECT
        matches.resource_id,
        matches.entity_id,
        COUNT(*) AS annotation_count,
        COUNT(DISTINCT matches.cv_term) AS matched_term_count,
        list(DISTINCT matches.cv_term) AS matched_terms,
        list(DISTINCT matches.resource_id) AS supporting_resources
      FROM matches
      GROUP BY 1, 2
      ${matchConstraint}
    )
    SELECT
      entity_matches.resource_id,
      entity_matches.entity_id,
      entities.source,
      CAST(entities.taxonomy_id AS VARCHAR) AS taxonomy_id,
      CAST(entities.entity_type AS VARCHAR) AS entity_type,
      entity_matches.annotation_count,
      entity_matches.matched_term_count,
      entity_matches.matched_terms,
      entity_matches.supporting_resources
    FROM entity_matches
    LEFT JOIN resource_entities AS entities
      ON entity_matches.resource_id = entities.resource_id
     AND entity_matches.entity_id = entities.entity_id
    ORDER BY entity_matches.matched_term_count DESC, entity_matches.annotation_count DESC, entity_matches.resource_id ASC, entity_matches.entity_id ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const rows = await runRowsQuery(connection, sql);
  const countRows = await runRowsQuery(
    connection,
    `WITH selected_terms AS (${selectedTermsSql}),
     matches AS (
       SELECT annotations.resource_id, annotations.subject_id AS entity_id, annotations.cv_term
       FROM resource_annotations AS annotations
       INNER JOIN selected_terms ON annotations.cv_term = selected_terms.cv_term
       WHERE annotations.subject_type = 'entity'
     )
     SELECT COUNT(*) AS total_count
     FROM (
       SELECT matches.resource_id, matches.entity_id
       FROM matches
       GROUP BY 1, 2
       ${matchConstraint}
     )`,
  );

  return {
    rows: rows.map((row) => {
      const resourceId = String(row.resource_id ?? "");
      const entityId = String(row.entity_id ?? "");
      return {
        key: `${resourceId}:${entityId}`,
        entity_id: entityId,
        resource_id: resourceId,
        source: String(row.source ?? resourceId),
        taxonomy_id: row.taxonomy_id == null ? null : String(row.taxonomy_id),
        entity_type: row.entity_type == null ? null : String(row.entity_type),
        matched_term_count: Number(row.matched_term_count ?? 0),
        annotation_count: Number(row.annotation_count ?? 0),
        matched_terms: toStringArray(row.matched_terms).sort(),
        supporting_resources: toStringArray(row.supporting_resources).sort(),
      } satisfies AnnotationEntityPageRow;
    }),
    totalCount: Number(countRows[0]?.total_count ?? 0),
  };
}

export async function queryAnnotationEntityTerms(
  connection: AsyncDuckDBConnection,
  resourceId: string,
  entityId: string,
): Promise<string[]> {
  const rows = await runRowsQuery(
    connection,
    `SELECT cv_term, COUNT(*) AS annotation_count
     FROM resource_annotations
     WHERE subject_type = 'entity'
       AND resource_id = ${sqlString(resourceId)}
       AND subject_id = ${sqlString(entityId)}
     GROUP BY 1
     ORDER BY annotation_count DESC, cv_term ASC
     LIMIT 250`,
  );
  return rows.map((row) => String(row.cv_term ?? "")).filter(Boolean);
}

export async function queryAnnotationTermResourceSupport(
  connection: AsyncDuckDBConnection,
  termId: string,
): Promise<Array<{ resource_id: string; entity_count: number; annotation_count: number }>> {
  const rows = await runRowsQuery(
    connection,
    `SELECT
       resource_id,
       COUNT(DISTINCT subject_id) AS entity_count,
       COUNT(*) AS annotation_count
     FROM resource_annotations
     WHERE subject_type = 'entity' AND cv_term = ${sqlString(termId)}
     GROUP BY 1
     ORDER BY entity_count DESC, resource_id ASC`,
  );
  return rows.map((row) => ({
    resource_id: String(row.resource_id ?? ""),
    entity_count: Number(row.entity_count ?? 0),
    annotation_count: Number(row.annotation_count ?? 0),
  }));
}
