"use server";

import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, getPool } from "@/lib/db/client";
import { entity, entityRelation, ontologyTerm, type OntologyTerm } from "@next-omnipath/drizzle";
import { toPublicEntityId } from "@/lib/entity-public-id";

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
}: {
  query?: string;
  prefixes?: string[];
  limit?: number;
} = {}): Promise<OntologyTerm[]> {
  const db = getDb();
  const conditions: SQL[] = [];

  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    const pattern = `%${trimmedQuery}%`;
    conditions.push(sql`(
      ${ontologyTerm.termId} ILIKE ${pattern}
      OR ${ontologyTerm.label} ILIKE ${pattern}
      OR ${ontologyTerm.definition} ILIKE ${pattern}
      OR ${ontologyTerm.ontologyPrefix} ILIKE ${pattern}
    )`);
  }

  if (prefixes?.length) {
    conditions.push(inArray(ontologyTerm.ontologyPrefix, prefixes));
  }

  const where = conditions.length ? and(...conditions) : undefined;

  return db
    .select()
    .from(ontologyTerm)
    .where(where)
    .orderBy(asc(ontologyTerm.termId))
    .limit(limit);
}

export async function getOntologyPrefixes(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ prefix: ontologyTerm.ontologyPrefix })
    .from(ontologyTerm)
    .where(sql`${ontologyTerm.ontologyPrefix} IS NOT NULL`)
    .orderBy(asc(ontologyTerm.ontologyPrefix));
  return rows.map((r) => String(r.prefix)).filter(Boolean);
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
