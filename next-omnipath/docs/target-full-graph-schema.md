# Target full graph schema

## Goal

Describe a fully reified graph model where both domain objects and relation instances are represented as entities.

This extends the lighter target graph schema by modeling interactions and other relations as first-class graph nodes.

---

## Core idea

Use these main tables:
- `entity`
- `entity_relation`
- `entity_identifier`
- `omnipath_vocabulary`

In this model:
- proteins, pathways, diseases, and ontology-backed concepts can be entities
- interaction instances can also be entities
- edges between anything are represented through `entity_relation`
- controlled terms live in `omnipath_vocabulary`

---

## Base tables

## `entity`
Stores every graph node.

Suggested columns:
- `entity_pk`
- `canonical_identifier`
- `canonical_identifier_type`
- `entity_type`
- `taxonomy_id`
- `entity_attributes jsonb`
- `sources text[]`
- `identifiers jsonb`

Examples of entity types:
- protein
- gene
- pathway
- disease
- phenotype
- ontology_term
- interaction
- association
- evidence_record

Notes:
- Interaction instances are entities with `entity_type = 'interaction'`.
- Evidence records may also be entities if full provenance graphing is desired.

## `omnipath_vocabulary`
Stores controlled terms.

Suggested columns:
- `term_pk`
- `namespace`
- `accession`
- `label`
- `definition`

Examples:
- predicates such as `has_participant`, `has_annotation`, `has_evidence`, `supports`
- entity type terms
- identifier type terms
- taxonomy terms
- MI / GO / HP / OM / KW terms

## `entity_relation`
Stores every typed edge in the graph.

Suggested columns:
- `relation_pk`
- `subject_entity_pk`
- `predicate_term_pk`
- `object_entity_pk`
- `sources text[]`

Notes:
- The predicate is a controlled term from `omnipath_vocabulary`.
- Subject/object order carries direction.
- This is the single edge table for both biological facts and metadata links.

## `entity_identifier`
Stores alternate identifiers for entities.

Suggested columns:
- `id`
- `entity_pk`
- `identifier`
- `identifier_type`

---

## Main modeling pattern

Instead of storing an interaction only as an edge:
- `proteinA -- positively_regulates --> proteinB`

we create an interaction entity and connect it to participants and metadata through ordinary graph edges.

Example:
- `interactionR1 -- has_subject --> proteinA`
- `interactionR1 -- has_predicate --> positively_regulates_term_entity_or_proxy`
- `interactionR1 -- has_object --> proteinB`

A more practical form in this schema is:
- `interactionR1 -- has_participant_a --> proteinA`
- `interactionR1 -- has_participant_b --> proteinB`
- `interactionR1 -- has_interaction_type --> positively_regulates_term_entity`

If predicates remain in `omnipath_vocabulary` rather than `entity`, then the interaction entity carries the relation semantics through attributes or through typed helper edges projected from the vocabulary layer.

---

## Two ways to do full graph

## Option A: relation entity plus direct edge row

Keep both:
- an `entity` row for the interaction instance
- an `entity_relation` row for the biological assertion itself

Example:
- `proteinA -- positively_regulates --> proteinB`
- `interactionR1 -- describes_relation --> relation123`
- `interactionR1 -- has_annotation --> miTerm`

### Pros
- keeps simple binary relation queries fast
- still allows annotations and provenance on the interaction entity
- easier migration from the lighter graph model

### Tradeoffs
- duplicates relation identity
- requires synchronization rules between the relation row and the interaction entity

## Option B: relation entity only

Do not store the core interaction as a subject-predicate-object fact row.
Instead represent the interaction entirely as an entity plus helper edges.

Example:
- `interactionR1 -- has_subject --> proteinA`
- `interactionR1 -- has_object --> proteinB`
- `interactionR1 -- has_interaction_type --> miTerm`
- `interactionR1 -- has_annotation --> miAnnotationTerm`

### Pros
- purest reified graph model
- everything can point to the interaction uniformly
- no duplication between edge row and interaction entity

### Tradeoffs
- binary relation queries become more complex
- interaction search needs more joins or dedicated materialized views
- less convenient for simple graph traversal unless projected into derived views

---

## Recommended full-graph interpretation

If going full graph, the cleanest conceptual model is usually Option B:
- interaction as entity
- participant and metadata links as ordinary edges

That makes interactions first-class graph objects.

However, the app will still likely need derived read models that reconstruct a simple interaction shape.

---

## Interaction modeling

An interaction entity can be connected as follows:

Required links:
- `interactionR1 -- has_subject --> entityA`
- `interactionR1 -- has_object --> entityB`
- `interactionR1 -- has_interaction_type --> interactionTypeTermEntityOrMappedConcept`

Optional links:
- `interactionR1 -- has_annotation --> termEntity`
- `interactionR1 -- has_source --> sourceEntity`
- `interactionR1 -- has_evidence --> evidenceRecordEntity`

Possible attributes on the interaction entity:
- sign
- is_directed
- evidence_count
- other derived summary properties

Notes:
- if sign is intrinsic to the interaction type, it may not need its own field
- if sign is an aggregate summary over evidence, it may be better as a derived property

---

## Evidence modeling in the full graph

Evidence can also be modeled as entities.

Example:
- `evidenceE1 -- supports --> interactionR1`
- `evidenceE1 -- has_annotation --> MI:0006`
- `evidenceE1 -- has_source --> sourceX`

This is the main advantage of full reification.

It preserves the fact pattern:
- a specific evidence record supports a specific interaction
- a specific annotation belongs to that evidence record

This is often a better semantic fit for MI detection methods and other evidence-scoped terms than attaching them directly to the aggregated interaction.

---

## Annotations in the full graph

### Entity annotations
Example:
- `proteinA -- has_annotation --> goTerm`

### Interaction annotations
Example:
- `interactionR1 -- has_annotation --> miTerm`

### Evidence annotations
Example:
- `evidenceE1 -- has_annotation --> miDetectionMethodTerm`

This is the strongest expressive benefit of the full graph model:
- entities, interactions, and evidence records can all be annotated through the same mechanism

---

## Derived read models

Even in a full graph design, app-facing read models are still useful.

### `interaction_mv`
Reconstructs a simple interaction surface from the reified graph.

Projected columns may include:
- `interaction_entity_pk`
- `entity_a_pk`
- `entity_b_pk`
- `interaction_type`
- `sign`
- `is_directed`
- `evidence_count`

### `interaction_annotation_mv`
Aggregates annotations attached directly to interaction entities.

### `interaction_evidence_annotation_mv`
Aggregates annotations attached to evidence entities grouped by interaction.

### `association_mv`
If associations are also reified as entities, reconstruct a parent/member style projection.

---

## Advantages

- Pure graph representation.
- Interactions become first-class objects.
- Evidence can become first-class objects.
- The same annotation mechanism can be used for entities, interactions, and evidence.
- Supports statements about statements naturally.
- Very extensible for future graph-native features.

---

## Tradeoffs

- Higher conceptual complexity.
- More rows and joins.
- More difficult ingestion rules.
- More derived views needed for ergonomic product queries.
- Simple binary interaction queries become reconstructed views instead of direct table reads.
- May be overkill if most needs are satisfied by relation rows plus evidence attributes.

---

## Performance strategy

Use the fully reified graph as the canonical model, but rely heavily on materialized views for product-facing reads.

Examples:
- `interaction_mv`
- `interaction_filter_counts_mv`
- `interaction_annotation_mv`
- `evidence_annotation_mv`

Suggested `entity_relation` indexes:
- `(subject_entity_pk)`
- `(object_entity_pk)`
- `(predicate_term_pk)`
- `(predicate_term_pk, subject_entity_pk)`
- `(predicate_term_pk, object_entity_pk)`

Suggested `entity` indexes:
- `(entity_type)`
- canonical identifier indexes

Suggested `omnipath_vocabulary` indexes:
- `(namespace, accession)`
- search indexes on `label` / `definition` if needed

---

## When this model is worth it

Choose the full graph model if you want:
- interactions as first-class graph objects
- evidence as first-class graph objects
- uniform annotations across nodes, interactions, and evidence
- long-term support for graph-native provenance and statement reification

Do not choose it only for schema elegance. It should be justified by real query, provenance, or product needs.

---

## Summary

Target full graph storage model:
- `entity`
- `entity_relation`
- `entity_identifier`
- `omnipath_vocabulary`

In this version, interactions are represented as entities, and optionally evidence records are too.

This is the most expressive graph design, but it shifts much more complexity into conventions, ingestion, and derived views.