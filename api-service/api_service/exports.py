"""Graph-native Parquet filtering and export helpers."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import polars as pl

PARQUET_DIR = Path(os.getenv("OMNIPATH_PARQUET_DIR", os.getenv("ONTOLOGY_DATA_DIR", "./data")))

ENTITY_PARQUET = PARQUET_DIR / "entity.parquet"
RELATIONS_PARQUET = PARQUET_DIR / "entity_relation.parquet"
RELATION_EVIDENCE_PARQUET = PARQUET_DIR / "entity_relation_evidence.parquet"
RELATION_ANNOTATION_TERM_PARQUET = PARQUET_DIR / "relation_annotation_term.parquet"
ONTOLOGY_TERM_PARQUET = PARQUET_DIR / "ontology_term.parquet"
RESOURCES_PARQUET = PARQUET_DIR / "resources.parquet"

VALID_RELATION_CATEGORIES = {"interaction", "membership", "annotation"}


def _require_file(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing parquet file: {path}")


def _normalize_strings(values: list[Any] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


def _normalize_ints(values: list[Any] | None) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()
    for value in values or []:
        if value is None or value == "":
            continue
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed in seen:
            continue
        seen.add(parsed)
        normalized.append(parsed)
    return normalized


def _get_any(filters: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        value = filters.get(key)
        if value not in (None, ""):
            return value
    return default


def _combine_and(expressions: list[pl.Expr]) -> pl.Expr | None:
    if not expressions:
        return None
    expr = expressions[0]
    for next_expr in expressions[1:]:
        expr = expr & next_expr
    return expr


def _combine_or(expressions: list[pl.Expr]) -> pl.Expr | None:
    if not expressions:
        return None
    expr = expressions[0]
    for next_expr in expressions[1:]:
        expr = expr | next_expr
    return expr


def _scalar_in(column: str, values: list[Any]) -> pl.Expr:
    return pl.col(column).is_in(values)


def _list_contains_any(column: str, values: list[str]) -> pl.Expr:
    expr = _combine_or([pl.col(column).list.contains(value).fill_null(False) for value in values])
    return expr if expr is not None else pl.lit(False)


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
        .list.eval(pl.element().cast(pl.Utf8).str.to_lowercase().str.contains(query_lower, literal=True), parallel=True)
        .list.any()
        .fill_null(False)
    )


def _contains_query_struct_list(column: str, field: str, query_lower: str) -> pl.Expr:
    return (
        pl.col(column)
        .list.eval(pl.element().struct.field(field).cast(pl.Utf8).str.to_lowercase().str.contains(query_lower, literal=True), parallel=True)
        .list.any()
        .fill_null(False)
    )


def _write_scan(scan: pl.LazyFrame, output_path: Path) -> int:
    df = scan.collect(streaming=True)
    df.write_parquet(str(output_path), compression="zstd")
    return df.height


def _entity_filter_expression(filters: dict[str, Any], query: str = "") -> pl.Expr | None:
    expressions: list[pl.Expr] = []

    entity_pks = _normalize_ints(_get_any(filters, "entity_pks", "entityPks", "entity_ids", default=[]))
    if entity_pks:
        expressions.append(_scalar_in("entity_pk", entity_pks))

    entity_types = _normalize_strings(_get_any(filters, "entity_types", "entityTypes", default=[]))
    if entity_types:
        expressions.append(_scalar_in("entity_type", entity_types))

    taxonomy_ids = _normalize_strings(_get_any(filters, "taxonomy_ids", "taxonomyIds", "ncbi_tax_id", default=[]))
    if taxonomy_ids:
        expressions.append(_scalar_in("taxonomy_id", taxonomy_ids))

    sources = _normalize_strings(filters.get("sources"))
    if sources:
        expressions.append(_list_contains_any("sources", sources))

    query_text = (query or "").strip().lower()
    if query_text:
        query_exprs = [
            _contains_query_scalar("entity_pk", query_text),
            _contains_query_scalar("canonical_identifier", query_text),
            _contains_query_scalar("canonical_identifier_type", query_text),
            _contains_query_scalar("entity_type", query_text),
            _contains_query_scalar("taxonomy_id", query_text),
            _contains_query_list("sources", query_text),
            _contains_query_struct_list("identifiers", "identifier", query_text),
            _contains_query_struct_list("identifiers", "identifier_type", query_text),
            _contains_query_struct_list("entity_attributes", "term", query_text),
            _contains_query_struct_list("entity_attributes", "value", query_text),
        ]
        expressions.append(_combine_or(query_exprs) or pl.lit(True))

    return _combine_and(expressions)


def filtered_entities_scan(query: str, filters: dict[str, Any]) -> pl.LazyFrame:
    _require_file(ENTITY_PARQUET)
    scan = pl.scan_parquet(str(ENTITY_PARQUET))
    expr = _entity_filter_expression(filters, query)
    return scan.filter(expr) if expr is not None else scan


def _relation_annotation_filter_scan(terms: list[str], scopes: list[str]) -> pl.LazyFrame | None:
    if not terms:
        return None
    _require_file(RELATION_ANNOTATION_TERM_PARQUET)
    annotation_scan = pl.scan_parquet(str(RELATION_ANNOTATION_TERM_PARQUET)).filter(pl.col("term_id").is_in(terms))
    if scopes:
        annotation_scan = annotation_scan.filter(pl.col("scope").is_in(scopes))
    return annotation_scan.select("relation_pk").unique()


def _relation_query_expression(query: str) -> pl.Expr | None:
    query_text = (query or "").strip().lower()
    if not query_text:
        return None
    return _combine_or([
        _contains_query_scalar("relation_pk", query_text),
        _contains_query_scalar("subject_entity_pk", query_text),
        _contains_query_scalar("object_entity_pk", query_text),
        _contains_query_scalar("predicate", query_text),
        _contains_query_scalar("relation_category", query_text),
        _contains_query_list("participant_types", query_text),
        _contains_query_list("sources", query_text),
    ])


def filtered_annotations_scan(query: str, filters: dict[str, Any]) -> pl.LazyFrame:
    _require_file(ONTOLOGY_TERM_PARQUET)
    scan = pl.scan_parquet(str(ONTOLOGY_TERM_PARQUET))
    expressions: list[pl.Expr] = []

    query_text = (query or "").strip().lower()
    if query_text:
        expressions.append(_combine_or([
            _contains_query_scalar("term_id", query_text),
            _contains_query_scalar("label", query_text),
            _contains_query_scalar("definition", query_text),
            _contains_query_scalar("ontology_prefix", query_text),
            _contains_query_list("synonyms", query_text),
            _contains_query_list("sources", query_text),
        ]) or pl.lit(True))

    prefixes = _normalize_strings(_get_any(filters, "prefixes", "ontology_prefixes", "ontologyPrefixes", default=[]))
    if prefixes:
        expressions.append(_scalar_in("ontology_prefix", prefixes))

    expr = _combine_and(expressions)
    if expr is not None:
        scan = scan.filter(expr)

    entity_pks = _normalize_ints(_get_any(filters, "entity_pks", "entityPks", default=[]))
    if entity_pks:
        _require_file(RELATIONS_PARQUET)
        scoped_terms = (
            pl.scan_parquet(str(RELATIONS_PARQUET))
            .filter(
                (pl.col("relation_category") == "annotation")
                & pl.col("subject_entity_pk").is_in(entity_pks)
            )
            .select(pl.col("object_entity_pk").alias("entity_pk"))
            .unique()
        )
        _require_file(ENTITY_PARQUET)
        scoped_term_ids = (
            pl.scan_parquet(str(ENTITY_PARQUET))
            .join(scoped_terms, on="entity_pk", how="semi")
            .select(pl.col("canonical_identifier").alias("term_id"))
            .unique()
        )
        scan = scan.join(scoped_term_ids, on="term_id", how="semi")

    return scan


def filtered_relations_scan(query: str, filters: dict[str, Any]) -> pl.LazyFrame:
    _require_file(RELATIONS_PARQUET)
    scan = pl.scan_parquet(str(RELATIONS_PARQUET))
    expressions: list[pl.Expr] = []

    relation_pks = _normalize_ints(_get_any(filters, "relation_pks", "relationPks", default=[]))
    if relation_pks:
        expressions.append(_scalar_in("relation_pk", relation_pks))

    subject_entity_pks = _normalize_ints(_get_any(filters, "subject_entity_pks", "subjectEntityPks", default=[]))
    if subject_entity_pks:
        expressions.append(_scalar_in("subject_entity_pk", subject_entity_pks))

    object_entity_pks = _normalize_ints(_get_any(filters, "object_entity_pks", "objectEntityPks", default=[]))
    if object_entity_pks:
        expressions.append(_scalar_in("object_entity_pk", object_entity_pks))

    entity_pks = _normalize_ints(_get_any(filters, "entity_pks", "entityPks", "entity_ids", default=[]))
    if entity_pks:
        expressions.append(_scalar_in("subject_entity_pk", entity_pks) | _scalar_in("object_entity_pk", entity_pks))

    predicates = _normalize_strings(filters.get("predicates"))
    predicates = [*predicates, *[value for value in _normalize_strings(filters.get("interaction_types")) if value not in predicates]]
    if predicates:
        expressions.append(_scalar_in("predicate", predicates))

    relation_categories = _normalize_strings(_get_any(filters, "relation_categories", "relationCategories", default=[]))
    invalid_categories = sorted(set(relation_categories) - VALID_RELATION_CATEGORIES)
    if invalid_categories:
        raise ValueError(f"Unsupported relation categories: {', '.join(invalid_categories)}")
    if relation_categories:
        expressions.append(_scalar_in("relation_category", relation_categories))

    participant_types = _normalize_strings(_get_any(filters, "participant_types", "participantTypes", default=[]))
    if participant_types:
        expressions.append(_list_contains_any("participant_types", participant_types))

    sources = _normalize_strings(filters.get("sources"))
    if sources:
        expressions.append(_list_contains_any("sources", sources))

    filter_expr = _combine_and(expressions)
    if filter_expr is not None:
        scan = scan.filter(filter_expr)

    query_expr = _relation_query_expression(query)
    if query_expr is not None:
        scan = scan.filter(query_expr)

    annotation_terms = _normalize_strings(_get_any(filters, "annotation_terms", "annotationTerms", "ontology_terms", "ontologyTerms", default=[]))
    annotation_scopes = _normalize_strings(_get_any(filters, "annotation_scopes", "annotationScopes", default=[]))
    annotation_relations = _relation_annotation_filter_scan(annotation_terms, annotation_scopes)
    if annotation_relations is not None:
        scan = scan.join(annotation_relations, on="relation_pk", how="semi")

    return scan


def write_entity_subset_parquet_direct(query: str, filters: dict[str, Any], output_path: Path) -> int:
    return _write_scan(filtered_entities_scan(query, filters), output_path)


def write_annotation_subset_parquet_direct(query: str, filters: dict[str, Any], output_path: Path) -> int:
    return _write_scan(filtered_annotations_scan(query, filters), output_path)


def write_relation_subset_parquet_direct(query: str, filters: dict[str, Any], output_path: Path) -> int:
    return _write_scan(filtered_relations_scan(query, filters), output_path)


def collect_entity_slice(query: str, filters: dict[str, Any], *, limit: int, offset: int) -> tuple[list[dict[str, Any]], int | None]:
    scan = filtered_entities_scan(query, filters)
    total = scan.select(pl.len().alias("total")).collect(streaming=True).item()
    rows = scan.slice(offset, limit).collect(streaming=True).to_dicts()
    return rows, int(total)


def collect_relation_slice(query: str, filters: dict[str, Any], *, limit: int, offset: int) -> tuple[list[dict[str, Any]], int | None]:
    scan = filtered_relations_scan(query, filters)
    total = scan.select(pl.len().alias("total")).collect(streaming=True).item()
    rows = scan.slice(offset, limit).collect(streaming=True).to_dicts()
    return rows, int(total)


def collect_relation_evidence(relation_pk: int) -> list[dict[str, Any]]:
    _require_file(RELATION_EVIDENCE_PARQUET)
    return (
        pl.scan_parquet(str(RELATION_EVIDENCE_PARQUET))
        .filter(pl.col("relation_pk") == int(relation_pk))
        .collect(streaming=True)
        .to_dicts()
    )


def collect_relation_evidence_by_pk(relation_evidence_pk: int) -> dict[str, Any] | None:
    _require_file(RELATION_EVIDENCE_PARQUET)
    df = (
        pl.scan_parquet(str(RELATION_EVIDENCE_PARQUET))
        .filter(pl.col("relation_evidence_pk") == int(relation_evidence_pk))
        .limit(1)
        .collect(streaming=True)
    )
    if df.is_empty():
        return None
    return df.row(0, named=True)
