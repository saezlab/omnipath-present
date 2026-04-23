# Note on literal-valued attributes

## Question

Should `entity_relation` directly support literal-valued assertions with columns such as:
- `value`
- `unit`

Examples:
- chemical has molecular weight 120 daltons
- protein has pI 6.8
- compound has logP 2.4

## Decision

For now, **no**.

We should keep `entity_relation` focused on entity-to-entity graph edges:
- `subject_entity_pk`
- `predicate_term_pk`
- `object_entity_pk`

and avoid adding generic `value` / `unit` columns to the core relation table.

## Why

### 1. Most relations are entity-to-entity
The common case is:
- `proteinA -- interacts_with --> proteinB`
- `complexX -- has_component --> proteinA`
- `proteinA -- has_annotation --> goTerm`

Adding `value` and `unit` to every relation row would complicate the core model for a less common fact shape.

### 2. Literal-valued facts are a different shape
Assertions such as:
- molecular weight = 120 daltons
- pI = 6.8

are better understood as typed attributes or measurements than as ordinary graph edges.

### 3. The structured attribute model already exists
We already use a structured representation with:
- `term`
- `value`
- `unit`

This is a reasonable and compact way to represent literal-valued facts without weakening the graph schema.

## Current approach

For now, keep literal-valued assertions in structured attributes, for example in:
- `entity_attributes`
- `record_attributes`
- other evidence-scoped structured attribute payloads where appropriate

## Future option

If literal-valued assertions become important enough for first-class querying, filtering, or indexing, introduce a separate normalized table such as:

- `entity_attribute`
  - `entity_pk`
  - `attribute_term_pk`
  - `value`
  - `unit_term_pk`

and, if needed later, an equivalent relation-scoped attribute table.

## Summary

- Keep `entity_relation` strictly entity-to-entity.
- Do not add generic `value` and `unit` columns to the core relation table.
- Use structured attributes for literal-valued facts.
- Normalize into separate attribute tables later only if there is a clear need.
