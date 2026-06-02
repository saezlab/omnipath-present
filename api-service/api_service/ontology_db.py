"""Database-backed ontology helpers for the FastAPI service."""

from __future__ import annotations

import os
import re
from typing import Any

import psycopg
from psycopg.rows import dict_row

SEARCH_SCHEMA = os.getenv('OMNIPATH_PG_SCHEMA', 'public')

ONTOLOGY_DESCRIPTIONS = {
    'chebi': 'Chemical Entities of Biological Interest',
    'chemont': 'ClassyFire / ChemOnt',
    'enzyme_classification': 'Enzyme Classification',
    'gene_ontology': 'Gene Ontology',
    'hpo': 'Human Phenotype Ontology',
    'kegg_pathways': 'KEGG pathway ontology',
    'macdb_traits': 'MACDB traits ontology',
    'mondo': 'Mondo Disease Ontology',
    'omnipath': 'OmniPath ontology',
    'psi-mi': 'PSI-MI ontology',
    'reactome_pathways': 'Reactome pathway ontology',
    'uniprot_keywords': 'UniProt Keywords ontology',
}


def _database_url() -> str:
    url = os.getenv('DATABASE_URL')
    if not url:
        raise RuntimeError('DATABASE_URL is not configured')
    return url


def _connect():
    return psycopg.connect(_database_url(), row_factory = dict_row)


def _normalize_search_text(value: str) -> str:
    return re.sub(r'\s+', ' ', str(value).strip().lower())


def _score_term_match(query: str, candidate: str) -> tuple[int, str] | None:
    if not query or not candidate:
        return None

    if candidate == query:
        return 1000, 'exact'

    if candidate.startswith(query):
        return 800, 'prefix'

    query_tokens = [token for token in query.split(' ') if token]
    candidate_tokens = [token for token in candidate.split(' ') if token]

    if query_tokens and candidate_tokens[: len(query_tokens)] == query_tokens:
        return 700, 'token-prefix'

    if query_tokens and all(token in candidate_tokens for token in query_tokens):
        return 600, 'token-match'

    if query in candidate:
        return 500, 'substring'

    return None


def _term_row_to_info(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': row['term_id'],
        'name': row['label'],
        'definition': row['definition'],
        'namespace': row['ontology_id'],
    }


def list_ontologies() -> list[dict[str, Any]]:
    sql = f"""
        SELECT ontology_id
        FROM (
          SELECT DISTINCT ontology_id
          FROM {SEARCH_SCHEMA}.entity_ontology_term
          WHERE COALESCE(ontology_id, '') <> ''
          UNION
          SELECT DISTINCT ontology_id
          FROM {SEARCH_SCHEMA}.entity_ontology_relation
          WHERE COALESCE(ontology_id, '') <> ''
        ) ontologies
        ORDER BY ontology_id
    """
    with _connect() as conn:
        rows = conn.execute(sql).fetchall()

    return [
        {
            'id': row['ontology_id'],
            'description': ONTOLOGY_DESCRIPTIONS.get(row['ontology_id'], row['ontology_id']),
            'loaded': True,
        }
        for row in rows
    ]


def ontology_exists(ontology_id: str) -> bool:
    sql = f"""
        SELECT EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.entity_ontology_term
          WHERE ontology_id = %s
          UNION
          SELECT 1
          FROM {SEARCH_SCHEMA}.entity_ontology_relation
          WHERE ontology_id = %s
        ) AS exists
    """
    with _connect() as conn:
        row = conn.execute(sql, (ontology_id, ontology_id)).fetchone()
    return bool(row and row['exists'])


def get_term(term_id: str, ontology_id: str | None = None) -> dict[str, Any] | None:
    params: list[Any] = [term_id]
    ontology_where = ''
    if ontology_id:
        ontology_where = f"""
          AND (
            t.ontology_id = %s
            OR EXISTS (
              SELECT 1
              FROM {SEARCH_SCHEMA}.entity_ontology_relation r
              WHERE r.ontology_id = %s
                AND (r.subject_entity_id = t.term_entity_id OR r.object_entity_id = t.term_entity_id)
            )
          )
        """
        params.extend([ontology_id, ontology_id])

    sql = f"""
        SELECT DISTINCT ON (t.term_id)
          t.term_id,
          t.label,
          t.definition,
          t.ontology_id
        FROM {SEARCH_SCHEMA}.entity_ontology_term t
        WHERE t.term_id = %s
          {ontology_where}
        ORDER BY t.term_id, CASE WHEN t.ontology_id = %s THEN 0 ELSE 1 END, t.ontology_id
    """
    if ontology_id:
        params.append(ontology_id)
    else:
        sql = sql.replace('ORDER BY t.term_id, CASE WHEN t.ontology_id = %s THEN 0 ELSE 1 END, t.ontology_id', 'ORDER BY t.term_id, t.ontology_id')

    with _connect() as conn:
        row = conn.execute(sql, params).fetchone()
    return _term_row_to_info(row) if row else None


def get_terms(term_ids: list[str]) -> dict[str, dict[str, Any] | None]:
    if not term_ids:
        return {}

    sql = f"""
        SELECT DISTINCT ON (t.term_id)
          t.term_id,
          t.label,
          t.definition,
          t.ontology_id
        FROM {SEARCH_SCHEMA}.entity_ontology_term t
        WHERE t.term_id = ANY(%s::text[])
        ORDER BY t.term_id, t.ontology_id
    """
    with _connect() as conn:
        rows = conn.execute(sql, (term_ids,)).fetchall()

    by_id = {row['term_id']: _term_row_to_info(row) for row in rows}
    return {term_id: by_id.get(term_id) for term_id in term_ids}


def search_terms(query: str, ontology_ids: list[str] | None = None, limit: int = 10) -> list[dict[str, Any]]:
    normalized_query = _normalize_search_text(query)
    if not normalized_query:
        return []

    params: list[Any] = [query.lower(), f'%{query.lower()}%', f'%{query.lower()}%', f'%{query.lower()}%', f'%{query.lower()}%']
    ontology_where = ''
    if ontology_ids:
        ontology_where = 'AND t.ontology_id = ANY(%s::text[])'
        params.append(ontology_ids)

    sql = f"""
        SELECT
          t.term_id,
          t.label,
          t.definition,
          t.ontology_id,
          t.synonyms,
          t.term_aliases,
          t.identifiers_text
        FROM {SEARCH_SCHEMA}.entity_ontology_term t
        WHERE (
          lower(t.term_id) = %s
          OR lower(COALESCE(t.label, '')) LIKE %s
          OR lower(COALESCE(t.definition, '')) LIKE %s
          OR lower(COALESCE(t.synonyms_text, '')) LIKE %s
          OR lower(COALESCE(t.identifiers_text, '')) LIKE %s
        )
        {ontology_where}
        ORDER BY t.child_count DESC, t.term_id
        LIMIT 500
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()

    matches: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        candidate_texts = [row['term_id'], row['label'], *(row['synonyms'] or []), *(row['term_aliases'] or [])]
        best_score: int | None = None
        best_match_type: str | None = None
        best_matched_text: str | None = None
        seen: set[str] = set()

        for text in candidate_texts:
            normalized = _normalize_search_text(text)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            scored = _score_term_match(normalized_query, normalized)
            if scored is None:
                continue
            score, match_type = scored
            if best_score is None or score > best_score:
                best_score = score
                best_match_type = match_type
                best_matched_text = str(text)

        if best_score is None or best_match_type is None or best_matched_text is None:
            continue

        if _normalize_search_text(row['label'] or '') == normalized_query:
            best_score += 50

        matches.append((
            best_score,
            {
                'id': row['term_id'],
                'name': row['label'],
                'definition': row['definition'],
                'namespace': row['ontology_id'],
                'ontology_id': row['ontology_id'],
                'matched_text': best_matched_text,
                'match_type': best_match_type,
                'score': best_score,
            },
        ))

    matches.sort(key = lambda item: (-item[0], len(item[1]['id']), item[1]['id']))
    return [match for _, match in matches[:limit]]


def direct_relatives(
    ontology_id: str,
    term_id: str,
    *,
    direction: str,
) -> list[str]:
    if direction == 'parents':
        select_col = 'parent.term_id'
        join_sql = f"""
            JOIN {SEARCH_SCHEMA}.entity_ontology_term child
              ON child.term_entity_id = r.subject_entity_id
            JOIN {SEARCH_SCHEMA}.entity_ontology_term parent
              ON parent.term_entity_id = r.object_entity_id
            WHERE child.term_id = %s
        """
    else:
        select_col = 'child.term_id'
        join_sql = f"""
            JOIN {SEARCH_SCHEMA}.entity_ontology_term parent
              ON parent.term_entity_id = r.object_entity_id
            JOIN {SEARCH_SCHEMA}.entity_ontology_term child
              ON child.term_entity_id = r.subject_entity_id
            WHERE parent.term_id = %s
        """

    sql = f"""
        SELECT DISTINCT {select_col} AS term_id
        FROM {SEARCH_SCHEMA}.entity_ontology_relation r
        {join_sql}
          AND r.ontology_id = %s
        ORDER BY term_id
    """
    with _connect() as conn:
        rows = conn.execute(sql, (term_id, ontology_id)).fetchall()
    return [row['term_id'] for row in rows]


def recursive_relatives(
    ontology_id: str,
    term_id: str,
    *,
    direction: str,
    depth: int | None = None,
) -> list[str]:
    if direction == 'ancestors':
        seed_join = f"""
            JOIN {SEARCH_SCHEMA}.entity_ontology_term seed
              ON seed.term_entity_id = r.subject_entity_id
            WHERE seed.term_id = %s
        """
        next_join = 'r.subject_entity_id = walk.term_entity_id'
        next_entity = 'r.object_entity_id'
    else:
        seed_join = f"""
            JOIN {SEARCH_SCHEMA}.entity_ontology_term seed
              ON seed.term_entity_id = r.object_entity_id
            WHERE seed.term_id = %s
        """
        next_join = 'r.object_entity_id = walk.term_entity_id'
        next_entity = 'r.subject_entity_id'

    depth_sql = ''
    params: list[Any] = [term_id, ontology_id, ontology_id]
    if depth is not None:
        depth_sql = 'AND walk.depth < %s'
        params.append(depth)

    sql = f"""
        WITH RECURSIVE walk AS (
          SELECT
            {next_entity} AS term_entity_id,
            1::integer AS depth,
            ARRAY[{next_entity}] AS path
          FROM {SEARCH_SCHEMA}.entity_ontology_relation r
          {seed_join}
            AND r.ontology_id = %s
          UNION ALL
          SELECT
            {next_entity} AS term_entity_id,
            walk.depth + 1 AS depth,
            walk.path || {next_entity}
          FROM walk
          JOIN {SEARCH_SCHEMA}.entity_ontology_relation r
            ON {next_join}
           AND r.ontology_id = %s
          WHERE NOT {next_entity} = ANY(walk.path)
            {depth_sql}
        )
        SELECT t.term_id, MIN(walk.depth) AS min_depth
        FROM walk
        JOIN {SEARCH_SCHEMA}.entity_ontology_term t
          ON t.term_entity_id = walk.term_entity_id
        GROUP BY t.term_id
        ORDER BY min_depth, t.term_id
    """
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [row['term_id'] for row in rows]


def trajectories(ontology_id: str, term_id: str) -> list[list[dict[str, Any]]]:
    sql = f"""
        WITH RECURSIVE walk AS (
          SELECT
            t.term_entity_id,
            ARRAY[t.term_entity_id] AS path_entity_ids,
            ARRAY[t.term_id] AS path_term_ids,
            ARRAY[COALESCE(t.label, t.term_id)] AS path_labels
          FROM {SEARCH_SCHEMA}.entity_ontology_term t
          WHERE t.term_id = %s
          UNION ALL
          SELECT
            parent.term_entity_id,
            ARRAY[parent.term_entity_id] || walk.path_entity_ids,
            ARRAY[parent.term_id] || walk.path_term_ids,
            ARRAY[COALESCE(parent.label, parent.term_id)] || walk.path_labels
          FROM walk
          JOIN {SEARCH_SCHEMA}.entity_ontology_relation r
            ON r.subject_entity_id = walk.term_entity_id
           AND r.ontology_id = %s
          JOIN {SEARCH_SCHEMA}.entity_ontology_term parent
            ON parent.term_entity_id = r.object_entity_id
          WHERE NOT parent.term_entity_id = ANY(walk.path_entity_ids)
        )
        SELECT path_term_ids, path_labels
        FROM walk
        WHERE NOT EXISTS (
          SELECT 1
          FROM {SEARCH_SCHEMA}.entity_ontology_relation r
          WHERE r.ontology_id = %s
            AND r.subject_entity_id = walk.term_entity_id
        )
        ORDER BY cardinality(path_term_ids), path_term_ids::text
    """
    with _connect() as conn:
        rows = conn.execute(sql, (term_id, ontology_id, ontology_id)).fetchall()

    result: list[list[dict[str, Any]]] = []
    for row in rows:
        term_ids = row['path_term_ids'] or []
        labels = row['path_labels'] or []
        path: list[dict[str, Any]] = []
        distance_offset = len(term_ids) - 1
        for index, item_term_id in enumerate(term_ids):
            path.append({
                'id': item_term_id,
                'name': labels[index] if index < len(labels) else None,
                'distance': index - distance_offset,
            })
        result.append(path)
    return result


def canonical_ontology_id(term_id: str) -> str | None:
    sql = f"""
        SELECT ontology_id
        FROM {SEARCH_SCHEMA}.entity_ontology_term
        WHERE term_id = %s
          AND COALESCE(ontology_id, '') <> ''
        ORDER BY ontology_id
        LIMIT 1
    """
    with _connect() as conn:
        row = conn.execute(sql, (term_id,)).fetchone()
    return row['ontology_id'] if row else None
