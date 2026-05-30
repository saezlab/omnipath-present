import { getPool } from "$lib/server/db/client";
import { relationCategoryEqualsSql, relationPredicateNameSql } from "$lib/server/queries/sql-fragments";

export type SelectionScopeMode = "union" | "intersection";

export type SelectionScopeInput = {
  entityPks?: Array<string | number>;
  annotationTermIds?: string[];
  includeAssociatedEntities?: boolean;
  includeMembersParticipants?: boolean;
  mode?: SelectionScopeMode;
};

export type SelectionScopeResult = {
  entityPks: string[];
  seedEntityPks: string[];
  termEntityPks: string[];
  ontologyTermIds: string[];
  criteriaCount: number;
  expandedEntityCount: number;
};

type CriterionRow = {
  criterion_id: string;
  entity_ids: string[] | null;
};

function normalizeIds(values: Array<string | number> | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => String(value).trim()).filter(Boolean)));
}

function normalizeTermIds(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
}

function intersectSets(sets: Array<Set<string>>): Set<string> {
  if (sets.length === 0) return new Set();
  const [smallest, ...rest] = [...sets].sort((a, b) => a.size - b.size);
  const result = new Set<string>();
  for (const value of smallest) {
    if (rest.every((set) => set.has(value))) result.add(value);
  }
  return result;
}

export async function resolveSelectionScope({
  entityPks = [],
  annotationTermIds = [],
  includeAssociatedEntities = true,
  includeMembersParticipants = true,
  mode = "union",
}: SelectionScopeInput): Promise<SelectionScopeResult> {
  const seedEntityPks = normalizeIds(entityPks);
  const requestedTermIds = normalizeTermIds(annotationTermIds);
  const criteria: Array<Set<string>> = [];
  let termEntityPks: string[] = [];
  let ontologyTermIds: string[] = requestedTermIds;
  const seedOntologyTermEntityPks = new Set<string>();

  const schema = process.env.OMNIPATH_PG_SCHEMA || "public";
  const client = await getPool().connect();
  try {
    if (seedEntityPks.length > 0) {
      const result = await client.query<{ term_entity_id: string; term_id: string }>(
        `SELECT DISTINCT terms.term_entity_id::text, terms.term_id
         FROM ${schema}.entity_ontology_term terms
         WHERE terms.term_entity_id = ANY($1::uuid[])
         ORDER BY terms.term_entity_id::text, terms.term_id`,
        [seedEntityPks],
      );
      const seedOntologyTermIds = result.rows.map((row) => row.term_id);
      for (const row of result.rows) seedOntologyTermEntityPks.add(row.term_entity_id);
      ontologyTermIds = Array.from(new Set([...requestedTermIds, ...seedOntologyTermIds]));
    }

    if (ontologyTermIds.length > 0) {
      const result = await client.query<{ term_entity_id: string }>(
        `SELECT DISTINCT terms.term_entity_id::text
         FROM ${schema}.entity_ontology_term terms
         WHERE terms.term_id = ANY($1::text[])
            OR terms.term_aliases && $1::text[]
         ORDER BY terms.term_entity_id::text`,
        [ontologyTermIds],
      );
      termEntityPks = Array.from(new Set(result.rows.map((row) => row.term_entity_id)));
    }

    if (includeAssociatedEntities && ontologyTermIds.length > 0) {
      const result = await client.query<CriterionRow>(
        `WITH requested AS (
           SELECT unnest($1::text[]) AS term_id
         ),
         term_bitmaps AS (
           SELECT
             requested.term_id AS criterion_id,
             COALESCE(rb_or_agg(bitmap.entity_bitmap), rb_build(ARRAY[]::integer[])) AS entity_bitmap
           FROM requested
           JOIN ${schema}.entity_ontology_term terms
             ON terms.term_id = requested.term_id
             OR requested.term_id = ANY(terms.term_aliases)
           JOIN ${schema}.annotation_term_entity_bitmap bitmap
             ON bitmap.term_entity_id = terms.term_entity_id
           GROUP BY requested.term_id
         )
         SELECT
           term_bitmaps.criterion_id,
           array_agg(entity_bitmap.entity_id::text ORDER BY entity_bitmap.entity_id::text) AS entity_ids
         FROM term_bitmaps
         CROSS JOIN LATERAL rb_iterate(term_bitmaps.entity_bitmap) matched(bitmap_id)
         JOIN ${schema}.entity_bitmap_id entity_bitmap
           ON entity_bitmap.bitmap_id = matched.bitmap_id
         GROUP BY term_bitmaps.criterion_id`,
        [ontologyTermIds],
      );
      const entitiesByTermId = new Map(result.rows.map((row) => [row.criterion_id, row.entity_ids || []]));
      criteria.push(...ontologyTermIds.map((termId) => new Set(entitiesByTermId.get(termId) || [])));
    }

    if (seedEntityPks.length > 0) {
      const entitySeedPks = seedEntityPks.filter((entityPk) => !seedOntologyTermEntityPks.has(entityPk));
      const entityCriterion = new Set(entitySeedPks);

      if (includeMembersParticipants && entitySeedPks.length > 0) {
        const result = await client.query<CriterionRow>(
          `SELECT
             r.subject_entity_id::text AS criterion_id,
             array_agg(DISTINCT r.object_entity_id::text ORDER BY r.object_entity_id::text) AS entity_ids
           FROM ${schema}.relation r
           WHERE r.subject_entity_id = ANY($1::uuid[])
             AND ${relationPredicateNameSql(schema, "r")} IN ('has_member', 'has_participant')
           GROUP BY r.subject_entity_id`,
          [entitySeedPks],
        );
        for (const row of result.rows) {
          for (const entityPk of row.entity_ids || []) entityCriterion.add(entityPk);
        }
      }

      if (includeAssociatedEntities && entitySeedPks.length > 0) {
        const result = await client.query<CriterionRow>(
          `WITH endpoint AS (
             SELECT r.subject_entity_id AS criterion_id, r.object_entity_id AS entity_id
             FROM ${schema}.relation r
             WHERE r.subject_entity_id = ANY($1::uuid[])
               AND ${relationCategoryEqualsSql(schema, "r", "association")}
           )
           SELECT
             criterion_id::text,
             array_agg(DISTINCT entity_id::text ORDER BY entity_id::text) AS entity_ids
           FROM endpoint
           GROUP BY criterion_id`,
          [entitySeedPks],
        );
        for (const row of result.rows) {
          for (const entityPk of row.entity_ids || []) entityCriterion.add(entityPk);
        }
      }

      if (entitySeedPks.length > 0) criteria.push(entityCriterion);
    }
  } finally {
    client.release();
  }

  const seedSet = new Set(seedEntityPks);
  const scopedSet =
    criteria.length === 0
      ? new Set<string>()
      : mode === "intersection"
      ? intersectSets(criteria)
      : criteria.reduce((acc, criterion) => {
          for (const id of criterion) acc.add(id);
          return acc;
        }, new Set<string>());

  const expandedSet = new Set([...scopedSet].filter((id) => !seedSet.has(id)));
  return {
    entityPks: [...scopedSet],
    seedEntityPks: seedEntityPks,
    termEntityPks,
    ontologyTermIds,
    criteriaCount: criteria.length,
    expandedEntityCount: expandedSet.size,
  };
}
