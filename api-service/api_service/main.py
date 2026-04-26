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
    EntityExportRequest,
    RelationExportRequest,
    AnnotationExportRequest,
    ResourceDownloadRequest,
    SliceRequest,
    SliceResponse,
    EntityResolveRequest,
    EntityResolveMatch,
    EntityResolveResponse,
)
from .registry import registry
from .resource_catalog import list_resources
from .resource_downloads import build_multi_resource_download, build_single_resource_download

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)



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
    root_path="/api",
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

    try:
        pronto_ontology = client._ontology._ontology
    except Exception:
        return []
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


def _database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=500, detail="DATABASE_URL is not configured")
    return url


def _normalize_identifiers(identifiers: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for identifier in identifiers:
        value = str(identifier).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


SEARCH_SCHEMA = os.getenv("OMNIPATH_PG_SCHEMA", "public")


@app.post("/entities/resolve", response_model=EntityResolveResponse)
def resolve_entities(request: EntityResolveRequest):
    """Resolve raw identifiers to candidate entity primary keys using Postgres."""
    identifiers = _normalize_identifiers(request.identifiers)
    if not identifiers:
        raise HTTPException(status_code=400, detail="No identifiers provided")

    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="Postgres driver is not installed") from exc

    query = f"""
        SELECT
            ei.identifier,
            e.entity_pk,
            e.canonical_identifier,
            e.canonical_identifier_type,
            e.entity_type,
            e.taxonomy_id,
            e.entity_attributes,
            e.sources
        FROM {SEARCH_SCHEMA}.entity_identifier ei
        JOIN {SEARCH_SCHEMA}.entity e ON e.entity_pk = ei.entity_pk
        WHERE {{where_clause}}
        ORDER BY e.entity_pk
    """

    with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
        exact_rows = list(conn.execute(query.format(where_clause="ei.identifier = ANY(%s)"), (identifiers,)))
        exact_keys = {str(row["identifier"]).lower() for row in exact_rows}
        lowered_misses = sorted({identifier.lower() for identifier in identifiers if identifier.lower() not in exact_keys})
        fallback_rows = list(conn.execute(query.format(where_clause="LOWER(ei.identifier) = ANY(%s)"), (lowered_misses,))) if lowered_misses else []

    match_map: dict[str, list[int]] = {}
    entities_by_pk: dict[int, dict] = {}
    for row in [*exact_rows, *fallback_rows]:
        entity_pk = int(row["entity_pk"])
        key = str(row["identifier"]).lower()
        match_map.setdefault(key, [])
        if entity_pk not in match_map[key]:
            match_map[key].append(entity_pk)
        entities_by_pk.setdefault(entity_pk, {
            "entity_pk": entity_pk,
            "canonical_identifier": row["canonical_identifier"],
            "canonical_identifier_type": row["canonical_identifier_type"],
            "entity_type": row["entity_type"],
            "taxonomy_id": row["taxonomy_id"],
            "entity_attributes": row["entity_attributes"],
            "sources": row["sources"] or [],
        })

    return EntityResolveResponse(
        matches=[
            EntityResolveMatch(identifier=identifier, entityPks=match_map.get(identifier.lower(), []))
            for identifier in identifiers
        ],
        entities=list(entities_by_pk.values()),
    )


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
    ontology_ids = [
        ont_id for ont_id in registry.list_available()
        if registry.is_loaded(ont_id)
    ]

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
    
    root: TreeNode | None = None
    node_index: dict[str, TreeNode] = {}
    for trajectory in all_trajectories:
        parent: TreeNode | None = None
        for raw_node in trajectory:
            node_id = str(raw_node.get("id"))
            node = node_index.get(node_id)
            if node is None:
                node = TreeNode(
                    id=node_id,
                    name=raw_node.get("name"),
                    distance=int(raw_node.get("distance", 0)),
                    children=[],
                )
                node_index[node_id] = node
            if parent is None:
                root = root or node
            elif all(child.id != node.id for child in parent.children):
                parent.children.append(node)
            parent = node

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



def _filters_payload(request) -> dict:
    if hasattr(request.filters, "model_dump"):
        return request.filters.model_dump(exclude_none=True)
    return dict(request.filters or {})


def _run_export(
    *,
    request: EntityExportRequest | RelationExportRequest | AnnotationExportRequest,
    background_tasks: BackgroundTasks,
    write_subset_direct,
    default_filename: str,
    log_label: str,
):
    try:
        filters_payload = _filters_payload(request)

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
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("%s export failed", log_label)
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}") from exc


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


@app.post("/exports/annotations/parquet")
def export_annotations_parquet(request: AnnotationExportRequest, background_tasks: BackgroundTasks):
    from .exports import write_annotation_subset_parquet_direct

    return _run_export(
        request=request,
        background_tasks=background_tasks,
        write_subset_direct=write_annotation_subset_parquet_direct,
        default_filename="annotations_subset",
        log_label="Annotation",
    )


@app.get("/exports/annotations/parquet")
def export_annotations_parquet_get(
    background_tasks: BackgroundTasks,
    query: str = "",
    filters: str | None = Query(default=None),
    filename: str | None = None,
):
    request = _parse_export_request_from_query(
        AnnotationExportRequest,
        query=query,
        filters=filters,
        filename=filename,
    )
    return export_annotations_parquet(request, background_tasks)


@app.post("/exports/relations/parquet")
def export_relations_parquet(request: RelationExportRequest, background_tasks: BackgroundTasks):
    from .exports import write_relation_subset_parquet_direct

    return _run_export(
        request=request,
        background_tasks=background_tasks,
        write_subset_direct=write_relation_subset_parquet_direct,
        default_filename="relations_subset",
        log_label="Relation",
    )


@app.get("/exports/relations/parquet")
def export_relations_parquet_get(
    background_tasks: BackgroundTasks,
    query: str = "",
    filters: str | None = Query(default=None),
    filename: str | None = None,
):
    request = _parse_export_request_from_query(
        RelationExportRequest,
        query=query,
        filters=filters,
        filename=filename,
    )
    return export_relations_parquet(request, background_tasks)


@app.post("/entities/slice", response_model=SliceResponse)
def get_entities_slice(request: SliceRequest):
    from .exports import collect_entity_slice

    rows, total = collect_entity_slice(request.query, request.filters, limit=request.limit, offset=request.offset)
    return SliceResponse(rows=rows, total=total, limit=request.limit, offset=request.offset)


@app.post("/relations/slice", response_model=SliceResponse)
def get_relations_slice(request: SliceRequest):
    from .exports import collect_relation_slice

    rows, total = collect_relation_slice(request.query, request.filters, limit=request.limit, offset=request.offset)
    return SliceResponse(rows=rows, total=total, limit=request.limit, offset=request.offset)


@app.get("/relations/{relation_pk}/evidence")
def get_relation_evidence(relation_pk: int):
    from .exports import collect_relation_evidence

    rows = collect_relation_evidence(relation_pk)
    if not rows:
        raise HTTPException(status_code=404, detail=f"Relation '{relation_pk}' evidence not found")
    return {"relation_pk": relation_pk, "evidence": rows}


@app.get("/relation-evidence/{relation_evidence_pk}")
def get_relation_evidence_record(relation_evidence_pk: int):
    from .exports import collect_relation_evidence_by_pk

    row = collect_relation_evidence_by_pk(relation_evidence_pk)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Relation evidence '{relation_evidence_pk}' not found")
    return row


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


