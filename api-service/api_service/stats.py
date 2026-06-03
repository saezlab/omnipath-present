"""Statistics / query API (Milestone H).

Read-only endpoints over **precomputed** tables (derived counts, facet bitmaps,
the build manifest, resource summary) — no full scans / heavy compute on the
request path. Payloads are camelCase to match the graph/facets surface. `stats`
and `figure-data` are one surface.
"""

from __future__ import annotations

import os
from typing import Any

SEARCH_SCHEMA = os.getenv('OMNIPATH_PG_SCHEMA', 'public')

# Exclude the controlled-vocabulary term entity type from entity-facing counts,
# consistent with the derived tables (research §2 / A).
_CV_TERM_ENTITY_TYPE = 'Cv Term:OM:0012'


def _database_url() -> str:
    url = os.getenv('DATABASE_URL')
    if not url:
        raise RuntimeError('DATABASE_URL is not configured')
    return url


def _connect():
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(_database_url(), row_factory=dict_row)


def _has_column(conn, table: str, column: str) -> bool:
    return bool(
        conn.execute(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s AND column_name = %s
            LIMIT 1
            """,
            [SEARCH_SCHEMA, table, column],
        ).fetchone()
    )


def _relation_exists(conn, name: str) -> bool:
    return bool(
        conn.execute(
            'SELECT to_regclass(%s)', [f'{SEARCH_SCHEMA}.{name}']
        ).fetchone()['to_regclass']
    )


def _entity_facet_counts(conn, facet_name: str, key: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"""
        SELECT facet_value, entity_count
        FROM {SEARCH_SCHEMA}.facet_entity_bitmap
        WHERE facet_name = %s AND facet_value <> %s
        ORDER BY entity_count DESC
        """,
        [facet_name, _CV_TERM_ENTITY_TYPE],
    ).fetchall()
    return [{key: r['facet_value'], 'count': int(r['entity_count'])} for r in rows]


def sources() -> list[dict[str, Any]]:
    """Per-resource counts in the 3-name model (slug/short/full) from `resources`."""
    with _connect() as conn:
        short = (
            'resource_short' if _has_column(conn, 'resources', 'resource_short')
            else 'resource_name'
        )
        full = (
            'resource_full' if _has_column(conn, 'resources', 'resource_full')
            else 'resource_name'
        )
        rows = conn.execute(
            f"""
            SELECT
              resource_id AS slug,
              {short} AS short,
              {full} AS full,
              entity_count, interaction_count, association_count,
              identifier_count, ontology_term_count
            FROM {SEARCH_SCHEMA}.resources
            ORDER BY resource_id
            """
        ).fetchall()
    return [
        {
            'slug': r['slug'],
            'short': r['short'],
            'full': r['full'],
            'entityCount': int(r['entity_count'] or 0),
            'interactionCount': int(r['interaction_count'] or 0),
            'associationCount': int(r['association_count'] or 0),
            'identifierCount': int(r['identifier_count'] or 0),
            'ontologyTermCount': int(r['ontology_term_count'] or 0),
        }
        for r in rows
    ]


def entity_types() -> list[dict[str, Any]]:
    with _connect() as conn:
        return _entity_facet_counts(conn, 'entity_type', 'entityType')


def chemical_classes() -> list[dict[str, Any]]:
    with _connect() as conn:
        return _entity_facet_counts(conn, 'chemical_class', 'chemicalClass')


def metabolic_domains() -> list[dict[str, Any]]:
    with _connect() as conn:
        return _entity_facet_counts(conn, 'metabolic_domain', 'metabolicDomain')


def interaction_types() -> list[dict[str, Any]]:
    """Predicate facet counts, tagged with their coarse interaction class (C)."""
    with _connect() as conn:
        has_class = _relation_exists(conn, 'vocab_interaction_class')
        class_join = (
            f"""
            LEFT JOIN {SEARCH_SCHEMA}.vocab_relation_predicate p
              ON p.name = f.facet_value
            LEFT JOIN {SEARCH_SCHEMA}.vocab_interaction_class ic
              ON ic.interaction_class_id = p.interaction_class_id
            """
            if has_class
            else ''
        )
        class_col = 'ic.name' if has_class else 'NULL::text'
        rows = conn.execute(
            f"""
            SELECT f.facet_value AS interaction_type,
                   {class_col} AS interaction_class,
                   f.relation_count
            FROM {SEARCH_SCHEMA}.facet_relation_bitmap f
            {class_join}
            WHERE f.facet_name = 'predicate'
            ORDER BY f.relation_count DESC
            """
        ).fetchall()
    return [
        {
            'interactionType': r['interaction_type'],
            'interactionClass': r['interaction_class'],
            'count': int(r['relation_count']),
        }
        for r in rows
    ]


def identifier_types() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT vit.name AS identifier_type, count(*) AS n
            FROM {SEARCH_SCHEMA}.identifier_evidence ie
            JOIN {SEARCH_SCHEMA}.vocab_identifier_type vit
              ON vit.identifier_type_id = ie.identifier_type_id
            GROUP BY vit.name
            ORDER BY n DESC
            """
        ).fetchall()
    return [
        {'identifierType': r['identifier_type'], 'count': int(r['n'])} for r in rows
    ]


def build_manifest() -> dict[str, Any]:
    with _connect() as conn:
        row = conn.execute(
            f"""
            SELECT build_id, built_at, package_commits, resources, partial_build
            FROM {SEARCH_SCHEMA}.build_manifest
            """
        ).fetchone()
    if row is None:
        return {}
    built_at = row['built_at']
    return {
        'buildId': row['build_id'],
        'builtAt': built_at.isoformat() if hasattr(built_at, 'isoformat') else built_at,
        'packageCommits': row['package_commits'],
        'resources': row['resources'],
        'partialBuild': bool(row['partial_build']),
    }


def coverage_profile() -> list[dict[str, Any]]:
    """How many entities are supported by N resources (from entity_source_count, A)."""
    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT source_count AS n_resources, count(*) AS n_entities
            FROM {SEARCH_SCHEMA}.entity_source_count
            GROUP BY source_count
            ORDER BY source_count
            """
        ).fetchall()
    return [
        {'nResources': int(r['n_resources']), 'nEntities': int(r['n_entities'])}
        for r in rows
    ]


def resource_overlap(content_kind: str = 'entity') -> list[dict[str, Any]]:
    """Pairwise resource overlap (from resource_overlap_summary, A)."""
    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT da.name AS source_a, db.name AS source_b, o.overlap
            FROM {SEARCH_SCHEMA}.resource_overlap_summary o
            JOIN {SEARCH_SCHEMA}.data_source da ON da.source_id = o.source_a_id
            JOIN {SEARCH_SCHEMA}.data_source db ON db.source_id = o.source_b_id
            WHERE o.content_kind = %s
            ORDER BY o.overlap DESC
            """,
            [content_kind],
        ).fetchall()
    return [
        {
            'sourceA': r['source_a'],
            'sourceB': r['source_b'],
            'overlap': int(r['overlap']),
        }
        for r in rows
    ]


def ramp_conflicts() -> list[dict[str, Any]]:
    """RaMP multi-InChIKey conflict counts by reason (from metabo table, F)."""
    with _connect() as conn:
        if not _relation_exists(conn, 'metabo_ramp_inchikey_conflict'):
            return []
        rows = conn.execute(
            f"""
            SELECT conflict_reason, count(*) AS n
            FROM {SEARCH_SCHEMA}.metabo_ramp_inchikey_conflict
            GROUP BY conflict_reason
            ORDER BY n DESC
            """
        ).fetchall()
    return [
        {'conflictReason': r['conflict_reason'], 'count': int(r['n'])} for r in rows
    ]
