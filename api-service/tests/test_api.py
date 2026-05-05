"""Tests for ontology service API."""

from pathlib import Path
import tempfile

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
        response = client.post("/ontology/scoped-search", json={"query": "apoptosis"})

    assert response.status_code == 200
    assert response.json()[0]["termId"] == "GO:0006915"


def test_download_single_resource(client):
    """Single-resource downloads serve the prebuilt archive."""
    from api_service.resource_downloads import DownloadArtifact

    with tempfile.TemporaryDirectory() as tmp:
        artifact_path = Path(tmp) / "signor.zip"
        artifact_path.write_bytes(b"zip-bytes")

        with patch("api_service.main.build_single_resource_download") as mock_download:
            mock_download.return_value = DownloadArtifact(
                path=artifact_path,
                media_type="application/zip",
                filename="signor.zip",
                is_temporary=False,
            )
            response = client.get("/resources/signor/download")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "signor.zip" in response.headers["content-disposition"]
    assert response.content == b"zip-bytes"



def test_download_multiple_resources(client):
    """Multi-resource downloads return a zip bundle."""
    from api_service.resource_downloads import DownloadArtifact

    with tempfile.TemporaryDirectory() as tmp:
        artifact_path = Path(tmp) / "resources.zip"
        artifact_path.write_bytes(b"zip-bytes")

        with patch("api_service.main.build_multi_resource_download") as mock_download:
            mock_download.return_value = DownloadArtifact(
                path=artifact_path,
                media_type="application/zip",
                filename="resources_bundle.zip",
                is_temporary=False,
            )
            response = client.post("/resources/download", json={"resource_ids": ["signor", "reactome"]})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "resources_bundle.zip" in response.headers["content-disposition"]
    assert response.content == b"zip-bytes"
