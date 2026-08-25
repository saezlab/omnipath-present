from __future__ import annotations

import os
from datetime import datetime
from typing import Any


def _database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not configured")
    return url


def _schema() -> str:
    return os.getenv("OMNIPATH_PG_SCHEMA", "public")


def _connect():
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(_database_url(), row_factory=dict_row)


def _as_text_array(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item]
    return []


def _as_iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return value if isinstance(value, str) else None


def _has_column(conn, table: str, column: str) -> bool:
    return bool(
        conn.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = %s
              AND table_name = %s
              AND column_name = %s
            LIMIT 1
            """,
            [_schema(), table, column],
        ).fetchone()
    )


def list_resources() -> list[dict[str, Any]]:
    with _connect() as conn:
        license_label_select = (
            "license_label"
            if _has_column(conn, "resources", "license_label")
            else "NULL::text AS license_label"
        )
        # 3-name model columns (Milestone M) — guarded for older builds.
        short_select = (
            "resource_short" if _has_column(conn, "resources", "resource_short")
            else "NULL::text AS resource_short"
        )
        full_select = (
            "resource_full" if _has_column(conn, "resources", "resource_full")
            else "NULL::text AS resource_full"
        )
        synonyms_select = (
            "synonyms" if _has_column(conn, "resources", "synonyms")
            else "ARRAY[]::text[] AS synonyms"
        )

        sql = f"""
            SELECT
              resource_id,
              resource_name,
              {short_select},
              {full_select},
              {synonyms_select},
              description,
              homepage_url,
              license,
              {license_label_select},
              pubmed_id,
              resource_kind,
              input_module,
              input_module_commit,
              input_module_dirty,
              categories,
              annotation_ontologies,
              entity_count,
              interaction_count,
              association_count,
              identifier_count,
              ontology_term_count,
              total_size_bytes,
              last_downloaded_at,
              last_built_at,
              build_status
            FROM {_schema()}.resources
            ORDER BY lower(coalesce(resource_name, resource_id)), resource_id
        """

        rows = conn.execute(sql).fetchall()

    return [
        {
            "resource_id": row["resource_id"],
            "resource_name": row["resource_name"] or row["resource_id"],
            "slug": row["resource_id"],
            "short": row["resource_short"] or row["resource_name"] or row["resource_id"],
            "full": row["resource_full"] or row["resource_name"] or row["resource_id"],
            "synonyms": _as_text_array(row["synonyms"]),
            "description": row["description"],
            "homepage_url": row["homepage_url"],
            "license": row["license"],
            "license_label": row["license_label"],
            "pubmed_id": row["pubmed_id"],
            "resource_kind": row["resource_kind"],
            "input_module": row["input_module"],
            "input_module_commit": row["input_module_commit"],
            "input_module_dirty": bool(row["input_module_dirty"]),
            "categories": _as_text_array(row["categories"]),
            "annotation_ontologies": _as_text_array(row["annotation_ontologies"]),
            "entity_count": int(row["entity_count"] or 0),
            "interaction_count": int(row["interaction_count"] or 0),
            "association_count": int(row["association_count"] or 0),
            "identifier_count": int(row["identifier_count"] or 0),
            "ontology_term_count": int(row["ontology_term_count"] or 0),
            "total_size_bytes": int(row["total_size_bytes"] or 0),
            "last_downloaded_at": _as_iso(row["last_downloaded_at"]),
            "last_built_at": _as_iso(row["last_built_at"]),
            "build_status": row["build_status"],
        }
        for row in rows
    ]


# ── Forgiving resource filter resolution ────────────────────────────────────
import re
import functools

_SLUG_RE = re.compile(r"[^a-z0-9]")


def _slugify(name: str) -> str:
    return _SLUG_RE.sub("", (name or "").lower())


@functools.lru_cache(maxsize=1)
def _resource_filter_index() -> dict[str, str]:
    """Map {slugified slug/short/synonym} → canonical resource key (resource_id).

    Built from the resources table so a user filter like ``ramp``/``RaMP``/a
    declared synonym all resolve to the same stored source key used in facets.
    """
    with _connect() as conn:
        has_short = _has_column(conn, "resources", "resource_short")
        has_syn = _has_column(conn, "resources", "synonyms")
        cols = ["resource_id"]
        cols.append("resource_short" if has_short else "NULL::text AS resource_short")
        cols.append("synonyms" if has_syn else "ARRAY[]::text[] AS synonyms")
        rows = conn.execute(
            f"SELECT {', '.join(cols)} FROM {_schema()}.resources"
        ).fetchall()
    index: dict[str, str] = {}
    for row in rows:
        rid = row["resource_id"]
        index[_slugify(rid)] = rid
        if row["resource_short"]:
            index.setdefault(_slugify(row["resource_short"]), rid)
        for synonym in (row["synonyms"] or []):
            index.setdefault(_slugify(synonym), rid)
    return index


def resolve_resource_filter(value: str) -> str:
    """Resolve one resource filter arg (slug/short/synonym, case-insensitive) → key.

    Unknown values pass through unchanged (so an explicit unknown filter is not
    silently swallowed).
    """
    if not value:
        return value
    return _resource_filter_index().get(_slugify(value), value)


def resolve_resource_filters(values: list[str]) -> list[str]:
    """Resolve a list of resource filter args to canonical keys (order/dedup-safe)."""
    seen: dict[str, None] = {}
    for value in values or []:
        seen.setdefault(resolve_resource_filter(value), None)
    return list(seen)
