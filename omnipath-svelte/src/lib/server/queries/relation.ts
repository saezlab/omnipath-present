import { getPool } from "$lib/server/db/client";
import type { Entity, EntityRelation } from "$lib/drizzle";
import { toPublicEntityId } from "$lib/entity-public-id";
import {
  canonicalIdentifierTypeNameSql,
  entityTypeNameSql,
  relationCategoryEqualsSql,
  relationCategoryNameSql,
  relationPredicateNameSql,
  resolutionStatusNameSql,
} from "$lib/server/queries/sql-fragments";

const SEARCH_SCHEMA = () => process.env.OMNIPATH_PG_SCHEMA || "public";

export type RelationWithEntities = EntityRelation & {
  subjectEntity: Entity;
  objectEntity: Entity;
};

function toRelationRow(row: {
  relation_id: string | number;
  subject_entity_id: string | number;
  predicate: string;
  object_entity_id: string | number;
  relation_category: string | null;
  participant_types: string[] | null;
  evidence_count: string | number | null;
  sources: string[] | null;
}): EntityRelation {
  return {
    relationPk: String(row.relation_id),
    subjectEntityPk: String(row.subject_entity_id),
    predicate: row.predicate,
    objectEntityPk: String(row.object_entity_id),
    relationCategory: row.relation_category,
    participantTypes: (row.participant_types || []).filter(Boolean),
    evidenceCount: Number(row.evidence_count || 0),
    sources: (row.sources || []).filter(Boolean),
  };
}

function toEntityRow(row: {
  entity_id: string | number;
  id: string;
  id_type: string;
  resolution_status?: string | null;
  entity_type: string | null;
  taxonomy_id: string | null;
}): Entity {
  return {
    entityPk: String(row.entity_id),
    canonicalIdentifier: row.id,
    canonicalIdentifierType: row.id_type,
    resolutionStatus: row.resolution_status ?? null,
    entityType: row.entity_type,
    taxonomyId: row.taxonomy_id,
    entityAttributes: null,
    sources: [],
  };
}

function entityTypeSql(schema: string, alias: string): string {
  return entityTypeNameSql(schema, alias);
}

function canonicalTypeSql(schema: string, alias: string): string {
  return canonicalIdentifierTypeNameSql(schema, alias);
}

function resolutionStatusSql(schema: string, alias: string): string {
  return resolutionStatusNameSql(schema, alias);
}

function relationSelect(schema: string, alias = "r"): string {
  return `${alias}.relation_id,
    ${alias}.subject_entity_id,
    ${relationPredicateNameSql(schema, alias)} AS predicate,
    ${alias}.object_entity_id,
    ${relationCategoryNameSql(schema, alias)} AS relation_category,
    ARRAY(
      SELECT DISTINCT entity_type
      FROM (
        SELECT ${entityTypeSql(schema, "subject")} AS entity_type
        FROM ${schema}.entity subject
        WHERE subject.entity_id = ${alias}.subject_entity_id
        UNION
        SELECT ${entityTypeSql(schema, "object")} AS entity_type
        FROM ${schema}.entity object
        WHERE object.entity_id = ${alias}.object_entity_id
      ) participant_types
      WHERE entity_type IS NOT NULL
      ORDER BY entity_type
    ) AS participant_types,
    (
      SELECT COUNT(*)::bigint
      FROM ${schema}.relation_evidence_relation rer
      WHERE rer.relation_id = ${alias}.relation_id
    ) AS evidence_count,
    ARRAY(
      SELECT DISTINCT ds.name
      FROM ${schema}.relation_evidence_relation rer
      JOIN ${schema}.relation_evidence re
        ON re.source_id = rer.source_id
       AND re.relation_evidence_id = rer.relation_evidence_id
      JOIN ${schema}.data_source ds ON ds.source_id = re.source_id
      WHERE rer.relation_id = ${alias}.relation_id
        AND ds.name IS NOT NULL
        AND ds.name <> ''
      ORDER BY ds.name
    ) AS sources`;
}

export async function getRelationByPk(pk: string | number): Promise<RelationWithEntities | null> {
  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const result = await client.query<{
      relation_id: string | number;
      subject_entity_id: string | number;
      predicate: string;
      object_entity_id: string | number;
      relation_category: string | null;
      participant_types: string[] | null;
      evidence_count: string | number | null;
      sources: string[] | null;
      subject_id: string;
      subject_id_type: string;
      subject_resolution_status: string | null;
      subject_entity_type: string | null;
      subject_taxonomy_id: string | null;
      object_id: string;
      object_id_type: string;
      object_resolution_status: string | null;
      object_entity_type: string | null;
      object_taxonomy_id: string | null;
    }>(
      `SELECT
         ${relationSelect(schema, "r")},
         subject.canonical_identifier AS subject_id,
         ${canonicalTypeSql(schema, "subject")} AS subject_id_type,
         ${resolutionStatusSql(schema, "subject")} AS subject_resolution_status,
         ${entityTypeSql(schema, "subject")} AS subject_entity_type,
         subject.taxonomy_id AS subject_taxonomy_id,
         object.canonical_identifier AS object_id,
         ${canonicalTypeSql(schema, "object")} AS object_id_type,
         ${resolutionStatusSql(schema, "object")} AS object_resolution_status,
         ${entityTypeSql(schema, "object")} AS object_entity_type,
         object.taxonomy_id AS object_taxonomy_id
       FROM ${schema}.relation r
       JOIN ${schema}.entity subject ON subject.entity_id = r.subject_entity_id
       JOIN ${schema}.entity object ON object.entity_id = r.object_entity_id
       WHERE r.relation_id = $1::uuid
       LIMIT 1`,
      [String(pk)],
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      ...toRelationRow(row),
      subjectEntity: toEntityRow({
        entity_id: row.subject_entity_id,
        id: row.subject_id,
        id_type: row.subject_id_type,
        resolution_status: row.subject_resolution_status,
        entity_type: row.subject_entity_type,
        taxonomy_id: row.subject_taxonomy_id,
      }),
      objectEntity: toEntityRow({
        entity_id: row.object_entity_id,
        id: row.object_id,
        id_type: row.object_id_type,
        resolution_status: row.object_resolution_status,
        entity_type: row.object_entity_type,
        taxonomy_id: row.object_taxonomy_id,
      }),
    };
  } finally {
    client.release();
  }
}

export async function getRelationsByPks(pks: Array<string | number>): Promise<EntityRelation[]> {
  const normalized = normalizeIdValues(pks);
  if (normalized.length === 0) return [];
  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const result = await client.query<{
      relation_id: string | number;
      subject_entity_id: string | number;
      predicate: string;
      object_entity_id: string | number;
      relation_category: string | null;
      participant_types: string[] | null;
      evidence_count: string | number | null;
      sources: string[] | null;
    }>(
      `SELECT ${relationSelect(schema, "r")}
       FROM ${schema}.relation r
       WHERE r.relation_id = ANY($1::uuid[])
       ORDER BY r.relation_id`,
      [normalized],
    );
    return result.rows.map(toRelationRow);
  } finally {
    client.release();
  }
}

export interface RelationFilters {
  relationCategories?: string[];
  predicates?: string[];
  interactionTypes?: string[];
  subjectEntityPks?: Array<string | number>;
  objectEntityPks?: Array<string | number>;
  entityPks?: Array<string | number>;
  sources?: string[];
  taxonomyIds?: string[];
  annotationTerms?: string[];
  scopeEntityPks?: Array<string | number>;
  scopeEndpointMode?: "any" | "both";
  scopeMode?: "union" | "intersection";
  scopeAnnotationTerms?: string[];
}

function normalizeIdValues(values: Array<string | number> | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => String(value).trim()).filter(Boolean)));
}

function normalizeStringValues(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
}

function hasOnlyPredicateCategoryFilters(filters: RelationFilters): boolean {
  return normalizeIdValues(filters.subjectEntityPks).length === 0
    && normalizeIdValues(filters.objectEntityPks).length === 0
    && normalizeIdValues(filters.entityPks).length === 0
    && normalizeIdValues(filters.scopeEntityPks).length === 0
    && normalizeStringValues(filters.interactionTypes).length === 0
    && normalizeStringValues(filters.sources).length === 0
    && normalizeStringValues(filters.taxonomyIds).length === 0
    && normalizeStringValues(filters.annotationTerms).length === 0
    && normalizeStringValues(filters.scopeAnnotationTerms).length === 0;
}

function shouldUseIndexedTermSearch(filters: RelationFilters): boolean {
  if (!hasOnlyPredicateCategoryFilters(filters)) return false;
  return !normalizeStringValues(filters.predicates).includes("associated_with");
}

function buildRelationBitmapQuery(filters: RelationFilters, schema: string) {
  const params: unknown[] = [];
  const pushParam = (value: unknown, cast?: string): string => {
    params.push(value);
    const placeholder = `$${params.length}`;
    return cast ? `${placeholder}::${cast}` : placeholder;
  };

  const bitmapParts: string[] = [];
  const addFacetBitmap = (facetName: string, values: string[]) => {
    if (values.length === 0) return;
    const param = pushParam(values, "text[]");
    bitmapParts.push(`SELECT COALESCE(rb_or_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM ${schema}.facet_relation_bitmap
      WHERE facet_name = '${facetName}' AND facet_value = ANY(${param})`);
  };
  const addAnnotationTermBitmap = (values: string[]) => {
    if (values.length === 0) return;
    const param = pushParam(values, "text[]");
    bitmapParts.push(`SELECT COALESCE(rb_or_agg(b.relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM ${schema}.ontology_terms terms
      JOIN ${schema}.annotation_term_direct_relation_bitmap b ON b.term_entity_id = terms.term_entity_id
      WHERE terms.term_id = ANY(${param})`);
  };

  const relationCategories = normalizeStringValues(filters.relationCategories);
  if (relationCategories.length) {
    const param = pushParam(relationCategories, "text[]");
    bitmapParts.push(`SELECT COALESCE(rb_or_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM ${schema}.facet_relation_bitmap
      WHERE facet_name = 'predicate' AND facet_category = ANY(${param})`);
  }

  addFacetBitmap("predicate", normalizeStringValues(filters.predicates));
  addFacetBitmap("participant_type", normalizeStringValues(filters.interactionTypes));

  const subjectEntityPks = normalizeIdValues(filters.subjectEntityPks);
  if (subjectEntityPks.length) {
    const param = pushParam(subjectEntityPks, "uuid[]");
    bitmapParts.push(`SELECT COALESCE(rb_build_agg(bitmap.bitmap_id), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM ${schema}.relation r
      JOIN ${schema}.relation_bitmap_id bitmap ON bitmap.relation_id = r.relation_id
      WHERE r.subject_entity_id = ANY(${param})`);
  }

  const objectEntityPks = normalizeIdValues(filters.objectEntityPks);
  if (objectEntityPks.length) {
    const param = pushParam(objectEntityPks, "uuid[]");
    bitmapParts.push(`SELECT COALESCE(rb_build_agg(bitmap.bitmap_id), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM ${schema}.relation r
      JOIN ${schema}.relation_bitmap_id bitmap ON bitmap.relation_id = r.relation_id
      WHERE r.object_entity_id = ANY(${param})`);
  }

  const entityPks = normalizeIdValues(filters.entityPks);
  if (entityPks.length) {
    const param = pushParam(entityPks, "uuid[]");
    bitmapParts.push(`SELECT COALESCE(rb_or_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM ${schema}.entity_relation_bitmap
      WHERE entity_id = ANY(${param})`);
  }

  addFacetBitmap("source", normalizeStringValues(filters.sources));
  addFacetBitmap("taxonomy_id", normalizeStringValues(filters.taxonomyIds));

  addAnnotationTermBitmap(normalizeStringValues(filters.annotationTerms));

  const scopeBitmapParts: string[] = [];
  const scopeEntityPks = normalizeIdValues(filters.scopeEntityPks);
  if (scopeEntityPks.length) {
    const param = pushParam(scopeEntityPks, "uuid[]");
    const endpointPredicate = filters.scopeEndpointMode === "both"
      ? `r.subject_entity_id = ANY(${param}) AND r.object_entity_id = ANY(${param})`
      : `r.subject_entity_id = ANY(${param}) OR r.object_entity_id = ANY(${param})`;
    scopeBitmapParts.push(filters.scopeEndpointMode === "both"
      ? `SELECT COALESCE(rb_build_agg(bitmap.bitmap_id), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.relation r
        JOIN ${schema}.relation_bitmap_id bitmap ON bitmap.relation_id = r.relation_id
        WHERE ${endpointPredicate}`
      : `SELECT COALESCE(rb_or_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.entity_relation_bitmap
        WHERE entity_id = ANY(${param})`);
  }

  const scopeAnnotationTerms = normalizeStringValues(filters.scopeAnnotationTerms);
  if (scopeAnnotationTerms.length) {
    const param = pushParam(scopeAnnotationTerms, "text[]");
    if (filters.scopeMode === "intersection") {
      scopeBitmapParts.push(`SELECT
        CASE
          WHEN COUNT(DISTINCT terms.term_id) = cardinality(${param})
          THEN COALESCE(rb_and_agg(b.relation_bitmap), rb_build(ARRAY[]::integer[]))
          ELSE rb_build(ARRAY[]::integer[])
        END AS bitmap
        FROM ${schema}.ontology_terms terms
        JOIN ${schema}.annotation_term_direct_relation_bitmap b ON b.term_entity_id = terms.term_entity_id
        WHERE terms.term_id = ANY(${param})`);
    } else {
      scopeBitmapParts.push(`SELECT COALESCE(rb_or_agg(b.relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.ontology_terms terms
        JOIN ${schema}.annotation_term_direct_relation_bitmap b ON b.term_entity_id = terms.term_entity_id
        WHERE terms.term_id = ANY(${param})`);
    }
  }

  if (scopeBitmapParts.length) {
    const scopeAgg = filters.scopeMode === "intersection" ? "rb_and_agg" : "rb_or_agg";
    bitmapParts.push(`SELECT COALESCE(${scopeAgg}(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
      FROM (${scopeBitmapParts.join("\nUNION ALL\n")}) scope_bitmap_parts`);
  }

  const cte = bitmapParts.length
    ? `filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM (${bitmapParts.join("\nUNION ALL\n")}) bitmap_parts
      )`
    : `filter_bitmap AS MATERIALIZED (
        SELECT rb_or_agg(relation_bitmap) AS bitmap
        FROM ${schema}.facet_relation_bitmap
        WHERE facet_name = 'predicate'
      )`;

  return { cte, params };
}

export async function searchRelations({
  filters = {},
  limit = 20,
  offset = 0,
}: {
  filters?: RelationFilters;
  limit?: number;
  offset?: number;
} = {}): Promise<{ relations: EntityRelation[]; total: number }> {
  const schema = SEARCH_SCHEMA();
  if (shouldUseIndexedTermSearch(filters)) {
    return searchRelationsByIndexedTerms({ schema, filters, limit, offset });
  }

  const client = await getPool().connect();
  try {
    const { cte, params } = buildRelationBitmapQuery(filters, schema);
    const pageParams = [...params, limit, offset];
    const result = await client.query<{
      relation_id: string | number;
      subject_entity_id: string | number;
      predicate: string;
      object_entity_id: string | number;
      relation_category: string | null;
      participant_types: string[] | null;
      evidence_count: string | number | null;
      sources: string[] | null;
      total_count: string | number;
    }>(
      `WITH ${cte},
       total AS MATERIALIZED (
         SELECT COALESCE(rb_cardinality(bitmap), 0)::bigint AS total_count
         FROM filter_bitmap
       ),
       page_ids AS MATERIALIZED (
         SELECT relation_bitmap.relation_id
         FROM filter_bitmap,
              rb_iterate(rb_select(bitmap, $${pageParams.length - 1}, $${pageParams.length})) AS selected(bitmap_id)
         JOIN ${schema}.relation_bitmap_id relation_bitmap
           ON relation_bitmap.bitmap_id = selected.bitmap_id
       )
       SELECT ${relationSelect(schema, "r")}, total.total_count
       FROM page_ids page
       JOIN ${schema}.relation r ON r.relation_id = page.relation_id
       CROSS JOIN total
       ORDER BY r.relation_id`,
      pageParams,
    );

    return {
      relations: result.rows.map(toRelationRow),
      total: Number(result.rows[0]?.total_count || 0),
    };
  } finally {
    client.release();
  }
}

export async function countRelations(filters: RelationFilters = {}): Promise<number> {
  const schema = SEARCH_SCHEMA();
  if (hasOnlyPredicateCategoryFilters(filters)) {
    return countRelationsByFacetCounts(schema, filters);
  }

  const client = await getPool().connect();
  try {
    const { cte, params } = buildRelationBitmapQuery(filters, schema);
    const result = await client.query<{ count: string }>(
      `WITH ${cte}
       SELECT COALESCE(rb_cardinality(bitmap), 0)::bigint AS count
       FROM filter_bitmap`,
      params,
    );
    return Number(result.rows[0]?.count || 0);
  } finally {
    client.release();
  }
}

async function searchRelationsByIndexedTerms({
  schema,
  filters,
  limit,
  offset,
}: {
  schema: string;
  filters: RelationFilters;
  limit: number;
  offset: number;
}): Promise<{ relations: EntityRelation[]; total: number }> {
  const relationCategories = normalizeStringValues(filters.relationCategories);
  const predicates = normalizeStringValues(filters.predicates);
  const params: unknown[] = [];
  const where: string[] = [];

  if (predicates.length > 0) {
    params.push(predicates);
    where.push(`predicate_filter.name = ANY($${params.length}::text[])`);
  }
  if (relationCategories.length > 0) {
    params.push(relationCategories);
    where.push(`category_filter.name = ANY($${params.length}::text[])`);
  }

  params.push(limit, offset);
  const limitParam = `$${params.length - 1}`;
  const offsetParam = `$${params.length}`;

  const client = await getPool().connect();
  try {
    const [result, total] = await Promise.all([
      client.query<{
        relation_id: string | number;
        subject_entity_id: string | number;
        predicate: string;
        object_entity_id: string | number;
        relation_category: string | null;
        participant_types: string[] | null;
        evidence_count: string | number | null;
        sources: string[] | null;
      }>(
        `SELECT ${relationSelect(schema, "r")}
         FROM ${schema}.relation r
         JOIN ${schema}.vocab_relation_predicate predicate_filter
           ON predicate_filter.relation_predicate_id = r.predicate_id
         LEFT JOIN ${schema}.vocab_relation_category category_filter
           ON category_filter.relation_category_id = r.relation_category_id
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY r.relation_id
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params,
      ),
      countRelationsByFacetCounts(schema, filters),
    ]);

    return {
      relations: result.rows.map(toRelationRow),
      total,
    };
  } finally {
    client.release();
  }
}

async function countRelationsByFacetCounts(schema: string, filters: RelationFilters): Promise<number> {
  const relationCategories = normalizeStringValues(filters.relationCategories);
  const predicates = normalizeStringValues(filters.predicates);
  const params: unknown[] = [];
  const where = ["facet_name = 'predicate'"];

  if (predicates.length > 0) {
    params.push(predicates);
    where.push(`facet_value = ANY($${params.length}::text[])`);
  }
  if (relationCategories.length > 0) {
    params.push(relationCategories);
    where.push(`facet_category = ANY($${params.length}::text[])`);
  }

  const client = await getPool().connect();
  try {
    const result = await client.query<{ count: string }>(
      `SELECT COALESCE(SUM(relation_count), 0)::bigint AS count
       FROM ${schema}.facet_relation_bitmap
       WHERE ${where.join(" AND ")}`,
      params,
    );
    return Number(result.rows[0]?.count || 0);
  } finally {
    client.release();
  }
}

type RelationFilterOptions = {
  predicatesByCategory: Record<string, string[]>;
  sources: string[];
  interactionTypes: string[];
};

let relationFilterOptionsCache: { value: RelationFilterOptions; expiresAt: number } | null = null;
let relationFilterOptionsInFlight: Promise<RelationFilterOptions> | null = null;

export async function getRelationFilterOptions(): Promise<RelationFilterOptions> {
  const now = Date.now();
  if (relationFilterOptionsCache && relationFilterOptionsCache.expiresAt > now) return relationFilterOptionsCache.value;
  if (relationFilterOptionsInFlight) return relationFilterOptionsInFlight;

  relationFilterOptionsInFlight = (async () => {
    const schema = SEARCH_SCHEMA();
    const client = await getPool().connect();
    try {
      const predicateResult = await client.query<{ category: string; predicates: string[] | null }>(
        `SELECT category, array_agg(predicate ORDER BY predicate) AS predicates
         FROM (
           SELECT DISTINCT ${relationCategoryNameSql(schema, "r")} AS category, ${relationPredicateNameSql(schema, "r")} AS predicate
           FROM ${schema}.relation r
         ) t
         GROUP BY category
         ORDER BY category`,
      );
      const sourceResult = await client.query<{ values: string[] | null }>(
        `SELECT array_agg(facet_value ORDER BY facet_value) AS values
         FROM ${schema}.facet_relation_bitmap
         WHERE facet_name = 'source'`,
      );
      const interactionTypeResult = await client.query<{ values: string[] | null }>(
        `SELECT array_agg(facet_value ORDER BY facet_value) AS values
         FROM ${schema}.facet_relation_bitmap
         WHERE facet_name = 'participant_type'`,
      );

      const value = {
        predicatesByCategory: Object.fromEntries(
          predicateResult.rows.map((row) => [row.category || "uncategorized", row.predicates?.filter(Boolean) ?? []]),
        ),
        sources: sourceResult.rows[0]?.values?.filter(Boolean) ?? [],
        interactionTypes: interactionTypeResult.rows[0]?.values?.filter(Boolean) ?? [],
      };

      relationFilterOptionsCache = { value, expiresAt: Date.now() + 30 * 60 * 1000 };
      return value;
    } finally {
      client.release();
      relationFilterOptionsInFlight = null;
    }
  })();

  return relationFilterOptionsInFlight;
}

export async function getAssociatedEntityIds(entityPks: Array<string | number>): Promise<string[]> {
  const normalized = normalizeIdValues(entityPks);
  if (normalized.length === 0) return [];

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const result = await client.query<{ id: string; id_type: string }>(
      `SELECT DISTINCT
         e.canonical_identifier AS id,
         ${canonicalTypeSql(schema, "e")} AS id_type
       FROM ${schema}.relation r
       JOIN ${schema}.entity e ON e.entity_id = r.object_entity_id
       WHERE ${relationCategoryEqualsSql(schema, "r", "association")}
         AND r.subject_entity_id = ANY($1::uuid[])
       ORDER BY id_type, id`,
      [normalized],
    );

    return result.rows.map((row) => toPublicEntityId(row));
  } finally {
    client.release();
  }
}

export type RelationFacetCount = {
  facetName: string;
  facetValue: string;
  facetCategory: string | null;
  scopedCount: number;
};

export async function getScopedRelationFacetCounts({
  entityPks = [],
  endpointMode = "any",
  mode = "union",
  annotationTermIds = [],
  predicates = [],
  interactionTypes = [],
  sources = [],
  taxonomyIds = [],
}: {
  entityPks?: Array<string | number>;
  endpointMode?: "any" | "both";
  mode?: "union" | "intersection";
  annotationTermIds?: string[];
  predicates?: string[];
  interactionTypes?: string[];
  sources?: string[];
  taxonomyIds?: string[];
}): Promise<RelationFacetCount[]> {
  const normalizedEntityPks = normalizeIdValues(entityPks);
  const normalizedTermIds = Array.from(new Set(annotationTermIds.map((id) => id.trim()).filter(Boolean)));
  const normalizedPredicates = Array.from(new Set(predicates.map((v) => v.trim()).filter(Boolean)));
  const normalizedInteractionTypes = Array.from(new Set(interactionTypes.map((v) => v.trim()).filter(Boolean)));
  const normalizedSources = Array.from(new Set(sources.map((v) => v.trim()).filter(Boolean)));
  const normalizedTaxonomyIds = Array.from(new Set(taxonomyIds.map((v) => v.trim()).filter(Boolean)));

  const schema = SEARCH_SCHEMA();
  const client = await getPool().connect();
  try {
    const params: unknown[] = [];
    const pushParam = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const ctes: string[] = [];
    const scopeParts: string[] = [];
    if (normalizedTermIds.length > 0) {
      const termParam = pushParam(normalizedTermIds);
      if (mode === "intersection") {
        scopeParts.push(`SELECT
          CASE
            WHEN COUNT(DISTINCT terms.term_id) = cardinality(${termParam}::text[])
            THEN COALESCE(rb_and_agg(b.relation_bitmap), rb_build(ARRAY[]::integer[]))
            ELSE rb_build(ARRAY[]::integer[])
          END AS bitmap
          FROM ${schema}.ontology_terms terms
          JOIN ${schema}.annotation_term_direct_relation_bitmap b ON b.term_entity_id = terms.term_entity_id
          WHERE terms.term_id = ANY(${termParam}::text[])`);
      } else {
        scopeParts.push(`SELECT COALESCE(rb_or_agg(b.relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
          FROM ${schema}.ontology_terms terms
          JOIN ${schema}.annotation_term_direct_relation_bitmap b ON b.term_entity_id = terms.term_entity_id
          WHERE terms.term_id = ANY(${termParam}::text[])`);
      }
    }
    if (normalizedEntityPks.length > 0) {
      const ePkParam = pushParam(normalizedEntityPks);
      const endpointPredicate = endpointMode === "both"
        ? `r.subject_entity_id = ANY(${ePkParam}::uuid[]) AND r.object_entity_id = ANY(${ePkParam}::uuid[])`
        : `r.subject_entity_id = ANY(${ePkParam}::uuid[]) OR r.object_entity_id = ANY(${ePkParam}::uuid[])`;
      scopeParts.push(endpointMode === "both"
        ? `SELECT COALESCE(rb_build_agg(bitmap.bitmap_id), rb_build(ARRAY[]::integer[])) AS bitmap
          FROM ${schema}.relation r
          JOIN ${schema}.relation_bitmap_id bitmap ON bitmap.relation_id = r.relation_id
          WHERE ${endpointPredicate}`
        : `SELECT COALESCE(rb_or_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
          FROM ${schema}.entity_relation_bitmap
          WHERE entity_id = ANY(${ePkParam}::uuid[])`);
    }

    const scopeAgg = mode === "intersection" ? "rb_and_agg" : "rb_or_agg";
    ctes.push(scopeParts.length > 0
      ? `scope_base AS MATERIALIZED (
          SELECT COALESCE(${scopeAgg}(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
          FROM (${scopeParts.join("\nUNION ALL\n")}) scope_parts
        )`
      : `scope_base AS MATERIALIZED (
          SELECT rb_or_agg(relation_bitmap) AS bitmap
          FROM ${schema}.facet_relation_bitmap
          WHERE facet_name = 'predicate'
        )`);

    if (normalizedPredicates.length > 0) {
      const predParam = pushParam(normalizedPredicates);
      ctes.push(`predicate_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_relation_bitmap
        WHERE facet_name = 'predicate' AND facet_value = ANY(${predParam}::text[])
      )`);
    }
    if (normalizedInteractionTypes.length > 0) {
      const typeParam = pushParam(normalizedInteractionTypes);
      ctes.push(`participant_type_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_relation_bitmap
        WHERE facet_name = 'participant_type' AND facet_value = ANY(${typeParam}::text[])
      )`);
    }
    if (normalizedSources.length > 0) {
      const sourceParam = pushParam(normalizedSources);
      ctes.push(`source_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_relation_bitmap
        WHERE facet_name = 'source' AND facet_value = ANY(${sourceParam}::text[])
      )`);
    }
    if (normalizedTaxonomyIds.length > 0) {
      const taxonomyParam = pushParam(normalizedTaxonomyIds);
      ctes.push(`taxonomy_filter_bitmap AS MATERIALIZED (
        SELECT COALESCE(rb_or_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
        FROM ${schema}.facet_relation_bitmap
        WHERE facet_name = 'taxonomy_id' AND facet_value = ANY(${taxonomyParam}::text[])
      )`);
    }

    const scopeAnd = (extras: (string | null)[]): string => {
      const parts = ["scope_base.bitmap", ...extras.filter((e): e is string => e != null)];
      return parts.slice(1).reduce((acc, part) => `rb_and(${acc}, ${part})`, parts[0]);
    };
    const joins = ["CROSS JOIN scope_base"];
    if (normalizedPredicates.length > 0) joins.push("CROSS JOIN predicate_filter_bitmap");
    if (normalizedInteractionTypes.length > 0) joins.push("CROSS JOIN participant_type_filter_bitmap");
    if (normalizedSources.length > 0) joins.push("CROSS JOIN source_filter_bitmap");
    if (normalizedTaxonomyIds.length > 0) joins.push("CROSS JOIN taxonomy_filter_bitmap");

    const subqueries = [
      `SELECT 'predicate' AS facet_name, f.facet_value, f.facet_category,
        rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedInteractionTypes.length > 0 ? "participant_type_filter_bitmap.bitmap" : null, normalizedSources.length > 0 ? "source_filter_bitmap.bitmap" : null, normalizedTaxonomyIds.length > 0 ? "taxonomy_filter_bitmap.bitmap" : null])})) AS scoped_count
       FROM ${schema}.facet_relation_bitmap f ${joins.join("\n")}
       WHERE f.facet_name = 'predicate'
         AND rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedInteractionTypes.length > 0 ? "participant_type_filter_bitmap.bitmap" : null, normalizedSources.length > 0 ? "source_filter_bitmap.bitmap" : null, normalizedTaxonomyIds.length > 0 ? "taxonomy_filter_bitmap.bitmap" : null])})) > 0`,
      `SELECT 'participant_type' AS facet_name, f.facet_value, f.facet_category,
        rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedPredicates.length > 0 ? "predicate_filter_bitmap.bitmap" : null, normalizedSources.length > 0 ? "source_filter_bitmap.bitmap" : null, normalizedTaxonomyIds.length > 0 ? "taxonomy_filter_bitmap.bitmap" : null])})) AS scoped_count
       FROM ${schema}.facet_relation_bitmap f ${joins.join("\n")}
       WHERE f.facet_name = 'participant_type'
         AND rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedPredicates.length > 0 ? "predicate_filter_bitmap.bitmap" : null, normalizedSources.length > 0 ? "source_filter_bitmap.bitmap" : null, normalizedTaxonomyIds.length > 0 ? "taxonomy_filter_bitmap.bitmap" : null])})) > 0`,
      `SELECT 'source' AS facet_name, f.facet_value, f.facet_category,
        rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedPredicates.length > 0 ? "predicate_filter_bitmap.bitmap" : null, normalizedInteractionTypes.length > 0 ? "participant_type_filter_bitmap.bitmap" : null, normalizedTaxonomyIds.length > 0 ? "taxonomy_filter_bitmap.bitmap" : null])})) AS scoped_count
       FROM ${schema}.facet_relation_bitmap f ${joins.join("\n")}
       WHERE f.facet_name = 'source'
         AND rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedPredicates.length > 0 ? "predicate_filter_bitmap.bitmap" : null, normalizedInteractionTypes.length > 0 ? "participant_type_filter_bitmap.bitmap" : null, normalizedTaxonomyIds.length > 0 ? "taxonomy_filter_bitmap.bitmap" : null])})) > 0`,
      `SELECT 'taxonomy_id' AS facet_name, f.facet_value, f.facet_category,
        rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedPredicates.length > 0 ? "predicate_filter_bitmap.bitmap" : null, normalizedInteractionTypes.length > 0 ? "participant_type_filter_bitmap.bitmap" : null, normalizedSources.length > 0 ? "source_filter_bitmap.bitmap" : null])})) AS scoped_count
       FROM ${schema}.facet_relation_bitmap f ${joins.join("\n")}
       WHERE f.facet_name = 'taxonomy_id'
         AND rb_cardinality(rb_and(f.relation_bitmap, ${scopeAnd([normalizedPredicates.length > 0 ? "predicate_filter_bitmap.bitmap" : null, normalizedInteractionTypes.length > 0 ? "participant_type_filter_bitmap.bitmap" : null, normalizedSources.length > 0 ? "source_filter_bitmap.bitmap" : null])})) > 0`,
    ];

    const result = await client.query<{ facet_name: string; facet_value: string; facet_category: string | null; scoped_count: string | number }>(
      `WITH ${ctes.join(",\n")}
       ${subqueries.join("\nUNION ALL\n")}
       ORDER BY facet_name, scoped_count DESC`,
      params,
    );

    return result.rows.map((row) => ({
      facetName: row.facet_name,
      facetValue: row.facet_value,
      facetCategory: row.facet_category,
      scopedCount: Number(row.scoped_count || 0),
    }));
  } finally {
    client.release();
  }
}
