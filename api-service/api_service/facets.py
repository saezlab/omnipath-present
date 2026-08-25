"""Postgres-backed scoped facet and ontology search helpers."""

from __future__ import annotations

import os
from typing import Any
from .resource_catalog import resolve_resource_filters

SEARCH_SCHEMA = os.getenv("OMNIPATH_PG_SCHEMA", "public")


def _database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not configured")
    return url


def _connect():
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(_database_url(), row_factory=dict_row)


def _relation_term_bitmap_table() -> str:
    with _connect() as conn:
        for table_name in (
            "annotation_term_relation_bitmap",
            "annotation_term_direct_relation_bitmap",
        ):
            row = conn.execute(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_name = %s
                """,
                (SEARCH_SCHEMA, table_name),
            ).fetchone()
            if row:
                return table_name
    return "annotation_term_direct_relation_bitmap"


def _strings(values: list[Any] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values or []:
        text = str(value).strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _ints(values: list[Any] | None) -> list[int]:
    seen: set[int] = set()
    out: list[int] = []
    for value in values or []:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed not in seen:
            seen.add(parsed)
            out.append(parsed)
    return out


def _ids(values: list[Any] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values or []:
        text = str(value).strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def list_sources(domain: str | None = None) -> list[dict[str, Any]]:
    normalized_domain = str(domain or "").strip().lower()
    domain_filter = normalized_domain if normalized_domain in {"entity", "relation"} else None

    params: list[Any] = []
    domain_where = ""
    if domain_filter:
        domain_where = "WHERE domain = %s"
        params.append(domain_filter)

    sql = f"""
        WITH source_counts AS (
          SELECT
            'entity' AS domain,
            facet_value AS source,
            entity_count::bigint AS entity_count,
            0::bigint AS relation_count
          FROM {SEARCH_SCHEMA}.facet_entity_bitmap
          WHERE facet_name = 'source'
          UNION ALL
          SELECT
            'relation' AS domain,
            facet_value AS source,
            0::bigint AS entity_count,
            relation_count::bigint AS relation_count
          FROM {SEARCH_SCHEMA}.facet_relation_bitmap
          WHERE facet_name = 'source'
        )
        SELECT
          source,
          SUM(entity_count)::bigint AS entity_count,
          SUM(relation_count)::bigint AS relation_count,
          SUM(entity_count + relation_count)::bigint AS total_count
        FROM source_counts
        {domain_where}
        GROUP BY source
        ORDER BY total_count DESC, source
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [
        {
            "source": row["source"],
            "entityCount": int(row["entity_count"] or 0),
            "relationCount": int(row["relation_count"] or 0),
            "totalCount": int(row["total_count"] or 0),
        }
        for row in rows
    ]


def _chain_bitmaps(parts: list[str]) -> str:
    expr = parts[0]
    for part in parts[1:]:
        expr = f"rb_and({expr}, {part})"
    return expr


def scoped_entity_facet_counts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    entity_pks = _ids(payload.get("entityPks") or payload.get("entity_pks"))
    term_ids = _strings(payload.get("annotationTermIds") or payload.get("annotation_terms") or payload.get("ontology_terms"))
    entity_types = _strings(payload.get("entityTypes") or payload.get("entity_types"))
    sources = resolve_resource_filters(_strings(payload.get("sources")))
    taxonomy_ids = _strings(payload.get("ncbi_tax_id") or payload.get("taxonomy_ids"))
    query = str(payload.get("query") or "").strip()

    params: list[Any] = []

    def push(value: Any) -> str:
        params.append(value)
        return "%s"

    ctes: list[str] = []
    scope_parts: list[str] = []
    if term_ids:
        scope_parts.append(f"""
            SELECT b.entity_bitmap AS bitmap
            FROM {SEARCH_SCHEMA}.entity_ontology_term terms
            JOIN {SEARCH_SCHEMA}.annotation_term_entity_bitmap b ON b.term_entity_id = terms.term_entity_id
            WHERE terms.term_id = ANY({push(term_ids)}::text[])
        """)
    if entity_pks:
        scope_parts.append(f"""
            SELECT rb_build_agg(ebi.bitmap_id) AS bitmap
            FROM {SEARCH_SCHEMA}.entity_bitmap_id ebi
            WHERE ebi.entity_id = ANY({push(entity_pks)}::uuid[])
        """)

    if scope_parts:
        ctes.append(f"""
            scope_base AS MATERIALIZED (
                SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
                FROM ({' UNION ALL '.join(scope_parts)}) scope_parts
            )
        """)
    else:
        ctes.append(f"""
            scope_base AS MATERIALIZED (
                SELECT rb_or_agg(entity_bitmap) AS bitmap
                FROM {SEARCH_SCHEMA}.facet_entity_bitmap
                WHERE facet_name = 'entity_type'
            )
        """)

    if query:
        query_lower = query.lower()
        ctes.append(f"""
            query_bitmap AS MATERIALIZED (
                SELECT rb_build_agg(ebi.bitmap_id) AS bitmap
                FROM (
                    SELECT e.entity_id
                    FROM {SEARCH_SCHEMA}.entity e
                    WHERE LOWER(e.canonical_identifier) = {push(query_lower)}
                    UNION
                    SELECT eil.entity_id
                    FROM {SEARCH_SCHEMA}.identifier_evidence i
                    JOIN {SEARCH_SCHEMA}.entity_identifier_lookup eil
                      ON eil.identifier_id = i.identifier_id
                    WHERE LOWER(i.value) = %s
                ) query_entities
                JOIN {SEARCH_SCHEMA}.entity_bitmap_id ebi ON ebi.entity_id = query_entities.entity_id
            )
        """)
        params.append(query_lower)

    if entity_types:
        ctes.append(f"""
            type_filter_bitmap AS MATERIALIZED (
                SELECT COALESCE(rb_and_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
                FROM {SEARCH_SCHEMA}.facet_entity_bitmap
                WHERE facet_name = 'entity_type' AND facet_value = ANY({push(entity_types)}::text[])
            )
        """)
    if sources:
        ctes.append(f"""
            source_filter_bitmap AS MATERIALIZED (
                SELECT COALESCE(rb_and_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
                FROM {SEARCH_SCHEMA}.facet_entity_bitmap
                WHERE facet_name = 'source' AND facet_value = ANY({push(sources)}::text[])
            )
        """)
    if taxonomy_ids:
        ctes.append(f"""
            taxonomy_filter_bitmap AS MATERIALIZED (
                SELECT COALESCE(rb_and_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
                FROM {SEARCH_SCHEMA}.facet_entity_bitmap
                WHERE facet_name = 'taxonomy_id' AND facet_value = ANY({push(taxonomy_ids)}::text[])
            )
        """)

    joins = ["CROSS JOIN scope_base"]
    if query:
        joins.append("CROSS JOIN query_bitmap")
    if entity_types:
        joins.append("CROSS JOIN type_filter_bitmap")
    if sources:
        joins.append("CROSS JOIN source_filter_bitmap")
    if taxonomy_ids:
        joins.append("CROSS JOIN taxonomy_filter_bitmap")
    joins_sql = "\n".join(joins)

    type_scope = _chain_bitmaps(["scope_base.bitmap", *(["query_bitmap.bitmap"] if query else []), *(["source_filter_bitmap.bitmap"] if sources else []), *(["taxonomy_filter_bitmap.bitmap"] if taxonomy_ids else [])])
    source_scope = _chain_bitmaps(["scope_base.bitmap", *(["query_bitmap.bitmap"] if query else []), *(["type_filter_bitmap.bitmap"] if entity_types else []), *(["taxonomy_filter_bitmap.bitmap"] if taxonomy_ids else [])])
    taxonomy_scope = _chain_bitmaps(["scope_base.bitmap", *(["query_bitmap.bitmap"] if query else []), *(["type_filter_bitmap.bitmap"] if entity_types else []), *(["source_filter_bitmap.bitmap"] if sources else [])])
    # Derived classification facets (chemical_class, metabolic_domain,
    # structural_specificity). These are not filter inputs, so they are counted
    # against the full scope (all active filters applied).
    full_scope = _chain_bitmaps(["scope_base.bitmap", *(["query_bitmap.bitmap"] if query else []), *(["type_filter_bitmap.bitmap"] if entity_types else []), *(["source_filter_bitmap.bitmap"] if sources else []), *(["taxonomy_filter_bitmap.bitmap"] if taxonomy_ids else [])])
    CLASSIFICATION_FACETS = ("chemical_class", "metabolic_domain", "structural_specificity")
    classification_branches = "\n".join(
        f"""
        UNION ALL
        SELECT '{facet}' AS facet_name, f.facet_value, NULL::text AS facet_category,
               rb_cardinality(rb_and(f.entity_bitmap, {full_scope})) AS scoped_count
        FROM {SEARCH_SCHEMA}.facet_entity_bitmap f
        {joins_sql}
        WHERE f.facet_name = '{facet}'
          AND rb_cardinality(rb_and(f.entity_bitmap, {full_scope})) > 0
        """
        for facet in CLASSIFICATION_FACETS
    )

    sql = f"""
        WITH {', '.join(ctes)}
        SELECT 'entity_type' AS facet_name, f.facet_value, NULL::text AS facet_category,
               rb_cardinality(rb_and(f.entity_bitmap, {type_scope})) AS scoped_count
        FROM {SEARCH_SCHEMA}.facet_entity_bitmap f
        {joins_sql}
        WHERE f.facet_name = 'entity_type'
          AND rb_cardinality(rb_and(f.entity_bitmap, {type_scope})) > 0
        UNION ALL
        SELECT 'source' AS facet_name, f.facet_value, NULL::text AS facet_category,
               rb_cardinality(rb_and(f.entity_bitmap, {source_scope})) AS scoped_count
        FROM {SEARCH_SCHEMA}.facet_entity_bitmap f
        {joins_sql}
        WHERE f.facet_name = 'source'
          AND rb_cardinality(rb_and(f.entity_bitmap, {source_scope})) > 0
        UNION ALL
        SELECT 'taxonomy_id' AS facet_name, f.facet_value, NULL::text AS facet_category,
               rb_cardinality(rb_and(f.entity_bitmap, {taxonomy_scope})) AS scoped_count
        FROM {SEARCH_SCHEMA}.facet_entity_bitmap f
        {joins_sql}
        WHERE f.facet_name = 'taxonomy_id'
          AND rb_cardinality(rb_and(f.entity_bitmap, {taxonomy_scope})) > 0
        {classification_branches}
        ORDER BY facet_name, scoped_count DESC
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [{"facetName": r["facet_name"], "facetValue": r["facet_value"], "facetCategory": r["facet_category"], "scopedCount": int(r["scoped_count"] or 0)} for r in rows]


def scoped_relation_facet_counts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    entity_pks = _ids(payload.get("entityPks") or payload.get("entity_pks"))
    term_ids = _strings(payload.get("annotationTermIds") or payload.get("annotation_terms") or payload.get("ontology_terms"))
    predicates = _strings(payload.get("predicates"))
    participant_types = _strings(payload.get("participantTypes") or payload.get("participant_types") or payload.get("interactionTypes") or payload.get("interaction_types"))
    sources = resolve_resource_filters(_strings(payload.get("sources")))
    taxonomy_ids = _strings(payload.get("ncbi_tax_id") or payload.get("taxonomy_ids") or payload.get("taxonomyIds"))

    params: list[Any] = []

    def push(value: Any) -> str:
        params.append(value)
        return "%s"

    ctes: list[str] = []
    scope_parts: list[str] = []
    if term_ids:
        relation_term_bitmap_table = _relation_term_bitmap_table()
        scope_parts.append(f"""
            SELECT b.relation_bitmap AS bitmap
            FROM {SEARCH_SCHEMA}.entity_ontology_term terms
            JOIN {SEARCH_SCHEMA}.{relation_term_bitmap_table} b ON b.term_entity_id = terms.term_entity_id
            WHERE terms.term_id = ANY({push(term_ids)}::text[])
        """)
    if entity_pks:
        scope_parts.append(f"""
            SELECT rb_build_agg(rbi.bitmap_id) AS bitmap
            FROM {SEARCH_SCHEMA}.relation r
            JOIN {SEARCH_SCHEMA}.relation_bitmap_id rbi ON rbi.relation_id = r.relation_id
            WHERE r.subject_entity_id = ANY({push(entity_pks)}::uuid[])
               OR r.object_entity_id = ANY(%s::uuid[])
        """)
        params.append(entity_pks)

    if scope_parts:
        ctes.append(f"""
            scope_base AS MATERIALIZED (
                SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
                FROM ({' UNION ALL '.join(scope_parts)}) scope_parts
            )
        """)
    else:
        ctes.append(f"""
            scope_base AS MATERIALIZED (
                SELECT rb_or_agg(relation_bitmap) AS bitmap
                FROM {SEARCH_SCHEMA}.facet_relation_bitmap
                WHERE facet_name = 'predicate'
            )
        """)

    if predicates:
        ctes.append(f"""
            predicate_filter_bitmap AS MATERIALIZED (
                SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
                FROM {SEARCH_SCHEMA}.facet_relation_bitmap
                WHERE facet_name = 'predicate' AND facet_value = ANY({push(predicates)}::text[])
            )
        """)
    if participant_types:
        ctes.append(f"""
            participant_type_filter_bitmap AS MATERIALIZED (
                SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
                FROM {SEARCH_SCHEMA}.facet_relation_bitmap
                WHERE facet_name = 'participant_type' AND facet_value = ANY({push(participant_types)}::text[])
            )
        """)
    if sources:
        ctes.append(f"""
            source_filter_bitmap AS MATERIALIZED (
                SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
                FROM {SEARCH_SCHEMA}.facet_relation_bitmap
                WHERE facet_name = 'source' AND facet_value = ANY({push(sources)}::text[])
            )
        """)
    if taxonomy_ids:
        ctes.append(f"""
            taxonomy_filter_bitmap AS MATERIALIZED (
                SELECT COALESCE(rb_or_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
                FROM {SEARCH_SCHEMA}.facet_relation_bitmap
                WHERE facet_name = 'taxonomy_id' AND facet_value = ANY({push(taxonomy_ids)}::text[])
            )
        """)

    joins = ["CROSS JOIN scope_base"]
    if predicates:
        joins.append("CROSS JOIN predicate_filter_bitmap")
    if participant_types:
        joins.append("CROSS JOIN participant_type_filter_bitmap")
    if sources:
        joins.append("CROSS JOIN source_filter_bitmap")
    if taxonomy_ids:
        joins.append("CROSS JOIN taxonomy_filter_bitmap")
    joins_sql = "\n".join(joins)

    predicate_scope = _chain_bitmaps(["scope_base.bitmap", *(["participant_type_filter_bitmap.bitmap"] if participant_types else []), *(["source_filter_bitmap.bitmap"] if sources else []), *(["taxonomy_filter_bitmap.bitmap"] if taxonomy_ids else [])])
    participant_scope = _chain_bitmaps(["scope_base.bitmap", *(["predicate_filter_bitmap.bitmap"] if predicates else []), *(["source_filter_bitmap.bitmap"] if sources else []), *(["taxonomy_filter_bitmap.bitmap"] if taxonomy_ids else [])])
    source_scope = _chain_bitmaps(["scope_base.bitmap", *(["predicate_filter_bitmap.bitmap"] if predicates else []), *(["participant_type_filter_bitmap.bitmap"] if participant_types else []), *(["taxonomy_filter_bitmap.bitmap"] if taxonomy_ids else [])])
    taxonomy_scope = _chain_bitmaps(["scope_base.bitmap", *(["predicate_filter_bitmap.bitmap"] if predicates else []), *(["participant_type_filter_bitmap.bitmap"] if participant_types else []), *(["source_filter_bitmap.bitmap"] if sources else [])])

    sql = f"""
        WITH {', '.join(ctes)}
        SELECT 'predicate' AS facet_name, f.facet_value, f.facet_category,
               rb_cardinality(rb_and(f.relation_bitmap, {predicate_scope})) AS scoped_count
        FROM {SEARCH_SCHEMA}.facet_relation_bitmap f
        {joins_sql}
        WHERE f.facet_name = 'predicate'
          AND rb_cardinality(rb_and(f.relation_bitmap, {predicate_scope})) > 0
        UNION ALL
        SELECT 'participant_type' AS facet_name, f.facet_value, f.facet_category,
               rb_cardinality(rb_and(f.relation_bitmap, {participant_scope})) AS scoped_count
        FROM {SEARCH_SCHEMA}.facet_relation_bitmap f
        {joins_sql}
        WHERE f.facet_name = 'participant_type'
          AND rb_cardinality(rb_and(f.relation_bitmap, {participant_scope})) > 0
        UNION ALL
        SELECT 'source' AS facet_name, f.facet_value, f.facet_category,
               rb_cardinality(rb_and(f.relation_bitmap, {source_scope})) AS scoped_count
        FROM {SEARCH_SCHEMA}.facet_relation_bitmap f
        {joins_sql}
        WHERE f.facet_name = 'source'
          AND rb_cardinality(rb_and(f.relation_bitmap, {source_scope})) > 0
        UNION ALL
        SELECT 'taxonomy_id' AS facet_name, f.facet_value, f.facet_category,
               rb_cardinality(rb_and(f.relation_bitmap, {taxonomy_scope})) AS scoped_count
        FROM {SEARCH_SCHEMA}.facet_relation_bitmap f
        {joins_sql}
        WHERE f.facet_name = 'taxonomy_id'
          AND rb_cardinality(rb_and(f.relation_bitmap, {taxonomy_scope})) > 0
        ORDER BY facet_name, scoped_count DESC
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [{"facetName": r["facet_name"], "facetValue": r["facet_value"], "facetCategory": r["facet_category"], "scopedCount": int(r["scoped_count"] or 0)} for r in rows]


def search_ontology_terms(payload: dict[str, Any]) -> list[dict[str, Any]]:
    filters = payload.get("filters") if isinstance(payload.get("filters"), dict) else {}
    entity_pks = _ids(payload.get("entityPks") or payload.get("entity_pks") or filters.get("entityPks") or filters.get("entity_pks"))
    term_ids = _strings(payload.get("termIds") or payload.get("term_ids") or payload.get("annotationTermIds") or payload.get("annotation_terms") or filters.get("termIds") or filters.get("term_ids") or filters.get("annotationTermIds") or filters.get("annotation_terms"))
    ontology_ids = _strings(payload.get("ontologyIds") or payload.get("ontology_ids") or filters.get("ontologyIds") or filters.get("ontology_ids"))
    sources = resolve_resource_filters(_strings(payload.get("sources") or filters.get("sources")))
    query = str(payload.get("query") or payload.get("q") or "").strip()
    limit = max(1, min(int(payload.get("limit") or 24), 100))
    offset = max(0, int(payload.get("offset") or 0))
    relation_term_bitmap_table = _relation_term_bitmap_table()

    params: list[Any] = []
    where = ["TRUE"]
    if entity_pks:
        params.append(entity_pks)
        where.append(f"""ot.term_entity_id IN (
            SELECT r.object_entity_id
            FROM {SEARCH_SCHEMA}.relation r
            JOIN {SEARCH_SCHEMA}.vocab_relation_category rc
              ON rc.relation_category_id = r.relation_category_id
            WHERE rc.name = 'association'
              AND r.subject_entity_id = ANY(%s::uuid[])
        )""")
    if term_ids:
        params.append(term_ids)
        where.append("ot.term_id = ANY(%s::text[])")
    if ontology_ids:
        params.append(ontology_ids)
        where.append("ot.ontology_id = ANY(%s::text[])")
    if sources:
        params.append(sources)
        where.append(f"""(
            EXISTS (
                SELECT 1
                FROM {SEARCH_SCHEMA}.annotation_term_entity_bitmap term_bitmap
                JOIN {SEARCH_SCHEMA}.facet_entity_bitmap source_bitmap
                  ON source_bitmap.facet_name = 'source'
                 AND source_bitmap.facet_value = ANY(%s::text[])
                WHERE term_bitmap.term_entity_id = ot.term_entity_id
                  AND rb_cardinality(rb_and(term_bitmap.entity_bitmap, source_bitmap.entity_bitmap)) > 0
            )
            OR EXISTS (
                SELECT 1
                FROM {SEARCH_SCHEMA}.{relation_term_bitmap_table} term_bitmap
                JOIN {SEARCH_SCHEMA}.facet_relation_bitmap source_bitmap
                  ON source_bitmap.facet_name = 'source'
                 AND source_bitmap.facet_value = ANY(%s::text[])
                WHERE term_bitmap.term_entity_id = ot.term_entity_id
                  AND rb_cardinality(rb_and(term_bitmap.relation_bitmap, source_bitmap.relation_bitmap)) > 0
            )
        )""")
        params.append(sources)
    if query:
        params.extend([query, f"%{query.lower()}%", f"%{query.lower()}%", f"%{query.lower()}%"])
        where.append("(ot.term_id = %s OR lower(ot.label) LIKE %s OR lower(ot.definition) LIKE %s OR lower(ot.synonyms_text) LIKE %s)")

    params.extend([limit, offset])
    sql = f"""
        SELECT ot.term_id, ot.ontology_prefix, ot.ontology_id, ot.label, ot.definition,
               ot.synonyms, ot.sources,
               COALESCE(ot.child_count, 0) AS child_count,
               COALESCE(ae.global_count, 0) AS annotated_entity_count,
               COALESCE(ar.global_count, 0) AS annotated_relation_count,
               COALESCE(ae.global_count, 0) + COALESCE(ar.global_count, 0) AS annotated_item_count
        FROM {SEARCH_SCHEMA}.entity_ontology_term ot
        LEFT JOIN {SEARCH_SCHEMA}.annotation_term_entity_bitmap ae ON ae.term_entity_id = ot.term_entity_id
        LEFT JOIN {SEARCH_SCHEMA}.{relation_term_bitmap_table} ar ON ar.term_entity_id = ot.term_entity_id
        WHERE {' AND '.join(where)}
        ORDER BY annotated_item_count DESC, child_count DESC, ot.term_id
        LIMIT %s OFFSET %s
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [
        {
            "termId": r["term_id"],
            "ontologyPrefix": r["ontology_prefix"],
            "ontologyId": r["ontology_id"],
            "label": r["label"],
            "definition": r["definition"],
            "synonyms": r["synonyms"] or [],
            "sources": r["sources"] or [],
            "annotatedEntityCount": int(r["annotated_entity_count"] or 0),
            "annotatedRelationCount": int(r["annotated_relation_count"] or 0),
            "annotatedItemCount": int(r["annotated_item_count"] or 0),
        }
        for r in rows
    ]
