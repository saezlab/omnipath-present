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


def list_resources() -> list[dict[str, Any]]:
    sql = f"""
        SELECT
          resource_id,
          resource_name,
          description,
          homepage_url,
          license,
          pubmed_id,
          resource_kind,
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
        ORDER BY total_size_bytes DESC, resource_id
    """

    with _connect() as conn:
        rows = conn.execute(sql).fetchall()

    return [
        {
            "resource_id": row["resource_id"],
            "resource_name": row["resource_name"] or row["resource_id"],
            "description": row["description"],
            "homepage_url": row["homepage_url"],
            "license": row["license"],
            "pubmed_id": row["pubmed_id"],
            "resource_kind": row["resource_kind"],
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
