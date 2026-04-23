# Target graph schema

## Goal

Move to a small, general graph model with:
- `entity` for graph nodes
- `entity_relation` for graph edges
- `entity_relation_evidence` for provenance and evidence-level attributes
- `ontology_term` for ontology-backed and controlled terms

This replaces the current split between:
- `entity`
- `interaction`
- `association`
- `annotation_term`
- `entity_annotation`

with a simpler storage model plus derived views/materialized views.

---

## Core idea

### 1. `entity`
Represents every node in the graph.

Examples:
- protein
- gene
- complex
- pathway
- disease
- phenotype
- ontology-backed concept that should participate as a graph node

Ontology terms are not modeled as entities by default. Instead, some entities may be backed by ontology terms via their canonical identifier.

### 2. `ontology_term`
Represents ontology-backed and controlled terms used across the schema.

Examples:
- ontology terms
- entity types
- predicates
- identifier types
- taxonomy terms

### 3. `entity_relation`
Represents every typed edge in the graph.

Each row is:
- `subject_entity_pk`
- `predicate_term_pk`
- `object_entity_pk`

where `predicate_term_pk` points to `ontology_term.term_pk`.

Examples:
- `proteinA -- positively_regulates --> proteinB`
- `complexX -- has_component --> proteinA`
- `pathwayY -- associated_with --> diseaseZ`
- `proteinA -- involved_in --> pathwayY`
- `proteinA -- has_annotation --> goTerm`

---

## Target base tables

## `entity`
Stores all graph nodes.

Suggested columns:
- `entity_pk`
- `canonical_identifier`
- `canonical_identifier_type`
- `entity_type`
- `taxonomy_id`
- `entity_attributes jsonb`
- `sources text[]`
- `identifiers jsonb`

Notes:
- Pathways and diseases are regular entities when they need to participate as graph nodes.
- Some entities are backed by ontology terms, e.g. a pathway entity whose `canonical_identifier_type` is `CV_TERM_ACCESSION`.
- Ontology hierarchy and traversal stay in the separate ontology service.
- Existing identifier handling can stay largely unchanged.

## `ontology_term`
Stores ontology-backed and controlled terms used by the graph and related metadata.

Suggested columns:
- `term_pk`
- `namespace`
- `accession`
- `label`
- `definition`

Notes:
- This replaces `annotation_term` as the normalized term registry.
- Ontology terms live here with their ontology-specific metadata such as namespace and definition.
- Predicates come from this table.
- It can also hold entity type terms, identifier type terms, taxonomy terms, and similar controlled values.

## `entity_relation`
Stores all graph edges.

Suggested columns:
- `relation_pk`
- `subject_entity_pk`
- `predicate_term_pk`
- `object_entity_pk`
- `relation_category`
- `sources text[]`

Notes:
- This replaces `interaction`, `association`, and `entity_annotation` as base storage.
- Subject/object order carries direction.
- The predicate is a controlled term from `ontology_term`.
- `relation_category` is a coarse grouping for operational convenience, not the primary semantics of the edge.
- Keep the category set minimal for now:
  - `interaction`
  - `membership`
  - `annotation`

## `entity_relation_evidence`
Stores source-specific evidence for a relation.

Suggested columns:
- `source`
- `relation_pk`
- `record_attributes jsonb`
- `subject_attributes jsonb`
- `object_attributes jsonb`
- `evidence jsonb`

Notes:
- This replaces separate interaction/association evidence tables.
- Evidence stays attached to the edge, not to a specialized table.

---

## What disappears as base tables

These become derived concepts rather than primary storage tables:
- `interaction`
- `association`
- `entity_annotation`
- `annotation_term`

Their semantics move into:
- graph nodes in `entity`
- ontology and controlled terms in `ontology_term`
- predicates in `ontology_term`
- evidence attributes in `entity_relation_evidence`
- derived views/materialized views

--- 

## Modeling rules

### Nodes
Use `entity` for anything that may need:
- relations to other things
- provenance
- identifiers
- attributes
- standalone search/detail pages

This includes ontology-backed concepts such as pathways or diseases when they should participate as first-class graph nodes.

### Ontology-backed entities
Some concepts sit in between a plain ontology term and a plain graph entity. Pathways are the main example:
- they often come from an ontology-like or controlled-term source
- but they also need to participate in graph relations
- e.g. `pathway -- associated_with --> disease`

If pathways were modeled only as ontology terms, they would be easy to search and resolve through the ontology service, but awkward to use as first-class graph nodes. If they were modeled only as ontology terms, we would lose the ability to express many biologically useful relations directly in `entity_relation`.

For that reason, we model these concepts as regular `entity` rows when they should participate in the graph, while keeping their ontology metadata in `ontology_term`.

For now we keep the linkage simple:
- an ontology-backed entity uses the ontology accession as its `canonical_identifier`
- `canonical_identifier_type = CV_TERM_ACCESSION`

This is enough to signal that the entity is backed by an ontology term without introducing a separate linkage column yet.

Examples:
- pathway entity with `canonical_identifier = 'R-HSA-199420'` and `canonical_identifier_type = CV_TERM_ACCESSION`
- disease entity with `canonical_identifier = 'MONDO:0005148'` and `canonical_identifier_type = CV_TERM_ACCESSION`

Ontology hierarchy and traversal are intentionally not modeled in this database. Those stay in the separate ontology service, which can provide ancestors, descendants, children, and related ontology operations.

### Predicates
Predicates are controlled terms from `ontology_term`, used in predicate position.

Examples:
- `positively_regulates`
- `negatively_regulates`
- `physically_interacts_with`
- `has_component`
- `involved_in`
- `associated_with`
- `has_annotation`

The predicate carries the main meaning of the edge. `relation_category` is only a coarse grouping.

### Annotations
Annotations are no longer a special join table.
They are ordinary relations whose predicate is an annotation predicate term.
The object may be an entity that is backed by an ontology term.

Example:
- `proteinA -- has_annotation --> goTerm`

For interaction/evidence annotations such as MI terms, prefer storing them in `entity_relation_evidence.record_attributes` and deriving materialized views if needed.

### Relation categories
Use a small coarse relation category set for grouping, filtering, and operational convenience.

For now keep it minimal:
- `interaction`
- `membership`
- `annotation`

These categories should not replace predicate semantics. They are only broad buckets.

### Interactions
Interactions are ordinary relations whose predicate belongs to an interaction predicate family.
They use `relation_category = interaction`.

Example:
- `proteinA -- physically_interacts_with --> proteinB`

### Associations / memberships
Associations are ordinary relations whose predicate belongs to a membership/composition family.
They use `relation_category = membership`.

Example:
- `complexX -- has_component --> proteinA`

---

## Why this model

### Pros
- One general graph model for nodes and edges.
- Ontology terms and other controlled terms are centralized in one term table.
- Pathways and diseases can participate as first-class entities without making all ontology terms entities.
- Ontology-backed entities are simple to represent using `CV_TERM_ACCESSION` as the canonical identifier type.
- Interactions, memberships, and annotations are unified.
- New relation types do not require new base tables.
- Specialized app surfaces can still be recovered with materialized views.

### Tradeoffs
- The model distinguishes between graph entities and ontology terms, so ontology-backed entities need a clear identifier convention.
- More semantics move into predicate design and conventions.
- Generic queries need stronger indexing and careful view design.
- App-facing interaction/association shapes should still exist as derived read models.

---

## Performance strategy

Start with:
- strong indexes on `entity_relation`
- materialized views for interaction/association-heavy read paths

Partitioning is optional and should follow measured query patterns, not be the starting point.
If needed later, prefer partitioning by relation category/family rather than raw predicate accession.

## Summary

Target storage model:
- `entity`
- `ontology_term`
- `entity_relation`
- `entity_relation_evidence`
- `entity_identifier` (kept)