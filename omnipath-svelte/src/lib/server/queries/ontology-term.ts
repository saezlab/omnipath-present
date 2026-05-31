import { getPool } from "$lib/server/db/client";
import { toPublicEntityId } from "$lib/entity-public-id";
import { relationCategoryEqualsSql, relationPredicateNameSql } from "$lib/server/queries/sql-fragments";

export type OntologyTerm = {
  termId: string;
  ontologyPrefix: string | null;
  label: string | null;
  definition: string | null;
  synonyms: string[];
  ontologyId: string | null;
  sources: string[];
  relationCount: number;
};

export type OntologyHierarchyNode = {
  id: string;
  name: string | null;
  ontologyId?: string | null;
  distance?: number;
  children: OntologyHierarchyNode[];
};

type OntologyTermRow = {
  term_entity_id: string | number;
  term_id: string;
  ontology_prefix: string | null;
  label: string | null;
  definition: string | null;
  synonyms: string[] | null;
  synonyms_text?: string | null;
  term_aliases?: string[] | null;
  identifiers_text?: string | null;
  ontology_id: string | null;
  sources: string[] | null;
  child_count?: string | number | null;
  relation_count?: string | number | null;
  annotated_entity_count?: string | number | null;
  annotated_relation_count?: string | number | null;
  annotated_item_count?: string | number | null;
};

type OntologyHierarchyRow = {
  term_entity_id: string;
  term_id: string;
  label: string | null;
  ontology_id: string;
  distance: string | number;
};

type OntologyHierarchyEdgeRow = {
  parent_entity_id: string;
  child_entity_id: string;
};

export type OntologyTermWithAnnotationCounts = OntologyTerm & {
  annotatedEntityCount: number;
  annotatedRelationCount: number;
  annotatedItemCount: number;
};

export type ScopedOntologyTerm = OntologyTerm & {
  annotatedEntityCount: number;
  annotatedRelationCount: number;
  annotatedItemCount: number;
};

export type OntologyPrefixCount = {
  prefix: string;
  scopedCount: number;
};

export type OntologySourceCount = {
  source: string;
  scopedCount: number;
};

export type OntologyIdCount = {
  ontologyId: string;
  scopedCount: number;
};

export type OntologySelectionScopeInput = {
  entityPks?: Array<string | number>;
  annotationTermIds?: string[];
  includeAssociatedEntities?: boolean;
  includeMembersParticipants?: boolean;
  mode?: "union" | "intersection";
};

function ontologyTermsQuery(schema: string): string {
  return `
    SELECT
      terms.term_entity_id,
      terms.term_id,
      terms.ontology_prefix,
      terms.label,
      terms.definition,
      terms.synonyms,
      terms.synonyms_text,
      terms.term_aliases,
      terms.identifiers_text,
      terms.ontology_id,
      terms.sources,
      terms.child_count,
      COALESCE(relation_counts.relation_count, 0)::bigint AS relation_count
    FROM ${schema}.entity_ontology_term terms
    LEFT JOIN ${schema}.entity_relation_counts relation_counts
      ON relation_counts.entity_id = terms.term_entity_id
  `;
}

function ontologyTermsTable(schema: string, alias = "terms"): string {
  return `(${ontologyTermsQuery(schema)}) ${alias}`;
}

function ontologyTermSearchPredicate(placeholder: string): string {
  return `(
    terms.term_id ILIKE ${placeholder}
    OR terms.label ILIKE ${placeholder}
    OR terms.definition ILIKE ${placeholder}
    OR terms.ontology_prefix ILIKE ${placeholder}
    OR terms.synonyms_text ILIKE ${placeholder}
    OR terms.identifiers_text ILIKE ${placeholder}
  )`;
}

function ontologyTermIdMatchPredicate(placeholder: string): string {
  return `(
    terms.term_id = ANY(${placeholder}::text[])
    OR terms.term_aliases && ${placeholder}::text[]
  )`;
}

function ontologyBitmapScopeCtes(schema: string, entityPksParam: string, termIdsParam: string): string {
  return `entity_scope_bitmap AS MATERIALIZED (
    SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
    FROM (
      SELECT b.entity_bitmap AS bitmap
      FROM ${ontologyTermsTable(schema)}
      JOIN ${schema}.annotation_term_entity_bitmap b
        ON b.term_entity_id = terms.term_entity_id
      WHERE ${ontologyTermIdMatchPredicate(termIdsParam)}
      UNION ALL
      SELECT COALESCE(rb_build_agg(bitmap.bitmap_id), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM ${schema}.entity_bitmap_id bitmap
      WHERE bitmap.entity_id = ANY(${entityPksParam}::uuid[])
    ) scope_parts
  ),
  relation_scope_bitmap AS MATERIALIZED (
    SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
    FROM (
      SELECT b.relation_bitmap AS bitmap
      FROM ${ontologyTermsTable(schema)}
      JOIN ${schema}.annotation_term_direct_relation_bitmap b
        ON b.term_entity_id = terms.term_entity_id
      WHERE ${ontologyTermIdMatchPredicate(termIdsParam)}
      UNION ALL
      SELECT COALESCE(rb_or_agg(b.relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM ${schema}.entity_relation_bitmap b
      WHERE b.entity_id = ANY(${entityPksParam}::uuid[])
    ) scope_parts
  )`;
}

function ontologySelectionScopeBitmapCtes(
  schema: string,
  entityPksParam: string,
  termIdsParam: string,
  {
    includeAssociatedEntities,
    includeMembersParticipants,
    mode,
  }: {
    includeAssociatedEntities: boolean;
    includeMembersParticipants: boolean;
    mode: "union" | "intersection";
  },
): string {
  const entityExpansionParts = [
    "SELECT entity_id FROM entity_seed_pks",
    ...(includeMembersParticipants
      ? [`SELECT r.object_entity_id AS entity_id
          FROM ${schema}.relation r
          JOIN entity_seed_pks seed ON seed.entity_id = r.subject_entity_id
          WHERE ${relationPredicateNameSql(schema, "r")} IN ('has_member', 'has_participant')`]
      : []),
    ...(includeAssociatedEntities
      ? [`SELECT r.object_entity_id AS entity_id
          FROM ${schema}.relation r
          JOIN entity_seed_pks seed ON seed.entity_id = r.subject_entity_id
          WHERE ${relationCategoryEqualsSql(schema, "r", "association")}`]
      : []),
  ];
  const scopeAgg = mode === "intersection" ? "rb_and_agg" : "rb_or_agg";

  return `selected_seed_terms AS MATERIALIZED (
    SELECT DISTINCT terms.term_entity_id, terms.term_id
    FROM ${ontologyTermsTable(schema)}
    WHERE terms.term_entity_id = ANY(${entityPksParam}::uuid[])
  ),
  requested_scope_terms AS MATERIALIZED (
    SELECT DISTINCT term_id
    FROM (
      SELECT unnest(${termIdsParam}::text[]) AS term_id
      UNION ALL
      SELECT term_id FROM selected_seed_terms
    ) ids
    WHERE term_id <> ''
  ),
  entity_seed_pks AS MATERIALIZED (
    SELECT seed.entity_id
    FROM unnest(${entityPksParam}::uuid[]) AS seed(entity_id)
    LEFT JOIN selected_seed_terms seed_terms
      ON seed_terms.term_entity_id = seed.entity_id
    WHERE seed_terms.term_entity_id IS NULL
  ),
  term_criteria AS MATERIALIZED (
    SELECT
      requested.term_id AS criterion_id,
      COALESCE(rb_or_agg(bitmap.entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
    FROM requested_scope_terms requested
    LEFT JOIN ${ontologyTermsTable(schema)}
      ON terms.term_id = requested.term_id
      OR requested.term_id = ANY(terms.term_aliases)
    LEFT JOIN ${schema}.annotation_term_entity_bitmap bitmap
      ON bitmap.term_entity_id = terms.term_entity_id
    GROUP BY requested.term_id
  ),
  entity_seed_entities AS MATERIALIZED (
    SELECT DISTINCT entity_id
    FROM (${entityExpansionParts.join("\nUNION ALL\n")}) expanded_entities
  ),
  entity_criterion AS MATERIALIZED (
    SELECT
      'entity_seed' AS criterion_id,
      COALESCE(rb_build_agg(DISTINCT bitmap.bitmap_id), rb_build(ARRAY[]::integer[])) AS bitmap
    FROM entity_seed_entities entities
    JOIN ${schema}.entity_bitmap_id bitmap
      ON bitmap.entity_id = entities.entity_id
    HAVING EXISTS (SELECT 1 FROM entity_seed_pks)
  ),
  selection_criteria AS MATERIALIZED (
    SELECT criterion_id, bitmap FROM term_criteria
    UNION ALL
    SELECT criterion_id, bitmap FROM entity_criterion
  ),
  entity_scope_bitmap AS MATERIALIZED (
    SELECT
      CASE
        WHEN COUNT(*) = 0 THEN rb_build(ARRAY[]::integer[])
        ELSE COALESCE(${scopeAgg}(bitmap), rb_build(ARRAY[]::integer[]))
      END AS bitmap
    FROM selection_criteria
  ),
  relation_scope_bitmap AS MATERIALIZED (
    SELECT COALESCE(rb_or_agg(relation_bitmap.relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
    FROM entity_scope_bitmap entity_scope
    CROSS JOIN LATERAL rb_iterate(entity_scope.bitmap) scoped(bitmap_id)
    JOIN ${schema}.entity_bitmap_id entity_bitmap
      ON entity_bitmap.bitmap_id = scoped.bitmap_id
    JOIN ${schema}.entity_relation_bitmap relation_bitmap
      ON relation_bitmap.entity_id = entity_bitmap.entity_id
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
    relationCount: Number(row.relation_count || 0),
  };
}

function normalizeIdValues(values: Array<string | number> | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => String(value).trim()).filter(Boolean)));
}

function normalizeSelectionScope(scope: OntologySelectionScopeInput | undefined) {
  if (!scope) return null;
  const entityPks = normalizeIdValues(scope.entityPks);
  const annotationTermIds = Array.from(new Set((scope.annotationTermIds || []).map((id) => id.trim()).filter(Boolean)));
  if (entityPks.length === 0 && annotationTermIds.length === 0) return null;
  return {
    entityPks,
    annotationTermIds,
    includeAssociatedEntities: scope.includeAssociatedEntities !== false,
    includeMembersParticipants: scope.includeMembersParticipants !== false,
    mode: scope.mode === "intersection" ? "intersection" as const : "union" as const,
  };
}

function hierarchyPredicatesForOntology(ontologyId: string | null): string[] {
  if (ontologyId === "chebi") return ["is_a"];
  if (ontologyId === "reactome_pathways") return ["part_of"];
  return ["is_a", "part_of"];
}

function ontologyScopeCtes(schema: string, entityPksParam: string, termIdsParam: string): string {
  return `
    selected_terms AS MATERIALIZED (
      SELECT DISTINCT terms.term_entity_id
      FROM ${ontologyTermsTable(schema)}
      WHERE terms.term_id = ANY(${termIdsParam}::text[])
         OR terms.term_aliases && ${termIdsParam}::text[]
    ),
    descendant_entities(entity_id) AS (
      SELECT selected_terms.term_entity_id AS entity_id
      FROM selected_terms
      UNION
      SELECT eor.subject_entity_id AS entity_id
      FROM ${schema}.entity_ontology_relation eor
      JOIN descendant_entities descendants
        ON descendants.entity_id = eor.object_entity_id
    ),
    explicit_entities AS MATERIALIZED (
      SELECT unnest(${entityPksParam}::uuid[]) AS entity_id
    ),
    scope_entities AS MATERIALIZED (
      SELECT entity_id FROM explicit_entities
      UNION
      SELECT entity_id FROM descendant_entities
    ),
    scoped_term_entities AS MATERIALIZED (
      SELECT entity_id AS term_entity_id FROM scope_entities
      UNION
      SELECT eor.object_entity_id AS term_entity_id
      FROM ${schema}.entity_ontology_relation eor
      JOIN scope_entities scope
        ON scope.entity_id = eor.subject_entity_id
    ),
    scope_child_counts AS MATERIALIZED (
      SELECT eor.object_entity_id AS term_entity_id, COUNT(DISTINCT eor.subject_entity_id) AS scoped_child_count
      FROM ${schema}.entity_ontology_relation eor
      JOIN scope_entities scope
        ON scope.entity_id = eor.subject_entity_id
      GROUP BY eor.object_entity_id
    )
  `;
}

export async function getOntologyTermsByIds(termIds: string[]): Promise<OntologyTerm[]> {
  const normalized = Array.from(new Set(termIds.map((t) => t.trim()).filter(Boolean)));
  if (normalized.length === 0) return [];
  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const result = await client.query<OntologyTermRow>(
      `WITH requested AS (
         SELECT unnest($1::text[]) AS term_id
       )
       SELECT DISTINCT ON (requested.term_id)
         terms.term_entity_id,
         requested.term_id,
         terms.ontology_prefix,
         terms.label,
         terms.definition,
         terms.synonyms,
         terms.synonyms_text,
         terms.term_aliases,
         terms.identifiers_text,
         terms.ontology_id,
         terms.sources,
         terms.child_count,
         terms.relation_count
       FROM requested
       JOIN ${ontologyTermsTable(S)}
         ON terms.term_id = requested.term_id
        OR requested.term_id = ANY(terms.term_aliases)
       ORDER BY requested.term_id, terms.term_id`,
      [normalized],
    );
    return result.rows.map(toOntologyTerm);
  } finally {
    client.release();
  }
}

export async function getOntologyHierarchyTree(
  termId: string,
  ontologyId?: string | null,
  maxDepth = 8,
): Promise<OntologyHierarchyNode | null> {
  const normalizedTermId = termId.trim();
  if (!normalizedTermId) return null;
  const requestedOntologyId = ontologyId || null;

  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const result = await client.query<OntologyHierarchyRow>(
      `WITH RECURSIVE seed AS MATERIALIZED (
         SELECT
           terms.term_entity_id,
           terms.term_id,
           terms.label,
           terms.ontology_id
         FROM ${ontologyTermsTable(S)}
         WHERE (terms.term_id = $1 OR $1 = ANY(terms.term_aliases))
           AND ($2::text IS NULL OR terms.ontology_id = $2::text)
         ORDER BY
           CASE WHEN terms.term_id = $1 THEN 0 ELSE 1 END,
           terms.child_count DESC,
           terms.ontology_id ASC,
           terms.term_id ASC
         LIMIT 1
       ),
       ancestors(term_entity_id, term_id, label, ontology_id, distance) AS (
         SELECT
           seed.term_entity_id,
           seed.term_id,
           seed.label,
           seed.ontology_id,
           0::int AS distance
         FROM seed
         UNION
         SELECT
           parent.term_entity_id,
           parent.term_id,
           parent.label,
           parent.ontology_id,
           ancestors.distance + 1
         FROM ancestors
         JOIN ${S}.entity_ontology_relation eor
           ON eor.subject_entity_id = ancestors.term_entity_id
          AND eor.ontology_id = ancestors.ontology_id
         JOIN ${S}.vocab_relation_predicate predicate
           ON predicate.relation_predicate_id = eor.predicate_id
         JOIN ${ontologyTermsTable(S, "parent")}
           ON parent.term_entity_id = eor.object_entity_id
          AND parent.ontology_id = eor.ontology_id
         WHERE ancestors.distance < $3::int
           AND predicate.name = ANY(
             CASE ancestors.ontology_id
               WHEN 'chebi' THEN ARRAY['is_a']::text[]
               WHEN 'reactome_pathways' THEN ARRAY['part_of']::text[]
               ELSE ARRAY['is_a', 'part_of']::text[]
             END
           )
       )
       SELECT DISTINCT ON (term_entity_id)
         term_entity_id::text AS term_entity_id,
         term_id,
         label,
         ontology_id,
         distance
       FROM ancestors
       ORDER BY term_entity_id, distance ASC, label ASC NULLS LAST, term_id ASC`,
      [normalizedTermId, requestedOntologyId, maxDepth],
    );

    if (result.rows.length === 0) return null;

    const ids = result.rows.map((row) => row.term_entity_id);
    const ontology = result.rows[0]?.ontology_id || requestedOntologyId || null;
    const edgePredicates = hierarchyPredicatesForOntology(ontology);
    const edgeResult = await client.query<OntologyHierarchyEdgeRow>(
      `SELECT DISTINCT
         eor.object_entity_id::text AS parent_entity_id,
         eor.subject_entity_id::text AS child_entity_id
       FROM ${S}.entity_ontology_relation eor
       JOIN ${S}.vocab_relation_predicate predicate
         ON predicate.relation_predicate_id = eor.predicate_id
       WHERE eor.object_entity_id = ANY($1::uuid[])
         AND eor.subject_entity_id = ANY($1::uuid[])
         AND ($2::text IS NULL OR eor.ontology_id = $2::text)
         AND predicate.name = ANY($3::text[])`,
      [ids, ontology, edgePredicates],
    );

    const nodes = new Map<string, OntologyHierarchyNode>();
    const termEntityIdByTermId = new Map<string, string>();
    for (const row of result.rows) {
      nodes.set(row.term_entity_id, {
        id: row.term_id,
        name: row.label || row.term_id,
        ontologyId: row.ontology_id,
        distance: Number(row.distance || 0),
        children: [],
      });
      termEntityIdByTermId.set(row.term_id, row.term_entity_id);
    }

    const childEntityIds = new Set<string>();
    for (const edge of edgeResult.rows) {
      const parent = nodes.get(edge.parent_entity_id);
      const child = nodes.get(edge.child_entity_id);
      if (!parent || !child) continue;
      parent.children.push(child);
      childEntityIds.add(edge.child_entity_id);
    }

    for (const node of nodes.values()) {
      node.children.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    }

    const roots = Array.from(nodes.entries())
      .filter(([entityId]) => !childEntityIds.has(entityId))
      .map(([, node]) => node)
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

    if (roots.length === 1) return roots[0];

    const seedEntityId = termEntityIdByTermId.get(normalizedTermId);
    const seedNode = seedEntityId ? nodes.get(seedEntityId) : null;
    return {
      id: ontology || normalizedTermId,
      name: ontology || "Ontology",
      ontologyId: ontology,
      children: roots.length > 0 ? roots : seedNode ? [seedNode] : [],
    };
  } finally {
    client.release();
  }
}

export async function getOntologyChildren(
  termId: string,
  ontologyId?: string | null,
  limit = 200,
): Promise<OntologyTerm[]> {
  const normalizedTermId = termId.trim();
  if (!normalizedTermId) return [];
  const requestedOntologyId = ontologyId || null;

  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const result = await client.query<OntologyTermRow>(
      `WITH seed AS MATERIALIZED (
         SELECT terms.term_entity_id, terms.ontology_id
         FROM ${ontologyTermsTable(S)}
         WHERE (terms.term_id = $1 OR $1 = ANY(terms.term_aliases))
           AND ($2::text IS NULL OR terms.ontology_id = $2::text)
         ORDER BY
           CASE WHEN terms.term_id = $1 THEN 0 ELSE 1 END,
           terms.child_count DESC,
           terms.ontology_id ASC,
           terms.term_id ASC
         LIMIT 1
       )
       SELECT DISTINCT ON (terms.term_entity_id)
         terms.term_entity_id,
         terms.term_id,
         terms.ontology_prefix,
         terms.label,
         terms.definition,
         terms.synonyms,
         terms.synonyms_text,
         terms.term_aliases,
         terms.identifiers_text,
         terms.ontology_id,
         terms.sources,
         terms.child_count
       FROM seed
       JOIN ${S}.entity_ontology_relation eor
         ON eor.object_entity_id = seed.term_entity_id
        AND eor.ontology_id = seed.ontology_id
       JOIN ${S}.vocab_relation_predicate predicate
         ON predicate.relation_predicate_id = eor.predicate_id
       JOIN ${ontologyTermsTable(S)}
         ON terms.term_entity_id = eor.subject_entity_id
        AND terms.ontology_id = eor.ontology_id
       WHERE predicate.name = ANY(
         CASE seed.ontology_id
           WHEN 'chebi' THEN ARRAY['is_a']::text[]
           WHEN 'reactome_pathways' THEN ARRAY['part_of']::text[]
           ELSE ARRAY['is_a', 'part_of']::text[]
         END
       )
       ORDER BY
         terms.term_entity_id,
         terms.child_count DESC,
         terms.label ASC NULLS LAST,
         terms.term_id ASC
       LIMIT $3::int`,
      [normalizedTermId, requestedOntologyId, limit],
    );
    return result.rows.map(toOntologyTerm);
  } finally {
    client.release();
  }
}

export async function searchOntologyTerms({
  query = "",
  prefixes,
  ontologyIds,
  limit = 24,
  offset = 0,
}: {
  query?: string;
  prefixes?: string[];
  ontologyIds?: string[];
  limit?: number;
  offset?: number;
} = {}): Promise<OntologyTermWithAnnotationCounts[]> {
  const normalizedPrefixes = Array.from(new Set((prefixes || []).map((prefix) => prefix.trim()).filter(Boolean)));
  const normalizedOntologyIds = Array.from(new Set((ontologyIds || []).map((id) => id.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const client = await getPool().connect();

  try {
    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = [];
    const whereParts: string[] = [];

    if (
      !trimmedQuery
      && normalizedPrefixes.length === 0
      && normalizedOntologyIds.length === 0
    ) {
      const candidateLimit = Math.max(1, Math.floor(limit + offset));
      const result = await client.query<OntologyTermRow>(
        `WITH candidate_terms AS MATERIALIZED (
           SELECT term_entity_id
           FROM (
             SELECT term_entity_id
             FROM ${SEARCH_SCHEMA}.annotation_term_entity_bitmap
             ORDER BY global_count DESC
             LIMIT $1::integer
           ) top_entity_terms
           UNION
           SELECT term_entity_id
           FROM ${SEARCH_SCHEMA}.annotation_term_direct_relation_bitmap
         )
         SELECT
           terms.*,
           COALESCE(entity_counts.global_count, 0)::bigint AS annotated_entity_count,
           COALESCE(relation_counts.global_count, 0)::bigint AS annotated_relation_count,
           (
             COALESCE(entity_counts.global_count, 0)
             + COALESCE(relation_counts.global_count, 0)
           )::bigint AS annotated_item_count
         FROM candidate_terms candidate
         JOIN ${ontologyTermsTable(SEARCH_SCHEMA)}
           ON terms.term_entity_id = candidate.term_entity_id
         LEFT JOIN ${SEARCH_SCHEMA}.annotation_term_entity_bitmap entity_counts
           ON entity_counts.term_entity_id = terms.term_entity_id
         LEFT JOIN ${SEARCH_SCHEMA}.annotation_term_direct_relation_bitmap relation_counts
           ON relation_counts.term_entity_id = terms.term_entity_id
         ORDER BY annotated_item_count DESC, terms.child_count DESC, terms.term_id ASC
         LIMIT $2::integer
         OFFSET $3::integer`,
        [candidateLimit, limit, offset],
      );

      return result.rows.map((row) => {
        const entityCount = Number(row.annotated_entity_count || 0);
        const relationCount = Number(row.annotated_relation_count || 0);
        return {
          ...toOntologyTerm(row),
          annotatedEntityCount: entityCount,
          annotatedRelationCount: relationCount,
          annotatedItemCount: entityCount + relationCount,
        };
      });
    }

    if (trimmedQuery) {
      params.push(`%${trimmedQuery}%`);
      whereParts.push(ontologyTermSearchPredicate(`$${params.length}`));
    }

    if (normalizedPrefixes.length > 0) {
      params.push(normalizedPrefixes);
      whereParts.push(`terms.ontology_prefix = ANY($${params.length}::text[])`);
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

    const result = await client.query<OntologyTermRow>(
      `SELECT
         terms.*,
         COALESCE(entity_counts.global_count, 0)::bigint AS annotated_entity_count,
         COALESCE(relation_counts.global_count, 0)::bigint AS annotated_relation_count,
         (
           COALESCE(entity_counts.global_count, 0)
           + COALESCE(relation_counts.global_count, 0)
         )::bigint AS annotated_item_count
       FROM ${ontologyTermsTable(SEARCH_SCHEMA)}
       LEFT JOIN ${SEARCH_SCHEMA}.annotation_term_entity_bitmap entity_counts
         ON entity_counts.term_entity_id = terms.term_entity_id
       LEFT JOIN ${SEARCH_SCHEMA}.annotation_term_direct_relation_bitmap relation_counts
         ON relation_counts.term_entity_id = terms.term_entity_id
       ${whereClause}
       ORDER BY annotated_item_count DESC, terms.child_count DESC, terms.term_id ASC
       LIMIT ${limitPlaceholder}
       OFFSET ${offsetPlaceholder}`,
      params,
    );

    return result.rows.map((row) => {
      const entityCount = Number(row.annotated_entity_count || 0);
      const relationCount = Number(row.annotated_relation_count || 0);
      return {
        ...toOntologyTerm(row),
        annotatedEntityCount: entityCount,
        annotatedRelationCount: relationCount,
        annotatedItemCount: entityCount + relationCount,
      };
    });
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
         FROM ${S}.entity_ontology_term
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

export async function searchScopedOntologyTerms({
  entityPks = [],
  termIds = [],
  selectionScope,
  query = "",
  prefixes,
  ontologyIds,
  limit = 24,
  offset = 0,
}: {
  entityPks?: Array<string | number>;
  termIds?: string[];
  selectionScope?: OntologySelectionScopeInput;
  query?: string;
  prefixes?: string[];
  ontologyIds?: string[];
  limit?: number;
  offset?: number;
}): Promise<ScopedOntologyTerm[]> {
  const normalizedSelectionScope = normalizeSelectionScope(selectionScope);
  const normalizedEntityPks = normalizeIdValues(entityPks);
  const normalizedTermIds = Array.from(new Set(termIds.map((id) => id.trim()).filter(Boolean)));
  if (!normalizedSelectionScope && normalizedEntityPks.length === 0 && normalizedTermIds.length === 0) return [];

  const normalizedPrefixes = Array.from(new Set((prefixes || []).map((prefix) => prefix.trim()).filter(Boolean)));
  const normalizedOntologyIds = Array.from(new Set((ontologyIds || []).map((id) => id.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const client = await getPool().connect();

  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = normalizedSelectionScope
      ? [normalizedSelectionScope.entityPks, normalizedSelectionScope.annotationTermIds]
      : [normalizedEntityPks, normalizedTermIds];
    const scopeCtes = normalizedSelectionScope
      ? ontologySelectionScopeBitmapCtes(S, "$1", "$2", normalizedSelectionScope)
      : ontologyBitmapScopeCtes(S, "$1", "$2");
    const whereParts: string[] = [];

    if (trimmedQuery) {
      params.push(`%${trimmedQuery}%`);
      whereParts.push(ontologyTermSearchPredicate(`$${params.length}`));
    }

    if (normalizedPrefixes.length > 0) {
      params.push(normalizedPrefixes);
      whereParts.push(`terms.ontology_prefix = ANY($${params.length}::text[])`);
    }

    if (normalizedOntologyIds.length > 0) {
      params.push(normalizedOntologyIds);
      whereParts.push(`terms.ontology_id = ANY($${params.length}::text[])`);
    }

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(offset);
    const offsetPlaceholder = `$${params.length}`;
    const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";

    const result = await client.query<OntologyTermRow>(
      `WITH ${scopeCtes}
       SELECT
         terms.*,
         scoped.annotated_entity_count,
         scoped.annotated_relation_count,
         item_count.annotated_item_count
       FROM ${ontologyTermsTable(S)}
       LEFT JOIN ${S}.annotation_term_entity_bitmap entity_bitmap
         ON entity_bitmap.term_entity_id = terms.term_entity_id
       LEFT JOIN ${S}.annotation_term_direct_relation_bitmap relation_bitmap
         ON relation_bitmap.term_entity_id = terms.term_entity_id
       CROSS JOIN entity_scope_bitmap entity_scope
       CROSS JOIN relation_scope_bitmap relation_scope
       CROSS JOIN LATERAL (
         SELECT
           COALESCE(rb_cardinality(rb_and(entity_bitmap.entity_bitmap, entity_scope.bitmap)), 0)::bigint AS annotated_entity_count,
           COALESCE(rb_cardinality(rb_and(relation_bitmap.relation_bitmap, relation_scope.bitmap)), 0)::bigint AS annotated_relation_count
       ) scoped
       CROSS JOIN LATERAL (
         SELECT
           scoped.annotated_entity_count + scoped.annotated_relation_count AS annotated_item_count
       ) item_count
       WHERE item_count.annotated_item_count > 0
         ${whereClause}
       ORDER BY item_count.annotated_item_count DESC, terms.term_id ASC
       LIMIT ${limitPlaceholder}
       OFFSET ${offsetPlaceholder}`,
      params,
    );

    return result.rows.map((row) => ({
      ...toOntologyTerm(row),
      annotatedEntityCount: Number(row.annotated_entity_count || 0),
      annotatedRelationCount: Number(row.annotated_relation_count || 0),
      annotatedItemCount: Number(row.annotated_item_count || 0),
    }));
  } finally {
    client.release();
  }
}

export async function getScopedOntologyPrefixCounts({
  entityPks = [],
  annotationTermIds = [],
  query = "",
}: {
  entityPks?: Array<string | number>;
  annotationTermIds?: string[];
  query?: string;
}): Promise<OntologyPrefixCount[]> {
  const normalizedEntityPks = normalizeIdValues(entityPks);
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const hasScope = normalizedEntityPks.length > 0 || normalizedTermIds.length > 0;

  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = hasScope ? [normalizedEntityPks, normalizedTermIds] : [];
    const whereParts: string[] = [];

    if (trimmedQuery) {
      params.push(`%${trimmedQuery}%`);
      whereParts.push(ontologyTermSearchPredicate(`$${params.length}`));
    }

    if (!hasScope) {
      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
      const result = await client.query<{
        ontology_prefix: string | null;
        scoped_count: string | number;
      }>(
        `SELECT terms.ontology_prefix, COUNT(*) AS scoped_count
         FROM ${ontologyTermsTable(S)}
         ${whereClause}
         GROUP BY terms.ontology_prefix
         ORDER BY scoped_count DESC, terms.ontology_prefix ASC`,
        params,
      );

      return result.rows.map((row) => ({
        prefix: row.ontology_prefix ?? "unknown",
        scopedCount: Number(row.scoped_count || 0),
      }));
    }

    const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";

    const result = await client.query<{
      ontology_prefix: string | null;
      scoped_count: string | number;
    }>(
      `WITH ${ontologyBitmapScopeCtes(S, "$1", "$2")}
       SELECT terms.ontology_prefix, COUNT(*) AS scoped_count
       FROM ${ontologyTermsTable(S)}
       LEFT JOIN ${S}.annotation_term_entity_bitmap entity_bitmap
         ON entity_bitmap.term_entity_id = terms.term_entity_id
       LEFT JOIN ${S}.annotation_term_direct_relation_bitmap relation_bitmap
         ON relation_bitmap.term_entity_id = terms.term_entity_id
       CROSS JOIN entity_scope_bitmap entity_scope
       CROSS JOIN relation_scope_bitmap relation_scope
       WHERE (
         COALESCE(rb_cardinality(rb_and(entity_bitmap.entity_bitmap, entity_scope.bitmap)), 0)
         + COALESCE(rb_cardinality(rb_and(relation_bitmap.relation_bitmap, relation_scope.bitmap)), 0)
       ) > 0
       ${whereClause}
       GROUP BY terms.ontology_prefix
       ORDER BY scoped_count DESC, terms.ontology_prefix ASC`,
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

export async function getScopedOntologyIdCounts({
  entityPks = [],
  annotationTermIds = [],
  selectionScope,
  query = "",
}: {
  entityPks?: Array<string | number>;
  annotationTermIds?: string[];
  selectionScope?: OntologySelectionScopeInput;
  query?: string;
}): Promise<OntologyIdCount[]> {
  const normalizedSelectionScope = normalizeSelectionScope(selectionScope);
  const normalizedEntityPks = normalizeIdValues(entityPks);
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const hasScope = !!normalizedSelectionScope || normalizedEntityPks.length > 0 || normalizedTermIds.length > 0;

  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = hasScope
      ? normalizedSelectionScope
        ? [normalizedSelectionScope.entityPks, normalizedSelectionScope.annotationTermIds]
        : [normalizedEntityPks, normalizedTermIds]
      : [];
    const scopeCtes = normalizedSelectionScope
      ? ontologySelectionScopeBitmapCtes(S, "$1", "$2", normalizedSelectionScope)
      : ontologyBitmapScopeCtes(S, "$1", "$2");
    const whereParts: string[] = [];

    if (trimmedQuery) {
      params.push(`%${trimmedQuery}%`);
      whereParts.push(ontologyTermSearchPredicate(`$${params.length}`));
    }

    if (!hasScope) {
      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
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

    const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";

    const result = await client.query<{ ontology_id: string | null; scoped_count: string | number }>(
      `WITH ${scopeCtes}
       SELECT terms.ontology_id, COUNT(*) AS scoped_count
       FROM ${ontologyTermsTable(S)}
       LEFT JOIN ${S}.annotation_term_entity_bitmap entity_bitmap
         ON entity_bitmap.term_entity_id = terms.term_entity_id
       LEFT JOIN ${S}.annotation_term_direct_relation_bitmap relation_bitmap
         ON relation_bitmap.term_entity_id = terms.term_entity_id
       CROSS JOIN entity_scope_bitmap entity_scope
       CROSS JOIN relation_scope_bitmap relation_scope
       WHERE (
         COALESCE(rb_cardinality(rb_and(entity_bitmap.entity_bitmap, entity_scope.bitmap)), 0)
         + COALESCE(rb_cardinality(rb_and(relation_bitmap.relation_bitmap, relation_scope.bitmap)), 0)
       ) > 0
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
  entityPks?: Array<string | number>;
  annotationTermIds?: string[];
  query?: string;
}): Promise<OntologySourceCount[]> {
  const normalizedEntityPks = normalizeIdValues(entityPks);
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const trimmedQuery = query.trim();
  const hasScope = normalizedEntityPks.length > 0 || normalizedTermIds.length > 0;

  const client = await getPool().connect();
  try {
    const S = process.env.OMNIPATH_PG_SCHEMA || "public";
    const params: unknown[] = hasScope ? [normalizedEntityPks, normalizedTermIds] : [];
    const whereParts: string[] = [];

    if (trimmedQuery) {
      params.push(`%${trimmedQuery}%`);
      whereParts.push(ontologyTermSearchPredicate(`$${params.length}`));
    }

    if (!hasScope) {
      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
      const result = await client.query<{ source: string | null; scoped_count: string | number }>(
        `SELECT source.value AS source, COUNT(*) AS scoped_count
         FROM ${ontologyTermsTable(S)}
         CROSS JOIN LATERAL unnest(terms.sources) AS source(value)
         ${whereClause}
         ${whereClause ? "AND" : "WHERE"} source.value <> ''
         GROUP BY source.value
         ORDER BY scoped_count DESC, source.value ASC`,
        params,
      );

      return result.rows.map((row) => ({
        source: row.source ?? "unknown",
        scopedCount: Number(row.scoped_count || 0),
      }));
    }

    const whereClause = whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "";

    const result = await client.query<{ source: string | null; scoped_count: string | number }>(
      `WITH ${ontologyBitmapScopeCtes(S, "$1", "$2")}
       SELECT source.value AS source, COUNT(*) AS scoped_count
       FROM ${ontologyTermsTable(S)}
       LEFT JOIN ${S}.annotation_term_entity_bitmap entity_bitmap
         ON entity_bitmap.term_entity_id = terms.term_entity_id
       LEFT JOIN ${S}.annotation_term_direct_relation_bitmap relation_bitmap
         ON relation_bitmap.term_entity_id = terms.term_entity_id
       CROSS JOIN entity_scope_bitmap entity_scope
       CROSS JOIN relation_scope_bitmap relation_scope
       CROSS JOIN LATERAL unnest(terms.sources) AS source(value)
       WHERE (
         COALESCE(rb_cardinality(rb_and(entity_bitmap.entity_bitmap, entity_scope.bitmap)), 0)
         + COALESCE(rb_cardinality(rb_and(relation_bitmap.relation_bitmap, relation_scope.bitmap)), 0)
       ) > 0
       ${whereClause}
       AND source.value <> ''
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
  throw new Error("Bitmap rebuilds are owned by omnipath_build/minimal, not the Svelte app");
}

/** @deprecated Use {@link rebuildAllBitmaps} instead. Rebuilds only annotation-term -> entity bitmaps. */
export async function rebuildAnnotationTermBitmaps(): Promise<void> {
  throw new Error("Bitmap rebuilds are owned by omnipath_build/minimal, not the Svelte app");
}

export async function getEntityIdsForAnnotationTerms(termIds: string[]): Promise<string[]> {
  const normalized = Array.from(new Set(termIds.map((t) => t.trim()).filter(Boolean)));
  if (normalized.length === 0) return [];

  const client = await getPool().connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SET LOCAL jit = off");

    const SEARCH_SCHEMA = process.env.OMNIPATH_PG_SCHEMA || "public";
    const result = await client.query(
      `WITH RECURSIVE selected_terms AS MATERIALIZED (
         SELECT DISTINCT terms.term_entity_id
         FROM ${SEARCH_SCHEMA}.entity_ontology_term terms
         WHERE terms.term_id = ANY($1::text[])
            OR terms.term_aliases && $1::text[]
       ),
       selected_entities(entity_id) AS (
         SELECT term_entity_id AS entity_id FROM selected_terms
         UNION
         SELECT eor.subject_entity_id AS entity_id
         FROM ${SEARCH_SCHEMA}.entity_ontology_relation eor
         JOIN selected_entities selected
           ON selected.entity_id = eor.object_entity_id
       ),
       selected_entity_ids AS MATERIALIZED (
         SELECT DISTINCT entity_id
         FROM selected_entities
       )
       SELECT
         es.canonical_identifier,
         it.name AS canonical_identifier_type
       FROM selected_entity_ids selected
       JOIN ${SEARCH_SCHEMA}.entity es
         ON es.entity_id = selected.entity_id
       LEFT JOIN ${SEARCH_SCHEMA}.vocab_identifier_type it
         ON it.identifier_type_id = es.canonical_identifier_type_id`,
      [normalized],
    );
    const entityIds = result.rows.map((row) => toPublicEntityId(row));
    await client.query("COMMIT");
    inTransaction = false;
    return entityIds;
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}
