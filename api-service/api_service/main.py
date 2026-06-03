"""FastAPI application for API service."""

import logging

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
from .ontology_db import (
    canonical_ontology_id,
    direct_relatives,
    get_term as get_term_record,
    get_terms as get_term_records,
    list_ontologies as list_ontology_records,
    ontology_exists,
    recursive_relatives,
    search_terms as search_term_records,
    trajectories,
)
from .resource_catalog import list_resources

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


app = FastAPI(
    title="API Service",
    description="REST API for querying biological ontologies",
    version="0.1.0",
    root_path="/api",
)


def _ensure_term_in_ontology(ontology_id: str, term_id: str) -> None:
    if get_term_record(term_id, ontology_id = ontology_id) is None:
        raise HTTPException(status_code=404, detail=f"Term '{term_id}' not found")


# --- Health ---

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


# --- Ontology listing ---

@app.get("/ontologies", response_model=OntologiesResponse)
async def list_ontologies():
    """List all available ontologies."""
    ontologies = [OntologyInfo(**ontology) for ontology in list_ontology_records()]
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
    if not ontology_exists(ontology_id):
        raise HTTPException(status_code=404, detail=f"Ontology '{ontology_id}' not found")
    term_info = get_term_record(term_id, ontology_id = ontology_id)
    if term_info is None:
        raise HTTPException(status_code=404, detail=f"Term '{term_id}' not found")
    return TermInfo(**term_info)


@app.post("/terms", response_model=TermsResponse)
async def get_terms_batch(request: TermsRequest):
    """Batch lookup of terms from the Postgres ontology tables."""
    terms = {
        term_id: (TermInfo(**term_info) if term_info is not None else None)
        for term_id, term_info in get_term_records(request.term_ids).items()
    }
    return TermsResponse(terms = terms)


@app.post("/terms/search", response_model=TermSearchResponse)
async def search_terms(request: TermSearchRequest):
    """Search ontology terms by name/synonym using the Postgres ontology tables."""
    results = {
        query: [TermSearchMatch(**match) for match in search_term_records(query, limit = request.limit)]
        for query in request.queries
    }

    return TermSearchResponse(results = results)


# --- Navigation ---

@app.get("/{ontology_id}/term/{term_id}/parents")
async def get_parents(ontology_id: str, term_id: str):
    """Get direct parents of a term."""
    if not ontology_exists(ontology_id):
        raise HTTPException(status_code=404, detail=f"Ontology '{ontology_id}' not found")
    _ensure_term_in_ontology(ontology_id, term_id)
    return {"term_id": term_id, "parents": direct_relatives(ontology_id, term_id, direction = "parents")}


@app.get("/{ontology_id}/term/{term_id}/ancestors")
async def get_ancestors(
    ontology_id: str,
    term_id: str,
    depth: int | None = Query(None, description="Maximum depth to traverse")
):
    """Get all ancestors of a term."""
    if not ontology_exists(ontology_id):
        raise HTTPException(status_code=404, detail=f"Ontology '{ontology_id}' not found")
    _ensure_term_in_ontology(ontology_id, term_id)
    return {"term_id": term_id, "ancestors": recursive_relatives(ontology_id, term_id, direction = "ancestors", depth = depth)}


@app.get("/{ontology_id}/term/{term_id}/children")
async def get_children(ontology_id: str, term_id: str):
    """Get direct children of a term."""
    if not ontology_exists(ontology_id):
        raise HTTPException(status_code=404, detail=f"Ontology '{ontology_id}' not found")
    _ensure_term_in_ontology(ontology_id, term_id)
    return {"term_id": term_id, "children": direct_relatives(ontology_id, term_id, direction = "children")}


@app.get("/{ontology_id}/term/{term_id}/descendants")
async def get_descendants(
    ontology_id: str,
    term_id: str,
    depth: int | None = Query(None, description="Maximum depth to traverse")
):
    """Get all descendants of a term."""
    if not ontology_exists(ontology_id):
        raise HTTPException(status_code=404, detail=f"Ontology '{ontology_id}' not found")
    _ensure_term_in_ontology(ontology_id, term_id)
    return {"term_id": term_id, "descendants": recursive_relatives(ontology_id, term_id, direction = "descendants", depth = depth)}


# --- Trajectory / Hierarchy ---

@app.get("/{ontology_id}/term/{term_id}/trajectories", response_model=TrajectoryResponse)
async def get_trajectories(ontology_id: str, term_id: str):
    """Get all root-to-term trajectories from the ontology relation graph."""
    if not ontology_exists(ontology_id):
        raise HTTPException(status_code=404, detail=f"Ontology '{ontology_id}' not found")
    _ensure_term_in_ontology(ontology_id, term_id)
    result = [
        [TrajectoryNode(**node) for node in trajectory]
        for trajectory in trajectories(ontology_id, term_id)
    ]
    return TrajectoryResponse(term_id = term_id, trajectories = result)


@app.post("/tree", response_model=TreeResponse)
async def get_tree(request: TermsRequest):
    """Get a merged tree for terms using the canonical ontology graph in Postgres."""
    all_trajectories: list[list[dict[str, object]]] = []
    for term_id in request.term_ids:
        ontology_id = canonical_ontology_id(term_id)
        if ontology_id is None:
            continue
        all_trajectories.extend(trajectories(ontology_id, term_id))

    if not all_trajectories:
        return TreeResponse(root = None)

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

    return TreeResponse(root = root)


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


# ── Statistics / query API (Milestone H) — precomputed reads, camelCase ──────


@app.get("/stats/sources")
def get_stats_sources():
    """Per-resource counts in the 3-name model (slug/short/full)."""
    from . import stats

    return stats.sources()


@app.get("/stats/entity-types")
def get_stats_entity_types():
    from . import stats

    return stats.entity_types()


@app.get("/stats/interaction-types")
def get_stats_interaction_types():
    from . import stats

    return stats.interaction_types()


@app.get("/stats/identifier-types")
def get_stats_identifier_types():
    from . import stats

    return stats.identifier_types()


@app.get("/stats/chemical-classes")
def get_stats_chemical_classes():
    from . import stats

    return stats.chemical_classes()


@app.get("/stats/metabolic-domains")
def get_stats_metabolic_domains():
    from . import stats

    return stats.metabolic_domains()


@app.get("/stats/build-manifest")
def get_stats_build_manifest():
    from . import stats

    return stats.build_manifest()


@app.get("/stats/coverage-profile")
def get_stats_coverage_profile():
    from . import stats

    return stats.coverage_profile()


@app.get("/stats/resource-overlap")
def get_stats_resource_overlap(contentKind: str = "entity"):
    from . import stats

    return stats.resource_overlap(contentKind)


@app.get("/stats/ramp-conflicts")
def get_stats_ramp_conflicts():
    from . import stats

    return stats.ramp_conflicts()


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
def get_relation_record(relation_id: str):
    """Return one relation with hydrated subject and object entities."""
    from .graph import get_relation

    relation = get_relation(relation_id)
    if relation is None:
        raise HTTPException(status_code=404, detail=f"Relation '{relation_id}' not found")
    return relation


@app.get("/relations/{relation_id}/evidence")
def get_relation_evidence(relation_id: str):
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
