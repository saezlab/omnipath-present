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
  const termIds = normalizeTermIds(annotationTermIds);
  const criteria: Array<Set<string>> = [];
  let termEntityPks: string[] = [];

  const schema = process.env.OMNIPATH_PG_SCHEMA || "public";
  const client = await getPool().connect();
  try {
    if (termIds.length > 0) {
      const result = await client.query<{ term_entity_id: string }>(
        `SELECT term_entity_id::text
         FROM ${schema}.ontology_terms
         WHERE term_id = ANY($1::text[])
         ORDER BY term_id`,
        [termIds],
      );
      termEntityPks = Array.from(new Set(result.rows.map((row) => row.term_entity_id)));
    }

    if (includeAssociatedEntities && termIds.length > 0) {
      const result = await client.query<CriterionRow>(
        `SELECT
           terms.term_id AS criterion_id,
           array_agg(DISTINCT r.object_entity_id::text ORDER BY r.object_entity_id::text) AS entity_ids
         FROM ${schema}.ontology_terms terms
         JOIN ${schema}.relation r
           ON r.subject_entity_id = terms.term_entity_id
         WHERE ${relationCategoryEqualsSql(schema, "r", "association")}
           AND terms.term_id = ANY($1::text[])
         GROUP BY terms.term_id`,
        [termIds],
      );
      const entitiesByTermId = new Map(result.rows.map((row) => [row.criterion_id, row.entity_ids || []]));
      criteria.push(...termIds.map((termId) => new Set(entitiesByTermId.get(termId) || [])));
    }

    if (seedEntityPks.length > 0) {
      const entityCriterion = new Set(seedEntityPks);

      if (includeMembersParticipants) {
        const result = await client.query<CriterionRow>(
          `SELECT
             r.subject_entity_id::text AS criterion_id,
             array_agg(DISTINCT r.object_entity_id::text ORDER BY r.object_entity_id::text) AS entity_ids
           FROM ${schema}.relation r
           WHERE r.subject_entity_id = ANY($1::uuid[])
             AND ${relationPredicateNameSql(schema, "r")} IN ('has_member', 'has_participant')
           GROUP BY r.subject_entity_id`,
          [seedEntityPks],
        );
        for (const row of result.rows) {
          for (const entityPk of row.entity_ids || []) entityCriterion.add(entityPk);
        }
      }

      criteria.push(entityCriterion);
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
    criteriaCount: criteria.length,
    expandedEntityCount: expandedSet.size,
  };
}
