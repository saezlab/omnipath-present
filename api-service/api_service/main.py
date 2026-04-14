"""FastAPI application for API service."""

import json
import logging
import os
import re
import tempfile
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from time import perf_counter

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
import httpx
import polars as pl
from ontograph.queries.introspection import IntrospectionPronto
from pydantic import ValidationError

from .models import (
    TermInfo,
    TermsRequest,
    TermsResponse,
    TermSearchMatch,
    TermSearchRequest,
    TermSearchResponse,
    TrajectoryNode,
    TrajectoryResponse,
    TreeNode,
    TreeResponse,
    OntologyInfo,
    OntologiesResponse,
    InteractionExportRequest,
    EntityExportRequest,
    AssociationExportRequest,
    ResourceDownloadRequest,
    ResourceWorkspaceRequest,
    EvidenceLookupResponse,
    EntityLookupRequest,
    EntityLookupMatch,
    EntityLookupResponse,
)
from .registry import registry
from .exports import INTERACTIONS_PARQUET, ASSOCIATIONS_PARQUET, ENTITIES_PARQUET
from .resource_catalog import list_resources
from .resource_downloads import build_multi_resource_download, build_single_resource_download
from .resource_workspace import build_workspace_manifest, resolve_workspace_artifact

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ENTITY_SERVICE_URL = os.getenv("ENTITY_SERVICE_URL", "http://localhost:8080")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Preload core ontologies on startup."""
    logger.info("Starting API service - preloading core ontologies...")
    registry.preload_core_ontologies()
    logger.info("Core ontologies loaded, service ready")
    yield
    logger.info("Shutting down API service")


app = FastAPI(
    title="API Service",
    description="REST API for querying biological ontologies",
    version="0.1.0",
    lifespan=lifespan,
)


def get_ontology_or_404(ontology_id: str):
    """Get ontology client or raise 404."""
    client = registry.get(ontology_id)
    if client is None:
        raise HTTPException(
            status_code=404,
            detail=f"Ontology '{ontology_id}' not found or failed to load"
        )
    return client


def extract_term_info(client, term_id: str) -> TermInfo | None:
    """Extract term info from ontology client."""
    try:
        term = client.get_term(term_id)
        if term is None:
            return None
        return TermInfo(
            id=term.id,
            name=term.name,
            definition=str(term.definition) if term.definition else None,
            namespace=term.namespace,
        )
    except Exception:
        return None


def ontograph_node_to_tree_node(node) -> TreeNode:
    """Convert ontograph's internal Node to our TreeNode model."""
    return TreeNode(
        id=node.id,
        name=node.name,
        distance=node.distance,
        children=[ontograph_node_to_tree_node(c) for c in node.children.values()]
    )


def _normalize_search_text(value: str) -> str:
    """Normalize text for ontology term name search."""
    return re.sub(r"\s+", " ", value.strip().lower())


@lru_cache(maxsize=32)
def _get_search_documents(ontology_id: str) -> list[dict[str, object]]:
    """Build a lightweight in-memory search index for ontology names/synonyms."""
    client = registry.get(ontology_id)
    if client is None:
        return []

    pronto_ontology = client._ontology._ontology
    documents: list[dict[str, object]] = []

    for term in pronto_ontology.terms():
        if getattr(term, "obsolete", False):
            continue

        candidate_texts: list[str] = []
        if term.name:
            candidate_texts.append(str(term.name))

        for synonym in getattr(term, "synonyms", ()):
            synonym_text = getattr(synonym, "description", None) or str(synonym)
            if synonym_text:
                candidate_texts.append(str(synonym_text))

        normalized_texts = []
        seen = set()
        for text in candidate_texts:
            normalized = _normalize_search_text(text)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            normalized_texts.append({"original": text, "normalized": normalized})

        if not normalized_texts:
            continue

        documents.append(
            {
                "id": term.id,
                "name": term.name,
                "definition": str(term.definition) if term.definition else None,
                "namespace": term.namespace,
                "texts": normalized_texts,
            }
        )

    return documents


def _score_term_match(query: str, candidate: str) -> tuple[int, str] | None:
    """Return a simple relevance score and match type for a query/candidate pair."""
    if not query or not candidate:
        return None

    if candidate == query:
        return 1000, "exact"

    if candidate.startswith(query):
        return 800, "prefix"

    query_tokens = [token for token in query.split(" ") if token]
    candidate_tokens = [token for token in candidate.split(" ") if token]

    if query_tokens and candidate_tokens[: len(query_tokens)] == query_tokens:
        return 700, "token-prefix"

    if query_tokens and all(token in candidate_tokens for token in query_tokens):
        return 600, "token-match"

    if query in candidate:
        return 500, "substring"

    return None


def search_terms_by_name(query: str, ontology_ids: list[str], limit: int = 10) -> list[TermSearchMatch]:
    """Search ontology terms by name/synonym across one or more ontologies."""
    normalized_query = _normalize_search_text(query)
    if not normalized_query:
        return []

    matches: list[tuple[int, TermSearchMatch]] = []

    for ontology_id in ontology_ids:
        for doc in _get_search_documents(ontology_id):
            best_score: int | None = None
            best_match_type: str | None = None
            best_matched_text: str | None = None

            for text in doc["texts"]:
                scored = _score_term_match(normalized_query, text["normalized"])
                if scored is None:
                    continue
                score, match_type = scored
                if best_score is None or score > best_score:
                    best_score = score
                    best_match_type = match_type
                    best_matched_text = text["original"]

            if best_score is None or best_match_type is None or best_matched_text is None:
                continue

            name = doc["name"] or ""
            if _normalize_search_text(str(name)) == normalized_query:
                best_score += 50

            matches.append(
                (
                    best_score,
                    TermSearchMatch(
                        id=str(doc["id"]),
                        name=str(doc["name"]) if doc["name"] is not None else None,
                        definition=str(doc["definition"]) if doc["definition"] is not None else None,
                        namespace=str(doc["namespace"]) if doc["namespace"] is not None else None,
                        ontology_id=ontology_id,
                        matched_text=best_matched_text,
                        match_type=best_match_type,
                        score=best_score,
                    ),
                )
            )

    matches.sort(key=lambda item: (-item[0], len(item[1].id), item[1].id))
    return [match for _, match in matches[:limit]]


# --- Health ---

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


def _load_evidence_row(parquet_path: Path, id_column: str, key_column: str, record_id: int) -> EvidenceLookupResponse:
    """Load a single evidence-bearing row from parquet by numeric ID."""
    if not parquet_path.exists():
        raise HTTPException(status_code=500, detail=f"Missing parquet file: {parquet_path}")

    df = (
        pl.scan_parquet(str(parquet_path))
        .filter(pl.col(id_column) == record_id)
        .select([id_column, key_column, "evidence"])
        .collect(streaming=True)
    )

    if df.is_empty():
        raise HTTPException(status_code=404, detail=f"Record '{record_id}' not found")

    row = df.row(0, named=True)
    return EvidenceLookupResponse(
        id=int(row[id_column]),
        key=str(row[key_column]),
        evidence=list(row.get("evidence") or []),
    )


@app.get("/interactions/{interaction_id}/evidence", response_model=EvidenceLookupResponse)
async def get_interaction_evidence(interaction_id: int):
    """Return full evidence payload for a single interaction."""
    return _load_evidence_row(INTERACTIONS_PARQUET, "interaction_id", "interaction_key", interaction_id)


@app.get("/associations/{association_id}/evidence", response_model=EvidenceLookupResponse)
async def get_association_evidence(association_id: int):
    """Return full evidence payload for a single association."""
    return _load_evidence_row(ASSOCIATIONS_PARQUET, "association_id", "association_key", association_id)


# --- Ontology listing ---

@app.get("/ontologies", response_model=OntologiesResponse)
async def list_ontologies():
    """List all available ontologies."""
    ontologies = [
        OntologyInfo(
            id=ont_id,
            description=desc,
            loaded=registry.is_loaded(ont_id)
        )
        for ont_id, desc in registry.list_available().items()
    ]
    return OntologiesResponse(ontologies=ontologies)


def _load_entity_documents(entity_ids: list[str]) -> list[dict]:
    """Load entity search documents for resolved entity IDs."""
    if not entity_ids:
        return []

    if not ENTITIES_PARQUET.exists():
        raise HTTPException(status_code=500, detail=f"Missing parquet file: {ENTITIES_PARQUET}")

    df = (
        pl.scan_parquet(str(ENTITIES_PARQUET))
        .filter(pl.col("entity_id").is_in(entity_ids))
        .collect(streaming=True)
    )

    if df.is_empty():
        return []

    docs = df.to_dicts()
    order = {entity_id: idx for idx, entity_id in enumerate(entity_ids)}
    docs.sort(key=lambda row: order.get(str(row.get("entity_id")), len(order)))
    return docs


@app.post("/entity-lookup", response_model=EntityLookupResponse)
async def entity_lookup(request: EntityLookupRequest):
    """Resolve raw identifiers to candidate OmniPath entity IDs and attach entity documents."""
    identifiers = [identifier.strip() for identifier in request.identifiers if identifier.strip()]
    if not identifiers:
        raise HTTPException(status_code=400, detail="No identifiers provided")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(f"{ENTITY_SERVICE_URL}/lookup", json={"identifiers": identifiers})
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        raise HTTPException(status_code=502, detail=f"Entity service error: {exc.response.status_code} {detail}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Entity service unavailable: {exc}") from exc

    payload = response.json()
    results = payload.get("results") or {}
    matches = [
        EntityLookupMatch(identifier=identifier, entityIds=list(results.get(identifier) or []))
        for identifier in identifiers
    ]
    all_entity_ids = list(dict.fromkeys(entity_id for match in matches for entity_id in match.entityIds))
    entities = _load_entity_documents(all_entity_ids)
    return EntityLookupResponse(matches=matches, entities=entities)


# --- Term lookup ---

@app.get("/{ontology_id}/term/{term_id}", response_model=TermInfo)
async def get_term(ontology_id: str, term_id: str):
    """Get term information by ID."""
    client = get_ontology_or_404(ontology_id)
    term_info = extract_term_info(client, term_id)
    if term_info is None:
        raise HTTPException(status_code=404, detail=f"Term '{term_id}' not found")
    return term_info


@app.post("/terms", response_model=TermsResponse)
async def get_terms_batch(request: TermsRequest):
    """Batch lookup of terms across multiple ontologies.
    
    Auto-detects ontology from term prefix (GO:, MI:, KW:, etc.)
    """
    from .config import get_ontology_for_term
    
    terms: dict[str, TermInfo | None] = {}
    
    # Group terms by ontology
    terms_by_ontology: dict[str, list[str]] = {}
    for term_id in request.term_ids:
        ontology_id = get_ontology_for_term(term_id)
        if ontology_id:
            terms_by_ontology.setdefault(ontology_id, []).append(term_id)
        else:
            # No matching ontology, term will be None
            terms[term_id] = None
    
    # Look up terms in each ontology
    for ontology_id, term_ids in terms_by_ontology.items():
        client = registry.get(ontology_id)
        if client is None:
            for term_id in term_ids:
                terms[term_id] = None
            continue
        for term_id in term_ids:
            terms[term_id] = extract_term_info(client, term_id)
    
    return TermsResponse(terms=terms)


@app.post("/terms/search", response_model=TermSearchResponse)
async def search_terms(request: TermSearchRequest):
    """Search ontology terms by name/synonym across all configured ontologies."""
    ontology_ids = list(registry.list_available().keys())

    results = {
        query: search_terms_by_name(query, ontology_ids=ontology_ids, limit=request.limit)
        for query in request.queries
    }

    return TermSearchResponse(results=results)


# --- Navigation ---

@app.get("/{ontology_id}/term/{term_id}/parents")
async def get_parents(ontology_id: str, term_id: str):
    """Get direct parents of a term."""
    client = get_ontology_or_404(ontology_id)
    try:
        parents = client.get_parents(term_id)
        return {"term_id": term_id, "parents": [str(p) for p in parents]}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/{ontology_id}/term/{term_id}/ancestors")
async def get_ancestors(
    ontology_id: str,
    term_id: str,
    depth: int | None = Query(None, description="Maximum depth to traverse")
):
    """Get all ancestors of a term."""
    client = get_ontology_or_404(ontology_id)
    try:
        ancestors = client.get_ancestors(term_id, distance=depth)
        return {"term_id": term_id, "ancestors": [str(a) for a in ancestors]}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/{ontology_id}/term/{term_id}/children")
async def get_children(ontology_id: str, term_id: str):
    """Get direct children of a term."""
    client = get_ontology_or_404(ontology_id)
    try:
        children = client.get_children(term_id)
        return {"term_id": term_id, "children": [str(c) for c in children]}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/{ontology_id}/term/{term_id}/descendants")
async def get_descendants(
    ontology_id: str,
    term_id: str,
    depth: int | None = Query(None, description="Maximum depth to traverse")
):
    """Get all descendants of a term."""
    client = get_ontology_or_404(ontology_id)
    try:
        descendants = client.get_descendants(term_id, distance=depth)
        return {"term_id": term_id, "descendants": [str(d) for d in descendants]}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


# --- Trajectory / Hierarchy ---

@app.get("/{ontology_id}/term/{term_id}/trajectories", response_model=TrajectoryResponse)
async def get_trajectories(ontology_id: str, term_id: str):
    """Get all trajectories (paths) from root to a term.
    
    Uses ontograph's get_trajectories_from_root which returns all
    paths from root to the term (multiple paths if term has multiple parents).
    """
    client = get_ontology_or_404(ontology_id)
    try:
        trajectories = client.get_trajectories_from_root(term_id)
        # Convert to response format
        result = []
        for traj in trajectories:
            nodes = [
                TrajectoryNode(
                    id=node['id'],
                    name=node.get('name'),
                    distance=node.get('distance', 0)
                )
                for node in traj
            ]
            result.append(nodes)
        return TrajectoryResponse(term_id=term_id, trajectories=result)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/tree", response_model=TreeResponse)
async def get_tree(request: TermsRequest):
    """Get merged tree for terms across multiple ontologies.
    
    Auto-detects ontology from term prefix (GO:, MI:, KW:, etc.)
    Collects all trajectories for the given terms and merges them
    into a single tree structure with shared ancestor nodes combined.
    """
    from .config import get_ontology_for_term
    
    # Group terms by ontology
    terms_by_ontology: dict[str, list[str]] = {}
    for term_id in request.term_ids:
        ontology_id = get_ontology_for_term(term_id)
        if ontology_id:
            terms_by_ontology.setdefault(ontology_id, []).append(term_id)
    
    # Collect trajectories from all ontologies
    all_trajectories = []
    for ontology_id, term_ids in terms_by_ontology.items():
        client = registry.get(ontology_id)
        if client is None:
            continue
        for term_id in term_ids:
            try:
                trajectories = client.get_trajectories_from_root(term_id)
                all_trajectories.extend(trajectories)
            except Exception:
                continue
    
    if not all_trajectories:
        return TreeResponse(root=None)
    
    # Build merged tree using ontograph's implementation
    ontograph_root = IntrospectionPronto._build_tree_from_trajectories(all_trajectories)
    root = ontograph_node_to_tree_node(ontograph_root)
    return TreeResponse(root=root)


# --- Data export ---


def _build_file_response(*, path: Path, media_type: str, filename: str, background_tasks: BackgroundTasks, temporary: bool):
    if temporary:
        background_tasks.add_task(lambda p: Path(p).unlink(missing_ok=True), str(path))

    return FileResponse(
        path=str(path),
        media_type=media_type,
        filename=filename,
    )


def _parse_export_request_from_query(
    model_class,
    *,
    query: str = "",
    filters: str | None = None,
    filename: str | None = None,
):
    filters_payload: dict = {}
    if filters:
        try:
            parsed = json.loads(filters)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid filters JSON") from exc
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=400, detail="filters must decode to a JSON object")
        filters_payload = parsed

    try:
        return model_class.model_validate({
            "query": query or "",
            "filters": filters_payload,
            "filename": filename,
        })
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc



def _run_export(
    *,
    request: InteractionExportRequest | EntityExportRequest | AssociationExportRequest,
    background_tasks: BackgroundTasks,
    write_subset_direct,
    default_filename: str,
    log_label: str,
):
    try:
        filters_payload = request.filters.model_dump(exclude_none=True)

        temp_file = tempfile.NamedTemporaryFile(prefix=f"{default_filename}_", suffix=".parquet", delete=False)
        temp_path = Path(temp_file.name)
        temp_file.close()

        started = perf_counter()
        row_count = write_subset_direct(request.query or "", filters_payload, temp_path)
        elapsed_ms = int((perf_counter() - started) * 1000)

        safe_name = (request.filename or default_filename).strip() or default_filename
        download_name = safe_name if safe_name.lower().endswith(".parquet") else f"{safe_name}.parquet"

        response = _build_file_response(
            path=temp_path,
            media_type="application/x-parquet",
            filename=download_name,
            background_tasks=background_tasks,
            temporary=True,
        )
        response.headers["X-Export-Row-Count"] = str(row_count)
        response.headers["X-Export-Strategy"] = "parquet"
        response.headers["X-Export-Duration-Ms"] = str(elapsed_ms)
        return response

    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("%s export failed", log_label)
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}") from exc


@app.post("/exports/interactions/parquet")
def export_interactions_parquet(request: InteractionExportRequest, background_tasks: BackgroundTasks):
    from .exports import write_interaction_subset_parquet_direct

    return _run_export(
        request=request,
        background_tasks=background_tasks,
        write_subset_direct=write_interaction_subset_parquet_direct,
        default_filename="interactions_subset",
        log_label="Interaction",
    )


@app.get("/exports/interactions/parquet")
def export_interactions_parquet_get(
    background_tasks: BackgroundTasks,
    query: str = "",
    filters: str | None = Query(default=None),
    filename: str | None = None,
):
    request = _parse_export_request_from_query(
        InteractionExportRequest,
        query=query,
        filters=filters,
        filename=filename,
    )
    return export_interactions_parquet(request, background_tasks)


@app.post("/exports/entities/parquet")
def export_entities_parquet(request: EntityExportRequest, background_tasks: BackgroundTasks):
    from .exports import write_entity_subset_parquet_direct

    return _run_export(
        request=request,
        background_tasks=background_tasks,
        write_subset_direct=write_entity_subset_parquet_direct,
        default_filename="entities_subset",
        log_label="Entity",
    )


@app.get("/exports/entities/parquet")
def export_entities_parquet_get(
    background_tasks: BackgroundTasks,
    query: str = "",
    filters: str | None = Query(default=None),
    filename: str | None = None,
):
    request = _parse_export_request_from_query(
        EntityExportRequest,
        query=query,
        filters=filters,
        filename=filename,
    )
    return export_entities_parquet(request, background_tasks)


@app.post("/exports/associations/parquet")
def export_associations_parquet(request: AssociationExportRequest, background_tasks: BackgroundTasks):
    from .exports import write_association_subset_parquet_direct

    return _run_export(
        request=request,
        background_tasks=background_tasks,
        write_subset_direct=write_association_subset_parquet_direct,
        default_filename="associations_subset",
        log_label="Association",
    )


@app.get("/exports/associations/parquet")
def export_associations_parquet_get(
    background_tasks: BackgroundTasks,
    query: str = "",
    filters: str | None = Query(default=None),
    filename: str | None = None,
):
    request = _parse_export_request_from_query(
        AssociationExportRequest,
        query=query,
        filters=filters,
        filename=filename,
    )
    return export_associations_parquet(request, background_tasks)


@app.get("/resources")
def get_resources_catalog():
    return list_resources()


@app.get("/resources/{resource_id}/download")
def download_single_resource(resource_id: str, background_tasks: BackgroundTasks):
    artifact = build_single_resource_download(resource_id)
    response = _build_file_response(
        path=artifact.path,
        media_type=artifact.media_type,
        filename=artifact.filename,
        background_tasks=background_tasks,
        temporary=artifact.is_temporary,
    )
    response.headers["X-Resource-Download-Mode"] = "single"
    response.headers["X-Resource-Id"] = resource_id
    return response


@app.post("/resources/download")
def download_multiple_resources(request: ResourceDownloadRequest, background_tasks: BackgroundTasks):
    artifact = build_multi_resource_download(request.resource_ids, filename=request.filename)
    response = _build_file_response(
        path=artifact.path,
        media_type=artifact.media_type,
        filename=artifact.filename,
        background_tasks=background_tasks,
        temporary=artifact.is_temporary,
    )
    response.headers["X-Resource-Download-Mode"] = "bundle"
    response.headers["X-Resource-Count"] = str(len(request.resource_ids))
    return response


@app.post("/resources/workspace/manifest")
def get_resource_workspace_manifest(request: ResourceWorkspaceRequest):
    return build_workspace_manifest(request.resource_ids)


@app.get("/resources/{resource_id}/artifacts/{artifact_name}")
def download_resource_workspace_artifact(resource_id: str, artifact_name: str, background_tasks: BackgroundTasks):
    artifact_path = resolve_workspace_artifact(resource_id, artifact_name)
    response = _build_file_response(
        path=artifact_path,
        media_type="application/x-parquet",
        filename=f"{resource_id}_{artifact_path.name}",
        background_tasks=background_tasks,
        temporary=False,
    )
    response.headers["X-Resource-Id"] = resource_id
    response.headers["X-Artifact-Name"] = artifact_path.name
    return response

