"""Tests for ontology service API."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch


@pytest.fixture
def mock_registry():
    """Create a mock registry that doesn't load real ontologies."""
    import api_service.main  # noqa: F401

    with patch("api_service.main.registry") as mock:
        # Setup mock client
        mock_client = MagicMock()
        mock_term = MagicMock()
        mock_term.id = "MI:0018"
        mock_term.name = "two hybrid"
        mock_term.definition = "Test definition"
        mock_term.namespace = "PSI-MI"
        
        mock_client.get_term.return_value = mock_term
        mock_client.get_parents.return_value = ["MI:0001"]
        mock_client.get_ancestors.return_value = ["MI:0001", "MI:0000"]
        mock_client.get_children.return_value = ["MI:0019"]
        mock_client.get_descendants.return_value = ["MI:0019", "MI:0020"]
        mock_client.get_trajectories_from_root.return_value = [
            [
                {"id": "MI:0000", "name": "root", "distance": -2},
                {"id": "MI:0001", "name": "parent", "distance": -1},
                {"id": "MI:0018", "name": "two hybrid", "distance": 0},
            ]
        ]
        
        mock.get.return_value = mock_client
        mock.list_available.return_value = {"psi_mi": "PSI-MI CV"}
        mock.is_loaded.return_value = True
        
        yield mock


@pytest.fixture
def client(mock_registry):
    """Create test client with mocked registry."""
    # Import after patching
    from api_service.main import app
    return TestClient(app)


def test_health(client):
    """Test health endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_list_ontologies(client):
    """Test ontologies listing."""
    response = client.get("/ontologies")
    assert response.status_code == 200
    data = response.json()
    assert "ontologies" in data
    assert len(data["ontologies"]) > 0


def test_get_term(client):
    """Test single term lookup."""
    response = client.get("/psi_mi/term/MI:0018")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == "MI:0018"
    assert data["name"] == "two hybrid"


def test_get_term_not_found(client, mock_registry):
    """Test 404 for non-existent term."""
    mock_registry.get.return_value.get_term.return_value = None
    response = client.get("/psi_mi/term/MI:9999")
    assert response.status_code == 404


def test_get_parents(client):
    """Test parents endpoint."""
    response = client.get("/psi_mi/term/MI:0018/parents")
    assert response.status_code == 200
    data = response.json()
    assert "parents" in data
    assert "MI:0001" in data["parents"]


def test_get_ancestors(client):
    """Test ancestors endpoint."""
    response = client.get("/psi_mi/term/MI:0018/ancestors")
    assert response.status_code == 200
    data = response.json()
    assert "ancestors" in data


def test_get_ancestors_with_depth(client):
    """Test ancestors with depth limit."""
    response = client.get("/psi_mi/term/MI:0018/ancestors?depth=1")
    assert response.status_code == 200


def test_batch_terms(client):
    """Test batch term lookup with auto-detection."""
    response = client.post(
        "/terms",
        json={"term_ids": ["MI:0018", "MI:0045"]}
    )
    assert response.status_code == 200
    data = response.json()
    assert "terms" in data


def test_get_ontology_for_kegg_pathway_terms():
    """Test KEGG pathway ontology auto-detection."""
    from api_service.config import get_ontology_for_term

    for term_id in [
        "map01100",
        "rn01100",
        "ko01100",
        "hsa01100",
        "mmu01100",
        "KEGG_PATHWAY_CATEGORY:metabolism",
        "br08901",
    ]:
        assert get_ontology_for_term(term_id) == "kegg_pathways"


def test_search_terms_by_name(client):
    """Test ontology term lookup by human-readable name."""
    from api_service.main import TermSearchMatch

    with patch("api_service.main.search_terms_by_name") as mock_search:
        mock_search.return_value = [
            TermSearchMatch(
                id="MI:0203",
                name="dephosphorylation reaction",
                definition="Test definition",
                namespace=None,
                ontology_id="omnipath",
                matched_text="dephosphorylation",
                match_type="exact",
                score=1000,
            )
        ]

        response = client.post(
            "/terms/search",
            json={"queries": ["dephosphorylation"], "prefixes": ["MI"], "limit": 5}
        )

    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert "dephosphorylation" in data["results"]
    assert data["results"]["dephosphorylation"][0]["id"] == "MI:0203"
    assert data["results"]["dephosphorylation"][0]["matched_text"] == "dephosphorylation"


def test_trajectories(client):
    """Test trajectories endpoint."""
    response = client.get("/psi_mi/term/MI:0018/trajectories")
    assert response.status_code == 200
    data = response.json()
    assert data["term_id"] == "MI:0018"
    assert "trajectories" in data
    assert len(data["trajectories"]) > 0
    # Check trajectory structure
    traj = data["trajectories"][0]
    assert len(traj) == 3
    assert traj[0]["id"] == "MI:0000"
    assert traj[-1]["id"] == "MI:0018"


def test_tree(client):
    """Test tree endpoint with auto-detection."""
    response = client.post(
        "/tree",
        json={"term_ids": ["MI:0018"]}
    )
    assert response.status_code == 200
    data = response.json()
    assert "root" in data
    assert data["root"]["id"] == "MI:0000"


def test_ontology_not_found(client, mock_registry):
    """Test 404 for non-existent ontology."""
    mock_registry.get.return_value = None
    response = client.get("/unknown_ontology/term/X:0001")
    assert response.status_code == 404


def test_relation_scoped_facets_endpoint(client):
    with patch("api_service.facets.scoped_relation_facet_counts") as mock_facets:
        mock_facets.return_value = [
            {"facetName": "predicate", "facetValue": "interacts_with", "facetCategory": "interaction", "scopedCount": 2}
        ]
        response = client.post("/relations/scoped-facets", json={"entityPks": [1]})

    assert response.status_code == 200
    assert response.json()[0]["facetValue"] == "interacts_with"


def test_ontology_scoped_search_endpoint(client):
    with patch("api_service.facets.search_ontology_terms") as mock_search:
        mock_search.return_value = [{"termId": "GO:0006915", "label": "apoptotic process"}]
        response = client.post("/ontology/scoped-search", json={"query": "apoptosis", "filters": {"sources": ["signor"]}})

    assert response.status_code == 200
    assert response.json()[0]["termId"] == "GO:0006915"
    mock_search.assert_called_once_with({"query": "apoptosis", "filters": {"sources": ["signor"]}})


def test_sources_endpoint(client):
    with patch("api_service.facets.list_sources") as mock_sources:
        mock_sources.return_value = [{"source": "signor", "entityCount": 2, "relationCount": 3, "totalCount": 5}]
        response = client.get("/sources?domain=relation")

    assert response.status_code == 200
    assert response.json()["sources"][0]["source"] == "signor"
    mock_sources.assert_called_once_with("relation")


def test_entities_resolve_endpoint(client):
    with patch("api_service.graph.resolve_entities") as mock_resolve:
        mock_resolve.return_value = {
            "matches": [
                {
                    "identifier": "TP53",
                    "entityPks": [128747],
                    "candidates": [
                        {
                            "entityPk": 128747,
                            "canonicalIdentifier": "P04637",
                            "taxonomyId": "9606",
                            "identifiers": [{"identifier": "TP53", "identifierType": "Gene Name Primary:OM:0200"}],
                        }
                    ],
                    "ambiguous": False,
                    "bestEntityPk": 128747,
                }
            ],
            "entities": [{"entityPk": 128747, "canonicalIdentifier": "P04637"}],
        }
        response = client.post(
            "/entities/resolve",
            json={"identifiers": ["TP53"], "filters": {"taxonomyIds": ["9606"]}, "preferredTaxonomyIds": ["9606"]},
        )

    assert response.status_code == 200
    assert response.json()["matches"][0]["bestEntityPk"] == 128747
    mock_resolve.assert_called_once_with({
        "identifiers": ["TP53"],
        "filters": {"taxonomyIds": ["9606"]},
        "preferredTaxonomyIds": ["9606"],
        "limit": 20,
    })


def test_entities_search_endpoint(client):
    with patch("api_service.graph.search_entities") as mock_search:
        mock_search.return_value = {
            "entities": [{"entityPk": 1, "canonicalIdentifier": "P04637"}],
            "total": 1,
            "limit": 10,
            "offset": 0,
        }
        response = client.post("/entities/search", json={"query": "TP53", "limit": 10})

    assert response.status_code == 200
    data = response.json()
    assert data["entities"][0]["canonicalIdentifier"] == "P04637"
    mock_search.assert_called_once_with({"query": "TP53", "limit": 10})


def test_entities_by_pks_endpoint(client):
    with patch("api_service.graph.entities_by_pks") as mock_lookup:
        mock_lookup.return_value = [{"entityPk": 1, "canonicalIdentifier": "P04637"}]
        response = client.post("/entities/by-pks", json={"entityPks": [1]})

    assert response.status_code == 200
    assert response.json()["entities"][0]["entityPk"] == 1
    mock_lookup.assert_called_once_with([1])


def test_ontology_entities_endpoint(client):
    with patch("api_service.graph.entities_for_terms") as mock_lookup:
        mock_lookup.return_value = {
            "entities": [{"entityPk": 1, "canonicalIdentifier": "P04637"}],
            "total": 1,
            "limit": 50,
            "offset": 0,
        }
        response = client.post("/ontology/entities", json={"termIds": ["KW-0597"], "filters": {"sources": ["signor"]}})

    assert response.status_code == 200
    assert response.json()["entities"][0]["entityPk"] == 1
    mock_lookup.assert_called_once_with({"termIds": ["KW-0597"], "filters": {"sources": ["signor"]}})


def test_relations_search_endpoint(client):
    with patch("api_service.graph.search_relations") as mock_search:
        mock_search.return_value = {
            "relations": [{"relationPk": 10, "predicate": "interacts_with"}],
            "total": 1,
            "limit": 5,
            "offset": 0,
        }
        response = client.post(
            "/relations/search",
            json={"filters": {"entityPks": [1], "predicates": ["interacts_with"]}, "limit": 5},
        )

    assert response.status_code == 200
    assert response.json()["relations"][0]["relationPk"] == 10
    mock_search.assert_called_once_with({"filters": {"entityPks": [1], "predicates": ["interacts_with"]}, "limit": 5})


def test_relation_lookup_and_evidence_endpoints(client):
    with patch("api_service.graph.get_relation") as mock_relation:
        mock_relation.return_value = {"relationPk": 10, "predicate": "interacts_with"}
        response = client.get("/relations/10")

    assert response.status_code == 200
    assert response.json()["relationPk"] == 10

    with patch("api_service.graph.relation_evidence") as mock_evidence:
        mock_evidence.return_value = {
            "relationPk": 10,
            "evidence": [{"relationEvidencePk": 100, "source": "signor"}],
        }
        response = client.get("/relations/10/evidence")

    assert response.status_code == 200
    assert response.json()["evidence"][0]["source"] == "signor"


def test_resource_download_routes_are_retired(client):
    """Resource downloads are not part of the active Postgres-only API."""
    assert client.get("/resources/signor/download").status_code == 404
    assert client.post("/resources/download", json={"resource_ids": ["signor", "reactome"]}).status_code == 404
