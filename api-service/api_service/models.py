"""Pydantic models for API request/response schemas."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TermInfo(BaseModel):
    """Basic term information."""

    id: str
    name: str | None = None
    definition: str | None = None
    namespace: str | None = None


class TermWithRelations(TermInfo):
    """Term with parent/child relationships."""

    parents: list[str] = []
    children: list[str] = []


class TermsRequest(BaseModel):
    """Request for batch term lookup."""

    term_ids: list[str]


class TermsResponse(BaseModel):
    """Response for batch term lookup."""

    terms: dict[str, TermInfo | None]


class TermSearchRequest(BaseModel):
    """Request for searching ontology terms by name or synonym."""

    queries: list[str] = Field(default_factory=list)
    limit: int = Field(default=10, ge=1, le=50)


class TermSearchMatch(TermInfo):
    """A term search match including search metadata."""

    ontology_id: str
    matched_text: str
    match_type: str
    score: int


class TermSearchResponse(BaseModel):
    """Response for ontology term name search."""

    results: dict[str, list[TermSearchMatch]]


class TrajectoryNode(BaseModel):
    """Node in a trajectory path."""

    id: str
    name: str | None = None
    distance: int = 0


class TreeNode(BaseModel):
    """Node in a hierarchy tree with children (recursive)."""

    id: str
    name: str | None = None
    distance: int = 0
    children: list["TreeNode"] = []


class TrajectoryResponse(BaseModel):
    """Response for single term trajectory (all paths from root)."""

    term_id: str
    trajectories: list[list[TrajectoryNode]]


class TreeResponse(BaseModel):
    """Response with merged tree structure for multiple terms."""

    root: TreeNode | None = None


class OntologyInfo(BaseModel):
    """Information about an available ontology."""

    id: str
    description: str
    loaded: bool


class OntologiesResponse(BaseModel):
    """Response listing available ontologies."""

    ontologies: list[OntologyInfo]


class InteractionDirectionFilter(str):
    ANY = "any"
    DIRECTED = "directed"
    UNDIRECTED = "undirected"


class InteractionSignFilter(str):
    ANY = "any"
    POSITIVE = "positive"
    NEGATIVE = "negative"
    MIXED = "mixed"


class InteractionExportFilters(BaseModel):
    """Typed filters for interaction exports."""

    entity_ids: list[str] = Field(default_factory=list)
    member_a_id: str | None = None
    member_b_id: str | None = None
    interaction_types: list[str] = Field(default_factory=list)

    # New, clearer API fields
    direction: Literal["any", "directed", "undirected"] | None = None
    sign: Literal["any", "positive", "negative", "mixed"] | None = None

    # Backward-compatible fields currently used in UI
    has_direction: bool | None = None
    has_positive_sign: bool | None = None
    has_negative_sign: bool | None = None

    # Ontology term filters
    interaction_annotation_terms: list[str] = Field(default_factory=list)
    participant_annotation_terms: list[str] = Field(default_factory=list)
    ontology_terms: list[str] = Field(default_factory=list)

    sources: list[str] = Field(default_factory=list)


class EntityExportFilters(BaseModel):
    """Typed filters for entity exports."""

    entity_ids: list[str] = Field(default_factory=list)
    entity_types: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)

    # New API alias for species filtering
    taxonomy_ids: list[str] = Field(default_factory=list)
    # Backward-compatible key used by current clients
    ncbi_tax_id: list[str] = Field(default_factory=list)

    # Unified ontology term filters
    ontology_terms: list[str] = Field(default_factory=list)


class AssociationExportFilters(BaseModel):
    """Typed filters for association exports."""

    parent_entity_ids: list[str] = Field(default_factory=list)
    member_entity_ids: list[str] = Field(default_factory=list)

    parent_entity_types: list[str] = Field(default_factory=list)
    member_entity_types: list[str] = Field(default_factory=list)

    sources: list[str] = Field(default_factory=list)

    association_annotation_terms: list[str] = Field(default_factory=list)
    ontology_terms: list[str] = Field(default_factory=list)


class InteractionExportRequest(BaseModel):
    """Request payload for interaction subset export."""

    query: str = ""
    filters: InteractionExportFilters = Field(default_factory=InteractionExportFilters)
    filename: str | None = None


class EntityExportRequest(BaseModel):
    """Request payload for entity subset export."""

    query: str = ""
    filters: EntityExportFilters = Field(default_factory=EntityExportFilters)
    filename: str | None = None


class AssociationExportRequest(BaseModel):
    """Request payload for association subset export."""

    query: str = ""
    filters: AssociationExportFilters = Field(default_factory=AssociationExportFilters)
    filename: str | None = None


class ResourceDownloadRequest(BaseModel):
    """Request payload for bundling one or more resource gold artifact sets."""

    resource_ids: list[str] = Field(default_factory=list)
    filename: str | None = None


class ResourceWorkspaceRequest(BaseModel):
    """Request payload for opening one or more resources in DuckDB."""

    resource_ids: list[str] = Field(default_factory=list)


class EvidenceLookupResponse(BaseModel):
    """Evidence lookup response for a single interaction or association."""

    id: int
    key: str
    evidence: list[dict]


class EntityLookupRequest(BaseModel):
    """Request payload for identifier-to-entity resolution."""

    identifiers: list[str] = Field(default_factory=list)


class EntityLookupMatch(BaseModel):
    """Resolved entity IDs for one queried identifier."""

    identifier: str
    entityIds: list[str] = Field(default_factory=list)


class EntityLookupResponse(BaseModel):
    """Identifier lookup response including matched entity documents."""

    matches: list[EntityLookupMatch] = Field(default_factory=list)
    entities: list[dict[str, Any]] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    """Error response."""

    detail: str
