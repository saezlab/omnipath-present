"""Pydantic models for API request/response schemas."""

from __future__ import annotations

from typing import Any

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


class EntityResolveRequest(BaseModel):
    """Request payload for identifier-to-entity_pk resolution."""

    identifiers: list[str] = Field(default_factory=list)
    filters: dict[str, Any] = Field(default_factory=dict)
    preferredTaxonomyIds: list[str] = Field(default_factory=list)
    limit: int = Field(default=20, ge=1, le=100)


class EntityResolveMatch(BaseModel):
    """Resolved entity PKs for one queried identifier."""

    identifier: str
    entityPks: list[int] = Field(default_factory=list)
    candidates: list[dict[str, Any]] = Field(default_factory=list)
    ambiguous: bool = False
    bestEntityPk: int | None = None


class EntityResolveResponse(BaseModel):
    """Identifier lookup response including matched entity rows."""

    matches: list[EntityResolveMatch] = Field(default_factory=list)
    entities: list[dict[str, Any]] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    """Error response."""

    detail: str
