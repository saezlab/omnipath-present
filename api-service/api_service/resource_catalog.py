from __future__ import annotations

import os
from pathlib import Path

import polars as pl
from fastapi import HTTPException


def get_data_root() -> Path:
    return Path(os.getenv("ONTOLOGY_DATA_DIR", "./data")).expanduser().resolve()


def get_resources_parquet_path() -> Path:
    parquet_path = get_data_root() / "resources.parquet"
    if not parquet_path.exists() or not parquet_path.is_file():
        raise HTTPException(status_code=404, detail=f"Resources parquet not found: {parquet_path}")
    return parquet_path


def list_resources() -> list[dict]:
    parquet_path = get_resources_parquet_path()
    df = pl.read_parquet(parquet_path)

    rows: list[dict] = []
    for row in df.to_dicts():
        normalized: dict = {}
        for key, value in row.items():
            if isinstance(value, list):
                normalized[key] = value
            elif value is None:
                normalized[key] = None
            else:
                normalized[key] = value
        rows.append(normalized)

    return rows
