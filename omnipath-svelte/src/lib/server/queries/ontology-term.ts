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

export async function searchScopedOntologyTerms({
  entityIds,
  query = "",
  prefixes,
  limit = 24,
  offset = 0,
}: {
  entityIds: string[];
  query?: string;
  prefixes?: string[];
  limit?: number;
  offset?: number;
}): Promise<ScopedOntologyTerm[]> {
  const normalizedEntityIds = Array.from(new Set(entityIds.map((id) => id.trim()).filter(Boolean)));
  if (normalizedEntityIds.length === 0) return [];

  const normalizedPrefixes = Array.from(new Set((prefixes || []).map((prefix) => prefix.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const client = await getPool().connect();

  try {
    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = [normalizedEntityIds];
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
      `SELECT ot.*, scoped_terms.annotated_entity_count
       FROM ${SEARCH_SCHEMA}.ontology_term ot
       JOIN (
         SELECT
           eo.canonical_identifier AS term_id,
           COUNT(DISTINCT er.subject_entity_pk) AS annotated_entity_count
         FROM ${SEARCH_SCHEMA}.entity_relation er
         JOIN ${SEARCH_SCHEMA}.entity es ON es.entity_pk = er.subject_entity_pk
         JOIN ${SEARCH_SCHEMA}.entity eo ON eo.entity_pk = er.object_entity_pk
         WHERE er.relation_category = 'annotation'
           AND (es.canonical_identifier_type || '|' || es.canonical_identifier) = ANY($1::text[])
         GROUP BY eo.canonical_identifier
       ) scoped_terms ON scoped_terms.term_id = ot.term_id
       WHERE 1 = 1
       ${whereClause}
       ORDER BY scoped_terms.annotated_entity_count DESC, ot.term_id ASC
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
    }));
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
       JOIN ${SEARCH_SCHEMA}.entity eo ON eo.entity_pk = er.object_entity_pk
       WHERE er.relation_category = 'annotation'
         AND eo.canonical_identifier = ANY($1::text[])`,
      [normalized],
    );
    return result.rows.map((row) => toPublicEntityId(row));
  } finally {
    client.release();
  }
}
