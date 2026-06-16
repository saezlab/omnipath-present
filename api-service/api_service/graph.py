"""Postgres-backed graph retrieval endpoints for OmniPath."""

from __future__ import annotations

import os
from typing import Any
from .resource_catalog import resolve_resource_filters

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
        SELECT DISTINCT source_name
        FROM (
          SELECT ds.name AS source_name
          FROM {SEARCH_SCHEMA}.entity_evidence_resolution eer
          JOIN {SEARCH_SCHEMA}.entity_evidence ee ON ee.entity_evidence_id = eer.entity_evidence_id
          JOIN {SEARCH_SCHEMA}.data_source ds ON ds.source_id = ee.source_id
          WHERE eer.entity_id = {alias}.entity_id
          UNION
          SELECT ds.name AS source_name
          FROM {SEARCH_SCHEMA}.relation_evidence_relation rer
          JOIN {SEARCH_SCHEMA}.relation_evidence re
            ON re.source_id = rer.source_id
           AND re.relation_evidence_id = rer.relation_evidence_id
          JOIN {SEARCH_SCHEMA}.data_source ds ON ds.source_id = re.source_id
          WHERE re.subject_entity_id = {alias}.entity_id
             OR re.object_entity_id = {alias}.entity_id
        ) entity_sources
        WHERE source_name IS NOT NULL AND source_name <> ''
        ORDER BY source_name
      )"""


def _entity_type_sql(alias: str = "e") -> str:
    return f"(SELECT et.name FROM {SEARCH_SCHEMA}.vocab_entity_type et WHERE et.entity_type_id = {alias}.entity_type_id)"


def _canonical_type_sql(alias: str = "e") -> str:
    return f"(SELECT it.name FROM {SEARCH_SCHEMA}.vocab_identifier_type it WHERE it.identifier_type_id = {alias}.canonical_identifier_type_id)"


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
        "entityPk": str(row[f"{prefix}entity_id"]),
        "canonicalIdentifier": row[f"{prefix}id"],
        "canonicalIdentifierType": row[f"{prefix}id_type"],
        "entityType": row[f"{prefix}entity_type"],
        "taxonomyId": row[f"{prefix}taxonomy_id"],
        "sources": row.get(f"{prefix}sources") or [],
        "relationCount": int(row.get(f"{prefix}relation_count") or 0),
    }


def _identifiers_for_entity_pks(entity_pks: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not entity_pks:
        return {}
    sql = f"""
        SELECT DISTINCT
          eil.entity_id,
          i.identifier_id,
          it.name AS identifier_type,
          i.value AS identifier
        FROM {SEARCH_SCHEMA}.entity_identifier_lookup eil
        JOIN {SEARCH_SCHEMA}.identifier_evidence i
          ON i.identifier_id = eil.identifier_id
        JOIN {SEARCH_SCHEMA}.vocab_identifier_type it
          ON it.identifier_type_id = i.identifier_type_id
        WHERE eil.entity_id = ANY(%s::uuid[])
          AND i.value <> ''
        UNION
        SELECT DISTINCT
          terms.term_entity_id AS entity_id,
          NULL::uuid AS identifier_id,
          'Name:OM:0200' AS identifier_type,
          terms.label AS identifier
        FROM {SEARCH_SCHEMA}.entity_ontology_term terms
        WHERE terms.term_entity_id = ANY(%s::uuid[])
          AND terms.label IS NOT NULL
          AND terms.label <> ''
        ORDER BY entity_id, identifier_type, identifier
    """
    with _connect() as conn:
        rows = conn.execute(sql, (entity_pks, entity_pks)).fetchall()

    result: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        entity_pk = str(row["entity_id"])
        item = {
            "entityPk": entity_pk,
            "identifier": row["identifier"],
            "identifierType": row["identifier_type"],
        }
        if row["identifier_id"] is not None:
            item["id"] = str(row["identifier_id"])
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
    entity_pks = _ids(filters.get("entityPks") or filters.get("entity_pks"))
    annotation_terms = _strings(filters.get("annotationTermIds") or filters.get("annotation_term_ids") or filters.get("ontology_terms"))
    entity_types = _strings(filters.get("entityTypes") or filters.get("entity_types"))
    sources = resolve_resource_filters(_strings(filters.get("sources")))
    taxonomy_ids = _strings(filters.get("ncbi_tax_id") or filters.get("taxonomy_ids") or filters.get("taxonomyIds"))

    if entity_pks:
        where.append(f"{alias}.entity_id = ANY({push(entity_pks)}::uuid[])")
    if annotation_terms:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.relation assoc
          JOIN {SEARCH_SCHEMA}.vocab_relation_category category
            ON category.relation_category_id = assoc.relation_category_id
          JOIN {SEARCH_SCHEMA}.entity_ontology_term terms ON terms.term_entity_id = assoc.object_entity_id
          WHERE category.name = 'association'
            AND assoc.subject_entity_id = {alias}.entity_id
            AND terms.term_id = ANY({push(annotation_terms)}::text[])
        )""")
    if entity_types:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.facet_entity_bitmap f
          JOIN {SEARCH_SCHEMA}.entity_bitmap_id ebi ON ebi.entity_id = {alias}.entity_id
          WHERE f.facet_name = 'entity_type'
            AND f.facet_value = ANY({push(entity_types)}::text[])
            AND rb_contains(f.entity_bitmap, ebi.bitmap_id)
        )""")
    if taxonomy_ids:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.facet_entity_bitmap f
          JOIN {SEARCH_SCHEMA}.entity_bitmap_id ebi ON ebi.entity_id = {alias}.entity_id
          WHERE f.facet_name = 'taxonomy_id'
            AND f.facet_value = ANY({push(taxonomy_ids)}::text[])
            AND rb_contains(f.entity_bitmap, ebi.bitmap_id)
        )""")
    if sources:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.facet_entity_bitmap f
          JOIN {SEARCH_SCHEMA}.entity_bitmap_id ebi ON ebi.entity_id = {alias}.entity_id
          WHERE f.facet_name = 'source'
            AND f.facet_value = ANY({push(sources)}::text[])
            AND rb_contains(f.entity_bitmap, ebi.bitmap_id)
        )""")

    return where


def resolve_entities(payload: dict[str, Any]) -> dict[str, Any]:
    identifiers = _strings(payload.get("identifiers"))
    filters = payload.get("filters") if isinstance(payload.get("filters"), dict) else {}
    limit = _limit(payload.get("limit"), default=20, maximum=100)
    preferred_taxonomy_ids = _ints(payload.get("preferredTaxonomyIds") or payload.get("preferred_taxonomy_ids"))
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
            + CASE WHEN e.taxonomy_id = ANY(%s::bigint[]) THEN 50 ELSE 0 END
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
            i.value AS match_identifier,
            it.name AS match_identifier_type,
            'identifier' AS match_kind,
            CASE
              WHEN it.name ILIKE 'Gene Name Primary:%%' THEN 950
              WHEN it.name ILIKE 'Gene Name:%%' THEN 900
              ELSE 800
            END
            + CASE WHEN e.taxonomy_id = ANY(%s::bigint[]) THEN 50 ELSE 0 END
            + CASE WHEN {_entity_type_sql('e')} = 'Protein:MI:0326' THEN 10 ELSE 0 END
            + LEAST(COALESCE(rc.relation_count, 0), 1000)::int / 100 AS score,
            COALESCE(rc.relation_count, 0)::bigint AS relation_count,
            {_entity_sources_sql("e")} AS sources
          FROM requested
          JOIN {SEARCH_SCHEMA}.identifier_evidence i
            ON i.value = requested.query_identifier
          JOIN {SEARCH_SCHEMA}.entity_identifier_lookup eil
            ON eil.identifier_id = i.identifier_id
          JOIN {SEARCH_SCHEMA}.entity e
            ON e.entity_id = eil.entity_id
          JOIN {SEARCH_SCHEMA}.vocab_identifier_type it
            ON it.identifier_type_id = i.identifier_type_id
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

    entities_by_pk: dict[str, dict[str, Any]] = {}
    matches: list[dict[str, Any]] = []
    for identifier in identifiers:
        candidates = sorted(
            rows_by_query.get(identifier, []),
            key=lambda row: (-int(row["score"] or 0), str(row["taxonomy_id"] or ""), str(row["entity_id"])),
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
          OR e.entity_id IN (
            SELECT eil.entity_id
            FROM {SEARCH_SCHEMA}.identifier_evidence i
            JOIN {SEARCH_SCHEMA}.entity_identifier_lookup eil
              ON eil.identifier_id = i.identifier_id
            WHERE i.value = %s
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
    pks = _ids(entity_pks)
    if not pks:
        return []
    sql = f"""
        SELECT {_entity_select("e")}
        FROM {SEARCH_SCHEMA}.entity e
        LEFT JOIN {SEARCH_SCHEMA}.entity_relation_counts rc ON rc.entity_id = e.entity_id
        WHERE e.entity_id = ANY(%s::uuid[])
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
      rp.name AS predicate,
      {alias}.object_entity_id,
      rc.name AS relation_category,
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
        SELECT DISTINCT ds.name
        FROM {SEARCH_SCHEMA}.relation_evidence_relation rer
        JOIN {SEARCH_SCHEMA}.relation_evidence re
          ON re.source_id = rer.source_id
         AND re.relation_evidence_id = rer.relation_evidence_id
        JOIN {SEARCH_SCHEMA}.data_source ds ON ds.source_id = re.source_id
        WHERE rer.relation_id = {alias}.relation_id
          AND ds.name IS NOT NULL
          AND ds.name <> ''
        ORDER BY ds.name
      ) AS sources"""


def _relation_to_api(row: dict[str, Any], include_entities: bool) -> dict[str, Any]:
    relation = {
        "relationPk": str(row["relation_id"]),
        "subjectEntityPk": str(row["subject_entity_id"]),
        "predicate": row["predicate"],
        "objectEntityPk": str(row["object_entity_id"]),
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
    relation_pks = _ids(filters.get("relationPks") or filters.get("relation_pks"))
    relation_categories = _strings(filters.get("relationCategories") or filters.get("relation_categories"))
    predicates = _strings(filters.get("predicates"))
    participant_types = _strings(filters.get("participantTypes") or filters.get("participant_types") or filters.get("interactionTypes") or filters.get("interaction_types"))
    subject_entity_pks = _ids(filters.get("subjectEntityPks") or filters.get("subject_entity_pks"))
    object_entity_pks = _ids(filters.get("objectEntityPks") or filters.get("object_entity_pks"))
    entity_pks = _ids(filters.get("entityPks") or filters.get("entity_pks"))
    sources = resolve_resource_filters(_strings(filters.get("sources")))
    taxonomy_ids = _strings(filters.get("ncbi_tax_id") or filters.get("taxonomy_ids") or filters.get("taxonomyIds"))
    annotation_terms = _strings(filters.get("annotationTerms") or filters.get("annotation_terms") or filters.get("ontology_terms"))
    require_both = bool(filters.get("requireBothParticipants") or filters.get("require_both_participants"))
    relation_term_bitmap_table = _relation_term_bitmap_table()

    if relation_pks:
        where.append(f"r.relation_id = ANY({push(relation_pks)}::uuid[])")
    if relation_categories:
        where.append(f"rc.name = ANY({push(relation_categories)}::text[])")
    if predicates:
        where.append(f"rp.name = ANY({push(predicates)}::text[])")
    if participant_types:
        where.append(f"""EXISTS (
          SELECT 1 FROM {SEARCH_SCHEMA}.entity endpoint
          WHERE {_entity_type_sql('endpoint')} = ANY({push(participant_types)}::text[])
            AND endpoint.entity_id IN (r.subject_entity_id, r.object_entity_id)
        )""")
    if subject_entity_pks:
        where.append(f"r.subject_entity_id = ANY({push(subject_entity_pks)}::uuid[])")
    if object_entity_pks:
        where.append(f"r.object_entity_id = ANY({push(object_entity_pks)}::uuid[])")
    if entity_pks:
        op = "AND" if require_both else "OR"
        where.append(f"(r.subject_entity_id = ANY({push(entity_pks)}::uuid[]) {op} r.object_entity_id = ANY(%s::uuid[]))")
        params.append(entity_pks)
    if sources:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.relation_evidence_relation rer
          JOIN {SEARCH_SCHEMA}.relation_evidence re
            ON re.source_id = rer.source_id
           AND re.relation_evidence_id = rer.relation_evidence_id
          JOIN {SEARCH_SCHEMA}.data_source ds ON ds.source_id = re.source_id
          WHERE rer.relation_id = r.relation_id
            AND ds.name = ANY({push(sources)}::text[])
        )""")
    if taxonomy_ids:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.facet_relation_bitmap f
          JOIN {SEARCH_SCHEMA}.relation_bitmap_id rbi ON rbi.relation_id = r.relation_id
          WHERE f.facet_name = 'taxonomy_id'
            AND f.facet_value = ANY({push(taxonomy_ids)}::text[])
            AND rb_contains(f.relation_bitmap, rbi.bitmap_id)
        )""")
    if annotation_terms:
        where.append(f"""EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.entity_ontology_term terms
          JOIN {SEARCH_SCHEMA}.{relation_term_bitmap_table} bitmap
            ON bitmap.term_entity_id = terms.term_entity_id
          JOIN {SEARCH_SCHEMA}.relation_bitmap_id rbi ON rbi.relation_id = r.relation_id
          WHERE terms.term_id = ANY({push(annotation_terms)}::text[])
            AND rb_contains(bitmap.relation_bitmap, rbi.bitmap_id)
        )""")

    return f"WHERE {' AND '.join(where)}" if where else ""


def search_relations(payload: dict[str, Any]) -> dict[str, Any]:
    filters = payload.get("filters") if isinstance(payload.get("filters"), dict) else payload
    # Selectable level (T034): when a chemical structural level is requested,
    # serve the collapsed edges from the materialised resolution-level table.
    chemical_level = (
        payload.get("chemicalLevel")
        or payload.get("chemical_level")
        or filters.get("chemicalLevel")
        or filters.get("chemical_level")
    )
    if chemical_level:
        return _search_chemical_level_relations(payload, filters, str(chemical_level))
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
        LEFT JOIN {SEARCH_SCHEMA}.vocab_relation_predicate rp
          ON rp.relation_predicate_id = r.predicate_id
        LEFT JOIN {SEARCH_SCHEMA}.vocab_relation_category rc
          ON rc.relation_category_id = r.relation_category_id
        {entity_joins}
        {where_sql}
        ORDER BY r.relation_id
        LIMIT %s OFFSET %s
    """
    count_sql = f"""
        SELECT count(*)::bigint AS total
        FROM {SEARCH_SCHEMA}.relation r
        LEFT JOIN {SEARCH_SCHEMA}.vocab_relation_predicate rp
          ON rp.relation_predicate_id = r.predicate_id
        LEFT JOIN {SEARCH_SCHEMA}.vocab_relation_category rc
          ON rc.relation_category_id = r.relation_category_id
        {where_sql}
    """
    with _connect() as conn:
        rows = conn.execute(sql, page_params).fetchall()
        total = conn.execute(count_sql, params).fetchone()["total"]

    return {
        "relations": [_relation_to_api(row, include_entities) for row in rows],
        "total": int(total or 0),
        "limit": limit,
        "offset": offset,
    }


# ---------------------------------------------------------------------------
# Selectable levels (spec-003 T034/T035)
#
# A "selectable level" picks how endpoints of a relation are projected. There
# are two axes of one shared concept:
#   * chemical_structure — the InChIKey structural-specificity level
#     (connectivity / stereo_isotope_tautomer / full), served from the
#     pre-materialised ``chemical_resolution_relation`` (no request-time GROUP
#     BY). This is the chemical instance of the level mechanism (T034).
#   * entity_layout — the gene↔protein↔state representation axis (T035). 'entity'
#     (the base graph) is implemented today; gene/protein/state re-projection is
#     the remaining build, registered here so both axes share one concept.
# ---------------------------------------------------------------------------

ENTITY_LAYOUTS = ("entity", "gene", "protein", "state")
DEFAULT_ENTITY_LAYOUT = "entity"


def _chemical_level_names() -> list[str]:
    """Names of the materialised chemical structural levels, coarse → fine."""
    with _connect() as conn:
        exists = conn.execute(
            """
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = %s AND table_name = 'chemical_resolution_level'
            """,
            (SEARCH_SCHEMA,),
        ).fetchone()
        if not exists:
            return []
        rows = conn.execute(
            f"""
            SELECT name FROM {SEARCH_SCHEMA}.chemical_resolution_level
            ORDER BY specificity_rank
            """
        ).fetchall()
    return [row["name"] for row in rows]


def selectable_levels() -> dict[str, Any]:
    """Discovery: the two axes of the shared selectable-level mechanism."""
    chemical = []
    with _connect() as conn:
        exists = conn.execute(
            """
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = %s AND table_name = 'chemical_resolution_level'
            """,
            (SEARCH_SCHEMA,),
        ).fetchone()
        if exists:
            chemical = [
                dict(row)
                for row in conn.execute(
                    f"""
                    SELECT name, inchikey_prefix_length, specificity_rank,
                           description
                    FROM {SEARCH_SCHEMA}.chemical_resolution_level
                    ORDER BY specificity_rank
                    """
                ).fetchall()
            ]
    return {
        "chemicalStructure": {
            "param": "chemicalLevel",
            "default": None,
            "served_from": "chemical_resolution_relation",
            "levels": chemical,
        },
        "entityLayout": {
            "param": "outputLayout",
            "default": DEFAULT_ENTITY_LAYOUT,
            "layouts": list(ENTITY_LAYOUTS),
            "implemented": [DEFAULT_ENTITY_LAYOUT],
        },
    }


def _normalize_output_layout(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text if text in ENTITY_LAYOUTS else DEFAULT_ENTITY_LAYOUT


def _chemical_level_select() -> str:
    """SELECT list for a projected chemical-level edge (mirrors _relation_select).

    The collapsed edge has no single ``relation_id``; synthesise a stable uuid
    from (level, subject, predicate, object) so it has a deterministic pk. The
    member count is the evidence count; provenance is the union ``source_ids``.
    """
    return f"""
      md5(
        cr.level_id::text || ':' || cr.subject_entity_id::text || ':' ||
        cr.predicate_id::text || ':' || cr.object_entity_id::text
      )::uuid AS relation_id,
      cr.subject_entity_id,
      rp.name AS predicate,
      cr.object_entity_id,
      rc.name AS relation_category,
      ARRAY(
        SELECT DISTINCT entity_type
        FROM (
          SELECT {_entity_type_sql('subject')} AS entity_type
          FROM {SEARCH_SCHEMA}.entity subject
          WHERE subject.entity_id = cr.subject_entity_id
          UNION
          SELECT {_entity_type_sql('object')} AS entity_type
          FROM {SEARCH_SCHEMA}.entity object
          WHERE object.entity_id = cr.object_entity_id
        ) participant_types
        WHERE entity_type IS NOT NULL
        ORDER BY entity_type
      ) AS participant_types,
      cr.member_relation_count::bigint AS evidence_count,
      ARRAY(
        SELECT DISTINCT ds.name
        FROM {SEARCH_SCHEMA}.data_source ds
        WHERE ds.source_id = ANY(cr.source_ids)
          AND ds.name IS NOT NULL AND ds.name <> ''
        ORDER BY ds.name
      ) AS sources"""


def _chemical_level_where(filters: dict[str, Any], params: list[Any]) -> str:
    """WHERE for the chemical-level path (cr.*; source filter via source_ids).

    Supports predicate / relation-category / subject-object-entity-pk / source
    filters. Taxonomy & annotation-term facets key on base ``relation_id`` and
    are not applied to projected edges (documented behaviour).
    """

    def push(value: Any) -> str:
        params.append(value)
        return "%s"

    where: list[str] = []
    relation_categories = _strings(filters.get("relationCategories") or filters.get("relation_categories"))
    predicates = _strings(filters.get("predicates"))
    subject_entity_pks = _ids(filters.get("subjectEntityPks") or filters.get("subject_entity_pks"))
    object_entity_pks = _ids(filters.get("objectEntityPks") or filters.get("object_entity_pks"))
    entity_pks = _ids(filters.get("entityPks") or filters.get("entity_pks"))
    sources = resolve_resource_filters(_strings(filters.get("sources")))
    require_both = bool(filters.get("requireBothParticipants") or filters.get("require_both_participants"))

    if relation_categories:
        where.append(f"rc.name = ANY({push(relation_categories)}::text[])")
    if predicates:
        where.append(f"rp.name = ANY({push(predicates)}::text[])")
    if subject_entity_pks:
        where.append(f"cr.subject_entity_id = ANY({push(subject_entity_pks)}::uuid[])")
    if object_entity_pks:
        where.append(f"cr.object_entity_id = ANY({push(object_entity_pks)}::uuid[])")
    if entity_pks:
        op = "AND" if require_both else "OR"
        where.append(f"(cr.subject_entity_id = ANY({push(entity_pks)}::uuid[]) {op} cr.object_entity_id = ANY(%s::uuid[]))")
        params.append(entity_pks)
    if sources:
        where.append(f"""cr.source_ids && (
          SELECT coalesce(array_agg(ds.source_id), '{{}}'::bigint[])
          FROM {SEARCH_SCHEMA}.data_source ds
          WHERE ds.name = ANY({push(sources)}::text[])
        )""")

    return f"AND {' AND '.join(where)}" if where else ""


def _search_chemical_level_relations(
    payload: dict[str, Any],
    filters: dict[str, Any],
    level: str,
) -> dict[str, Any]:
    """Serve relations at a chemical structural level from the materialised
    ``chemical_resolution_relation`` table (T034)."""
    available = _chemical_level_names()
    if level not in available:
        return {
            "relations": [],
            "total": 0,
            "limit": _limit(payload.get("limit"), default=50),
            "offset": _offset(payload.get("offset")),
            "chemicalLevel": level,
            "outputLayout": _normalize_output_layout(payload.get("outputLayout") or filters.get("outputLayout")),
            "error": f"unknown chemicalLevel '{level}'; available: {available}",
        }

    limit = _limit(payload.get("limit"), default=50)
    offset = _offset(payload.get("offset"))
    include_entities = payload.get("includeEntities", True) is not False
    output_layout = _normalize_output_layout(payload.get("outputLayout") or filters.get("outputLayout"))

    params: list[Any] = [level]
    where_sql = _chemical_level_where(filters, params)
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
          JOIN {SEARCH_SCHEMA}.entity subject ON subject.entity_id = cr.subject_entity_id
          JOIN {SEARCH_SCHEMA}.entity object ON object.entity_id = cr.object_entity_id"""

    sql = f"""
        SELECT {_chemical_level_select()}
          {entity_select}
        FROM {SEARCH_SCHEMA}.chemical_resolution_relation cr
        JOIN {SEARCH_SCHEMA}.chemical_resolution_level l
          ON l.level_id = cr.level_id AND l.name = %s
        LEFT JOIN {SEARCH_SCHEMA}.vocab_relation_predicate rp
          ON rp.relation_predicate_id = cr.predicate_id
        LEFT JOIN {SEARCH_SCHEMA}.vocab_relation_category rc
          ON rc.relation_category_id = cr.relation_category_id
        {entity_joins}
        WHERE true {where_sql}
        ORDER BY cr.subject_entity_id, cr.predicate_id, cr.object_entity_id
        LIMIT %s OFFSET %s
    """
    count_sql = f"""
        SELECT count(*)::bigint AS total
        FROM {SEARCH_SCHEMA}.chemical_resolution_relation cr
        JOIN {SEARCH_SCHEMA}.chemical_resolution_level l
          ON l.level_id = cr.level_id AND l.name = %s
        LEFT JOIN {SEARCH_SCHEMA}.vocab_relation_predicate rp
          ON rp.relation_predicate_id = cr.predicate_id
        LEFT JOIN {SEARCH_SCHEMA}.vocab_relation_category rc
          ON rc.relation_category_id = cr.relation_category_id
        WHERE true {where_sql}
    """
    with _connect() as conn:
        rows = conn.execute(sql, page_params).fetchall()
        total = conn.execute(count_sql, params).fetchone()["total"]

    return {
        "relations": [_relation_to_api(row, include_entities) for row in rows],
        "total": int(total or 0),
        "limit": limit,
        "offset": offset,
        "chemicalLevel": level,
        "outputLayout": output_layout,
    }


def get_relation(relation_id: str) -> dict[str, Any] | None:
    result = search_relations({"filters": {"relationPks": [relation_id]}, "limit": 1, "includeEntities": True})
    return result["relations"][0] if result["relations"] else None


def relation_evidence(relation_id: str) -> dict[str, Any]:
    sql = f"""
        SELECT
          ds.name AS source,
          re.relation_evidence_id,
          rer.relation_id,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object('term', a.term, 'value', a.value, 'unit', a.unit, 'scope', vas.name) ORDER BY a.annotation_key)
            FROM {SEARCH_SCHEMA}.relation_evidence_annotation rea
            JOIN {SEARCH_SCHEMA}.annotation a ON a.annotation_key = rea.annotation_key
            JOIN {SEARCH_SCHEMA}.vocab_annotation_scope vas
              ON vas.annotation_scope_id = rea.annotation_scope_id
            WHERE rea.source_id = re.source_id
              AND rea.relation_evidence_id = re.relation_evidence_id
              AND vas.name = 'relation'
          ), '[]'::jsonb) AS record_attributes,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object('term', a.term, 'value', a.value, 'unit', a.unit, 'scope', 'subject') ORDER BY a.annotation_key)
            FROM {SEARCH_SCHEMA}.entity_evidence_annotation eea
            JOIN {SEARCH_SCHEMA}.annotation a ON a.annotation_key = eea.annotation_key
            WHERE eea.source_id = re.source_id
              AND eea.entity_evidence_id = re.subject_entity_evidence_id
          ), '[]'::jsonb) AS subject_attributes,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object('term', a.term, 'value', a.value, 'unit', a.unit, 'scope', 'object') ORDER BY a.annotation_key)
            FROM {SEARCH_SCHEMA}.entity_evidence_annotation eea
            JOIN {SEARCH_SCHEMA}.annotation a ON a.annotation_key = eea.annotation_key
            WHERE eea.source_id = re.source_id
              AND eea.entity_evidence_id = re.object_entity_evidence_id
          ), '[]'::jsonb) AS object_attributes,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object('term', a.term, 'value', a.value, 'unit', a.unit, 'scope', vas.name) ORDER BY a.annotation_key)
            FROM {SEARCH_SCHEMA}.relation_evidence_annotation rea
            JOIN {SEARCH_SCHEMA}.annotation a ON a.annotation_key = rea.annotation_key
            JOIN {SEARCH_SCHEMA}.vocab_annotation_scope vas
              ON vas.annotation_scope_id = rea.annotation_scope_id
            WHERE rea.source_id = re.source_id
              AND rea.relation_evidence_id = re.relation_evidence_id
              AND vas.name <> 'relation'
          ), '[]'::jsonb) AS evidence
        FROM {SEARCH_SCHEMA}.relation_evidence_relation rer
        JOIN {SEARCH_SCHEMA}.relation_evidence re
          ON re.source_id = rer.source_id
         AND re.relation_evidence_id = rer.relation_evidence_id
        JOIN {SEARCH_SCHEMA}.data_source ds ON ds.source_id = re.source_id
        WHERE rer.relation_id = %s
        ORDER BY ds.name, re.relation_evidence_id
    """
    with _connect() as conn:
        rows = conn.execute(sql, (relation_id,)).fetchall()
    return {
        "relationPk": relation_id,
        "evidence": [
            {
                "source": row["source"],
                "relationEvidencePk": str(row["relation_evidence_id"]),
                "relationPk": str(row["relation_id"]),
                "recordAttributes": row["record_attributes"] or [],
                "subjectAttributes": row["subject_attributes"] or [],
                "objectAttributes": row["object_attributes"] or [],
                "evidence": row["evidence"] or [],
            }
            for row in rows
        ],
    }
