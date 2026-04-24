# Refactor discovery: new graph schema/data + removed entity service

Date: 2026-04-24

## Context

Inputs reviewed:

- New Drizzle schema: `next-omnipath/drizzle/schema.ts`
- New build data: `/Users/jschaul/Code/omnipath_build/data`
- Current API service code under `api-service/api_service`
- Docker compose files and existing Next/Postgres query helpers

The old standalone `entity-service` has been removed from the repo, but `api-service` and Docker still assume it exists.

## New schema/data shape observed

### Postgres/Drizzle tables

`next-omnipath/drizzle/schema.ts` now defines a compact graph-like schema:

- `entity`
  - `entity_pk` bigint PK
  - `canonical_identifier`, `canonical_identifier_type`
  - `entity_type`, `taxonomy_id`, `entity_attributes` JSONB, `sources[]`
- `entity_identifier`
  - `id` bigserial PK
  - `entity_pk` FK to `entity`
  - `identifier`, `identifier_type`
  - hash indexes on identifier / lower(identifier)
- `entity_relation`
  - `relation_pk` PK
  - `subject_entity_pk`, `predicate`, `object_entity_pk`
  - `relation_category`, `participant_types[]`, `evidence_count`, `sources[]`
- `entity_relation_evidence`
  - `relation_evidence_pk` PK
  - `relation_pk` FK
  - source plus record/subject/object/evidence JSONB payloads
- `relation_annotation_term`
  - `(term_id, scope, relation_evidence_pk)` primary key
  - links relation evidence to ontology terms
- `ontology_term`
- `resources`

### New combined data folder

`/Users/jschaul/Code/omnipath_build/data/combined` contains:

- `entity.parquet`
- `entity_relation.parquet`
- `entity_relation_evidence.parquet`
- `relation_annotation_term.parquet`
- `ontology_term.parquet`
- `resources.parquet`
- build summaries JSON

Important parquet schemas sampled:

```text
entity.parquet:
  entity_pk: Int64
  canonical_identifier: String
  canonical_identifier_type: String
  identifiers: List(Struct(identifier, identifier_type))
  entity_type: String
  taxonomy_id: String
  entity_attributes: List(Struct(term, value, unit))
  sources: List(String)

entity_relation.parquet:
  relation_pk: Int64
  subject_entity_pk: Int64
  predicate: String
  object_entity_pk: Int64
  relation_category: String
  participant_types: List(String)
  evidence_count: Int64
  sources: List(String)

entity_relation_evidence.parquet:
  source: String
  relation_evidence_pk: Int64
  relation_pk: Int64
  record_attributes / subject_attributes / object_attributes / evidence:
    List(Struct(term, value, unit))

relation_annotation_term.parquet:
  relation_pk: Int64
  relation_evidence_pk: Int64
  source: String
  scope: String
  term_id: String
```

Notably, the combined folder does **not** contain the old `search_entities.parquet`, `search_interactions.parquet`, `search_associations.parquet`, or `entity_identifier.parquet` files that `api-service` currently expects. Identifier data is nested inside `entity.parquet` and exposed as a normalized Postgres table by the schema.

### New gold folder shape

`/Users/jschaul/Code/omnipath_build/data/gold/<resource>/<resource>.zip` exists for built resources. The zip files contain paths such as:

- `entities/entity.parquet`
- `entities/entity_map.parquet`
- `relations/entity_relation.parquet`
- `relations/entity_relation_evidence.parquet`

The current API resource download/workspace code expects versioned directories with `latest` pointers and loose parquet artifacts, so it does not match this new layout.

## Current entity-service references found

### `api-service/api_service/main.py`

- Imports `httpx` only to call the removed resolver.
- Defines:

```python
ENTITY_SERVICE_URL = os.getenv("ENTITY_SERVICE_URL", "http://localhost:8080")
```

- `/entity-lookup` endpoint currently posts to:

```python
POST {ENTITY_SERVICE_URL}/lookup
```

- Response is then used to load old entity documents from `search_entities.parquet` via `_load_entity_documents()`.

This will fail now because:

1. the service no longer exists,
2. Docker still points to a missing `./entity-service`, and
3. the expected `search_entities.parquet` entity document file is not in the new combined data.

### Docker compose

`docker-compose.yaml` and `docker-compose.dev.yaml` still define `entity-resolver-service` using `./entity-service`, and `api-service` still receives `ENTITY_SERVICE_URL=http://entity-resolver-service:8080`.

`next-omnipath` depends on `entity-resolver-service` in production compose.

This must be removed or replaced because the directory is missing.

### Existing Next/Postgres implementation

`next-omnipath/src/lib/queries/entity-identifier.ts` already implements identifier resolution via Postgres:

- joins `entity_identifier` to `entity`
- exact match first, lower-case fallback
- returns `{ matches, entities }`
- public entity IDs are produced by `toPublicEntityId(entity)`

This is the strongest implementation reference for replacing `/entity-lookup` behavior.

## Other API-service incompatibilities with the new data/schema

### Export endpoints still target old denormalized search parquets

`api-service/api_service/exports.py` defines:

```python
INTERACTIONS_PARQUET = data/search_interactions.parquet
ENTITIES_PARQUET = data/search_entities.parquet
ASSOCIATIONS_PARQUET = data/search_associations.parquet
```

The new data uses graph tables, so these paths and filters are stale.

Old filters expect fields such as:

- `entity_id`
- `interaction_id`, `interaction_key`
- `member_a_id`, `member_b_id`
- `interaction_type`
- `has_direction`, `has_positive_sign`, `has_negative_sign`
- `association_id`, `parent_entity_id`, `member_entity_id`
- denormalized list columns like `ontology_terms`, `participant_annotation_terms`

New data has:

- numeric `entity_pk` and `relation_pk`
- relation participants as `subject_entity_pk` / `object_entity_pk`
- relation type via `predicate` and `relation_category`
- evidence in `entity_relation_evidence`
- annotation term filters in `relation_annotation_term`

### Evidence lookup endpoints still target old interaction/association parquets

`api-service/api_service/main.py` exposes:

- `GET /interactions/{interaction_id}/evidence`
- `GET /associations/{association_id}/evidence`

Both call `_load_evidence_row()` on old search parquet paths and expect columns:

- `interaction_id` / `interaction_key` / `evidence`
- `association_id` / `association_key` / `evidence`

These should be replaced or aliased to relation evidence lookups using `relation_pk` / `relation_evidence_pk` and `entity_relation_evidence.parquet` or Postgres.

### Resource catalog/download/workspace paths assume old data layout

- `api-service/api_service/resource_catalog.py`
  - reads `get_gold_root() / "resources.parquet"`
  - new resources file is under `data/combined/resources.parquet`
- `api-service/api_service/resource_downloads.py`
  - default root still searches `omnipath_build/data_v2/gold`
  - requires `gold/<resource>/latest` version pointers
  - expects archives inside version dirs
- `api-service/api_service/resource_workspace.py`
  - allows old loose artifact names:
    - `entities.parquet`
    - `interactions.parquet`
    - `associations.parquet`
    - `annotations.parquet`
    - `entity_identifiers_source.parquet`
    - `entity_identifiers_resolved.parquet`
  - new zips contain `entities/entity.parquet`, `entities/entity_map.parquet`, `relations/entity_relation.parquet`, `relations/entity_relation_evidence.parquet`

## Decisions from follow-up

The refactor should proceed with these product/architecture decisions:

1. `api-service` should connect to Postgres directly.
2. Public/API workflows may move to numeric `entity_pk`; no need to preserve public string entity IDs.
3. Do **not** implement backward compatibility for old search/index/export shapes.
4. The new canonical relation categories are:
   - `interaction`
   - `membership`
   - `annotation`
5. Old denormalized `search_*.parquet` files are fully retired.
6. Resource workspaces are no longer supported; remove workspace code/endpoints rather than adapting them.

## Recommended refactor task list

### P0 — Unblock startup by removing the deleted service wiring

1. Remove `entity-resolver-service` from:
   - `docker-compose.yaml`
   - `docker-compose.dev.yaml`
2. Remove `ENTITY_SERVICE_URL` environment variables from `api-service` containers.
3. Remove `entity-resolver-service` from `next-omnipath.depends_on`.
4. Update compose comments/defaults from old `data/output/latest` / `data_v2/gold` paths to the new data layout, likely:
   - `DATA_DIR=/Users/jschaul/Code/omnipath_build/data/combined`
   - `GOLD_ROOT_DIR=/Users/jschaul/Code/omnipath_build/data/gold`

### P0 — Replace old `/entity-lookup` with `/entities/resolve`

`api-service` should own this endpoint and connect to Postgres directly. The old `/entity-lookup` endpoint should be removed rather than kept as an alias.

1. Add a Python Postgres dependency (`psycopg[binary]` or `asyncpg`) to `api-service/pyproject.toml`.
2. Add `DATABASE_URL` config/env for `api-service` in Docker and local docs.
3. Implement `POST /entities/resolve` with SQL over `entity_identifier` + `entity`:
   - exact `identifier = ANY(...)`
   - fallback `LOWER(identifier) = ANY(...)`
   - join `entity_identifier` to `entity`
4. Endpoint contract should return `entity_pk` values, not old public string entity IDs.
   - Suggested response shape:
     - `matches[].identifier`
     - `matches[].entityPks: number[]`
     - `entities[]` rows from `entity`
5. Remove the now-unneeded `httpx` import and `ENTITY_SERVICE_URL` constant.
6. Remove old `/entity-lookup` docs/tests.
7. Update tests for `/entities/resolve`.

### P0 — Refactor export endpoints to graph-native combined parquets

Old denormalized `search_entities.parquet`, `search_interactions.parquet`, and `search_associations.parquet` are fully retired. Do not regenerate compatibility files.

Use **Polars over combined parquets** for export filtering and output. Postgres is for entity identifier resolution; export/slice data should come from `/data` combined parquet files.

Canonical input files:

- `entity.parquet`
- `entity_relation.parquet`
- `entity_relation_evidence.parquet`
- `relation_annotation_term.parquet`
- `ontology_term.parquet`
- `resources.parquet`

New API semantics should be numeric-primary-key based:

- `entities` export filters:
  - `entity_pks`
  - `entity_types`
  - `taxonomy_ids`
  - `sources`
- `relations` export filters:
  - `relation_pks`
  - `subject_entity_pks`
  - `object_entity_pks`
  - generic `entity_pks` applying to `subject_entity_pk OR object_entity_pk`
  - `predicates`
  - `relation_categories`: one or more of `interaction`, `membership`, `annotation`
  - `participant_types`
  - `sources`
  - `annotation_terms` / ontology term filters via `relation_annotation_term`

Endpoint cleanup/refactor:

1. Keep/refactor the important export endpoints only.
2. Remove unused old endpoints rather than preserving aliases.
3. Replace old interaction/association-specific export internals with graph-native relation exports.
4. Add/keep category-specific exports only if they directly map to `relation_category` without old field names.
5. Ensure filtered slice endpoints use the same filter model as the already-updated frontend.

### P1 — Replace evidence/slice endpoints with graph-native relation endpoints

1. Remove old `/interactions/{id}/evidence` and `/associations/{id}/evidence` endpoints if unused.
2. Add/standardize graph-native endpoints only if needed by frontend/API docs, for example:
   - `GET /relations/{relation_pk}/evidence`
   - `GET /relation-evidence/{relation_evidence_pk}`
3. Implement against `entity_relation_evidence.parquet` using Polars.
4. Align filtered slice endpoints with the new frontend filter model:
   - numeric `entity_pks`
   - `relation_pks`
   - subject/object entity PKs
   - `relation_categories`: `interaction`, `membership`, `annotation`
   - predicates/sources/participant types/annotation terms

### P1 — Refactor resource catalog/download and remove workspaces

1. Make resource catalog read `combined/resources.parquet`, not `gold/resources.parquet`.
2. Update `get_gold_root()` default from `data_v2/gold` to `data/gold`.
3. Update download resolution:
   - new direct archive: `gold/<resource>/<resource>.zip`
   - no `latest` pointer/version dir required for current data
4. Remove resource workspace support entirely:
   - delete or stop importing `api-service/api_service/resource_workspace.py`
   - remove workspace manifest/artifact endpoints from `api-service/api_service/main.py`
   - remove associated tests and frontend calls/docs
   - remove old allowed artifact names (`entities.parquet`, `interactions.parquet`, etc.)

### P1 — Move API/UI entity selection to `entity_pk`

The new relational schema uses numeric `entity_pk`, and workflows may move to that directly.

Tasks:

1. Update query/filter types from `entity_ids` string arrays to `entity_pks` number arrays where they refer to database entities.
2. Update `/entity-lookup` to return `matches[].entityPks`.
3. Update relation queries and exports to filter with `subject_entity_pk` / `object_entity_pk`.
4. Keep `next-omnipath/src/lib/entity-public-id.ts` only for display/deep-link parsing if still needed, not as the main API key.
5. Document `entity_pk` as the external API identifier going forward.

### P2 — Documentation and API docs cleanup

Update docs and API examples that still describe old search parquet fields or old routes:

- `api-service/README.md`
- `docker-compose*.yaml` comments
- docs mentioning `search_entities`, `search_interactions`, `search_associations`, and `entity_identifier.parquet`
- docs mentioning `/entity-lookup`; replace with `/entities/resolve`

Frontend docs/examples are lower priority because the frontend has already been adapted.

### P2 — Tests

Add/update tests for:

- entity lookup via Postgres, including exact and case-insensitive fallback
- missing/empty identifier input
- resource download with direct `gold/<resource>/<resource>.zip`
- evidence lookup via `relation_pk` / `relation_evidence_pk`
- export filters on new graph parquets or compatibility parquets, depending chosen strategy

## Suggested implementation order

1. Remove dead Docker/service wiring.
2. Replace `/entity-lookup` with Postgres-backed implementation or move it to Next.
3. Fix resource catalog/download path assumptions because these are clear layout mismatches.
4. Decide compatibility vs graph-native exports.
5. Refactor evidence/export endpoints and update API docs/UI.

## Resolved design questions

1. `api-service` connects to Postgres directly for identifier resolution.
2. Frontend has already been adapted; API cleanup can remove unused old endpoints.
3. Export and filtered slice endpoints should use Polars over combined parquets.
4. Entity identifier resolution route should be `POST /entities/resolve`, replacing `/entity-lookup`.

## Implemented API endpoint decisions

A single relation endpoint family is enough. Implemented/target endpoint names and shapes:

- `POST /entities/resolve`
  - request: `{ "identifiers": ["TP53", "P04637"] }`
  - response: `{ "matches": [{ "identifier": "TP53", "entityPks": [123] }], "entities": [...] }`
  - uses Postgres directly via `DATABASE_URL`.
- `POST /entities/slice`
  - request: `{ "query": "", "filters": { ... }, "limit": 50, "offset": 0 }`
  - response: `{ "rows": [...], "total": 123, "limit": 50, "offset": 0 }`
  - uses Polars over `entity.parquet`.
- `POST /relations/slice`
  - request: `{ "query": "", "filters": { ... }, "limit": 50, "offset": 0 }`
  - response: `{ "rows": [...], "total": 123, "limit": 50, "offset": 0 }`
  - uses Polars over `entity_relation.parquet`, with optional semi-join to `relation_annotation_term.parquet` for annotation filters.
- `POST /exports/entities/parquet`
  - request: `{ "query": "", "filters": { ... }, "filename": "entities_subset" }`
  - response: parquet file.
- `POST /exports/relations/parquet`
  - request: `{ "query": "", "filters": { ... }, "filename": "relations_subset" }`
  - response: parquet file.

Entity filters:

- `entity_pks`
- `entity_types`
- `taxonomy_ids`
- `sources`

Relation filters:

- `relation_pks`
- `subject_entity_pks`
- `object_entity_pks`
- `entity_pks`
- `predicates`
- `relation_categories`: `interaction`, `membership`, `annotation`
- `participant_types`
- `sources`
- `annotation_terms` / `ontology_terms`
- `annotation_scopes`

