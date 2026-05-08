from pathlib import Path

import polars as pl

from api_service import exports


def _write_graph_parquets(tmp_path: Path):
    entity_path = tmp_path / "entity.parquet"
    relation_path = tmp_path / "entity_relation.parquet"
    relation_annotation_path = tmp_path / "relation_annotation_term.parquet"

    pl.DataFrame([
        {
            "entity_pk": 10,
            "canonical_identifier": "GO:0000001",
            "canonical_identifier_type": "OM:0204:Cv Term Accession",
            "identifiers": [
                {"identifier": "mitochondrion inheritance", "identifier_type": "OM:0202:Name"},
                {"identifier": "mitochondrial inheritance", "identifier_type": "OM:0203:Synonym"},
            ],
            "entity_type": "OM:0012:Cv Term",
            "taxonomy_id": None,
            "entity_attributes": [
                {"term": "OM:0803:Ontology Id", "value": "gene_ontology", "unit": None},
                {"term": "OM:0801:Definition", "value": "Test definition", "unit": None},
            ],
            "sources": ["go"],
        },
        {
            "entity_pk": 20,
            "canonical_identifier": "P12345",
            "canonical_identifier_type": "uniprot",
            "identifiers": [],
            "entity_type": "protein",
            "taxonomy_id": "9606",
            "entity_attributes": [],
            "sources": ["test"],
        },
    ]).write_parquet(entity_path)

    pl.DataFrame([
        {"relation_pk": 1, "subject_entity_pk": 20, "predicate": "x", "object_entity_pk": 20, "relation_category": "interaction", "participant_types": ["protein"], "evidence_count": 1, "sources": ["test"]},
        {"relation_pk": 2, "subject_entity_pk": 20, "predicate": "associated_with", "object_entity_pk": 10, "relation_category": "association", "participant_types": ["OM:0012:Cv Term"], "evidence_count": 1, "sources": ["go"]},
    ]).write_parquet(relation_path)

    pl.DataFrame([
        {"relation_pk": 2, "relation_evidence_pk": 100, "source": "go", "scope": "participants", "term_entity_pk": 10},
    ]).write_parquet(relation_annotation_path)

    return entity_path, relation_path, relation_annotation_path


def test_relation_annotation_filter_uses_term_entity_pk_parquet(tmp_path, monkeypatch):
    entity_path, relation_path, relation_annotation_path = _write_graph_parquets(tmp_path)
    monkeypatch.setattr(exports, "ENTITY_PARQUET", entity_path)
    monkeypatch.setattr(exports, "RELATIONS_PARQUET", relation_path)
    monkeypatch.setattr(exports, "RELATION_ANNOTATION_TERM_PARQUET", relation_annotation_path)

    rows, total = exports.collect_relation_slice(
        "",
        {"annotation_terms": ["GO:0000001"], "annotation_scopes": ["participants"]},
        limit=10,
        offset=0,
    )

    assert total == 1
    assert [row["relation_pk"] for row in rows] == [2]


def test_annotation_export_falls_back_to_cv_term_entities(tmp_path, monkeypatch):
    entity_path, relation_path, relation_annotation_path = _write_graph_parquets(tmp_path)
    monkeypatch.setattr(exports, "ENTITY_PARQUET", entity_path)
    monkeypatch.setattr(exports, "RELATIONS_PARQUET", relation_path)
    monkeypatch.setattr(exports, "RELATION_ANNOTATION_TERM_PARQUET", relation_annotation_path)
    monkeypatch.setattr(exports, "ONTOLOGY_TERM_PARQUET", tmp_path / "missing_ontology_term.parquet")

    output_path = tmp_path / "annotations.parquet"
    row_count = exports.write_annotation_subset_parquet_direct("", {"prefixes": ["go"]}, output_path)
    df = pl.read_parquet(output_path)

    assert row_count == 1
    assert df.row(0, named=True)["term_id"] == "GO:0000001"
    assert df.row(0, named=True)["label"] == "mitochondrion inheritance"
