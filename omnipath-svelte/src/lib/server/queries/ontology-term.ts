import type { PoolClient } from "pg";
import { asc, inArray, sql } from "drizzle-orm";
import { getDb, getPool } from "$lib/server/db/client";
import { ontologyTerm, type OntologyTerm } from "$lib/drizzle";
import { toPublicEntityId } from "$lib/entity-public-id";

export type OntologyTermWithAnnotationCounts = OntologyTerm & {
  annotatedEntityCount: number;
  annotatedRelationCount: number;
  annotatedItemCount: number;
};

export type ScopedOntologyTerm = OntologyTerm & {
  annotatedEntityCount: number;
};

export async function getOntologyTermsByIds(termIds: string[]): Promise<OntologyTerm[]> {
  const normalized = Array.from(new Set(termIds.map((t) => t.trim()).filter(Boolean)));
  if (normalized.length === 0) return [];
  const db = getDb();
  return db.select().from(ontologyTerm).where(inArray(ontologyTerm.termId, normalized));
}

export async function searchOntologyTerms({
  query = "",
  prefixes,
  limit = 24,
  offset = 0,
}: {
  query?: string;
  prefixes?: string[];
  limit?: number;
  offset?: number;
} = {}): Promise<OntologyTermWithAnnotationCounts[]> {
  const normalizedPrefixes = Array.from(new Set((prefixes || []).map((prefix) => prefix.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const client = await getPool().connect();

  try {
    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = [];
    const whereParts: string[] = [];

    if (trimmedQuery) {
      params.push(`%${trimmedQuery}%`);
      const placeholder = `$${params.length}`;
      whereParts.push(`(
        ot.term_id ILIKE ${placeholder}
        OR ot.label ILIKE ${placeholder}
        OR ot.definition ILIKE ${placeholder}
        OR ot.ontology_prefix ILIKE ${placeholder}
      )`);
    }

    if (normalizedPrefixes.length > 0) {
      params.push(normalizedPrefixes);
      whereParts.push(`ot.ontology_prefix = ANY($${params.length}::text[])`);
    }

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(offset);
    const offsetPlaceholder = `$${params.length}`;
    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const result = await client.query<{
      term_id: string;
      ontology_prefix: string | null;
      label: string | null;
      definition: string | null;
      synonyms: string[] | null;
      sources: string[] | null;
      annotated_entity_count: string | number | null;
      annotated_relation_count: string | number | null;
      annotated_item_count: string | number | null;
    }>(
      `SELECT
         ot.term_id,
         ot.ontology_prefix,
         ot.label,
         ot.definition,
         ot.synonyms,
         ot.sources,
         COALESCE(counts.annotated_entity_count, 0) AS annotated_entity_count,
         COALESCE(counts.annotated_relation_count, 0) AS annotated_relation_count,
         COALESCE(counts.annotated_item_count, 0) AS annotated_item_count
       FROM ${SEARCH_SCHEMA}.ontology_term ot
       LEFT JOIN ${SEARCH_SCHEMA}.ontology_term_annotation_counts counts
         ON counts.term_id = ot.term_id
       ${whereClause}
       ORDER BY COALESCE(counts.annotated_item_count, 0) DESC, ot.term_id ASC
       LIMIT ${limitPlaceholder}
       OFFSET ${offsetPlaceholder}`,
      params,
    );

    return result.rows.map((row) => ({
      termId: row.term_id,
      ontologyPrefix: row.ontology_prefix,
      label: row.label,
      definition: row.definition,
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
    const db = getDb();
    const rows = await db
      .selectDistinct({ prefix: ontologyTerm.ontologyPrefix })
      .from(ontologyTerm)
      .where(sql`${ontologyTerm.ontologyPrefix} IS NOT NULL`)
      .orderBy(asc(ontologyTerm.ontologyPrefix));
    const value = rows.map((r) => String(r.prefix)).filter(Boolean);
    ontologyPrefixesCache = {
      value,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
    ontologyPrefixesInFlight = null;
    return value;
  })();

  return ontologyPrefixesInFlight;
}

async function searchScopedOntologyTermsRelational({
  entityPks,
  termIds,
  query,
  prefixes,
  limit,
  offset,
  client,
  schema,
}: {
  entityPks: number[];
  termIds: string[];
  query: string;
  prefixes: string[];
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
      WHERE er.relation_category = 'annotation'
        AND er.object_entity_pk IN (
          SELECT e.entity_pk FROM ${schema}.entity e WHERE e.canonical_identifier = ANY(${termParam}::text[])
        )
    )`);
  }

  let scopeTermPksFrom: string = hasTermIds
    ? `FROM ${schema}.entity_relation er WHERE er.relation_category = 'annotation' AND er.subject_entity_pk IN (SELECT entity_pk FROM scope_entity_pks)`
    : `FROM ${schema}.entity_relation er WHERE er.relation_category = 'annotation' AND er.subject_entity_pk = ANY(${pushParam(entityPks.map(String))}::bigint[])`;

  if (hasTermIds && hasEntityPks) {
    const ePksParam = pushParam(entityPks.map(String));
    scopeTermPksFrom = `FROM ${schema}.entity_relation er WHERE er.relation_category = 'annotation' AND (er.subject_entity_pk IN (SELECT entity_pk FROM scope_entity_pks) OR er.subject_entity_pk = ANY(${ePksParam}::bigint[]))`;
  }

  cteParts.push(`scope_term_pks AS MATERIALIZED (
    SELECT DISTINCT er.object_entity_pk AS term_entity_pk
    ${scopeTermPksFrom}
  )`);

  const whereParts: string[] = [];
  if (query) {
    const placeholder = pushParam(`%${query}%`);
    whereParts.push(`(
      ot.term_id ILIKE ${placeholder}
      OR ot.label ILIKE ${placeholder}
      OR ot.definition ILIKE ${placeholder}
      OR ot.ontology_prefix ILIKE ${placeholder}
    )`);
  }

  if (prefixes.length > 0) {
    const prefixParam = pushParam(prefixes);
    whereParts.push(`ot.ontology_prefix = ANY(${prefixParam}::text[])`);
  }

  const limitParam = pushParam(limit);
  const offsetParam = pushParam(offset);
  const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";

  const result = await client.query<{
    term_id: string;
    ontology_prefix: string | null;
    label: string | null;
    definition: string | null;
    synonyms: string[] | null;
    sources: string[] | null;
    annotated_entity_count: string | number;
  }>(
    `WITH ${cteParts.join(",\n")}
     SELECT ot.*, counts.annotated_entity_count
     FROM ${schema}.ontology_term ot
     JOIN ${schema}.ontology_term_annotation_counts counts ON counts.term_id = ot.term_id
     WHERE ot.term_id IN (
       SELECT e.canonical_identifier FROM ${schema}.entity e WHERE e.entity_pk IN (SELECT term_entity_pk FROM scope_term_pks)
     )
     ${whereClause}
     ORDER BY counts.annotated_entity_count DESC, ot.term_id ASC
     LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    params,
  );

  return result.rows.map((row) => ({
    termId: row.term_id,
    ontologyPrefix: row.ontology_prefix,
    label: row.label,
    definition: row.definition,
    synonyms: row.synonyms || [],
    sources: row.sources || [],
    annotatedEntityCount: Number(row.annotated_entity_count || 0),
  }));
}

async function searchScopedOntologyTermsBitmap({
  entityPks,
  termIds,
  query,
  prefixes,
  limit,
  offset,
  client,
  schema,
}: {
  entityPks: number[];
  termIds: string[];
  query: string;
  prefixes: string[];
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
      FROM ${schema}.entity e
      JOIN ${schema}.annotation_term_entity_bitmap b ON b.term_entity_pk = e.entity_pk
      WHERE e.canonical_identifier = ANY(${termParam}::text[])`);
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
    whereParts.push(`(
      ot.term_id ILIKE ${placeholder}
      OR ot.label ILIKE ${placeholder}
      OR ot.definition ILIKE ${placeholder}
      OR ot.ontology_prefix ILIKE ${placeholder}
    )`);
  }

  if (prefixes.length > 0) {
    const prefixParam = pushParam(prefixes);
    whereParts.push(`ot.ontology_prefix = ANY(${prefixParam}::text[])`);
  }

  const limitParam = pushParam(limit);
  const offsetParam = pushParam(offset);
  const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";

  const result = await client.query<{
    term_id: string;
    ontology_prefix: string | null;
    label: string | null;
    definition: string | null;
    synonyms: string[] | null;
    sources: string[] | null;
    annotated_entity_count: string | number;
  }>(
    `WITH ${scopeBitmapSql}
     SELECT
       ot.term_id,
       ot.ontology_prefix,
       ot.label,
       ot.definition,
       ot.synonyms,
       ot.sources,
       sc.scoped_count AS annotated_entity_count
     FROM ${schema}.ontology_term ot
     JOIN ${schema}.entity e ON e.canonical_identifier = ot.term_id
     JOIN ${schema}.annotation_term_entity_bitmap b ON b.term_entity_pk = e.entity_pk
     CROSS JOIN scope_bitmap sb
     CROSS JOIN LATERAL (
       SELECT rb_cardinality(rb_and(b.entity_bitmap, sb.bitmap)) AS scoped_count
     ) sc
     WHERE sc.scoped_count > 0
       ${whereClause}
     ORDER BY sc.scoped_count DESC, ot.term_id ASC
     LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    params,
  );

  return result.rows.map((row) => ({
    termId: row.term_id,
    ontologyPrefix: row.ontology_prefix,
    label: row.label,
    definition: row.definition,
    synonyms: row.synonyms || [],
    sources: row.sources || [],
    annotatedEntityCount: Number(row.annotated_entity_count || 0),
  }));
}

export async function searchScopedOntologyTerms({
  entityPks = [],
  termIds = [],
  query = "",
  prefixes,
  limit = 24,
  offset = 0,
}: {
  entityPks?: number[];
  termIds?: string[];
  query?: string;
  prefixes?: string[];
  limit?: number;
  offset?: number;
}): Promise<ScopedOntologyTerm[]> {
  const normalizedEntityPks = Array.from(new Set(entityPks.filter(Number.isFinite)));
  const normalizedTermIds = Array.from(new Set(termIds.map((id) => id.trim()).filter(Boolean)));
  if (normalizedEntityPks.length === 0 && normalizedTermIds.length === 0) return [];

  const normalizedPrefixes = Array.from(new Set((prefixes || []).map((prefix) => prefix.trim()).filter(Boolean)));
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

  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = [];

    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const ctes: string[] = [];

    // Base scope from selection
    const scopeParts: string[] = [];
    if (normalizedTermIds.length > 0) {
      const termParam = pushParam(normalizedTermIds);
      scopeParts.push(`SELECT b.entity_bitmap AS bitmap
        FROM ${S}.entity e
        JOIN ${S}.annotation_term_entity_bitmap b ON b.term_entity_pk = e.entity_pk
        WHERE e.canonical_identifier = ANY(${termParam}::text[])`);
    }
    if (normalizedEntityPks.length > 0) {
      const maxPk = Math.max(...normalizedEntityPks);
      if (maxPk > 2147483647) {
        throw new Error("Entity PK exceeds 32-bit range; bitmap path requires ordinal mapping");
      }
      const ePkParam = pushParam(normalizedEntityPks);
      scopeParts.push(`SELECT rb_build(${ePkParam}::integer[]) AS bitmap`);
    }

    if (scopeParts.length > 0) {
      ctes.push(`scope_base AS MATERIALIZED (
        SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM (
          ${scopeParts.join("\n          UNION ALL\n          ")}
        ) scope_parts
      )`);
    } else {
      ctes.push(`scope_base AS MATERIALIZED (
        SELECT rb_or_agg(entity_bitmap) AS bitmap
        FROM ${S}.facet_entity_bitmap
        WHERE facet_name = 'entity_type'
      )`);
    }

    const whereParts: string[] = [];
    if (trimmedQuery) {
      const queryParam = pushParam(`%${trimmedQuery}%`);
      whereParts.push(`(
        ot.term_id ILIKE ${queryParam}
        OR ot.label ILIKE ${queryParam}
        OR ot.definition ILIKE ${queryParam}
      )`);
    }

    const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";

    const result = await client.query<{
      ontology_prefix: string | null;
      scoped_count: string | number;
    }>(
      `WITH ${ctes.join(",\n")}
       SELECT ot.ontology_prefix, COUNT(*) AS scoped_count
       FROM ${S}.ontology_term ot
       JOIN ${S}.entity e ON e.canonical_identifier = ot.term_id
       JOIN ${S}.annotation_term_entity_bitmap b ON b.term_entity_pk = e.entity_pk
       CROSS JOIN scope_base sb
       WHERE rb_cardinality(rb_and(b.entity_bitmap, sb.bitmap)) > 0
         ${whereClause}
       GROUP BY ot.ontology_prefix
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
       WHERE er.relation_category = 'annotation'
         AND er.object_entity_pk IN (
           SELECT e.entity_pk FROM ${SEARCH_SCHEMA}.entity e WHERE e.canonical_identifier = ANY($1::text[])
         )`,
      [normalized],
    );
    return result.rows.map((row) => toPublicEntityId(row));
  } finally {
    client.release();
  }
}
