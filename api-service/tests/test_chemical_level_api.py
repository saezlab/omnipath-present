"""Chemical resolution-level serving, and the selectable-level mechanism.

Mock-based tests assert the param plumbing and routing; the integration tests
(gated on ``DATABASE_URL``) run the real SQL against a built database's
``chemical_resolution_relation`` / ``chemical_resolution_level`` tables.
"""

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from api_service.main import app

    return TestClient(app)


# ---------------------------------------------------------------------------
# Wiring (mocked)
# ---------------------------------------------------------------------------


def test_get_relations_search_passes_chemical_level(client):
    with patch("api_service.graph.search_relations") as mock_search:
        mock_search.return_value = {"relations": [], "total": 0}
        client.get(
            "/relations/search",
            params={"chemicalLevel": "connectivity", "outputLayout": "entity"},
        )
    payload = mock_search.call_args.args[0]
    assert payload["chemicalLevel"] == "connectivity"
    assert payload["outputLayout"] == "entity"


def test_search_relations_routes_to_chemical_path():
    from api_service import graph

    with patch.object(graph, "_search_chemical_level_relations") as mock_chem:
        mock_chem.return_value = {"relations": [], "total": 0}
        graph.search_relations({"chemicalLevel": "full", "filters": {}})
    assert mock_chem.called
    assert mock_chem.call_args.args[2] == "full"


def test_levels_endpoint(client):
    with patch("api_service.graph.selectable_levels") as mock_levels:
        mock_levels.return_value = {
            "chemicalStructure": {"levels": [{"name": "connectivity"}]},
            "entityLayout": {"layouts": ["entity", "gene", "protein", "state"]},
        }
        response = client.get("/levels")
    assert response.status_code == 200
    data = response.json()
    assert "chemicalStructure" in data
    assert "entityLayout" in data


# ---------------------------------------------------------------------------
# Integration (needs DATABASE_URL → a built database with the resolution tables)
# ---------------------------------------------------------------------------

DATABASE_URL = os.environ.get("DATABASE_URL")

pg = pytest.mark.skipif(
    not DATABASE_URL,
    reason="DATABASE_URL not set; chemical-level API test needs a built DB",
)


@pg
def test_selectable_levels_lists_chemical_levels():
    from api_service.graph import selectable_levels

    levels = selectable_levels()
    names = [lvl["name"] for lvl in levels["chemicalStructure"]["levels"]]
    assert names == ["connectivity", "stereo_isotope_tautomer", "full"]
    assert levels["entityLayout"]["default"] == "entity"


@pg
def test_chemical_level_serving_returns_collapsed_edges():
    from api_service.graph import search_relations

    result = search_relations(
        {"chemicalLevel": "connectivity", "limit": 5, "includeEntities": True}
    )
    assert result["chemicalLevel"] == "connectivity"
    assert result["outputLayout"] == "entity"
    assert result["total"] > 0
    assert len(result["relations"]) > 0
    rel = result["relations"][0]
    # API shape parity with base relations.
    for key in ("relationPk", "subjectEntityPk", "predicate", "objectEntityPk", "sources"):
        assert key in rel


@pg
def test_unknown_chemical_level_is_reported():
    from api_service.graph import search_relations

    result = search_relations({"chemicalLevel": "does_not_exist", "limit": 1})
    assert result["total"] == 0
    assert "error" in result
