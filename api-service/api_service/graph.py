"""Postgres-backed graph retrieval endpoints for OmniPath."""

from __future__ import annotations

import os
from typing import Any

SEARCH_SCHEMA = os.getenv("OMNIPATH_PG_SCHEMA", "public")
CV_TERM_ENTITY_TYPE = "Cv Term:OM:0012"


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


def _limit(value: Any, default: int = 50, maximum: int = 500) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(1, min(parsed, maximum))


def _offset(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = 0
    return max(0, parsed)


def _entity_sources_sql(alias: str = "e") -> str:
    return f"""ARRAY(
        SELECT DISTINCT source_value
        FROM (
          SELECT ee.source AS source_value
          FROM {SEARCH_SCHEMA}.entity_evidence_resolution eer
          JOIN {SEARCH_SCHEMA}.entity_evidence ee ON ee.entity_evidence_id = eer.entity_evidence_id
          WHERE eer.entity_id = {alias}.entity_id
          UNION
          SELECT re.source AS source_value
          FROM {SEARCH_SCHEMA}.relation_evidence re
          WHERE re.subject_entity_id = {alias}.entity_id
             OR re.object_entity_id = {alias}.entity_id
        ) entity_sources
        WHERE source_value IS NOT NULL AND source_value <> ''
        ORDER BY source_value
      )"""


def _entity_type_sql(alias: str = "e") -> str:
    return f"(SELECT et.name FROM {SEARCH_SCHEMA}.entity_type et WHERE et.entity_type_id = {alias}.entity_type_id)"


def _canonical_type_sql(alias: str = "e") -> str:
    return f"(SELECT it.name FROM {SEARCH_SCHEMA}.identifier_type it WHERE it.identifier_type_id = {alias}.canonical_identifier_type_id)"


def _entity_identifiers_json_sql(alias: str = "e") -> str:
    return f"""CASE
        WHEN jsonb_typeof({alias}.identifiers) = 'array' THEN {alias}.identifiers
        WHEN jsonb_typeof({alias}.identifiers) = 'object'
          AND jsonb_typeof({alias}.identifiers -> 'evidence_identifiers') = 'array'
          THEN {alias}.identifiers -> 'evidence_identifiers'
        ELSE '[]'::jsonb
      END"""


def _entity_select(alias: str = "e") -> str:
    return f"""{alias}.entity_id,
      {alias}.canonical_identifier AS id,
      {_canonical_type_sql(alias)} AS id_type,
      {_entity_type_sql(alias)} AS entity_type,
      {alias}.taxonomy_id,
      {_entity_sources_sql(alias)} AS sources,
      COALESCE(rc.relation_count, 0)::bigint AS relation_count"""


def _entity_to_api(row: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    return {
        "entityPk": int(row[f"{prefix}entity_id"]),
        "canonicalIdentifier": row[f"{prefix}id"],
        "canonicalIdentifierType": row[f"{prefix}id_type"],
        "entityType": row[f"{prefix}entity_type"],
        "taxonomyId": row[f"{prefix}taxonomy_id"],
        "sources": row.get(f"{prefix}sources") or [],
        "relationCount": int(row.get(f"{prefix}relation_count") or 0),
    }


def _identifiers_for_entity_pks(entity_pks: list[int]) -> dict[int, list[dict[str, Any]]]:
    if not entity_pks:
        return {}
    sql = f"""
        SELECT DISTINCT
          e.entity_id,
          NULL::bigint AS identifier_id,
          item.identifier_type,
          item.identifier
        FROM {SEARCH_SCHEMA}.entity e
        CROSS JOIN LATERAL jsonb_to_recordset({_entity_identifiers_json_sql("e")}) AS item(identifier text, identifier_type text)
        WHERE e.entity_id = ANY(%s::bigint[])
          AND COALESCE(item.identifier, '') <> ''
        UNION
        SELECT DISTINCT
          terms.term_entity_id AS entity_id,
          NULL::bigint AS identifier_id,
          'Name:OM:0200' AS identifier_type,
          terms.label AS identifier
        FROM {SEARCH_SCHEMA}.ontology_terms terms
        WHERE terms.term_entity_id = ANY(%s::bigint[])
          AND terms.label IS NOT NULL
          AND terms.label <> ''
        ORDER BY entity_id, identifier_type, identifier
    """
    with _connect() as conn:
        rows = conn.execute(sql, (entity_pks, entity_pks)).fetchall()

    result: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        entity_pk = int(row["entity_id"])
        item = {
            "entityPk": entity_pk,
            "identifier": row["identifier"],
            "identifierType": row["identifier_type"],
        }
        if row["identifier_id"] is not None:
            item["id"] = int(row["identifier_id"])
        result.setdefault(entity_pk, []).append(item)
    return result


def _hydrate_entities(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    entities = [_entity_to_api(row) for row in rows]
    identifiers = _identifiers_for_entity_pks([entity["entityPk"] for entity in entities])
    for entity in entities:
        entity["identifiers"] = identifiers.get(entity["entityPk"], [])
    return entities


def _entity_filter_sql(filters: dict[str, Any], params: list[Any], alias: str = "e") -> list[str]:
    def push(value: Any) -> str:
        params.append(value)
        return "%s"

    where: list[str] = []
    entity_pks = _ints(filters.get("entityPks") or filters.get("entity_pks"))
    annotation_terms = _strings(filters.get("annotationTermIds") or filters.get("annotation_term_ids") or filters.get("ontology_terms"))
    entity_types = _strings(filters.get("entityTypes") or filters.get("entity_types"))
    sources = _strings(filters.get("sources"))
    taxonomy_ids = _strings(filters.get("ncbi_tax_id") or filters.get("taxonomy_ids") or filters.get("taxonomyIds"))

    if entity_pks:
        where.append(f"{alias}.entity_id = ANY({push(entity_pks)}::bigint[])")
    if annotation_terms:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.relation assoc
          JOIN {SEARCH_SCHEMA}.ontology_terms terms ON terms.term_entity_id = assoc.object_entity_id
          WHERE assoc.relation_category = 'association'
            AND assoc.subject_entity_id = {alias}.entity_id
            AND terms.term_id = ANY({push(annotation_terms)}::text[])
        )""")
    if entity_types:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.facet_entity_bitmap f
          WHERE f.facet_name = 'entity_type'
            AND f.facet_value = ANY({push(entity_types)}::text[])
            AND rb_contains(f.entity_bitmap, {alias}.entity_id::integer)
        )""")
    if taxonomy_ids:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.facet_entity_bitmap f
          WHERE f.facet_name = 'taxonomy_id'
            AND f.facet_value = ANY({push(taxonomy_ids)}::text[])
            AND rb_contains(f.entity_bitmap, {alias}.entity_id::integer)
        )""")
    if sources:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.facet_entity_bitmap f
          WHERE f.facet_name = 'source'
            AND f.facet_value = ANY({push(sources)}::text[])
            AND rb_contains(f.entity_bitmap, {alias}.entity_id::integer)
        )""")

    return where


def resolve_entities(payload: dict[str, Any]) -> dict[str, Any]:
    identifiers = _strings(payload.get("identifiers"))
    filters = payload.get("filters") if isinstance(payload.get("filters"), dict) else {}
    limit = _limit(payload.get("limit"), default=20, maximum=100)
    preferred_taxonomy_ids = _strings(payload.get("preferredTaxonomyIds") or payload.get("preferred_taxonomy_ids"))
    if not identifiers:
        return {"matches": [], "entities": []}

    entity_params: list[Any] = []
    identifier_params: list[Any] = []
    base_where = [f"{_entity_type_sql('e')} IS DISTINCT FROM '{CV_TERM_ENTITY_TYPE}'"]
    entity_where = [*base_where, *_entity_filter_sql(filters, entity_params, "e")]
    identifier_where = [*base_where, *_entity_filter_sql(filters, identifier_params, "e")]
    entity_where_sql = f"WHERE {' AND '.join(entity_where)}"
    identifier_where_sql = f"WHERE {' AND '.join(identifier_where)}"
    sql = f"""
        WITH requested AS (
          SELECT *
          FROM unnest(%s::text[]) AS request(query_identifier)
        ),
        exact_matches AS (
          SELECT
            e.entity_id,
            e.canonical_identifier AS id,
            {_canonical_type_sql('e')} AS id_type,
            {_entity_type_sql('e')} AS entity_type,
            e.taxonomy_id,
            requested.query_identifier,
            e.canonical_identifier AS match_identifier,
            {_canonical_type_sql('e')} AS match_identifier_type,
            'canonical' AS match_kind,
            1000
            + CASE WHEN e.taxonomy_id = ANY(%s::text[]) THEN 50 ELSE 0 END
            + CASE WHEN {_entity_type_sql('e')} = 'Protein:MI:0326' THEN 10 ELSE 0 END
            + LEAST(COALESCE(rc.relation_count, 0), 1000)::int / 100 AS score,
            COALESCE(rc.relation_count, 0)::bigint AS relation_count,
            {_entity_sources_sql("e")} AS sources
          FROM requested
          JOIN {SEARCH_SCHEMA}.entity e ON e.canonical_identifier = requested.query_identifier
          LEFT JOIN {SEARCH_SCHEMA}.entity_relation_counts rc ON rc.entity_id = e.entity_id
          {entity_where_sql}
          UNION ALL
          SELECT
            e.entity_id,
            e.canonical_identifier AS id,
            {_canonical_type_sql('e')} AS id_type,
            {_entity_type_sql('e')} AS entity_type,
            e.taxonomy_id,
            requested.query_identifier,
            item.identifier AS match_identifier,
            item.identifier_type AS match_identifier_type,
            'identifier' AS match_kind,
            CASE
              WHEN item.identifier_type ILIKE 'Gene Name Primary:%%' THEN 950
              WHEN item.identifier_type ILIKE 'Gene Name:%%' THEN 900
              ELSE 800
            END
            + CASE WHEN e.taxonomy_id = ANY(%s::text[]) THEN 50 ELSE 0 END
            + CASE WHEN {_entity_type_sql('e')} = 'Protein:MI:0326' THEN 10 ELSE 0 END
            + LEAST(COALESCE(rc.relation_count, 0), 1000)::int / 100 AS score,
            COALESCE(rc.relation_count, 0)::bigint AS relation_count,
            {_entity_sources_sql("e")} AS sources
          FROM requested
          JOIN {SEARCH_SCHEMA}.entity e ON TRUE
          JOIN LATERAL jsonb_to_recordset({_entity_identifiers_json_sql("e")}) AS item(identifier text, identifier_type text)
            ON item.identifier = requested.query_identifier
          LEFT JOIN {SEARCH_SCHEMA}.entity_relation_counts rc ON rc.entity_id = e.entity_id
          {identifier_where_sql}
        )
        SELECT DISTINCT ON (query_identifier, entity_id)
          entity_id,
          id,
          id_type,
          entity_type,
          taxonomy_id,
          query_identifier,
          match_identifier,
          match_identifier_type,
          match_kind,
          score,
          relation_count,
          sources
        FROM exact_matches
        ORDER BY query_identifier, entity_id, score DESC, match_kind
    """
    params = [
        identifiers,
        preferred_taxonomy_ids,
        *entity_params,
        preferred_taxonomy_ids,
        *identifier_params,
    ]
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()

    rows_by_query: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        rows_by_query.setdefault(str(row["query_identifier"]), []).append(row)

    entities_by_pk: dict[int, dict[str, Any]] = {}
    matches: list[dict[str, Any]] = []
    for identifier in identifiers:
        candidates = sorted(
            rows_by_query.get(identifier, []),
            key=lambda row: (-int(row["score"] or 0), str(row["taxonomy_id"] or ""), int(row["entity_id"])),
        )[:limit]
        hydrated = _hydrate_entities(candidates)
        candidate_items = []
        for row, entity in zip(candidates, hydrated):
            entities_by_pk[entity["entityPk"]] = entity
            candidate_items.append({
                **entity,
                "matchIdentifier": row["match_identifier"],
                "matchIdentifierType": row["match_identifier_type"],
                "matchKind": row["match_kind"],
                "score": int(row["score"] or 0),
            })
        best_entity_pk = candidate_items[0]["entityPk"] if len(candidate_items) == 1 else None
        matches.append({
            "identifier": identifier,
            "entityPks": [candidate["entityPk"] for candidate in candidate_items],
            "candidates": candidate_items,
            "ambiguous": len(candidate_items) > 1,
            "bestEntityPk": best_entity_pk,
        })

    return {"matches": matches, "entities": list(entities_by_pk.values())}


def search_entities(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or payload.get("q") or "").strip()
    filters = payload.get("filters") if isinstance(payload.get("filters"), dict) else payload
    limit = _limit(payload.get("limit"), default=50)
    offset = _offset(payload.get("offset"))

    include_cv_terms = bool(filters.get("includeCvTerms") or filters.get("include_cv_terms"))

    params: list[Any] = []

    def push(value: Any) -> str:
        params.append(value)
        return "%s"

    where = []
    if not include_cv_terms:
        where.append(f"{_entity_type_sql('e')} IS DISTINCT FROM '{CV_TERM_ENTITY_TYPE}'")
    if query:
        where.append(f"""(
          (e.canonical_identifier = {push(query)})
          OR EXISTS (
            SELECT 1
            FROM jsonb_to_recordset({_entity_identifiers_json_sql("e")}) AS item(identifier text)
            WHERE item.identifier = %s
          )
        )""")
        params.append(query)
    where.extend(_entity_filter_sql(filters, params, "e"))

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    params.extend([limit, offset])
    sql = f"""
        SELECT {_entity_select("e")}
        FROM {SEARCH_SCHEMA}.entity e
        LEFT JOIN {SEARCH_SCHEMA}.entity_relation_counts rc ON rc.entity_id = e.entity_id
        {where_sql}
        ORDER BY relation_count DESC, e.entity_id ASC
        LIMIT %s OFFSET %s
    """
    count_sql = f"SELECT count(*)::bigint AS total FROM {SEARCH_SCHEMA}.entity e {where_sql}"
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        total = conn.execute(count_sql, params[:-2]).fetchone()["total"]

    return {"entities": _hydrate_entities(rows), "total": int(total or 0), "limit": limit, "offset": offset}


def entities_by_pks(entity_pks: list[Any]) -> list[dict[str, Any]]:
    pks = _ints(entity_pks)
    if not pks:
        return []
    sql = f"""
        SELECT {_entity_select("e")}
        FROM {SEARCH_SCHEMA}.entity e
        LEFT JOIN {SEARCH_SCHEMA}.entity_relation_counts rc ON rc.entity_id = e.entity_id
        WHERE e.entity_id = ANY(%s::bigint[])
        ORDER BY e.entity_id
    """
    with _connect() as conn:
        rows = conn.execute(sql, (pks,)).fetchall()
    return _hydrate_entities(rows)


def entities_for_terms(payload: dict[str, Any]) -> dict[str, Any]:
    term_ids = _strings(payload.get("termIds") or payload.get("term_ids") or payload.get("annotationTermIds"))
    if not term_ids:
        return {"entities": [], "total": 0, "limit": 0, "offset": 0}
    filters = dict(payload.get("filters") if isinstance(payload.get("filters"), dict) else {})
    filters["annotationTermIds"] = term_ids
    return search_entities({
        "filters": filters,
        "limit": payload.get("limit", 200),
        "offset": payload.get("offset", 0),
    })


def _relation_select(alias: str = "r") -> str:
    return f"""{alias}.relation_id,
      {alias}.subject_entity_id,
      {alias}.predicate,
      {alias}.object_entity_id,
      {alias}.relation_category,
      ARRAY(
        SELECT DISTINCT entity_type
        FROM (
          SELECT {_entity_type_sql('subject')} AS entity_type
          FROM {SEARCH_SCHEMA}.entity subject
          WHERE subject.entity_id = {alias}.subject_entity_id
          UNION
          SELECT {_entity_type_sql('object')} AS entity_type
          FROM {SEARCH_SCHEMA}.entity object
          WHERE object.entity_id = {alias}.object_entity_id
        ) participant_types
        WHERE entity_type IS NOT NULL
        ORDER BY entity_type
      ) AS participant_types,
      (
        SELECT COUNT(*)::bigint
        FROM {SEARCH_SCHEMA}.relation_evidence_relation rer
        WHERE rer.relation_id = {alias}.relation_id
      ) AS evidence_count,
      ARRAY(
        SELECT DISTINCT re.source
        FROM {SEARCH_SCHEMA}.relation_evidence_relation rer
        JOIN {SEARCH_SCHEMA}.relation_evidence re ON re.relation_evidence_id = rer.relation_evidence_id
        WHERE rer.relation_id = {alias}.relation_id
          AND re.source IS NOT NULL
          AND re.source <> ''
        ORDER BY re.source
      ) AS sources"""


def _relation_to_api(row: dict[str, Any], include_entities: bool) -> dict[str, Any]:
    relation = {
        "relationPk": int(row["relation_id"]),
        "subjectEntityPk": int(row["subject_entity_id"]),
        "predicate": row["predicate"],
        "objectEntityPk": int(row["object_entity_id"]),
        "relationCategory": row["relation_category"],
        "participantTypes": row["participant_types"] or [],
        "evidenceCount": int(row["evidence_count"] or 0),
        "sources": row["sources"] or [],
    }
    if include_entities:
        relation["subjectEntity"] = _entity_to_api(row, "subject_")
        relation["objectEntity"] = _entity_to_api(row, "object_")
    return relation


def _relation_where(filters: dict[str, Any], params: list[Any]) -> str:
    def push(value: Any) -> str:
        params.append(value)
        return "%s"

    where: list[str] = []
    relation_pks = _ints(filters.get("relationPks") or filters.get("relation_pks"))
    relation_categories = _strings(filters.get("relationCategories") or filters.get("relation_categories"))
    predicates = _strings(filters.get("predicates"))
    participant_types = _strings(filters.get("participantTypes") or filters.get("participant_types") or filters.get("interactionTypes") or filters.get("interaction_types"))
    subject_entity_pks = _ints(filters.get("subjectEntityPks") or filters.get("subject_entity_pks"))
    object_entity_pks = _ints(filters.get("objectEntityPks") or filters.get("object_entity_pks"))
    entity_pks = _ints(filters.get("entityPks") or filters.get("entity_pks"))
    sources = _strings(filters.get("sources"))
    taxonomy_ids = _strings(filters.get("ncbi_tax_id") or filters.get("taxonomy_ids") or filters.get("taxonomyIds"))
    annotation_terms = _strings(filters.get("annotationTerms") or filters.get("annotation_terms") or filters.get("ontology_terms"))
    require_both = bool(filters.get("requireBothParticipants") or filters.get("require_both_participants"))

    if relation_pks:
        where.append(f"r.relation_id = ANY({push(relation_pks)}::bigint[])")
    if relation_categories:
        where.append(f"r.relation_category = ANY({push(relation_categories)}::text[])")
    if predicates:
        where.append(f"r.predicate = ANY({push(predicates)}::text[])")
    if participant_types:
        where.append(f"""EXISTS (
          SELECT 1 FROM {SEARCH_SCHEMA}.entity endpoint
          WHERE {_entity_type_sql('endpoint')} = ANY({push(participant_types)}::text[])
            AND endpoint.entity_id IN (r.subject_entity_id, r.object_entity_id)
        )""")
    if subject_entity_pks:
        where.append(f"r.subject_entity_id = ANY({push(subject_entity_pks)}::bigint[])")
    if object_entity_pks:
        where.append(f"r.object_entity_id = ANY({push(object_entity_pks)}::bigint[])")
    if entity_pks:
        op = "AND" if require_both else "OR"
        where.append(f"(r.subject_entity_id = ANY({push(entity_pks)}::bigint[]) {op} r.object_entity_id = ANY(%s::bigint[]))")
        params.append(entity_pks)
    if sources:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.relation_evidence_relation rer
          JOIN {SEARCH_SCHEMA}.relation_evidence re ON re.relation_evidence_id = rer.relation_evidence_id
          WHERE rer.relation_id = r.relation_id
            AND re.source = ANY({push(sources)}::text[])
        )""")
    if taxonomy_ids:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.facet_relation_bitmap f
          WHERE f.facet_name = 'taxonomy_id'
            AND f.facet_value = ANY({push(taxonomy_ids)}::text[])
            AND rb_contains(f.relation_bitmap, r.relation_id::integer)
        )""")
    if annotation_terms:
        term_param = push(annotation_terms)
        where.append(f"""r.relation_id IN (
          WITH term_entities AS (
            SELECT terms.term_entity_id
            FROM {SEARCH_SCHEMA}.ontology_terms terms
            WHERE terms.term_id = ANY({term_param}::text[])
          ),
          annotated_entity_ids AS (
            SELECT DISTINCT association.subject_entity_id AS entity_id
            FROM {SEARCH_SCHEMA}.relation association
            JOIN term_entities term_entity ON term_entity.term_entity_id = association.object_entity_id
            WHERE association.relation_category = 'association'
          ),
          directly_annotated_relation_ids AS (
            SELECT DISTINCT ra.relation_id
            FROM {SEARCH_SCHEMA}.relation_annotation ra
            JOIN {SEARCH_SCHEMA}.annotation a ON a.annotation_key = ra.annotation_key
            JOIN term_entities term_entity
              ON term_entity.term_id IN (a.term, a.value)
          )
          SELECT relation_id FROM directly_annotated_relation_ids
          UNION
          SELECT subject_relation.relation_id
          FROM {SEARCH_SCHEMA}.relation subject_relation
          JOIN annotated_entity_ids annotated_entity ON annotated_entity.entity_id = subject_relation.subject_entity_id
          UNION
          SELECT object_relation.relation_id
          FROM {SEARCH_SCHEMA}.relation object_relation
          JOIN annotated_entity_ids annotated_entity ON annotated_entity.entity_id = object_relation.object_entity_id
        )""")

    return f"WHERE {' AND '.join(where)}" if where else ""


def search_relations(payload: dict[str, Any]) -> dict[str, Any]:
    filters = payload.get("filters") if isinstance(payload.get("filters"), dict) else payload
    limit = _limit(payload.get("limit"), default=50)
    offset = _offset(payload.get("offset"))
    include_entities = payload.get("includeEntities", True) is not False

    params: list[Any] = []
    where_sql = _relation_where(filters, params)
    page_params = [*params, limit, offset]
    entity_select = ""
    entity_joins = ""
    if include_entities:
        entity_select = f""",
          subject.entity_id AS subject_entity_id,
          subject.canonical_identifier AS subject_id,
          {_canonical_type_sql('subject')} AS subject_id_type,
          {_entity_type_sql('subject')} AS subject_entity_type,
          subject.taxonomy_id AS subject_taxonomy_id,
          ARRAY[]::text[] AS subject_sources,
          0::bigint AS subject_relation_count,
          object.entity_id AS object_entity_id,
          object.canonical_identifier AS object_id,
          {_canonical_type_sql('object')} AS object_id_type,
          {_entity_type_sql('object')} AS object_entity_type,
          object.taxonomy_id AS object_taxonomy_id,
          ARRAY[]::text[] AS object_sources,
          0::bigint AS object_relation_count"""
        entity_joins = f"""
          JOIN {SEARCH_SCHEMA}.entity subject ON subject.entity_id = r.subject_entity_id
          JOIN {SEARCH_SCHEMA}.entity object ON object.entity_id = r.object_entity_id"""

    sql = f"""
        SELECT {_relation_select("r")}
          {entity_select}
        FROM {SEARCH_SCHEMA}.relation r
        {entity_joins}
        {where_sql}
        ORDER BY r.relation_id
        LIMIT %s OFFSET %s
    """
    count_sql = f"SELECT count(*)::bigint AS total FROM {SEARCH_SCHEMA}.relation r {where_sql}"
    with _connect() as conn:
        rows = conn.execute(sql, page_params).fetchall()
        total = conn.execute(count_sql, params).fetchone()["total"]

    return {
        "relations": [_relation_to_api(row, include_entities) for row in rows],
        "total": int(total or 0),
        "limit": limit,
        "offset": offset,
    }


def get_relation(relation_id: int) -> dict[str, Any] | None:
    result = search_relations({"filters": {"relationPks": [relation_id]}, "limit": 1, "includeEntities": True})
    return result["relations"][0] if result["relations"] else None


def relation_evidence(relation_id: int) -> dict[str, Any]:
    sql = f"""
        SELECT
          re.source,
          re.relation_evidence_id,
          rer.relation_id,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object('term', a.term, 'value', a.value, 'unit', a.unit, 'scope', rea.scope) ORDER BY a.annotation_key)
            FROM {SEARCH_SCHEMA}.relation_evidence_annotation rea
            JOIN {SEARCH_SCHEMA}.annotation a ON a.annotation_key = rea.annotation_key
            WHERE rea.relation_evidence_id = re.relation_evidence_id AND rea.scope IN ('record', 'relation')
          ), '[]'::jsonb) AS record_attributes,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object('term', a.term, 'value', a.value, 'unit', a.unit, 'scope', eea.scope) ORDER BY a.annotation_key)
            FROM {SEARCH_SCHEMA}.entity_evidence_annotation eea
            JOIN {SEARCH_SCHEMA}.annotation a ON a.annotation_key = eea.annotation_key
            WHERE eea.entity_evidence_id = re.subject_entity_evidence_id
          ), '[]'::jsonb) AS subject_attributes,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object('term', a.term, 'value', a.value, 'unit', a.unit, 'scope', eea.scope) ORDER BY a.annotation_key)
            FROM {SEARCH_SCHEMA}.entity_evidence_annotation eea
            JOIN {SEARCH_SCHEMA}.annotation a ON a.annotation_key = eea.annotation_key
            WHERE eea.entity_evidence_id = re.object_entity_evidence_id
          ), '[]'::jsonb) AS object_attributes,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object('term', a.term, 'value', a.value, 'unit', a.unit, 'scope', rea.scope) ORDER BY a.annotation_key)
            FROM {SEARCH_SCHEMA}.relation_evidence_annotation rea
            JOIN {SEARCH_SCHEMA}.annotation a ON a.annotation_key = rea.annotation_key
            WHERE rea.relation_evidence_id = re.relation_evidence_id
              AND rea.scope NOT IN ('record', 'relation')
          ), '[]'::jsonb) AS evidence
        FROM {SEARCH_SCHEMA}.relation_evidence_relation rer
        JOIN {SEARCH_SCHEMA}.relation_evidence re ON re.relation_evidence_id = rer.relation_evidence_id
        WHERE rer.relation_id = %s
        ORDER BY re.source, re.relation_evidence_id
    """
    with _connect() as conn:
        rows = conn.execute(sql, (relation_id,)).fetchall()
    return {
        "relationPk": relation_id,
        "evidence": [
            {
                "source": row["source"],
                "relationEvidencePk": int(row["relation_evidence_id"]),
                "relationPk": int(row["relation_id"]),
                "recordAttributes": row["record_attributes"] or [],
                "subjectAttributes": row["subject_attributes"] or [],
                "objectAttributes": row["object_attributes"] or [],
                "evidence": row["evidence"] or [],
            }
            for row in rows
        ],
    }
