# Relation reification and evidence-level annotations

## Context

In the target graph model, the core storage is:
- `entity`
- `entity_relation`
- `entity_relation_evidence`

with ontology terms also modeled as `entity` rows.

A remaining design question is how to model annotations that conceptually apply to an interaction, especially Molecular Interaction (MI) ontology terms.

Examples:
- interaction detection method
- participant identification method
- interaction type labels from source records
- mechanism-like source annotations

The key issue is that many of these annotations do **not** describe only the subject or object entity. They describe either:
- the relation instance, or
- a specific evidence record for that relation

This document discusses **relation reification** in detail and compares it with lighter-weight alternatives.

---

## What is reification?

Reification means turning a relation into a first-class node so that other things can point to it.

Instead of only storing:
- `A -- predicate --> B`

we also create a node representing that edge instance, so we can say things like:
- `evidence_record_1 -- supports --> relation_R`
- `relation_R -- has_annotation --> MI:0006`
- `relation_R -- has_confidence --> score_node`

In practice, reification means that an interaction is no longer only a row in `entity_relation`; it can also be represented as its own addressable object.

---

## Why reification comes up here

The current modeling tension is this:

### Entity-level annotation
This is easy in the graph model:
- `proteinA -- has_annotation --> GO:0006915`

### Relation-level annotation
This is harder:
- `proteinA -- physically_interacts_with --> proteinB`
- and now: `this interaction -- has_annotation --> MI:0915`

The annotation is not naturally attached to either endpoint entity. It refers to the edge instance.

### Evidence-level annotation
This is even more specific:
- evidence record `E1` says the interaction was detected by method `MI:0006`
- evidence record `E2` says the interaction was detected by method `MI:0018`

Those annotations belong to specific evidence records, not necessarily to the aggregated relation as a whole.

This is why reification is attractive: it gives the edge a stable identity that other records can reference.

---

## Levels of semantics

It helps to distinguish three levels.

### 1. Predicate semantics
The predicate defines what the relation *is*.

Examples:
- `positively_regulates`
- `physically_interacts_with`
- `has_component`
- `associated_with`

These belong naturally in:
- `entity_relation.predicate_entity_pk`

### 2. Relation-level semantics
These describe the aggregated relation instance.

Examples:
- canonical interaction type used in search filters
- aggregate mechanism labels
- curated assertions that apply to the whole relation

These conceptually belong to the relation itself.

### 3. Evidence-level semantics
These describe one source record supporting a relation.

Examples:
- detection method
- participant identification method
- source-specific interaction label
- source-specific experimental role term

These conceptually belong to `entity_relation_evidence`.

This distinction matters because many MI terms fall into level 3 rather than level 2.

---

## Reification variants

There are several ways to reify a relation.

## Option A: Full relation entity

Create a dedicated `entity` row for each relation instance.

For example:
- `entity(entity_type='relation')` -> `relation_entity_pk = 9001`
- `entity_relation(subject=A, predicate=physically_interacts_with, object=B)`
- `entity_relation(subject=9001, predicate=has_annotation, object=MI:0006)`
- `entity_relation(subject=evidence_entity_1, predicate=supports, object=9001)`

### Advantages
- Pure graph model: everything is a node or edge.
- One uniform annotation mechanism for entities and relations.
- A relation can have its own graph neighborhood.
- Easy to attach multiple kinds of metadata without new special-case tables.
- Future-proof if you want RDF/property-graph style expressiveness.

### Tradeoffs
- Much more storage and join complexity.
- Every relation effectively becomes both a row and a node.
- More difficult ingestion and integrity rules.
- App queries become more abstract and less ergonomic.
- Many product surfaces still want a simple interaction row, so you often end up rebuilding that view anyway.

### Assessment
This is the most expressive option, but also the heaviest. It is probably more infrastructure than needed unless the system is explicitly becoming a graph-native platform.

---

## Option B: Reified relation table, but not as entity

Keep `entity_relation` as the base edge table, but treat each relation row as a first-class referencable object by its primary key.

Then attach annotations through auxiliary tables such as:
- `entity_relation_annotation(relation_pk, annotation_entity_pk, ...)`
- `entity_relation_evidence(relation_pk, ...)`

This is a form of reification, but lighter than full graph-node reification.

### Advantages
- Preserves stable identity for the relation.
- Lets you attach annotations directly to the relation.
- Much simpler than turning each relation into an entity.
- Easy to query and index.
- Keeps app-facing reads practical.

### Tradeoffs
- Not a fully uniform graph model.
- Requires special tables for things that point at relations.
- Still needs careful semantic rules for relation-level vs evidence-level annotations.

### Assessment
This is often the most practical compromise if relation-level metadata becomes important.

---

## Option C: No explicit reification; keep annotations on evidence

Do not create a dedicated relation annotation model.
Instead store annotations inside:
- `entity_relation_evidence.record_attributes`

Example:
- evidence row for relation `R1` contains:
  - `interaction_annotation_terms: ['MI:0915']`
  - `detection_method_terms: ['MI:0006']`

Then build read models such as:
- `entity_relation_annotation_mv`

by extracting and aggregating evidence attributes.

### Advantages
- Smallest base schema.
- Best preservation of source fidelity.
- Naturally models evidence-scoped annotations.
- Avoids premature normalization.

### Tradeoffs
- Annotation semantics are implicit in JSON conventions.
- Querying and indexing the raw source is harder.
- Aggregation rules must be defined explicitly.
- Relation-level annotations become derived, not primary.

### Assessment
This is a strong option when annotations mostly originate from evidence records and should preserve source linkage.

---

## The strongest argument for preserving evidence linkage

If an MI term comes from a source record, then the most faithful statement is often:

> evidence record E asserts annotation T about relation R

not simply:

> relation R has annotation T

These are not equivalent.

Why?

Because different evidence records may disagree or vary.

Example:
- `E1` supports `A interacts_with B` with detection method `MI:0006`
- `E2` supports the same aggregated relation with detection method `MI:0018`

If you collapse these into a single relation-level annotation too early, you lose the distinction between:
- evidence-specific metadata
- aggregate relation-level metadata

This is especially important if the UI may later want to show:
- which sources contributed which MI terms
- how many evidences support a given annotation
- conflicting or heterogeneous evidence annotations

That strongly favors keeping the canonical source of truth at the evidence level.

---

## Why full reification may still be more than you need

If the main requirement is:
- preserve annotation linkage to evidence records
- expose relation annotation facets in search
- maybe show aggregated terms in interaction details

then full relation-as-entity reification may be unnecessary.

You already have stable relation identity through:
- `entity_relation.relation_pk`

and stable evidence identity through:
- `entity_relation_evidence`

That means you can preserve the key fact pattern directly:
- relation `R`
- evidence `E`
- evidence attributes include MI terms

without introducing a relation node entity.

In other words, if evidence linkage is the real requirement, then **evidence-normalized storage** may solve the problem more directly than graph reification.

---

## A useful conceptual model

Think of the schema in three layers.

### 1. Canonical graph layer
- `entity`
- `entity_relation`

Represents nodes and typed edges.

### 2. Canonical provenance layer
- `entity_relation_evidence`

Represents source-specific support for a relation, including evidence-scoped annotations.

### 3. Derived semantic/query layer
- `interaction_mv`
- `association_mv`
- `entity_relation_annotation_mv`
- filter/count materialized views

Represents app-facing projections, including aggregated annotations derived from evidence.

This layered approach gives most of the benefits people often seek through reification, without forcing every relation into a node.

---

## Suggested evidence modeling if MI annotations are evidence-scoped

If MI terms are usually attached to specific source records, prefer explicit structured fields inside `record_attributes` rather than a generic key like `CV_TERM`.

Suggested conventions:
- `interaction_annotation_terms: string[]`
- `detection_method_terms: string[]`
- `participant_identification_method_terms: string[]`
- `participant_role_terms: string[]`
- `experimental_role_terms: string[]`

Why this helps:
- avoids semantic ambiguity
- simplifies extraction into materialized views
- preserves provenance at the evidence row level
- allows category-specific aggregation later

A vague key like `CV_TERM` will likely become too overloaded.

---

## How a derived annotation view could work

A materialized view such as `entity_relation_annotation_mv` could aggregate evidence-level terms into relation-level read rows.

Possible columns:
- `relation_pk`
- `annotation_entity_pk`
- `annotation_category`
- `evidence_count`
- `sources`

This would let the app ask questions like:
- which MI terms annotate this relation?
- how many evidence records support each term?
- which sources contributed them?

This preserves the distinction between:
- canonical source of truth = evidence rows
- app/query convenience = derived relation annotation rows

---

## Advantages of full reification

Full relation reification is still worth considering if you want any of the following:
- relations to participate in graph traversal as first-class objects
- annotations, scores, confidence, provenance, and curation all represented uniformly as graph edges
- support for statements about statements
- future RDF-like semantics
- a highly generic graph API where relations and entities are treated similarly

In that world, the interaction itself becomes an object that can be searched, classified, grouped, and linked.

---

## Tradeoffs of full reification in this project context

For this project, full reification would likely introduce these costs:
- more complex ingestion pipeline
- more complex frontend/read queries
- more derived views needed just to restore today's simple interaction shape
- more storage overhead
- more difficult integrity guarantees between relation rows and relation-entity rows

If the main product surfaces are still:
- interaction search
- interaction details
- association search
- annotation filters

then a lighter-weight design may be preferable.

---

## Recommendation

Given the current discussion, the most practical direction seems to be:

### Keep the base graph model compact
- `entity`
- `entity_relation`
- `entity_relation_evidence`

### Preserve MI and similar annotations at the evidence level
- store them in structured `record_attributes` fields
- keep the evidence link explicit

### Derive relation-level annotation read models
- create `entity_relation_annotation_mv`
- aggregate evidence-level terms into app-facing relation annotation rows
- include evidence counts and sources where useful

### Defer full relation-as-entity reification
- only adopt it if the project later needs statements-about-statements as a first-class graph capability

---

## Bottom line

Reification solves the problem of attaching annotations to relations by turning the relation into a first-class object.

But if the important truth is actually:
- **the annotation belongs to a specific evidence record supporting the relation**

then full reification may be less direct than simply preserving that evidence linkage in `entity_relation_evidence` and projecting relation-level annotations through materialized views.

So the practical conclusion is:
- preserve annotation provenance at the evidence level
- derive relation-level annotations for search and UI
- treat full reification as a future option, not the default starting point
