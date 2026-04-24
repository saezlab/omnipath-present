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


RelationCategory = Literal["interaction", "membership", "annotation"]


class EntityFilters(BaseModel):
    """Graph-native filters for entity slices/exports."""

    entity_pks: list[int] = Field(default_factory=list)
    entity_ids: list[int] = Field(default_factory=list)
    entity_types: list[str] = Field(default_factory=list)
    taxonomy_ids: list[str] = Field(default_factory=list)
    ncbi_tax_id: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)


class RelationFilters(BaseModel):
    """Graph-native filters for relation slices/exports."""

    relation_pks: list[int] = Field(default_factory=list)
    subject_entity_pks: list[int] = Field(default_factory=list)
    object_entity_pks: list[int] = Field(default_factory=list)
    entity_pks: list[int] = Field(default_factory=list)
    entity_ids: list[int] = Field(default_factory=list)
    predicates: list[str] = Field(default_factory=list)
    interaction_types: list[str] = Field(default_factory=list)
    relation_categories: list[RelationCategory] = Field(default_factory=list)
    participant_types: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    annotation_terms: list[str] = Field(default_factory=list)
    # UI filter key currently used for ontology-term scoped relation filters.
    ontology_terms: list[str] = Field(default_factory=list)
    annotation_scopes: list[str] = Field(default_factory=list)


class EntityExportRequest(BaseModel):
    """Request payload for entity subset export."""

    query: str = ""
    filters: EntityFilters = Field(default_factory=EntityFilters)
    filename: str | None = None


class RelationExportRequest(BaseModel):
    """Request payload for relation subset export."""

    query: str = ""
    filters: RelationFilters = Field(default_factory=RelationFilters)
    filename: str | None = None


class SliceRequest(BaseModel):
    """Request payload for filtered JSON slices."""

    query: str = ""
    filters: dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=50, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class SliceResponse(BaseModel):
    """Filtered slice response."""

    rows: list[dict[str, Any]] = Field(default_factory=list)
    total: int | None = None
    limit: int
    offset: int


class ResourceDownloadRequest(BaseModel):
    """Request payload for bundling one or more resource gold artifact sets."""

    resource_ids: list[str] = Field(default_factory=list)
    filename: str | None = None


class EntityResolveRequest(BaseModel):
    """Request payload for identifier-to-entity_pk resolution."""

    identifiers: list[str] = Field(default_factory=list)


class EntityResolveMatch(BaseModel):
    """Resolved entity PKs for one queried identifier."""

    identifier: str
    entityPks: list[int] = Field(default_factory=list)


class EntityResolveResponse(BaseModel):
    """Identifier lookup response including matched entity rows."""

    matches: list[EntityResolveMatch] = Field(default_factory=list)
    entities: list[dict[str, Any]] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    """Error response."""

    detail: str
