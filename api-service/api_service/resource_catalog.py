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

        sql = f"""
            SELECT
              resource_id,
              resource_name,
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
