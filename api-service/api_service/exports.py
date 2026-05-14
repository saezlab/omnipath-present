"""Graph-native Parquet filtering and export helpers."""

from __future__ import annotations

import json
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import polars as pl

from .resource_downloads import DownloadArtifact

PARQUET_DIR = Path(os.getenv("OMNIPATH_PARQUET_DIR", os.getenv("ONTOLOGY_DATA_DIR", "./data")))

ENTITY_PARQUET = PARQUET_DIR / "entity.parquet"
RELATIONS_PARQUET = PARQUET_DIR / "entity_relation.parquet"
RELATION_EVIDENCE_PARQUET = PARQUET_DIR / "entity_relation_evidence.parquet"
RELATION_ANNOTATION_TERM_PARQUET = PARQUET_DIR / "relation_annotation_term.parquet"
ONTOLOGY_TERM_PARQUET = PARQUET_DIR / "ontology_term.parquet"
RESOURCES_PARQUET = PARQUET_DIR / "resources.parquet"

VALID_RELATION_CATEGORIES = {"interaction", "association"}


def _require_file(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing parquet file: {path}")


def _first_existing(columns: set[str], *candidates: str) -> str:
    for candidate in candidates:
        if candidate in columns:
            return candidate
    raise ValueError(f"Expected one of {', '.join(candidates)}; found columns: {', '.join(sorted(columns))}")


def _scan_column(scan: pl.LazyFrame, *candidates: str) -> str:
    return _first_existing(set(scan.collect_schema().names()), *candidates)


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


def _entity_filter_expression(filters: dict[str, Any], query: str = "", *, entity_id_col: str = "entity_pk") -> pl.Expr | None:
    expressions: list[pl.Expr] = []

    entity_pks = _normalize_ints(_get_any(filters, "entity_pks", "entityPks", "entity_ids", "entityIds", default=[]))
    if entity_pks:
        expressions.append(_scalar_in(entity_id_col, entity_pks))

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
            _contains_query_scalar(entity_id_col, query_text),
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
    entity_id_col = _scan_column(scan, "entity_pk", "entity_id")
    expr = _entity_filter_expression(filters, query, entity_id_col=entity_id_col)
    return scan.filter(expr) if expr is not None else scan


def _relation_annotation_filter_scan(terms: list[str], scopes: list[str], *, relation_id_col: str) -> pl.LazyFrame | None:
    if not terms:
        return None
    _require_file(RELATION_ANNOTATION_TERM_PARQUET)
    annotation_scan = pl.scan_parquet(str(RELATION_ANNOTATION_TERM_PARQUET))
    annotation_columns = set(annotation_scan.collect_schema().names())
    annotation_relation_col = _first_existing(annotation_columns, "relation_pk", "relation_id")

    if "term_id" in annotation_columns:
        annotation_scan = annotation_scan.filter(pl.col("term_id").is_in(terms))
    elif "term_entity_pk" in annotation_columns or "term_entity_id" in annotation_columns:
        annotation_term_col = _first_existing(annotation_columns, "term_entity_pk", "term_entity_id")
        _require_file(ENTITY_PARQUET)
        entity_scan = pl.scan_parquet(str(ENTITY_PARQUET))
        entity_id_col = _scan_column(entity_scan, "entity_pk", "entity_id")
        term_entity_pks = _normalize_ints(terms)
        term_ids = _normalize_strings(terms)
        term_exprs: list[pl.Expr] = []
        if term_entity_pks:
            term_exprs.append(pl.col(entity_id_col).is_in(term_entity_pks))
        if term_ids:
            term_exprs.append(pl.col("canonical_identifier").is_in(term_ids))
        term_expr = _combine_or(term_exprs)
        if term_expr is None:
            return None
        term_entities = (
            entity_scan
            .filter(term_expr)
            .select(pl.col(entity_id_col).alias(annotation_term_col))
            .unique()
        )
        annotation_scan = annotation_scan.join(term_entities, on=annotation_term_col, how="semi")
    else:
        raise ValueError("relation annotation parquet must contain either term_id, term_entity_pk, or term_entity_id")

    if scopes:
        annotation_scan = annotation_scan.filter(pl.col("scope").is_in(scopes))
    return annotation_scan.select(pl.col(annotation_relation_col).alias(relation_id_col)).unique()


def _relation_query_expression(query: str, *, relation_id_col: str, subject_col: str, object_col: str) -> pl.Expr | None:
    query_text = (query or "").strip().lower()
    if not query_text:
        return None
    return _combine_or([
        _contains_query_scalar(relation_id_col, query_text),
        _contains_query_scalar(subject_col, query_text),
        _contains_query_scalar(object_col, query_text),
        _contains_query_scalar("predicate", query_text),
        _contains_query_scalar("relation_category", query_text),
        _contains_query_list("participant_types", query_text),
        _contains_query_list("sources", query_text),
    ])


def _annotation_terms_scan() -> pl.LazyFrame:
    if ONTOLOGY_TERM_PARQUET.exists():
        return pl.scan_parquet(str(ONTOLOGY_TERM_PARQUET))

    _require_file(ENTITY_PARQUET)
    return (
        pl.scan_parquet(str(ENTITY_PARQUET))
        .filter(pl.col("entity_type") == "OM:0012:Cv Term")
        .select(
            pl.col(_scan_column(pl.scan_parquet(str(ENTITY_PARQUET)), "entity_pk", "entity_id")).alias("term_entity_pk"),
            pl.col("canonical_identifier").alias("term_id"),
            pl.col("canonical_identifier").str.split(":").list.first().alias("ontology_prefix"),
            pl.col("entity_attributes")
            .list.eval(
                pl.when(pl.element().struct.field("term") == "OM:0803:Ontology Id")
                .then(pl.element().struct.field("value"))
                .otherwise(None),
                parallel=True,
            )
            .list.drop_nulls()
            .list.first()
            .alias("ontology_id"),
            pl.col("identifiers")
            .list.eval(
                pl.when(pl.element().struct.field("identifier_type") == "OM:0202:Name")
                .then(pl.element().struct.field("identifier"))
                .otherwise(None),
                parallel=True,
            )
            .list.drop_nulls()
            .list.first()
            .alias("label"),
            pl.col("entity_attributes")
            .list.eval(
                pl.when(pl.element().struct.field("term") == "OM:0801:Definition")
                .then(pl.element().struct.field("value"))
                .otherwise(None),
                parallel=True,
            )
            .list.drop_nulls()
            .list.first()
            .alias("definition"),
            pl.col("identifiers")
            .list.eval(
                pl.when(pl.element().struct.field("identifier_type") == "OM:0203:Synonym")
                .then(pl.element().struct.field("identifier"))
                .otherwise(None),
                parallel=True,
            )
            .list.drop_nulls()
            .alias("synonyms"),
            pl.col("sources"),
        )
    )


def filtered_annotations_scan(query: str, filters: dict[str, Any]) -> pl.LazyFrame:
    scan = _annotation_terms_scan()
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
        expressions.append(pl.col("ontology_prefix").str.to_lowercase().is_in([prefix.lower() for prefix in prefixes]))

    expr = _combine_and(expressions)
    if expr is not None:
        scan = scan.filter(expr)

    entity_pks = _normalize_ints(_get_any(filters, "entity_pks", "entityPks", "entity_ids", "entityIds", default=[]))
    if entity_pks:
        _require_file(RELATIONS_PARQUET)
        relation_base = pl.scan_parquet(str(RELATIONS_PARQUET))
        relation_subject_col = _scan_column(relation_base, "subject_entity_pk", "subject_entity_id")
        relation_object_col = _scan_column(relation_base, "object_entity_pk", "object_entity_id")
        scoped_terms = (
            relation_base
            .filter(
                (pl.col("relation_category") == "association")
                & pl.col(relation_subject_col).is_in(entity_pks)
            )
            .select(pl.col(relation_object_col).alias("term_entity_pk"))
            .unique()
        )
        scan_columns = set(scan.collect_schema().names())
        if "term_entity_pk" in scan_columns:
            scan = scan.join(scoped_terms, on="term_entity_pk", how="semi")
        else:
            _require_file(ENTITY_PARQUET)
            entity_base = pl.scan_parquet(str(ENTITY_PARQUET))
            entity_id_col = _scan_column(entity_base, "entity_pk", "entity_id")
            scoped_term_ids = (
                entity_base
                .join(scoped_terms.rename({"term_entity_pk": entity_id_col}), on=entity_id_col, how="semi")
                .select(pl.col("canonical_identifier").alias("term_id"))
                .unique()
            )
            scan = scan.join(scoped_term_ids, on="term_id", how="semi")

    return scan


def filtered_relations_scan(query: str, filters: dict[str, Any]) -> pl.LazyFrame:
    _require_file(RELATIONS_PARQUET)
    scan = pl.scan_parquet(str(RELATIONS_PARQUET))
    columns = set(scan.collect_schema().names())
    relation_id_col = _first_existing(columns, "relation_pk", "relation_id")
    subject_col = _first_existing(columns, "subject_entity_pk", "subject_entity_id")
    object_col = _first_existing(columns, "object_entity_pk", "object_entity_id")
    expressions: list[pl.Expr] = []

    relation_pks = _normalize_ints(_get_any(filters, "relation_pks", "relationPks", "relation_ids", "relationIds", default=[]))
    if relation_pks:
        expressions.append(_scalar_in(relation_id_col, relation_pks))

    subject_entity_pks = _normalize_ints(_get_any(filters, "subject_entity_pks", "subjectEntityPks", "subject_entity_ids", "subjectEntityIds", default=[]))
    if subject_entity_pks:
        expressions.append(_scalar_in(subject_col, subject_entity_pks))

    object_entity_pks = _normalize_ints(_get_any(filters, "object_entity_pks", "objectEntityPks", "object_entity_ids", "objectEntityIds", default=[]))
    if object_entity_pks:
        expressions.append(_scalar_in(object_col, object_entity_pks))

    entity_pks = _normalize_ints(_get_any(filters, "entity_pks", "entityPks", "entity_ids", "entityIds", default=[]))
    if entity_pks:
        expressions.append(_scalar_in(subject_col, entity_pks) | _scalar_in(object_col, entity_pks))

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

    query_expr = _relation_query_expression(query, relation_id_col=relation_id_col, subject_col=subject_col, object_col=object_col)
    if query_expr is not None:
        scan = scan.filter(query_expr)

    annotation_terms = _normalize_strings(_get_any(filters, "annotation_terms", "annotationTerms", "ontology_terms", "ontologyTerms", default=[]))
    annotation_scopes = _normalize_strings(_get_any(filters, "annotation_scopes", "annotationScopes", default=[]))
    annotation_relations = _relation_annotation_filter_scan(annotation_terms, annotation_scopes, relation_id_col=relation_id_col)
    if annotation_relations is not None:
        scan = scan.join(annotation_relations, on=relation_id_col, how="semi")

    return scan


def _sanitize_download_name(name: str | None, default: str) -> str:
    text = (name or default).strip().replace("/", "_").replace("\\", "_")
    return text or default


def _relations_scoped_by_entities_scan(
    *,
    entity_filters: dict[str, Any],
    relation_filters: dict[str, Any],
    require_both_participants_in_entity_scope: bool,
) -> pl.LazyFrame:
    entity_base = filtered_entities_scan("", entity_filters)
    entity_id_col = _scan_column(entity_base, "entity_pk", "entity_id")
    entity_scope = entity_base.select(entity_id_col).unique()
    relation_scan = filtered_relations_scan("", relation_filters or {})
    relation_id_col = _scan_column(relation_scan, "relation_pk", "relation_id")
    subject_col = _scan_column(relation_scan, "subject_entity_pk", "subject_entity_id")
    object_col = _scan_column(relation_scan, "object_entity_pk", "object_entity_id")

    subject_scope = entity_scope.rename({entity_id_col: subject_col})
    object_scope = entity_scope.rename({entity_id_col: object_col})

    if require_both_participants_in_entity_scope:
        return relation_scan.join(subject_scope, on=subject_col, how="semi").join(object_scope, on=object_col, how="semi")

    subject_matches = relation_scan.join(subject_scope, on=subject_col, how="semi")
    object_matches = relation_scan.join(object_scope, on=object_col, how="semi")
    return pl.concat([subject_matches, object_matches]).unique(subset=[relation_id_col])


def _relations_with_evidence_scan(relations_scan: pl.LazyFrame) -> pl.LazyFrame:
    _require_file(RELATION_EVIDENCE_PARQUET)
    relation_id_col = _scan_column(relations_scan, "relation_pk", "relation_id")
    selected_relation_ids = relations_scan.select(relation_id_col).unique()

    evidence_scan = pl.scan_parquet(str(RELATION_EVIDENCE_PARQUET))
    evidence_relation_id_col = _scan_column(evidence_scan, "relation_pk", "relation_id")
    evidence_columns = evidence_scan.collect_schema().names()
    evidence_payload_cols = [column for column in evidence_columns if column != evidence_relation_id_col]
    evidence_by_relation = (
        evidence_scan
        .join(selected_relation_ids.rename({relation_id_col: evidence_relation_id_col}), on=evidence_relation_id_col, how="semi")
        .group_by(evidence_relation_id_col)
        .agg(pl.struct(evidence_payload_cols).alias("evidence"))
        .rename({evidence_relation_id_col: relation_id_col})
    )
    return relations_scan.join(evidence_by_relation, on=relation_id_col, how="left")


def _participant_entities_scan(relations_scan: pl.LazyFrame) -> pl.LazyFrame:
    _require_file(ENTITY_PARQUET)
    entity_base = pl.scan_parquet(str(ENTITY_PARQUET))
    entity_id_col = _scan_column(entity_base, "entity_pk", "entity_id")
    subject_col = _scan_column(relations_scan, "subject_entity_pk", "subject_entity_id")
    object_col = _scan_column(relations_scan, "object_entity_pk", "object_entity_id")
    participant_pks = pl.concat([
        relations_scan.select(pl.col(subject_col).alias(entity_id_col)),
        relations_scan.select(pl.col(object_col).alias(entity_id_col)),
    ]).unique()
    return entity_base.join(participant_pks, on=entity_id_col, how="semi")


def _annotations_for_entity_scope_scan(entity_scope: pl.LazyFrame) -> pl.LazyFrame:
    scan = _annotation_terms_scan()
    _require_file(RELATIONS_PARQUET)
    relation_base = pl.scan_parquet(str(RELATIONS_PARQUET))
    relation_subject_col = _scan_column(relation_base, "subject_entity_pk", "subject_entity_id")
    relation_object_col = _scan_column(relation_base, "object_entity_pk", "object_entity_id")
    entity_id_col = _scan_column(entity_scope, "entity_pk", "entity_id")
    scoped_terms = (
        relation_base
        .filter(pl.col("relation_category") == "association")
        .join(entity_scope.select(entity_id_col).rename({entity_id_col: relation_subject_col}), on=relation_subject_col, how="semi")
        .select(pl.col(relation_object_col).alias("term_entity_pk"))
        .unique()
    )

    scan_columns = set(scan.collect_schema().names())
    if "term_entity_pk" in scan_columns:
        return scan.join(scoped_terms, on="term_entity_pk", how="semi")

    _require_file(ENTITY_PARQUET)
    entity_base = pl.scan_parquet(str(ENTITY_PARQUET))
    term_entity_id_col = _scan_column(entity_base, "entity_pk", "entity_id")
    scoped_term_ids = (
        entity_base
        .join(scoped_terms.rename({"term_entity_pk": term_entity_id_col}), on=term_entity_id_col, how="semi")
        .select(pl.col("canonical_identifier").alias("term_id"))
        .unique()
    )
    return scan.join(scoped_term_ids, on="term_id", how="semi")


def build_relation_context_zip(
    *,
    filters: dict[str, Any],
    require_both_participants_in_entity_scope: bool = True,
    include_annotations: bool = True,
    include_evidence: bool = True,
    filename: str | None = None,
) -> tuple[DownloadArtifact, dict[str, Any]]:
    """Build a zip with scoped relations, participating entities, annotations, and a manifest."""
    prefix = _sanitize_download_name(filename, "relation_context")
    filters = filters or {}
    temp_zip = tempfile.NamedTemporaryFile(prefix=f"{prefix}_", suffix=".zip", delete=False)
    zip_path = Path(temp_zip.name)
    temp_zip.close()

    scoped_relations_scan = _relations_scoped_by_entities_scan(
        entity_filters=filters,
        relation_filters=filters,
        require_both_participants_in_entity_scope=require_both_participants_in_entity_scope,
    )
    relations_scan = _relations_with_evidence_scan(scoped_relations_scan) if include_evidence else scoped_relations_scan
    entities_scan = _participant_entities_scan(scoped_relations_scan)
    annotations_scan = _annotations_for_entity_scope_scan(entities_scan) if include_annotations else None

    with tempfile.TemporaryDirectory(prefix="relation_context_") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        relations_path = temp_dir / "relations.parquet"
        entities_path = temp_dir / "entities.parquet"
        annotations_path = temp_dir / "annotations.parquet"
        manifest_path = temp_dir / "manifest.json"

        relations_count = _write_scan(relations_scan, relations_path)
        entities_count = _write_scan(entities_scan, entities_path)
        annotations_count = _write_scan(annotations_scan, annotations_path) if annotations_scan is not None else 0

        manifest: dict[str, Any] = {
            "filters": filters,
            "require_both_participants_in_entity_scope": require_both_participants_in_entity_scope,
            "include_annotations": include_annotations,
            "include_evidence": include_evidence,
            "relations_count": relations_count,
            "entities_count": entities_count,
            "annotations_count": annotations_count,
            "files": ["relations.parquet", "entities.parquet", *(["annotations.parquet"] if include_annotations else []), "manifest.json"],
        }
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

        with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(relations_path, arcname="relations.parquet")
            zf.write(entities_path, arcname="entities.parquet")
            if include_annotations:
                zf.write(annotations_path, arcname="annotations.parquet")
            zf.write(manifest_path, arcname="manifest.json")

    return DownloadArtifact(path=zip_path, media_type="application/zip", filename=f"{prefix}.zip", is_temporary=True), manifest


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
    scan = pl.scan_parquet(str(RELATION_EVIDENCE_PARQUET))
    relation_id_col = _scan_column(scan, "relation_pk", "relation_id")
    return (
        scan
        .filter(pl.col(relation_id_col) == int(relation_pk))
        .collect(streaming=True)
        .to_dicts()
    )


def collect_relation_evidence_by_pk(relation_evidence_pk: int) -> dict[str, Any] | None:
    _require_file(RELATION_EVIDENCE_PARQUET)
    scan = pl.scan_parquet(str(RELATION_EVIDENCE_PARQUET))
    relation_evidence_id_col = _scan_column(scan, "relation_evidence_pk", "relation_evidence_id")
    df = (
        scan
        .filter(pl.col(relation_evidence_id_col) == int(relation_evidence_pk))
        .limit(1)
        .collect(streaming=True)
    )
    if df.is_empty():
        return None
    return df.row(0, named=True)
