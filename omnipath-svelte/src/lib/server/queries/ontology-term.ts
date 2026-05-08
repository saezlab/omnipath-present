import type { PoolClient } from "pg";
import { getPool } from "$lib/server/db/client";
import { toPublicEntityId } from "$lib/entity-public-id";

export type OntologyTerm = {
  termId: string;
  ontologyPrefix: string | null;
  label: string | null;
  definition: string | null;
  synonyms: string[];
  ontologyId: string | null;
  sources: string[];
};

type OntologyTermRow = {
  term_entity_pk: string | number;
  term_id: string;
  ontology_prefix: string | null;
  label: string | null;
  definition: string | null;
  synonyms: string[] | null;
  synonyms_text?: string | null;
  ontology_id: string | null;
  sources: string[] | null;
};

function ontologyTermsTable(schema: string, alias = "terms"): string {
  return `${schema}.ontology_terms ${alias}`;
}

function ontologyTermSearchPredicate(placeholder: string): string {
  return `(
    terms.term_id ILIKE ${placeholder}
    OR terms.label ILIKE ${placeholder}
    OR terms.definition ILIKE ${placeholder}
    OR terms.ontology_prefix ILIKE ${placeholder}
    OR terms.synonyms_text ILIKE ${placeholder}
  )`;
}

function toOntologyTerm(row: OntologyTermRow): OntologyTerm {
  return {
    termId: row.term_id,
    ontologyPrefix: row.ontology_prefix,
    label: row.label,
    definition: row.definition,
    ontologyId: row.ontology_id,
    synonyms: row.synonyms || [],
    sources: row.sources || [],
  };
}

export type OntologyTermWithAnnotationCounts = OntologyTerm & {
  annotatedEntityCount: number;
  annotatedRelationCount: number;
  annotatedItemCount: number;
};

export type ScopedOntologyTerm = OntologyTerm & {
  annotatedEntityCount: number;
  annotatedRelationCount: number;
};

export async function getOntologyTermsByIds(termIds: string[]): Promise<OntologyTerm[]> {
  const normalized = Array.from(new Set(termIds.map((t) => t.trim()).filter(Boolean)));
  if (normalized.length === 0) return [];
  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const result = await client.query<OntologyTermRow>(
      `SELECT terms.*
       FROM ${ontologyTermsTable(S)}
       WHERE terms.term_id = ANY($1::text[])
       ORDER BY terms.term_id`,
      [normalized],
    );
    return result.rows.map(toOntologyTerm);
  } finally {
    client.release();
  }
}

export async function searchOntologyTerms({
  query = "",
  ontologyIds,
  limit = 24,
  offset = 0,
}: {
  query?: string;
  ontologyIds?: string[];
  limit?: number;
  offset?: number;
} = {}): Promise<OntologyTermWithAnnotationCounts[]> {
  const normalizedOntologyIds = Array.from(new Set((ontologyIds || []).map((id) => id.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const client = await getPool().connect();

  try {
    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = [];
    const whereParts: string[] = [];

    if (trimmedQuery) {
      params.push(`%${trimmedQuery}%`);
      const placeholder = `$${params.length}`;
      whereParts.push(ontologyTermSearchPredicate(placeholder));
    }

    if (normalizedOntologyIds.length > 0) {
      params.push(normalizedOntologyIds);
      whereParts.push(`terms.ontology_id = ANY($${params.length}::text[])`);
    }

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(offset);
    const offsetPlaceholder = `$${params.length}`;
    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const result = await client.query<{
      term_entity_pk: string | number;
      term_id: string;
      ontology_prefix: string | null;
      ontology_id: string | null;
      label: string | null;
      definition: string | null;
      synonyms: string[] | null;
      sources: string[] | null;
      annotated_entity_count: string | number | null;
      annotated_relation_count: string | number | null;
      annotated_item_count: string | number | null;
    }>(
      `SELECT
         terms.*,
         COALESCE(entity_counts.global_count, 0) AS annotated_entity_count,
         COALESCE(relation_counts.global_count, 0) AS annotated_relation_count,
         COALESCE(entity_counts.global_count, 0) + COALESCE(relation_counts.global_count, 0) AS annotated_item_count
       FROM ${ontologyTermsTable(SEARCH_SCHEMA)}
       LEFT JOIN ${SEARCH_SCHEMA}.annotation_term_entity_bitmap entity_counts
         ON entity_counts.term_entity_pk = terms.term_entity_pk
       LEFT JOIN ${SEARCH_SCHEMA}.annotation_term_relation_bitmap relation_counts
         ON relation_counts.term_entity_pk = terms.term_entity_pk
       ${whereClause}
       ORDER BY annotated_item_count DESC, terms.term_id ASC
       LIMIT ${limitPlaceholder}
       OFFSET ${offsetPlaceholder}`,
      params,
    );

    return result.rows.map((row) => ({
      termId: row.term_id,
      ontologyPrefix: row.ontology_prefix,
      label: row.label,
      definition: row.definition,
      ontologyId: row.ontology_id,
      synonyms: row.synonyms || [],
      sources: row.sources || [],
      annotatedEntityCount: Number(row.annotated_entity_count || 0),
      annotatedRelationCount: Number(row.annotated_relation_count || 0),
      annotatedItemCount: Number(row.annotated_item_count || 0),
    }));
  } finally {
    client.release();
  }
}

let ontologyPrefixesCache: { value: string[]; expiresAt: number } | null = null;
let ontologyPrefixesInFlight: Promise<string[]> | null = null;

export async function getOntologyPrefixes(): Promise<string[]> {
  const now = Date.now();
  if (ontologyPrefixesCache && ontologyPrefixesCache.expiresAt > now) {
    return ontologyPrefixesCache.value;
  }
  if (ontologyPrefixesInFlight) {
    return ontologyPrefixesInFlight;
  }

  ontologyPrefixesInFlight = (async () => {
    const client = await getPool().connect();
    try {
      const S = process.env.OMNIPATH_PG_SCHEMA || "public";
      const result = await client.query<{ prefix: string | null }>(
        `SELECT DISTINCT ontology_prefix AS prefix
         FROM ${ontologyTermsTable(S)}
         WHERE ontology_prefix IS NOT NULL
         ORDER BY prefix`,
      );
      const value = result.rows.map((r) => String(r.prefix)).filter(Boolean);
      ontologyPrefixesCache = {
        value,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
      return value;
    } finally {
      ontologyPrefixesInFlight = null;
      client.release();
    }
  })();

  return ontologyPrefixesInFlight;
}

async function searchScopedOntologyTermsRelational({
  entityPks,
  termIds,
  query,
  prefixes,
  ontologyIds,
  limit,
  offset,
  client,
  schema,
}: {
  entityPks: number[];
  termIds: string[];
  query: string;
  prefixes: string[];
  ontologyIds: string[];
  limit: number;
  offset: number;
  client: PoolClient;
  schema: string;
}): Promise<ScopedOntologyTerm[]> {
  const params: unknown[] = [];

  const pushParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const hasTermIds = termIds.length > 0;
  const hasEntityPks = entityPks.length > 0;

  // Build CTEs to force phased execution and avoid 4.7M-row fan-out
  const cteParts: string[] = [];

  if (hasTermIds) {
    const termParam = pushParam(termIds);
    cteParts.push(`scope_entity_pks AS MATERIALIZED (
      SELECT DISTINCT er.subject_entity_pk AS entity_pk
      FROM ${schema}.entity_relation er
      WHERE er.relation_category = 'association'
        AND er.object_entity_pk IN (
          SELECT terms.term_entity_pk FROM ${ontologyTermsTable(schema)} WHERE terms.term_id = ANY(${termParam}::text[])
        )
    )`);
  }

  let scopeTermPksFrom: string = hasTermIds
    ? `FROM ${schema}.entity_relation er WHERE er.relation_category = 'association' AND er.subject_entity_pk IN (SELECT entity_pk FROM scope_entity_pks)`
    : `FROM ${schema}.entity_relation er WHERE er.relation_category = 'association' AND er.subject_entity_pk = ANY(${pushParam(entityPks.map(String))}::bigint[])`;

  if (hasTermIds && hasEntityPks) {
    const ePksParam = pushParam(entityPks.map(String));
    scopeTermPksFrom = `FROM ${schema}.entity_relation er WHERE er.relation_category = 'association' AND (er.subject_entity_pk IN (SELECT entity_pk FROM scope_entity_pks) OR er.subject_entity_pk = ANY(${ePksParam}::bigint[]))`;
  }

  cteParts.push(`scope_term_pks AS MATERIALIZED (
    SELECT DISTINCT er.object_entity_pk AS term_entity_pk
    ${scopeTermPksFrom}
  )`);

  const whereParts: string[] = [];
  if (query) {
    const placeholder = pushParam(`%${query}%`);
    whereParts.push(ontologyTermSearchPredicate(placeholder));
  }

  if (prefixes.length > 0) {
    const prefixParam = pushParam(prefixes);
    whereParts.push(`terms.ontology_prefix = ANY(${prefixParam}::text[])`);
  }

  if (ontologyIds.length > 0) {
    const ontologyParam = pushParam(ontologyIds);
    whereParts.push(`terms.ontology_id = ANY(${ontologyParam}::text[])`);
  }

  const limitParam = pushParam(limit);
  const offsetParam = pushParam(offset);
  const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";

  const result = await client.query<{
    term_id: string;
    ontology_prefix: string | null;
    ontology_id: string | null;
    label: string | null;
    definition: string | null;
    synonyms: string[] | null;
    sources: string[] | null;
    annotated_entity_count: string | number;
    annotated_relation_count: string | number;
  }>(
    `WITH ${cteParts.join(",\n")},
     scope_term_counts AS MATERIALIZED (
       SELECT er.object_entity_pk AS term_entity_pk, COUNT(DISTINCT er.subject_entity_pk) AS annotated_entity_count
       ${scopeTermPksFrom}
       GROUP BY er.object_entity_pk
     )
     SELECT
       terms.*,
       scope_term_counts.annotated_entity_count,
       0 AS annotated_relation_count
     FROM scope_term_counts
     JOIN ${ontologyTermsTable(schema)} ON terms.term_entity_pk = scope_term_counts.term_entity_pk
     WHERE true
     ${whereClause}
     ORDER BY scope_term_counts.annotated_entity_count DESC, terms.term_id ASC
     LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    params,
  );

  return result.rows.map((row) => ({
    termId: row.term_id,
    ontologyPrefix: row.ontology_prefix,
    label: row.label,
    definition: row.definition,
    ontologyId: row.ontology_id,
    synonyms: row.synonyms || [],
    sources: row.sources || [],
    annotatedEntityCount: Number(row.annotated_entity_count || 0),
    annotatedRelationCount: Number(row.annotated_relation_count || 0),
  }));
}

async function searchScopedOntologyTermsBitmap({
  entityPks,
  termIds,
  query,
  prefixes,
  ontologyIds,
  limit,
  offset,
  client,
  schema,
}: {
  entityPks: number[];
  termIds: string[];
  query: string;
  prefixes: string[];
  ontologyIds: string[];
  limit: number;
  offset: number;
  client: PoolClient;
  schema: string;
}): Promise<ScopedOntologyTerm[]> {
  const params: unknown[] = [];

  const pushParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const hasTermIds = termIds.length > 0;
  const hasEntityPks = entityPks.length > 0;

  // pg_roaringbitmap stores 32-bit integers. PostgreSQL's integer type is
  // signed 32-bit, so entity_pk::integer will overflow above 2_147_483_647.
  // If entity PKs exceed this range we must fall back to the relational path.
  if (hasEntityPks) {
    const maxPk = Math.max(...entityPks);
    if (maxPk > 2147483647) {
      throw new Error("Entity PK exceeds 32-bit range; bitmap path requires ordinal mapping");
    }
  }

  // Build scope bitmap by ORing bitmaps of selected terms and selected entity PKs.
  const scopeParts: string[] = [];

  if (hasTermIds) {
    const termParam = pushParam(termIds);
    scopeParts.push(`SELECT b.entity_bitmap AS bitmap
      FROM ${ontologyTermsTable(schema)}
      JOIN ${schema}.annotation_term_entity_bitmap b ON b.term_entity_pk = terms.term_entity_pk
      WHERE terms.term_id = ANY(${termParam}::text[])`);
  }

  if (hasEntityPks) {
    const ePkParam = pushParam(entityPks);
    scopeParts.push(`SELECT rb_build(${ePkParam}::integer[]) AS bitmap`);
  }

  const scopeBitmapSql = `scope_bitmap AS MATERIALIZED (
    SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
    FROM (
      ${scopeParts.join("\n      UNION ALL\n      ")}
    ) scope_parts
  )`;

  const whereParts: string[] = [];
  if (query) {
    const placeholder = pushParam(`%${query}%`);
    whereParts.push(ontologyTermSearchPredicate(placeholder));
  }

  if (prefixes.length > 0) {
    const prefixParam = pushParam(prefixes);
    whereParts.push(`terms.ontology_prefix = ANY(${prefixParam}::text[])`);
  }

  if (ontologyIds.length > 0) {
    const ontologyParam = pushParam(ontologyIds);
    whereParts.push(`terms.ontology_id = ANY(${ontologyParam}::text[])`);
  }

  const limitParam = pushParam(limit);
  const offsetParam = pushParam(offset);
  const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";

  const result = await client.query<{
    term_id: string;
    ontology_prefix: string | null;
    ontology_id: string | null;
    label: string | null;
    definition: string | null;
    synonyms: string[] | null;
    sources: string[] | null;
    annotated_entity_count: string | number;
    annotated_relation_count: string | number;
  }>(
    `WITH ${scopeBitmapSql}
     SELECT
       terms.term_id,
       terms.ontology_prefix,
       terms.ontology_id,
       terms.label,
       terms.definition,
       terms.synonyms,
       terms.sources,
       sc.scoped_count AS annotated_entity_count,
       0 AS annotated_relation_count
     FROM ${ontologyTermsTable(schema)}
     JOIN ${schema}.annotation_term_entity_bitmap b ON b.term_entity_pk = terms.term_entity_pk
     CROSS JOIN scope_bitmap sb
     CROSS JOIN LATERAL (
       SELECT rb_cardinality(rb_and(b.entity_bitmap, sb.bitmap)) AS scoped_count
     ) sc
     WHERE sc.scoped_count > 0
       ${whereClause}
     ORDER BY sc.scoped_count DESC, terms.term_id ASC
     LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    params,
  );

  return result.rows.map((row) => ({
    termId: row.term_id,
    ontologyPrefix: row.ontology_prefix,
    label: row.label,
    definition: row.definition,
    ontologyId: row.ontology_id,
    synonyms: row.synonyms || [],
    sources: row.sources || [],
    annotatedEntityCount: Number(row.annotated_entity_count || 0),
    annotatedRelationCount: Number(row.annotated_relation_count || 0),
  }));
}

export async function searchScopedOntologyTerms({
  entityPks = [],
  termIds = [],
  query = "",
  prefixes,
  ontologyIds,
  limit = 24,
  offset = 0,
}: {
  entityPks?: number[];
  termIds?: string[];
  query?: string;
  prefixes?: string[];
  ontologyIds?: string[];
  limit?: number;
  offset?: number;
}): Promise<ScopedOntologyTerm[]> {
  const normalizedEntityPks = Array.from(new Set(entityPks.filter(Number.isFinite)));
  const normalizedTermIds = Array.from(new Set(termIds.map((id) => id.trim()).filter(Boolean)));
  if (normalizedEntityPks.length === 0 && normalizedTermIds.length === 0) return [];

  const normalizedPrefixes = Array.from(new Set((prefixes || []).map((prefix) => prefix.trim()).filter(Boolean)));
  const normalizedOntologyIds = Array.from(new Set((ontologyIds || []).map((id) => id.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const client = await getPool().connect();

  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";

    // Fast path: use bitmap-based set intersection when the table is populated.
    const bitmapCheck = await client.query<{ ready: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = 'annotation_term_entity_bitmap'
      ) AND EXISTS (
        SELECT 1 FROM ${S}.annotation_term_entity_bitmap LIMIT 1
      ) AS ready`,
      [S],
    );
    const useBitmap = bitmapCheck.rows[0]?.ready === true;

    if (useBitmap) {
      try {
        return await searchScopedOntologyTermsBitmap({
          entityPks: normalizedEntityPks,
          termIds: normalizedTermIds,
          query: trimmedQuery,
          prefixes: normalizedPrefixes,
          ontologyIds: normalizedOntologyIds,
          limit,
          offset,
          client,
          schema: S,
        });
      } catch (err) {
        // Bitmap path can fail if the extension is missing, entity PKs exceed
        // 32-bit range, or the table is empty. Fall back to relational path.
        console.warn("Bitmap scoped search failed, falling back to relational path:", err);
      }
    }

    return await searchScopedOntologyTermsRelational({
      entityPks: normalizedEntityPks,
      termIds: normalizedTermIds,
      query: trimmedQuery,
      prefixes: normalizedPrefixes,
      ontologyIds: normalizedOntologyIds,
      limit,
      offset,
      client,
      schema: S,
    });
  } finally {
    client.release();
  }
}

export type OntologyPrefixCount = {
  prefix: string;
  scopedCount: number;
};

export type OntologySourceCount = {
  source: string;
  scopedCount: number;
};

export async function getScopedOntologyPrefixCounts({
  entityPks = [],
  annotationTermIds = [],
  query = "",
}: {
  entityPks?: number[];
  annotationTermIds?: string[];
  query?: string;
}): Promise<OntologyPrefixCount[]> {
  const normalizedEntityPks = Array.from(new Set(entityPks.filter(Number.isFinite)));
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const hasScope = normalizedEntityPks.length > 0 || normalizedTermIds.length > 0;

  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = [];

    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    // No scope: return total term counts per prefix.
    if (!hasScope) {
      const whereParts: string[] = [];
      if (trimmedQuery) {
        const queryParam = pushParam(`%${trimmedQuery}%`);
        whereParts.push(ontologyTermSearchPredicate(queryParam));
      }
      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

      const result = await client.query<{
        ontology_prefix: string | null;
        scoped_count: string | number;
      }>(
        `SELECT terms.ontology_prefix, COUNT(*) AS scoped_count
         FROM ${ontologyTermsTable(S)}
         ${whereClause}
         GROUP BY terms.ontology_prefix
         ORDER BY scoped_count DESC`,
        params,
      );

      return result.rows.map((row) => ({
        prefix: row.ontology_prefix ?? "unknown",
        scopedCount: Number(row.scoped_count || 0),
      }));
    }

    // Scoped: count terms that annotate the selected entities.
    const ctes: string[] = [];
    const scopeParts: string[] = [];
    if (normalizedTermIds.length > 0) {
      const termParam = pushParam(normalizedTermIds);
      scopeParts.push(`SELECT b.entity_bitmap AS bitmap
        FROM ${ontologyTermsTable(S)}
        JOIN ${S}.annotation_term_entity_bitmap b ON b.term_entity_pk = terms.term_entity_pk
        WHERE terms.term_id = ANY(${termParam}::text[])`);
    }
    if (normalizedEntityPks.length > 0) {
      const maxPk = Math.max(...normalizedEntityPks);
      if (maxPk > 2147483647) {
        throw new Error("Entity PK exceeds 32-bit range; bitmap path requires ordinal mapping");
      }
      const ePkParam = pushParam(normalizedEntityPks);
      scopeParts.push(`SELECT rb_build(${ePkParam}::integer[]) AS bitmap`);
    }

    ctes.push(`scope_base AS MATERIALIZED (
      SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM (
        ${scopeParts.join("\n        UNION ALL\n        ")}
      ) scope_parts
    )`);

    const whereParts: string[] = [];
    if (trimmedQuery) {
      const queryParam = pushParam(`%${trimmedQuery}%`);
      whereParts.push(ontologyTermSearchPredicate(queryParam));
    }

    const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";

    const result = await client.query<{
      ontology_prefix: string | null;
      scoped_count: string | number;
    }>(
      `WITH ${ctes.join(",\n")}
       SELECT terms.ontology_prefix, COUNT(*) AS scoped_count
       FROM ${ontologyTermsTable(S)}
       JOIN ${S}.annotation_term_entity_bitmap b ON b.term_entity_pk = terms.term_entity_pk
       CROSS JOIN scope_base sb
       WHERE rb_cardinality(rb_and(b.entity_bitmap, sb.bitmap)) > 0
         ${whereClause}
       GROUP BY terms.ontology_prefix
       ORDER BY scoped_count DESC`,
      params,
    );

    return result.rows.map((row) => ({
      prefix: row.ontology_prefix ?? "unknown",
      scopedCount: Number(row.scoped_count || 0),
    }));
  } finally {
    client.release();
  }
}

export type OntologyIdCount = {
  ontologyId: string;
  scopedCount: number;
};

export async function getScopedOntologyIdCounts({
  entityPks = [],
  annotationTermIds = [],
  query = "",
}: {
  entityPks?: number[];
  annotationTermIds?: string[];
  query?: string;
}): Promise<OntologyIdCount[]> {
  const normalizedEntityPks = Array.from(new Set(entityPks.filter(Number.isFinite)));
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const hasScope = normalizedEntityPks.length > 0 || normalizedTermIds.length > 0;

  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = [];
    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const queryWhereParts: string[] = [];
    if (trimmedQuery) {
      const queryParam = pushParam(`%${trimmedQuery}%`);
      queryWhereParts.push(ontologyTermSearchPredicate(queryParam));
    }

    if (!hasScope) {
      if (!trimmedQuery) {
        const result = await client.query<{ ontology_id: string; scoped_count: string | number }>(
          `SELECT facet_value AS ontology_id, entity_count AS scoped_count
           FROM ${S}.facet_entity_bitmap
           WHERE facet_name = 'ontology_id'
           ORDER BY entity_count DESC, facet_value ASC`,
        );
        return result.rows.map((row) => ({ ontologyId: row.ontology_id, scopedCount: Number(row.scoped_count || 0) }));
      }

      const whereClause = queryWhereParts.length > 0 ? `WHERE ${queryWhereParts.join(" AND ")}` : "";
      const result = await client.query<{ ontology_id: string | null; scoped_count: string | number }>(
        `SELECT terms.ontology_id, COUNT(*) AS scoped_count
         FROM ${ontologyTermsTable(S)}
         ${whereClause}
         GROUP BY terms.ontology_id
         ORDER BY scoped_count DESC, terms.ontology_id ASC`,
        params,
      );
      return result.rows
        .filter((row) => row.ontology_id)
        .map((row) => ({ ontologyId: row.ontology_id || "unknown", scopedCount: Number(row.scoped_count || 0) }));
    }

    const scopeParts: string[] = [];
    if (normalizedTermIds.length > 0) {
      const termParam = pushParam(normalizedTermIds);
      scopeParts.push(`SELECT b.entity_bitmap AS bitmap
        FROM ${ontologyTermsTable(S)}
        JOIN ${S}.annotation_term_entity_bitmap b ON b.term_entity_pk = terms.term_entity_pk
        WHERE terms.term_id = ANY(${termParam}::text[])`);
    }
    if (normalizedEntityPks.length > 0) {
      const maxPk = Math.max(...normalizedEntityPks);
      if (maxPk > 2147483647) {
        throw new Error("Entity PK exceeds 32-bit range; bitmap path requires ordinal mapping");
      }
      const ePkParam = pushParam(normalizedEntityPks);
      scopeParts.push(`SELECT rb_build(${ePkParam}::integer[]) AS bitmap`);
    }

    const whereClause = queryWhereParts.length > 0 ? `AND ${queryWhereParts.join(" AND ")}` : "";
    const result = await client.query<{ ontology_id: string | null; scoped_count: string | number }>(
      `WITH scope_base AS MATERIALIZED (
        SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM (
          ${scopeParts.join("\n          UNION ALL\n          ")}
        ) scope_parts
      )
       SELECT terms.ontology_id, COUNT(*) AS scoped_count
       FROM ${ontologyTermsTable(S)}
       JOIN ${S}.annotation_term_entity_bitmap b ON b.term_entity_pk = terms.term_entity_pk
       CROSS JOIN scope_base sb
       WHERE rb_cardinality(rb_and(b.entity_bitmap, sb.bitmap)) > 0
         ${whereClause}
       GROUP BY terms.ontology_id
       ORDER BY scoped_count DESC, terms.ontology_id ASC`,
      params,
    );

    return result.rows
      .filter((row) => row.ontology_id)
      .map((row) => ({ ontologyId: row.ontology_id || "unknown", scopedCount: Number(row.scoped_count || 0) }));
  } finally {
    client.release();
  }
}

export async function getScopedOntologySourceCounts({
  entityPks = [],
  annotationTermIds = [],
  query = "",
}: {
  entityPks?: number[];
  annotationTermIds?: string[];
  query?: string;
}): Promise<OntologySourceCount[]> {
  const normalizedEntityPks = Array.from(new Set(entityPks.filter(Number.isFinite)));
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const hasScope = normalizedEntityPks.length > 0 || normalizedTermIds.length > 0;

  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = [];

    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const whereParts: string[] = [];
    if (trimmedQuery) {
      const queryParam = pushParam(`%${trimmedQuery}%`);
      whereParts.push(ontologyTermSearchPredicate(queryParam));
    }

    if (!hasScope) {
      const termWhereClause = ["source.value <> ''", ...whereParts].join(" AND ");
      const result = await client.query<{
        source: string | null;
        scoped_count: string | number;
      }>(
        `SELECT source_counts.source, source_counts.scoped_count
         FROM (
           SELECT source.value AS source, COUNT(*) AS scoped_count
           FROM ${ontologyTermsTable(S)}
           CROSS JOIN LATERAL unnest(terms.sources) AS source(value)
           WHERE ${termWhereClause}
           GROUP BY source.value
         ) source_counts
         LEFT JOIN ${S}.resources r ON r.resource_id = source_counts.source
         ORDER BY source_counts.scoped_count DESC, COALESCE(r.resource_name, source_counts.source) ASC, source_counts.source ASC`,
        params,
      );

      return result.rows.map((row) => ({
        source: row.source ?? "unknown",
        scopedCount: Number(row.scoped_count || 0),
      }));
    }

    const scopeParts: string[] = [];
    if (normalizedTermIds.length > 0) {
      const termParam = pushParam(normalizedTermIds);
      scopeParts.push(`SELECT b.entity_bitmap AS bitmap
        FROM ${ontologyTermsTable(S)}
        JOIN ${S}.annotation_term_entity_bitmap b ON b.term_entity_pk = terms.term_entity_pk
        WHERE terms.term_id = ANY(${termParam}::text[])`);
    }
    if (normalizedEntityPks.length > 0) {
      const maxPk = Math.max(...normalizedEntityPks);
      if (maxPk > 2147483647) {
        throw new Error("Entity PK exceeds 32-bit range; bitmap path requires ordinal mapping");
      }
      const ePkParam = pushParam(normalizedEntityPks);
      scopeParts.push(`SELECT rb_build(${ePkParam}::integer[]) AS bitmap`);
    }

    const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";
    const result = await client.query<{
      source: string | null;
      scoped_count: string | number;
    }>(
      `WITH scope_base AS MATERIALIZED (
        SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM (
          ${scopeParts.join("\n          UNION ALL\n          ")}
        ) scope_parts
      )
       SELECT source.value AS source, COUNT(*) AS scoped_count
       FROM ${ontologyTermsTable(S)}
       JOIN ${S}.annotation_term_entity_bitmap b ON b.term_entity_pk = terms.term_entity_pk
       CROSS JOIN scope_base sb
       CROSS JOIN LATERAL unnest(terms.sources) AS source(value)
       WHERE rb_cardinality(rb_and(b.entity_bitmap, sb.bitmap)) > 0
         AND source.value <> ''
         ${whereClause}
       GROUP BY source.value
       ORDER BY scoped_count DESC, source.value ASC`,
      params,
    );

    return result.rows.map((row) => ({
      source: row.source ?? "unknown",
      scopedCount: Number(row.scoped_count || 0),
    }));
  } finally {
    client.release();
  }
}

/** Rebuild all bitmap tables from current database snapshots.
 *  Populated by omnipath_build; this is a convenience wrapper for manual rebuilds.
 */
export async function rebuildAllBitmaps(): Promise<void> {
  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    await client.query(`CALL ${S}.rebuild_all_bitmaps()`);
  } finally {
    client.release();
  }
}

/** @deprecated Use {@link rebuildAllBitmaps} instead. Rebuilds only annotation-term → entity bitmaps. */
export async function rebuildAnnotationTermBitmaps(): Promise<void> {
  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    await client.query(`CALL ${S}.rebuild_annotation_term_bitmaps()`);
  } finally {
    client.release();
  }
}

export async function getEntityIdsForAnnotationTerms(termIds: string[]): Promise<string[]> {
  const normalized = Array.from(new Set(termIds.map((t) => t.trim()).filter(Boolean)));
  if (normalized.length === 0) return [];

  const client = await getPool().connect();
  try {
    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const result = await client.query(
      `SELECT DISTINCT
         es.canonical_identifier,
         es.canonical_identifier_type
       FROM ${SEARCH_SCHEMA}.entity_relation er
       JOIN ${SEARCH_SCHEMA}.entity es ON es.entity_pk = er.subject_entity_pk
       WHERE er.relation_category = 'association'
         AND er.object_entity_pk IN (
           SELECT terms.term_entity_pk FROM ${ontologyTermsTable(SEARCH_SCHEMA)} WHERE terms.term_id = ANY($1::text[])
         )`,
      [normalized],
    );
    return result.rows.map((row) => toPublicEntityId(row));
  } finally {
    client.release();
  }
}
