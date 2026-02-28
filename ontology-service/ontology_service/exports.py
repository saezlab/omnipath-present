"""Export helpers for Meilisearch-filtered Parquet subsets."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
import polars as pl

MEILI_HOST = os.getenv("MEILISEARCH_HOST", "http://localhost:7700")
MEILI_API_KEY = os.getenv("MEILISEARCH_API_KEY")
ONTOLOGY_DATA_DIR = os.getenv("ONTOLOGY_DATA_DIR", "./data")

INTERACTIONS_PARQUET = Path(ONTOLOGY_DATA_DIR) / "search_interactions.parquet"
ENTITIES_PARQUET = Path(ONTOLOGY_DATA_DIR) / "search_entities.parquet"
ASSOCIATIONS_PARQUET = Path(ONTOLOGY_DATA_DIR) / "search_associations.parquet"

DEFAULT_PAGE_SIZE = int(os.getenv("EXPORT_MEILI_PAGE_SIZE", "10000"))
MAX_EXPORT_HITS = int(os.getenv("EXPORT_MAX_HITS", "2000000"))


def _escape(value: str) -> str:
    return value.replace('"', '\\"')


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

    # Accept generic ontology term key as alias
    expanded_ontology_terms: list[str] = []
    for term in normalized.get("ontology_terms") or []:
        expanded_ontology_terms.extend(_expand_ontology_term_variants(str(term)))

    normalized["interaction_annotation_terms"] = _merge_list_values(
        list(normalized.get("interaction_annotation_terms") or []),
        expanded_ontology_terms,
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

    # Route generic ontology terms by prefix to cv_terms_* arrays.
    # If bare IDs are provided (e.g. GO:0005634), also include likely indexed variants.
    for term in normalized.get("ontology_terms") or []:
        term_str = str(term)
        if ":" not in term_str:
            continue

        expanded = _expand_ontology_term_variants(term_str)

        # Determine namespace from canonical ID when possible.
        # For already-expanded strings, fall back to containment checks.
        prefix = term_str.split(":", 1)[0].upper()
        if prefix not in {"GO", "MI", "OM", "HP", "KW"}:
            if ":GO:" in term_str:
                prefix = "GO"
            elif ":MI:" in term_str:
                prefix = "MI"
            elif ":OM:" in term_str:
                prefix = "OM"
            elif ":HP:" in term_str:
                prefix = "HP"
            elif ":KW:" in term_str:
                prefix = "KW"

        if prefix == "GO":
            normalized["cv_terms_go"] = _merge_list_values(normalized.get("cv_terms_go") or [], expanded)
        elif prefix == "MI":
            normalized["cv_terms_mi"] = _merge_list_values(normalized.get("cv_terms_mi") or [], expanded)
        elif prefix == "OM":
            normalized["cv_terms_om"] = _merge_list_values(normalized.get("cv_terms_om") or [], expanded)
        elif prefix == "HP":
            normalized["cv_terms_hp"] = _merge_list_values(normalized.get("cv_terms_hp") or [], expanded)
        elif prefix == "KW":
            normalized["cv_terms_kw"] = _merge_list_values(normalized.get("cv_terms_kw") or [], expanded)

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


def build_interaction_filter_string(filters: dict[str, Any]) -> str:
    filters = _normalize_interaction_filters(filters)
    parts: list[str] = []

    entity_ids = filters.get("entity_ids") or []
    if entity_ids:
        entity_filters = " OR ".join(
            f"(member_a_id = {int(entity_id)} OR member_b_id = {int(entity_id)})"
            for entity_id in entity_ids
        )
        parts.append(f"({entity_filters})")

    member_a_id = filters.get("member_a_id")
    if member_a_id is not None:
        member_a_id = int(member_a_id)
        parts.append(f"(member_a_id = {member_a_id} OR member_b_id = {member_a_id})")

    member_b_id = filters.get("member_b_id")
    if member_b_id is not None:
        member_b_id = int(member_b_id)
        parts.append(f"(member_a_id = {member_b_id} OR member_b_id = {member_b_id})")

    interaction_types = filters.get("interaction_types") or []
    if interaction_types:
        type_filters = " OR ".join(
            f'interaction_type = "{_escape(str(interaction_type))}"'
            for interaction_type in interaction_types
        )
        parts.append(f"({type_filters})")

    for bool_key in ("has_direction", "has_positive_sign", "has_negative_sign"):
        value = filters.get(bool_key)
        if value is not None:
            parts.append(f"{bool_key} = {'true' if bool(value) else 'false'}")

    interaction_annotation_terms = filters.get("interaction_annotation_terms") or []
    if interaction_annotation_terms:
        term_filters = " OR ".join(
            f'interaction_annotation_terms = "{_escape(str(term))}"'
            for term in interaction_annotation_terms
        )
        parts.append(f"({term_filters})")

    sources = filters.get("sources") or []
    if sources:
        source_filters = " OR ".join(
            f'sources = "{_escape(str(source))}"'
            for source in sources
        )
        parts.append(f"({source_filters})")

    return " AND ".join(parts)


def build_entity_filter_string(filters: dict[str, Any]) -> str:
    filters = _normalize_entity_filters(filters)
    parts: list[str] = []

    entity_ids = filters.get("entity_ids") or []
    if entity_ids:
        ids = ", ".join(str(int(entity_id)) for entity_id in entity_ids)
        parts.append(f"entity_id IN [{ids}]")

    entity_types = filters.get("entity_types") or []
    if entity_types:
        type_filters = " OR ".join(
            f'entity_type = "{_escape(str(entity_type))}"'
            for entity_type in entity_types
        )
        parts.append(f"({type_filters})")

    sources = filters.get("sources") or []
    if sources:
        source_filters = " OR ".join(
            f'sources = "{_escape(str(source))}"'
            for source in sources
        )
        parts.append(f"({source_filters})")

    ncbi_tax_ids = filters.get("ncbi_tax_id") or []
    if ncbi_tax_ids:
        tax_filters = " OR ".join(
            f'ncbi_tax_id = "{_escape(str(tax_id))}"'
            for tax_id in ncbi_tax_ids
        )
        parts.append(f"({tax_filters} OR ncbi_tax_id IS NULL)")

    for key in ("cv_terms_go", "cv_terms_mi", "cv_terms_om", "cv_terms_hp", "cv_terms_kw"):
        terms = filters.get(key) or []
        if terms:
            term_filters = " OR ".join(
                f'{key} = "{_escape(str(term))}"' for term in terms
            )
            parts.append(f"({term_filters})")

    return " AND ".join(parts)


def build_association_filter_string(filters: dict[str, Any]) -> str:
    filters = _normalize_association_filters(filters)
    parts: list[str] = []

    parent_entity_ids = filters.get("parent_entity_ids") or []
    if parent_entity_ids:
        parent_filters = " OR ".join(
            f"parent_entity_id = {int(entity_id)}" for entity_id in parent_entity_ids
        )
        parts.append(f"({parent_filters})")

    member_entity_ids = filters.get("member_entity_ids") or []
    if member_entity_ids:
        member_filters = " OR ".join(
            f"member_entity_id = {int(entity_id)}" for entity_id in member_entity_ids
        )
        parts.append(f"({member_filters})")

    parent_entity_types = filters.get("parent_entity_types") or []
    if parent_entity_types:
        parent_type_filters = " OR ".join(
            f'parent_entity_type = "{_escape(str(entity_type))}"' for entity_type in parent_entity_types
        )
        parts.append(f"({parent_type_filters})")

    member_entity_types = filters.get("member_entity_types") or []
    if member_entity_types:
        member_type_filters = " OR ".join(
            f'member_entity_type = "{_escape(str(entity_type))}"' for entity_type in member_entity_types
        )
        parts.append(f"({member_type_filters})")

    sources = filters.get("sources") or []
    if sources:
        source_filters = " OR ".join(
            f'sources = "{_escape(str(source))}"' for source in sources
        )
        parts.append(f"({source_filters})")

    association_annotation_terms = filters.get("association_annotation_terms") or []
    if association_annotation_terms:
        term_filters = " OR ".join(
            f'association_annotation_terms = "{_escape(str(term))}"' for term in association_annotation_terms
        )
        parts.append(f"({term_filters})")

    return " AND ".join(parts)


def fetch_matching_ids(index: str, id_field: str, query: str, filter_string: str) -> list[int]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if MEILI_API_KEY:
        headers["Authorization"] = f"Bearer {MEILI_API_KEY}"

    offset = 0
    found_ids: list[int] = []

    with httpx.Client(timeout=60.0) as client:
        while True:
            payload: dict[str, Any] = {
                "q": query,
                "limit": DEFAULT_PAGE_SIZE,
                "offset": offset,
                "attributesToRetrieve": [id_field],
            }
            if filter_string:
                payload["filter"] = filter_string

            response = client.post(
                f"{MEILI_HOST}/indexes/{index}/search",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

            hits = data.get("hits", [])
            if not hits:
                break

            for hit in hits:
                value = hit.get(id_field)
                if value is not None:
                    found_ids.append(int(value))

            if len(found_ids) > MAX_EXPORT_HITS:
                raise ValueError(
                    f"Export too large ({len(found_ids):,} rows). "
                    f"Maximum allowed is {MAX_EXPORT_HITS:,}."
                )

            estimated_total = int(data.get("estimatedTotalHits", 0))
            if len(hits) < DEFAULT_PAGE_SIZE:
                break
            if estimated_total and len(found_ids) >= estimated_total:
                break

            offset += DEFAULT_PAGE_SIZE

    seen: set[int] = set()
    deduped: list[int] = []
    for value in found_ids:
        if value not in seen:
            seen.add(value)
            deduped.append(value)

    return deduped


def write_subset_parquet(parquet_path: Path, id_column: str, ids: list[int], output_path: Path) -> int:
    if not parquet_path.exists():
        raise FileNotFoundError(f"Missing parquet file: {parquet_path}")

    scan = pl.scan_parquet(str(parquet_path))
    schema_names = scan.collect_schema().names()
    if id_column not in schema_names:
        raise RuntimeError(
            f"Column '{id_column}' not found in {parquet_path.name}. "
            "Rebuild and reimport search data with numeric IDs."
        )

    if not ids:
        empty_df = scan.limit(0).collect()
        empty_df.write_parquet(str(output_path), compression="zstd")
        return 0

    id_series = pl.Series(id_column, ids, dtype=pl.Int64)
    df = scan.filter(pl.col(id_column).is_in(id_series)).collect(streaming=True)
    df.write_parquet(str(output_path), compression="zstd")
    return df.height


def fetch_matching_interaction_ids(query: str, filters: dict[str, Any]) -> list[int]:
    return fetch_matching_ids(
        index="search_interactions",
        id_field="interaction_id",
        query=query,
        filter_string=build_interaction_filter_string(filters),
    )


def fetch_matching_entity_ids(query: str, filters: dict[str, Any]) -> list[int]:
    return fetch_matching_ids(
        index="search_entities",
        id_field="entity_id",
        query=query,
        filter_string=build_entity_filter_string(filters),
    )


def fetch_matching_association_ids(query: str, filters: dict[str, Any]) -> list[int]:
    return fetch_matching_ids(
        index="search_associations",
        id_field="association_id",
        query=query,
        filter_string=build_association_filter_string(filters),
    )


def write_interaction_subset_parquet(interaction_ids: list[int], output_path: Path) -> int:
    return write_subset_parquet(INTERACTIONS_PARQUET, "interaction_id", interaction_ids, output_path)


def write_entity_subset_parquet(entity_ids: list[int], output_path: Path) -> int:
    return write_subset_parquet(ENTITIES_PARQUET, "entity_id", entity_ids, output_path)


def write_association_subset_parquet(association_ids: list[int], output_path: Path) -> int:
    return write_subset_parquet(ASSOCIATIONS_PARQUET, "association_id", association_ids, output_path)
