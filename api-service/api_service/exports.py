"""Export helpers for direct Parquet-filtered subsets."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import polars as pl

ONTOLOGY_DATA_DIR = os.getenv("ONTOLOGY_DATA_DIR", "./data")

INTERACTIONS_PARQUET = Path(ONTOLOGY_DATA_DIR) / "search_interactions.parquet"
ENTITIES_PARQUET = Path(ONTOLOGY_DATA_DIR) / "search_entities.parquet"
ASSOCIATIONS_PARQUET = Path(ONTOLOGY_DATA_DIR) / "search_associations.parquet"


def _normalize_id(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_id_list(values: list[Any]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        parsed = _normalize_id(value)
        if parsed is None or parsed in seen:
            continue
        seen.add(parsed)
        normalized.append(parsed)
    return normalized


def _merge_list_values(*lists: list[Any]) -> list[Any]:
    merged: list[Any] = []
    seen: set[Any] = set()
    for values in lists:
        for value in values or []:
            if value not in seen:
                seen.add(value)
                merged.append(value)
    return merged


def _expand_ontology_term_variants(term: str) -> list[str]:
    """Expand a canonical ontology ID into likely indexed string variants.

    Search indexes often store term strings as:
    - "<name>:<TERM_ID>"
    - "<name>:<TERM_ID>:<TERM_ID>"

    We keep the original input and add these two variants when possible.
    """
    variants = [term]
    if ":" not in term:
        return variants

    # Already looks like an indexed term with embedded label.
    if term.count(":") >= 2:
        return variants

    try:
        from .config import get_ontology_for_term
        from .registry import registry

        ontology_id = get_ontology_for_term(term)
        if not ontology_id:
            return variants

        client = registry.get(ontology_id)
        if client is None:
            return variants

        ont_term = client.get_term(term)
        term_name = getattr(ont_term, "name", None)
        if not term_name:
            return variants

        name = str(term_name)
        variants.extend([
            f"{name}:{term}",
            f"{name}:{term}:{term}",
        ])
        return _merge_list_values(variants)
    except Exception:
        return variants


def _normalize_interaction_filters(filters: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(filters)

    # Accept generic ontology term key as alias for interaction-level terms.
    expanded_ontology_terms: list[str] = []
    for term in normalized.get("ontology_terms") or []:
        expanded_ontology_terms.extend(_expand_ontology_term_variants(str(term)))

    normalized["interaction_annotation_terms"] = _merge_list_values(
        list(normalized.get("interaction_annotation_terms") or []),
        expanded_ontology_terms,
    )
    normalized["participant_annotation_terms"] = _merge_list_values(
        list(normalized.get("participant_annotation_terms") or []),
    )

    # direction enum -> boolean helper field
    if normalized.get("has_direction") is None:
        direction = normalized.get("direction")
        if direction == "directed":
            normalized["has_direction"] = True
        elif direction == "undirected":
            normalized["has_direction"] = False

    # sign enum -> helper booleans
    if normalized.get("has_positive_sign") is None and normalized.get("has_negative_sign") is None:
        sign = normalized.get("sign")
        if sign == "positive":
            normalized["has_positive_sign"] = True
            normalized["has_negative_sign"] = False
        elif sign == "negative":
            normalized["has_positive_sign"] = False
            normalized["has_negative_sign"] = True
        elif sign == "mixed":
            normalized["has_positive_sign"] = True
            normalized["has_negative_sign"] = True

    return normalized


def _normalize_entity_filters(filters: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(filters)

    # taxonomy_ids is the new API name; ncbi_tax_id remains supported
    normalized["ncbi_tax_id"] = _merge_list_values(
        list(normalized.get("ncbi_tax_id") or []),
        list(normalized.get("taxonomy_ids") or []),
    )

    expanded_ontology_terms: list[str] = []
    for term in normalized.get("ontology_terms") or []:
        expanded_ontology_terms.extend(_expand_ontology_term_variants(str(term)))

    normalized["ontology_terms"] = _merge_list_values(
        list(normalized.get("ontology_terms") or []),
        expanded_ontology_terms,
    )

    return normalized


def _normalize_association_filters(filters: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(filters)
    expanded_ontology_terms: list[str] = []
    for term in normalized.get("ontology_terms") or []:
        expanded_ontology_terms.extend(_expand_ontology_term_variants(str(term)))

    normalized["association_annotation_terms"] = _merge_list_values(
        list(normalized.get("association_annotation_terms") or []),
        expanded_ontology_terms,
    )
    return normalized


def write_subset_parquet(
    parquet_path: Path,
    id_column: str,
    ids: list[str],
    output_path: Path,
    exclude_columns: list[str] | None = None,
) -> int:
    if not parquet_path.exists():
        raise FileNotFoundError(f"Missing parquet file: {parquet_path}")

    scan = pl.scan_parquet(str(parquet_path))
    schema_names = scan.collect_schema().names()
    if id_column not in schema_names:
        raise RuntimeError(
            f"Column '{id_column}' not found in {parquet_path.name}. "
            "Rebuild and reimport search data with the expected ID column."
        )

    exclude_columns = exclude_columns or []

    if not ids:
        empty_df = scan.limit(0).collect()
        drop_cols = [col for col in exclude_columns if col in empty_df.columns]
        if drop_cols:
            empty_df = empty_df.drop(drop_cols)
        empty_df.write_parquet(str(output_path), compression="zstd")
        return 0

    id_series = pl.Series(id_column, [str(value) for value in ids], dtype=pl.Utf8)
    df = scan.filter(pl.col(id_column).cast(pl.Utf8).is_in(id_series)).collect(streaming=True)
    drop_cols = [col for col in exclude_columns if col in df.columns]
    if drop_cols:
        df = df.drop(drop_cols)
    df.write_parquet(str(output_path), compression="zstd")
    return df.height


def _combine_and(expressions: list[pl.Expr]) -> pl.Expr | None:
    if not expressions:
        return None
    combined = expressions[0]
    for expr in expressions[1:]:
        combined = combined & expr
    return combined


def _combine_or(expressions: list[pl.Expr]) -> pl.Expr | None:
    if not expressions:
        return None
    combined = expressions[0]
    for expr in expressions[1:]:
        combined = combined | expr
    return combined


def _column_in_schema(schema_names: set[str], column: str) -> bool:
    return column in schema_names


def _scalar_in(column: str, values: list[str]) -> pl.Expr:
    return pl.col(column).cast(pl.Utf8).is_in(pl.Series(values, dtype=pl.Utf8))


def _list_contains_any(column: str, values: list[str]) -> pl.Expr:
    combined = _combine_or([pl.col(column).list.contains(value).fill_null(False) for value in values])
    return combined if combined is not None else pl.lit(False)


def _contains_query_scalar(column: str, query_lower: str) -> pl.Expr:
    return (
        pl.col(column)
        .cast(pl.Utf8)
        .str.to_lowercase()
        .str.contains(query_lower, literal=True)
        .fill_null(False)
    )


def _contains_query_list(column: str, query_lower: str) -> pl.Expr:
    return (
        pl.col(column)
        .list.eval(
            pl.element().cast(pl.Utf8).str.to_lowercase().str.contains(query_lower, literal=True),
            parallel=True,
        )
        .list.any()
        .fill_null(False)
    )


def _write_filtered_scan(
    scan: pl.LazyFrame,
    output_path: Path,
    filter_expression: pl.Expr | None,
    query_expression: pl.Expr | None,
    exclude_columns: list[str] | None = None,
) -> int:
    if filter_expression is not None:
        scan = scan.filter(filter_expression)
    if query_expression is not None:
        scan = scan.filter(query_expression)

    df = scan.collect(streaming=True)
    drop_cols = [col for col in (exclude_columns or []) if col in df.columns]
    if drop_cols:
        df = df.drop(drop_cols)
    df.write_parquet(str(output_path), compression="zstd")
    return df.height


def write_interaction_subset_parquet_direct(query: str, filters: dict[str, Any], output_path: Path) -> int:
    if not INTERACTIONS_PARQUET.exists():
        raise FileNotFoundError(f"Missing parquet file: {INTERACTIONS_PARQUET}")

    filters = _normalize_interaction_filters(filters)
    scan = pl.scan_parquet(str(INTERACTIONS_PARQUET))
    schema_names = set(scan.collect_schema().names())
    expressions: list[pl.Expr] = []

    raw_entity_ids = list(filters.get("entity_ids") or [])
    entity_ids = _normalize_id_list(raw_entity_ids)
    if raw_entity_ids and not entity_ids:
        return write_subset_parquet(INTERACTIONS_PARQUET, "interaction_id", [], output_path)
    if entity_ids and _column_in_schema(schema_names, "member_a_id") and _column_in_schema(schema_names, "member_b_id"):
        expr = _scalar_in("member_a_id", entity_ids) | _scalar_in("member_b_id", entity_ids)
        expressions.append(expr)

    raw_member_a_id = filters.get("member_a_id")
    member_a_id = _normalize_id(raw_member_a_id)
    if raw_member_a_id is not None and member_a_id is None:
        return write_subset_parquet(INTERACTIONS_PARQUET, "interaction_id", [], output_path)
    if member_a_id is not None and _column_in_schema(schema_names, "member_a_id") and _column_in_schema(schema_names, "member_b_id"):
        expr = _scalar_in("member_a_id", [member_a_id]) | _scalar_in("member_b_id", [member_a_id])
        expressions.append(expr)

    raw_member_b_id = filters.get("member_b_id")
    member_b_id = _normalize_id(raw_member_b_id)
    if raw_member_b_id is not None and member_b_id is None:
        return write_subset_parquet(INTERACTIONS_PARQUET, "interaction_id", [], output_path)
    if member_b_id is not None and _column_in_schema(schema_names, "member_a_id") and _column_in_schema(schema_names, "member_b_id"):
        expr = _scalar_in("member_a_id", [member_b_id]) | _scalar_in("member_b_id", [member_b_id])
        expressions.append(expr)

    interaction_types = [str(v) for v in (filters.get("interaction_types") or [])]
    if interaction_types and _column_in_schema(schema_names, "interaction_type"):
        expressions.append(_scalar_in("interaction_type", interaction_types))

    for bool_key in ("has_direction", "has_positive_sign", "has_negative_sign"):
        value = filters.get(bool_key)
        if value is not None and _column_in_schema(schema_names, bool_key):
            expressions.append(pl.col(bool_key) == bool(value))

    for key in (
        "interaction_annotation_terms",
        "participant_annotation_terms",
        "sources",
    ):
        values = [str(v) for v in (filters.get(key) or [])]
        if values and _column_in_schema(schema_names, key):
            expressions.append(_list_contains_any(key, values))

    query_expression: pl.Expr | None = None
    query_text = (query or "").strip()
    if query_text:
        query_lower = query_text.lower()
        query_exprs: list[pl.Expr] = []
        for col in ("interaction_id", "interaction_key", "member_a_id", "member_b_id", "interaction_type"):
            if _column_in_schema(schema_names, col):
                query_exprs.append(_contains_query_scalar(col, query_lower))
        for col in (
            "sources",
            "interaction_annotation_terms",
            "participant_annotation_terms",
        ):
            if _column_in_schema(schema_names, col):
                query_exprs.append(_contains_query_list(col, query_lower))
        query_expression = _combine_or(query_exprs)

    return _write_filtered_scan(scan, output_path, _combine_and(expressions), query_expression)


def write_entity_subset_parquet_direct(query: str, filters: dict[str, Any], output_path: Path) -> int:
    if not ENTITIES_PARQUET.exists():
        raise FileNotFoundError(f"Missing parquet file: {ENTITIES_PARQUET}")

    filters = _normalize_entity_filters(filters)
    scan = pl.scan_parquet(str(ENTITIES_PARQUET))
    schema_names = set(scan.collect_schema().names())
    expressions: list[pl.Expr] = []

    raw_entity_ids = list(filters.get("entity_ids") or [])
    entity_ids = _normalize_id_list(raw_entity_ids)
    if raw_entity_ids and not entity_ids:
        return write_subset_parquet(ENTITIES_PARQUET, "entity_id", [], output_path)
    if entity_ids and _column_in_schema(schema_names, "entity_id"):
        expressions.append(_scalar_in("entity_id", entity_ids))

    entity_types = [str(v) for v in (filters.get("entity_types") or [])]
    if entity_types and _column_in_schema(schema_names, "entity_type"):
        expressions.append(_scalar_in("entity_type", entity_types))

    sources = [str(v) for v in (filters.get("sources") or [])]
    if sources and _column_in_schema(schema_names, "sources"):
        expressions.append(_list_contains_any("sources", sources))

    ncbi_tax_ids = [str(v) for v in (filters.get("ncbi_tax_id") or [])]
    if ncbi_tax_ids and _column_in_schema(schema_names, "ncbi_tax_id"):
        expressions.append(_scalar_in("ncbi_tax_id", ncbi_tax_ids) | pl.col("ncbi_tax_id").is_null())

    ontology_terms = [str(v) for v in (filters.get("ontology_terms") or [])]
    if ontology_terms and _column_in_schema(schema_names, "ontology_terms"):
        expressions.append(_list_contains_any("ontology_terms", ontology_terms))

    query_expression: pl.Expr | None = None
    query_text = (query or "").strip()
    if query_text:
        query_lower = query_text.lower()
        query_exprs: list[pl.Expr] = []
        for col in ("entity_id", "entity_type", "ncbi_tax_id"):
            if _column_in_schema(schema_names, col):
                query_exprs.append(_contains_query_scalar(col, query_lower))
        for col in (
            "names",
            "synonyms",
            "gene_symbols",
            "descriptions",
            "references",
            "sources",
            "ontology_terms",
        ):
            if _column_in_schema(schema_names, col):
                query_exprs.append(_contains_query_list(col, query_lower))
        query_expression = _combine_or(query_exprs)

    return _write_filtered_scan(
        scan,
        output_path,
        _combine_and(expressions),
        query_expression,
    )


def write_association_subset_parquet_direct(query: str, filters: dict[str, Any], output_path: Path) -> int:
    if not ASSOCIATIONS_PARQUET.exists():
        raise FileNotFoundError(f"Missing parquet file: {ASSOCIATIONS_PARQUET}")

    filters = _normalize_association_filters(filters)
    scan = pl.scan_parquet(str(ASSOCIATIONS_PARQUET))
    schema_names = set(scan.collect_schema().names())
    expressions: list[pl.Expr] = []

    raw_parent_ids = list(filters.get("parent_entity_ids") or [])
    parent_ids = _normalize_id_list(raw_parent_ids)
    if raw_parent_ids and not parent_ids:
        return write_subset_parquet(ASSOCIATIONS_PARQUET, "association_id", [], output_path)
    if parent_ids and _column_in_schema(schema_names, "parent_entity_id"):
        expressions.append(_scalar_in("parent_entity_id", parent_ids))

    raw_member_ids = list(filters.get("member_entity_ids") or [])
    member_ids = _normalize_id_list(raw_member_ids)
    if raw_member_ids and not member_ids:
        return write_subset_parquet(ASSOCIATIONS_PARQUET, "association_id", [], output_path)
    if member_ids and _column_in_schema(schema_names, "member_entity_id"):
        expressions.append(_scalar_in("member_entity_id", member_ids))

    for key in ("parent_entity_types", "member_entity_types"):
        values = [str(v) for v in (filters.get(key) or [])]
        col = key[:-1] if key.endswith("s") else key
        if values and _column_in_schema(schema_names, col):
            expressions.append(_scalar_in(col, values))

    sources = [str(v) for v in (filters.get("sources") or [])]
    if sources and _column_in_schema(schema_names, "sources"):
        expressions.append(_list_contains_any("sources", sources))

    terms = [str(v) for v in (filters.get("association_annotation_terms") or [])]
    if terms and _column_in_schema(schema_names, "association_annotation_terms"):
        expressions.append(_list_contains_any("association_annotation_terms", terms))

    query_expression: pl.Expr | None = None
    query_text = (query or "").strip()
    if query_text:
        query_lower = query_text.lower()
        query_exprs: list[pl.Expr] = []
        for col in (
            "association_id",
            "association_key",
            "parent_entity_id",
            "member_entity_id",
            "parent_entity_type",
            "member_entity_type",
        ):
            if _column_in_schema(schema_names, col):
                query_exprs.append(_contains_query_scalar(col, query_lower))
        for col in ("sources", "association_annotation_terms"):
            if _column_in_schema(schema_names, col):
                query_exprs.append(_contains_query_list(col, query_lower))
        query_expression = _combine_or(query_exprs)

    return _write_filtered_scan(scan, output_path, _combine_and(expressions), query_expression)
