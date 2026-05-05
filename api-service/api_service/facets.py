"""DB-backed scoped facet helpers for graph data workflows."""

from __future__ import annotations

import os
from typing import Any

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


def scoped_entity_facet_counts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    entity_pks = _ints(payload.get("entityPks") or payload.get("entity_pks"))
    term_ids = _strings(payload.get("annotationTermIds") or payload.get("annotation_terms") or payload.get("ontology_terms"))
    entity_types = _strings(payload.get("entityTypes") or payload.get("entity_types"))
    sources = _strings(payload.get("sources"))
    query = str(payload.get("query") or "").strip()

    params: list[Any] = []

    def push(value: Any) -> str:
        params.append(value)
        return f"%s"

    ctes: list[str] = []
    scope_parts: list[str] = []
    if term_ids:
        scope_parts.append(f"""SELECT b.entity_bitmap AS bitmap
            FROM {SEARCH_SCHEMA}.entity e
            JOIN {SEARCH_SCHEMA}.annotation_term_entity_bitmap b ON b.term_entity_pk = e.entity_pk
            WHERE e.canonical_identifier = ANY({push(term_ids)}::text[])""")
    if entity_pks:
        scope_parts.append(f"SELECT rb_build({push(entity_pks)}::integer[]) AS bitmap")

    if scope_parts:
        ctes.append(f"""scope_base AS MATERIALIZED (
            SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
            FROM ({' UNION ALL '.join(scope_parts)}) scope_parts
        )""")
    else:
        ctes.append(f"""scope_base AS MATERIALIZED (
            SELECT rb_or_agg(entity_bitmap) AS bitmap
            FROM {SEARCH_SCHEMA}.facet_entity_bitmap
            WHERE facet_name = 'entity_type'
        )""")

    if query:
        ctes.append(f"""query_bitmap AS MATERIALIZED (
            SELECT rb_build_agg(entity_pk::integer) AS bitmap
            FROM {SEARCH_SCHEMA}.entity
            WHERE canonical_identifier = {push(query)}
               OR entity_pk IN (SELECT entity_pk FROM {SEARCH_SCHEMA}.entity_identifier WHERE identifier = %s)
        )""")
        params.append(query)

    if entity_types:
        ctes.append(f"""type_filter_bitmap AS MATERIALIZED (
            SELECT COALESCE(rb_and_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
            FROM {SEARCH_SCHEMA}.facet_entity_bitmap
            WHERE facet_name = 'entity_type' AND facet_value = ANY({push(entity_types)}::text[])
        )""")
    if sources:
        ctes.append(f"""source_filter_bitmap AS MATERIALIZED (
            SELECT COALESCE(rb_and_agg(entity_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
            FROM {SEARCH_SCHEMA}.facet_entity_bitmap
            WHERE facet_name = 'source' AND facet_value = ANY({push(sources)}::text[])
        )""")

    def scope_and(extra: str | None) -> str:
        parts = ["scope_base.bitmap"]
        if query:
            parts.append("query_bitmap.bitmap")
        if extra:
            parts.append(extra)
        return parts[0] if len(parts) == 1 else f"rb_and({', '.join(parts)})"

    joins = ["CROSS JOIN scope_base"]
    if query:
        joins.append("CROSS JOIN query_bitmap")
    if entity_types:
        joins.append("CROSS JOIN type_filter_bitmap")
    if sources:
        joins.append("CROSS JOIN source_filter_bitmap")
    joins_sql = "\n".join(joins)

    type_scope = scope_and("source_filter_bitmap.bitmap" if sources else None)
    source_scope = scope_and("type_filter_bitmap.bitmap" if entity_types else None)
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
        ORDER BY facet_name, scoped_count DESC
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [{"facetName": r["facet_name"], "facetValue": r["facet_value"], "facetCategory": r["facet_category"], "scopedCount": int(r["scoped_count"] or 0)} for r in rows]


def scoped_relation_facet_counts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    entity_pks = _ints(payload.get("entityPks") or payload.get("entity_pks"))
    term_ids = _strings(payload.get("annotationTermIds") or payload.get("annotation_terms") or payload.get("ontology_terms"))
    predicates = _strings(payload.get("predicates"))
    participant_types = _strings(payload.get("participantTypes") or payload.get("participant_types") or payload.get("interactionTypes") or payload.get("interaction_types"))
    sources = _strings(payload.get("sources"))

    params: list[Any] = []

    def push(value: Any) -> str:
        params.append(value)
        return "%s"

    ctes: list[str] = []
    scope_parts: list[str] = []
    if term_ids:
        scope_parts.append(f"""SELECT b.relation_bitmap AS bitmap
            FROM {SEARCH_SCHEMA}.entity e
            JOIN {SEARCH_SCHEMA}.annotation_term_relation_bitmap b ON b.term_entity_pk = e.entity_pk
            WHERE e.canonical_identifier = ANY({push(term_ids)}::text[])""")
    if entity_pks:
        scope_parts.append(f"""SELECT rb_build_agg(relation_pk::integer) AS bitmap
            FROM {SEARCH_SCHEMA}.entity_relation
            WHERE subject_entity_pk = ANY({push(entity_pks)}::bigint[])
               OR object_entity_pk = ANY(%s::bigint[])""")
        params.append(entity_pks)

    if scope_parts:
        ctes.append(f"""scope_base AS MATERIALIZED (
            SELECT COALESCE(rb_or_agg(bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
            FROM ({' UNION ALL '.join(scope_parts)}) scope_parts
        )""")
    else:
        ctes.append(f"""scope_base AS MATERIALIZED (
            SELECT rb_or_agg(relation_bitmap) AS bitmap
            FROM {SEARCH_SCHEMA}.facet_relation_bitmap
            WHERE facet_name = 'predicate'
        )""")

    if predicates:
        ctes.append(f"""predicate_filter_bitmap AS MATERIALIZED (
            SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
            FROM {SEARCH_SCHEMA}.facet_relation_bitmap
            WHERE facet_name = 'predicate' AND facet_value = ANY({push(predicates)}::text[])
        )""")
    if participant_types:
        ctes.append(f"""participant_type_filter_bitmap AS MATERIALIZED (
            SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
            FROM {SEARCH_SCHEMA}.facet_relation_bitmap
            WHERE facet_name = 'participant_type' AND facet_value = ANY({push(participant_types)}::text[])
        )""")
    if sources:
        ctes.append(f"""source_filter_bitmap AS MATERIALIZED (
            SELECT COALESCE(rb_and_agg(relation_bitmap), rb_build(ARRAY[]::integer[])) AS bitmap
            FROM {SEARCH_SCHEMA}.facet_relation_bitmap
            WHERE facet_name = 'source' AND facet_value = ANY({push(sources)}::text[])
        )""")

    joins = ["CROSS JOIN scope_base"]
    if predicates:
        joins.append("CROSS JOIN predicate_filter_bitmap")
    if participant_types:
        joins.append("CROSS JOIN participant_type_filter_bitmap")
    if sources:
        joins.append("CROSS JOIN source_filter_bitmap")
    joins_sql = "\n".join(joins)

    def chain(parts: list[str]) -> str:
        expr = parts[0]
        for part in parts[1:]:
            expr = f"rb_and({expr}, {part})"
        return expr

    predicate_scope = chain(["scope_base.bitmap", *( ["participant_type_filter_bitmap.bitmap"] if participant_types else []), *( ["source_filter_bitmap.bitmap"] if sources else [])])
    participant_scope = chain(["scope_base.bitmap", *( ["predicate_filter_bitmap.bitmap"] if predicates else []), *( ["source_filter_bitmap.bitmap"] if sources else [])])
    source_scope = chain(["scope_base.bitmap", *( ["predicate_filter_bitmap.bitmap"] if predicates else []), *( ["participant_type_filter_bitmap.bitmap"] if participant_types else [])])

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
        ORDER BY facet_name, scoped_count DESC
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [{"facetName": r["facet_name"], "facetValue": r["facet_value"], "facetCategory": r["facet_category"], "scopedCount": int(r["scoped_count"] or 0)} for r in rows]


def search_ontology_terms(payload: dict[str, Any]) -> list[dict[str, Any]]:
    entity_pks = _ints(payload.get("entityPks") or payload.get("entity_pks"))
    term_ids = _strings(payload.get("termIds") or payload.get("term_ids") or payload.get("annotationTermIds") or payload.get("annotation_terms"))
    ontology_ids = _strings(payload.get("ontologyIds") or payload.get("ontology_ids"))
    query = str(payload.get("query") or payload.get("q") or "").strip()
    limit = max(1, min(int(payload.get("limit") or 24), 100))
    offset = max(0, int(payload.get("offset") or 0))

    params: list[Any] = []
    where = ["TRUE"]
    if entity_pks:
        params.append(entity_pks)
        where.append(f"ot.term_entity_pk IN (SELECT er.object_entity_pk FROM {SEARCH_SCHEMA}.entity_relation er WHERE er.relation_category = 'annotation' AND er.subject_entity_pk = ANY(%s::bigint[]))")
    if term_ids:
        params.append(term_ids)
        where.append("ot.term_id = ANY(%s::text[])")
    if ontology_ids:
        params.append(ontology_ids)
        where.append("ot.ontology_id = ANY(%s::text[])")
    if query:
        params.extend([query, f"%{query.lower()}%", f"%{query.lower()}%", f"%{query.lower()}%"])
        where.append("(ot.term_id = %s OR lower(ot.label) LIKE %s OR lower(ot.definition) LIKE %s OR lower(ot.synonyms_text) LIKE %s)")

    params.extend([limit, offset])
    sql = f"""
        SELECT ot.term_id, ot.ontology_prefix, ot.ontology_id, ot.label, ot.definition,
               ot.synonyms, ot.sources,
               COALESCE(ae.entity_count, 0) AS annotated_entity_count,
               COALESCE(ar.relation_count, 0) AS annotated_relation_count,
               COALESCE(ae.entity_count, 0) + COALESCE(ar.relation_count, 0) AS annotated_item_count
        FROM {SEARCH_SCHEMA}.ontology_terms ot
        LEFT JOIN LATERAL (
            SELECT count(*) AS entity_count
            FROM {SEARCH_SCHEMA}.entity_relation er
            WHERE er.relation_category = 'annotation' AND er.object_entity_pk = ot.term_entity_pk
        ) ae ON TRUE
        LEFT JOIN LATERAL (
            SELECT count(DISTINCT relation_pk) AS relation_count
            FROM {SEARCH_SCHEMA}.relation_annotation_term rat
            WHERE rat.term_entity_pk = ot.term_entity_pk
        ) ar ON TRUE
        WHERE {' AND '.join(where)}
        ORDER BY annotated_item_count DESC, ot.term_id
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
