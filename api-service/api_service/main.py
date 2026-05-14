"""FastAPI application for API service."""

import logging
import re
from contextlib import asynccontextmanager
from functools import lru_cache

from fastapi import Body, FastAPI, HTTPException, Query

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
    EntityResolveRequest,
    EntityResolveResponse,
)
from .registry import registry
from .resource_catalog import list_resources

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


@app.post("/entities/resolve", response_model=EntityResolveResponse)
def resolve_entities(request: EntityResolveRequest):
    """Resolve raw identifiers to exact candidate entity primary keys using Postgres."""
    identifiers = _normalize_identifiers(request.identifiers)
    if not identifiers:
        raise HTTPException(status_code=400, detail="No identifiers provided")

    from .graph import resolve_entities as resolve_graph_entities

    return resolve_graph_entities({
        "identifiers": identifiers,
        "filters": request.filters,
        "preferredTaxonomyIds": request.preferredTaxonomyIds,
        "limit": request.limit,
    })


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


# --- Graph data discovery ---


@app.post("/entities/scoped-facets")
def get_entities_scoped_facets(payload: dict = Body(default_factory=dict)):
    """Return entity facet counts after applying the current entity scope/filters."""
    from .facets import scoped_entity_facet_counts

    return scoped_entity_facet_counts(payload)


@app.get("/sources")
def get_available_sources(domain: str | None = None):
    """Return available source values with entity/relation counts."""
    from .facets import list_sources

    return {"sources": list_sources(domain)}


@app.post("/entities/search")
def post_entities_search(payload: dict = Body(default_factory=dict)):
    """Search entities by identifier/name and optional annotation/type/source/taxon filters."""
    from .graph import search_entities

    return search_entities(payload)


@app.get("/entities/search")
def get_entities_search(
    q: str = "",
    limit: int = 50,
    offset: int = 0,
):
    """Search entities by identifier/name using query parameters."""
    from .graph import search_entities

    return search_entities({"query": q, "limit": limit, "offset": offset})


@app.post("/entities/by-pks")
def post_entities_by_pks(payload: dict = Body(default_factory=dict)):
    """Hydrate entity primary keys into entity records with identifiers."""
    from .graph import entities_by_pks

    return {"entities": entities_by_pks(payload.get("entityPks") or payload.get("entity_pks") or payload.get("pks") or [])}


@app.post("/ontology/entities")
def post_entities_for_ontology_terms(payload: dict = Body(default_factory=dict)):
    """Return entities annotated by one or more ontology term IDs."""
    from .graph import entities_for_terms

    return entities_for_terms(payload)


@app.post("/relations/scoped-facets")
def get_relations_scoped_facets(payload: dict = Body(default_factory=dict)):
    """Return relation facet counts after applying the current relation scope/filters."""
    from .facets import scoped_relation_facet_counts

    return scoped_relation_facet_counts(payload)


@app.post("/relations/search")
def post_relations_search(payload: dict = Body(default_factory=dict)):
    """Search relations by entity scope, predicate, relation category, source, or ontology terms."""
    from .graph import search_relations

    return search_relations(payload)


@app.get("/relations/search")
def get_relations_search(
    entityPks: str | None = None,
    predicates: str | None = None,
    relationCategories: str | None = None,
    annotationTerms: str | None = None,
    requireBothParticipants: bool = False,
    limit: int = 50,
    offset: int = 0,
):
    """Search relations using query parameters."""
    from .graph import search_relations

    return search_relations({
        "filters": {
            "entityPks": [value for value in (entityPks or "").split(",") if value],
            "predicates": [value for value in (predicates or "").split(",") if value],
            "relationCategories": [value for value in (relationCategories or "").split(",") if value],
            "annotationTerms": [value for value in (annotationTerms or "").split(",") if value],
            "requireBothParticipants": requireBothParticipants,
        },
        "limit": limit,
        "offset": offset,
    })


@app.get("/relations/{relation_id}")
def get_relation_record(relation_id: int):
    """Return one relation with hydrated subject and object entities."""
    from .graph import get_relation

    relation = get_relation(relation_id)
    if relation is None:
        raise HTTPException(status_code=404, detail=f"Relation '{relation_id}' not found")
    return relation


@app.get("/relations/{relation_id}/evidence")
def get_relation_evidence(relation_id: int):
    """Return evidence and annotations for a relation."""
    from .graph import relation_evidence

    result = relation_evidence(relation_id)
    if not result["evidence"]:
        raise HTTPException(status_code=404, detail=f"Relation '{relation_id}' evidence not found")
    return result


@app.post("/ontology/scoped-search")
def post_ontology_scoped_search(payload: dict = Body(default_factory=dict)):
    """Search ontology terms, optionally scoped by entities or selected term IDs."""
    from .facets import search_ontology_terms

    return search_ontology_terms(payload)


@app.get("/ontology/scoped-search")
def get_ontology_scoped_search(
    q: str = "",
    entityPks: str | None = None,
    termIds: str | None = None,
    ontologyIds: str | None = None,
    limit: int = 24,
    offset: int = 0,
):
    """Search ontology terms using query parameters."""
    from .facets import search_ontology_terms

    return search_ontology_terms({
        "query": q,
        "entityPks": [value for value in (entityPks or "").split(",") if value],
        "termIds": [value for value in (termIds or "").split(",") if value],
        "ontologyIds": [value for value in (ontologyIds or "").split(",") if value],
        "limit": limit,
        "offset": offset,
    })


# --- Postgres graph data ---


@app.get("/resources")
def get_resources_catalog():
    return list_resources()
