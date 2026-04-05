"use client";

import type { SearchResult } from "@/features/search/components/result-card";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { DuckDbFacetBucket, DuckDbFacetCounts, DuckDbInteractionsPage, InteractionLocalFilters } from "@/types/subsets";

const DEFAULT_INTERACTION_COLUMNS = [
  "interaction_key",
  "member_a_id",
  "member_b_id",
  "interaction_type",
  "is_directed",
  "sign",
  "evidence_count",
];

function buildUnionQuery(selects: string[]): string {
  return selects.join(" UNION ALL ");
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeStringArray(values: string[] | undefined): string[] {
  return (values || []).map((value) => value.trim()).filter(Boolean);
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
    if (type === "name" || type.includes("protein name")) return 2;
    if (type.includes("systematic name")) return 3;
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

function objectValuesInKeyOrder(value: Record<string, unknown>): unknown[] {
  return Object.keys(value)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => value[key]);
}

function toUnknownArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function") {
    return toUnknownArray(value.toJSON());
  }
  if (value && typeof value === "object") {
    return objectValuesInKeyOrder(value as Record<string, unknown>);
  }
  return [];
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }
  if (value && typeof value === "object") {
    return toUnknownArray(value).map((entry) => String(entry).trim()).filter(Boolean);
  }
  return [];
}

function toIdentifierArray(value: unknown): Array<{ key: string; value: string }> {
  return toUnknownArray(value).flatMap((entry) => {
    if (typeof entry === "object" && entry !== null) {
      const maybeKey = "key" in entry ? entry.key : undefined;
      const maybeValue = "value" in entry ? entry.value : undefined;
      if (typeof maybeKey === "string" && typeof maybeValue === "string") {
        return [{ key: maybeKey, value: maybeValue }];
      }
    }
    return [];
  });
}

function isSmallMoleculeType(entityTypeName: string | undefined): boolean {
  if (!entityTypeName) return false;
  const type = entityTypeName.toLowerCase();
  return type === "smallmolecule" ||
    type === "small_molecule" ||
    type === "compound" ||
    type === "metabolite" ||
    type === "drug" ||
    type === "lipid";
}

function getShortestName(names: string[] | undefined): string | undefined {
  if (!names || names.length === 0) return undefined;

  const validNames = names.filter((name) =>
    !/^(MLS|SMR|cid_|ZINC|SID_|CID_)/i.test(name) && name.length > 3,
  );

  if (validNames.length > 0) {
    return validNames.reduce((shortest, current) =>
      current.length < shortest.length ? current : shortest,
    );
  }

  return names[0];
}

function getIdentifierByType(
  identifiers: Array<{ key: string; value: string }>,
  types: string[],
): string | undefined {
  for (const id of identifiers) {
    const idType = id.key?.split(":")[0].toLowerCase();
    if (idType && id.value && types.some((type) => idType.includes(type))) {
      return id.value;
    }
  }
  return undefined;
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
    clauses.push(`(${sources.map((source) => `list_contains(sources, ${sqlString(source)})`).join(" OR ")})`);
  }

  const interactionAnnotationTerms = normalizeStringArray(filters.interaction_annotation_terms);
  if (interactionAnnotationTerms.length > 0) {
    clauses.push(`(${interactionAnnotationTerms.map((term) => `list_contains(interaction_annotation_terms, ${sqlString(term)})`).join(" OR ")})`);
  }

  const participantAnnotationTerms = normalizeStringArray(filters.participant_annotation_terms);
  if (participantAnnotationTerms.length > 0) {
    clauses.push(`(${participantAnnotationTerms.map((term) => `list_contains(participant_annotation_terms, ${sqlString(term)})`).join(" OR ")})`);
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
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

async function getViewColumns(connection: AsyncDuckDBConnection, viewName: string): Promise<Set<string>> {
  const rows = await runRowsQuery(connection, `DESCRIBE SELECT * FROM ${viewName}`);
  return new Set(rows.map((row) => String(row.column_name ?? "")).filter(Boolean));
}

export async function mountInteractionSubset(
  connection: AsyncDuckDBConnection,
  fileName: string,
  viewName = "interactions_subset",
): Promise<void> {
  await connection.query(`CREATE OR REPLACE VIEW ${viewName} AS SELECT * FROM read_parquet(${sqlString(fileName)})`);
}

export async function mountResourceInteractions(
  connection: AsyncDuckDBConnection,
  files: Array<{ fileName: string; resourceId: string }>,
  viewName = "interactions_subset",
): Promise<void> {
  const query = buildUnionQuery(
    files.map(({ fileName, resourceId }) => `
      SELECT
        CAST(interaction_id AS VARCHAR) AS interaction_key,
        interaction_id,
        CAST(entity_a_id AS VARCHAR) AS member_a_id,
        CAST(entity_b_id AS VARCHAR) AS member_b_id,
        COALESCE(NULLIF(mechanism_term, ''), NULLIF(statement_term, ''), 'interaction') AS interaction_type,
        CASE WHEN direction IS NULL OR direction = 0 THEN FALSE ELSE TRUE END AS is_directed,
        CAST(sign AS INTEGER) AS sign,
        COALESCE(array_length(evidence), 0) AS evidence_count,
        list_value(CAST(source AS VARCHAR)) AS sources,
        []::VARCHAR[] AS interaction_annotation_terms,
        []::VARCHAR[] AS participant_annotation_terms,
        CAST(source AS VARCHAR) AS source,
        ${sqlString(resourceId)} AS resource_id,
        mechanism_term,
        statement_term,
        evidence
      FROM read_parquet(${sqlString(fileName)})
    `),
  );

  await connection.query(`CREATE OR REPLACE VIEW ${viewName} AS ${query}`);
}

export async function mountEntitySubset(
  connection: AsyncDuckDBConnection,
  fileName: string,
  viewName = "entities_subset",
): Promise<void> {
  await connection.query(`CREATE OR REPLACE VIEW ${viewName} AS SELECT * FROM read_parquet(${sqlString(fileName)})`);
}

export async function mountResourceEntities(
  connection: AsyncDuckDBConnection,
  files: Array<{ fileName: string; resourceId: string }>,
  viewName = "entities_subset",
): Promise<void> {
  const query = buildUnionQuery(
    files.map(({ fileName, resourceId }) => `
      SELECT *, ${sqlString(resourceId)} AS resource_id
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

export async function queryInteractionPage(
  connection: AsyncDuckDBConnection,
  filters: InteractionLocalFilters,
  pageIndex: number,
  pageSize: number,
  viewName = "interactions_subset",
): Promise<DuckDbInteractionsPage> {
  const whereClause = buildInteractionWhereClause(filters);
  const offset = pageIndex * pageSize;

  const rows = await runRowsQuery(
    connection,
    `SELECT ${DEFAULT_INTERACTION_COLUMNS.join(", ")} FROM ${viewName} ${whereClause} ORDER BY evidence_count DESC NULLS LAST, interaction_key LIMIT ${pageSize} OFFSET ${offset}`,
  );

  const countRows = await runRowsQuery(connection, `SELECT COUNT(*) AS total_count FROM ${viewName} ${whereClause}`);
  const totalCount = Number(countRows[0]?.total_count || 0);

  return { rows, totalCount };
}

async function queryScalarFacet(
  connection: AsyncDuckDBConnection,
  column: string,
  filters: InteractionLocalFilters,
  viewName: string,
): Promise<DuckDbFacetBucket[]> {
  const whereClause = buildInteractionWhereClause(filters);
  return runFacetQuery(
    connection,
    `SELECT CAST(${column} AS VARCHAR) AS value, COUNT(*) AS count FROM ${viewName} ${whereClause} GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 25`,
  );
}

async function queryListFacet(
  connection: AsyncDuckDBConnection,
  column: string,
  filters: InteractionLocalFilters,
  viewName: string,
): Promise<DuckDbFacetBucket[]> {
  const whereClause = buildInteractionWhereClause(filters);
  return runFacetQuery(
    connection,
    `WITH filtered AS (SELECT * FROM ${viewName} ${whereClause}) SELECT CAST(value AS VARCHAR) AS value, COUNT(*) AS count FROM filtered, UNNEST(${column}) AS t(value) GROUP BY 1 ORDER BY count DESC, value ASC LIMIT 25`,
  );
}

async function runFacetQuery(connection: AsyncDuckDBConnection, sql: string): Promise<DuckDbFacetBucket[]> {
  const rows = await runRowsQuery(connection, sql);
  return rows
    .map((row) => ({
      value: String(row.value ?? ""),
      count: Number(row.count ?? 0),
    }))
    .filter((row) => row.value.length > 0);
}

export async function queryInteractionFacets(
  connection: AsyncDuckDBConnection,
  filters: InteractionLocalFilters,
  viewName = "interactions_subset",
): Promise<DuckDbFacetCounts> {
  const [interaction_type, sign, is_directed, sources] = await Promise.all([
    queryScalarFacet(connection, "interaction_type", filters, viewName),
    queryScalarFacet(connection, "sign", filters, viewName),
    queryScalarFacet(connection, "is_directed", filters, viewName),
    queryListFacet(connection, "sources", filters, viewName),
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

export async function queryInteractionEntityIds(
  connection: AsyncDuckDBConnection,
  viewName = "interactions_subset",
): Promise<string[]> {
  const rows = await runRowsQuery(
    connection,
    `SELECT DISTINCT entity_id FROM (
      SELECT CAST(member_a_id AS VARCHAR) AS entity_id FROM ${viewName}
      UNION
      SELECT CAST(member_b_id AS VARCHAR) AS entity_id FROM ${viewName}
    ) t
    WHERE entity_id IS NOT NULL
    ORDER BY entity_id`,
  );

  return rows.map((row) => String(row.entity_id)).filter(Boolean);
}

export async function queryEntitySummaries(
  connection: AsyncDuckDBConnection,
  viewName = "entities_subset",
): Promise<Map<string, { id: string; canonical_identifier: string; display_name: string; entity_type_name?: string }>> {
  const columns = await getViewColumns(connection, viewName);
  if (!columns.has("names") && !columns.has("display_name")) {
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
        const sourceIdentifiers = orderIdentifierRows(sourceByEntity.get(id) || [], entityType);
        const resolvedIdentifiers = orderIdentifierRows((resolvedByEntity.get(id) || []).map((item) => ({ identifier: item.identifier, identifier_type: item.identifier_type })), entityType);
        const canonicalResolved = (resolvedByEntity.get(id) || []).find((item) => item.is_canonical);
        const secondaryIdentifier = resolvedIdentifiers.sort((a, b) => secondaryPriority(entityType, a.identifier_type) - secondaryPriority(entityType, b.identifier_type))[0]?.identifier;
        const displayName = sourceIdentifiers.sort((a, b) => displayPriority(entityType, a.identifier_type) - displayPriority(entityType, b.identifier_type))[0]?.identifier
          || secondaryIdentifier
          || canonicalResolved?.identifier
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

  const selectedColumns = ["entity_id", "entity_type", "names", "gene_symbols", "identifiers"]
    .filter((column) => columns.has(column));

  const rows = await runRowsQuery(
    connection,
    `SELECT ${selectedColumns.join(", ")} FROM ${viewName}`,
  );

  return new Map(
    rows.map((row) => {
      const entity = adaptEntityRowToSearchResult(row);
      const id = String(entity.entity_id ?? entity.id);
      const { displayName, canonicalIdentifier, entityTypeName } = deriveEntityPresentation(entity);
      return [id, {
        id,
        canonical_identifier: canonicalIdentifier,
        display_name: displayName,
        entity_type_name: entityTypeName,
      }];
    }),
  );
}

export async function queryEntityById(
  connection: AsyncDuckDBConnection,
  entityId: string,
  viewName = "entities_subset",
): Promise<SearchResult | null> {
  const columns = await getViewColumns(connection, viewName);
  if (!columns.has("names") && !columns.has("display_name")) {
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
        entities.*, source_names.display_name, canonical.canonical_identifier, canonical.canonical_identifier_type
      FROM ${viewName} AS entities
      LEFT JOIN source_names ON TRUE
      LEFT JOIN canonical ON TRUE
      WHERE CAST(entities.entity_id AS VARCHAR) = ${sqlString(entityId)}
      LIMIT 1`,
    );

    if (rows.length === 0) return null;
    const row = rows[0];
    const displayName = String(row.display_name ?? row.canonical_identifier ?? row.entity_id ?? "");
    const identifierRows = orderIdentifierRows(
      await runRowsQuery(
        connection,
        `SELECT identifier, identifier_type FROM resource_entity_identifiers_resolved WHERE entity_id = ${sqlString(entityId)}
         UNION
         SELECT identifier, identifier_type FROM resource_entity_identifiers_source WHERE entity_id = ${sqlString(entityId)}`,
      ) as Array<{ identifier: string; identifier_type: string }>,
      row.entity_type,
    );

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
      identifiers: identifierRows.map((identifierRow) => ({
        key: String(identifierRow.identifier_type ?? "identifier"),
        value: String(identifierRow.identifier ?? ""),
      })).filter((item) => item.value.length > 0),
    };
  }

  const selectedColumns = Array.from(columns);
  const rows = await runRowsQuery(
    connection,
    `SELECT ${selectedColumns.join(", ")} FROM ${viewName} WHERE CAST(entity_id AS VARCHAR) = ${sqlString(entityId)} LIMIT 1`,
  );

  if (rows.length === 0) return null;
  return adaptEntityRowToSearchResult(rows[0]);
}

function deriveEntityPresentation(entity: SearchResult): {
  displayName: string;
  canonicalIdentifier: string;
  entityTypeName?: string;
} {
  const names = toStringArray(entity.names);
  const geneSymbols = toStringArray(entity.gene_symbols);
  const identifiers = toIdentifierArray(entity.identifiers);
  const entityTypeName = entity.entity_type?.split(":")[0];

  let displayName: string;
  let canonicalIdentifier: string;

  if (isSmallMoleculeType(entityTypeName)) {
    const shortName = getShortestName(names);
    const chemblId = getIdentifierByType(identifiers, ["chembl"]);
    const pubchemId = getIdentifierByType(identifiers, ["pubchem", "cid"]);

    if (chemblId) {
      displayName = chemblId;
    } else if (shortName && !/^\d+$/.test(shortName)) {
      displayName = shortName;
    } else {
      displayName = pubchemId || shortName || String(entity.entity_id ?? entity.id);
    }

    canonicalIdentifier = chemblId || pubchemId || names[0] || String(entity.entity_id ?? entity.id);
  } else if (entityTypeName?.toLowerCase() === "protein") {
    const uniprotId = getIdentifierByType(identifiers, ["uniprot", "uniprotkb"]);
    displayName = geneSymbols[0] || uniprotId || names[0] || String(entity.entity_id ?? entity.id);
    canonicalIdentifier = uniprotId || names[0] || String(entity.entity_id ?? entity.id);
  } else {
    displayName = geneSymbols[0] || names[0] || String(entity.entity_id ?? entity.id);
    canonicalIdentifier = identifiers[0]?.value || names[0] || String(entity.entity_id ?? entity.id);
  }

  return { displayName, canonicalIdentifier, entityTypeName };
}

function adaptEntityRowToSearchResult(row: Record<string, unknown>): SearchResult {
  const entityId = String(row.entity_id ?? row.id ?? "");
  const fallbackDisplayName = typeof row.display_name === "string" ? row.display_name.trim() : "";
  const fallbackCanonicalIdentifier = typeof row.canonical_identifier === "string" ? row.canonical_identifier.trim() : "";
  const fallbackSource = typeof row.source === "string" ? row.source.trim() : "";
  const names = toStringArray(row.names).length > 0
    ? toStringArray(row.names)
    : [fallbackDisplayName || fallbackCanonicalIdentifier].filter(Boolean);
  const geneSymbols = toStringArray(row.gene_symbols);
  const descriptions = toStringArray(row.descriptions);
  const references = toStringArray(row.references);
  const sources = toStringArray(row.sources).length > 0 ? toStringArray(row.sources) : [fallbackSource].filter(Boolean);
  const synonyms = toStringArray(row.synonyms);
  const ontologyTerms = toStringArray(row.ontology_terms);
  const cvTerms = toStringArray(row.cv_terms);
  const identifiers = toIdentifierArray(row.identifiers).length > 0
    ? toIdentifierArray(row.identifiers)
    : fallbackCanonicalIdentifier
      ? [{
          key: typeof row.canonical_identifier_type === "string" ? row.canonical_identifier_type : "identifier",
          value: fallbackCanonicalIdentifier,
        }]
      : [];

  return {
    ...(row as SearchResult),
    id: entityId,
    entity_id: entityId,
    type: "entity",
    names,
    gene_symbols: geneSymbols,
    descriptions,
    references,
    sources,
    synonyms,
    ontology_terms: ontologyTerms,
    cv_terms: cvTerms,
    identifiers,
  };
}
