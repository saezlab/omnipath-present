# Annotation and Identifier Search Requirements

## Scope

This document defines the intended backend/query behavior for:

- entity identifier lookup
- annotation term browse/search

It is intended to align database design, indexes, and frontend query usage.

---

## 1. Entity identifier search

### Intended behavior

Entity identifier lookup is **exact-match only**.

A query must match:

- `entity_identifier.identifier` exactly

### Non-goals

Identifier lookup must **not** support:

- prefix search
- substring search
- fuzzy/trigram search
- ranking by partial match type

### Backend/indexing requirements

The identifier table should keep only the indexes needed for exact lookup and joins:

- primary key / row identity as needed by the schema
- `entity_identifier(entity_pk)` btree index
- hash index on `entity_identifier(identifier)` for exact-match lookup

### Frontend requirements

Frontend identifier resolution must:

- submit exact identifier values only
- treat identifier lookup as a direct resolver, not a search UX

---

## 2. Annotation term browse/search

### Intended behavior

Annotation term browse/search should support:

- browsing available annotation terms
- ranking terms by how many entities they annotate
- searching by accession
- searching by label
- substring support for ontology term text search

### Data source

A PostgreSQL materialized view should back annotation browse/search:

- `public.entity_annotation_search`

### Required fields in the materialized view

The materialized view should expose the fields the frontend needs directly:

- `accession` — ontology term accession / ID
- `label` — display label
- `namespace` — optional ontology namespace
- `definition` — optional definition text
- `annotated_entity_count` — number of distinct annotated entities

### Required aggregation

The materialized view should be built from `entity_annotation` and grouped by annotation accession, counting distinct entities:

- group by term accession
- count `DISTINCT entity_pk`

If ontology metadata is stored separately, the view should join that source to populate:

- `label`
- `namespace`
- `definition`

### Query behavior

#### Browse

Default annotation browse should:

- list terms from `entity_annotation_search`
- order by `annotated_entity_count DESC, accession ASC`

#### Search

Annotation search should support:

- exact or partial accession matching
- substring matching on `label`
- optional substring matching on `definition` if acceptable for performance and relevance

#### Scoped annotation listing

When the UI is scoped to a selected entity set, the backend should return:

- matching annotation terms within that scope
- scoped `annotated_entity_count`

---

## 3. Indexing requirements for annotation search

### Required indexes

The materialized view should have:

- unique index on `accession`
- browse/sort index on `(annotated_entity_count DESC, accession)`

### Search indexes

Because annotation search should support substring matching, plain btree indexes are not sufficient for the main text-search path.

Recommended:

- trigram index on `label`
- trigram index on `accession` if accession substring search is supported

Optional, depending on whether definition search is enabled:

- trigram index on `definition`

If search is implemented via normalized lowercase expressions, indexes should be created on the same expression used by the query.

---

## 4. Frontend contract

For annotation browse/listing, the frontend should receive:

- `id` / `accession`
- `label`
- `namespace`
- `definition`
- `annotatedEntityCount`

The frontend should not need a second metadata-resolution request for standard annotation browse results if the materialized view already provides these fields.

Search-specific scoring/explanation fields such as:

- `matchType`
- `matchedText`
- `score`

are optional and are not required in the materialized view.

---

## 5. Summary

### Identifier lookup

- exact-match only
- minimal exact-lookup indexing
- no partial/fuzzy behavior

### Annotation term search

- materialized-view-backed
- frontend-ready fields included in the view
- ranked by annotated entity count
- substring support for ontology text search
- indexes designed for both browse ordering and substring search
