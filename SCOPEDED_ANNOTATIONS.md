# Scoped Annotations: Bug Fixes & Performance

## Problem

Two bugs on `/selection` + one performance issue:

1. **Entities tab**: Selecting a CV term + entity only showed one set, not both
2. **414 Request-URI Too Large**: CV terms like CHEBI:24431 (194k entities) stuffed all entity IDs into the URL
3. **Annotations tab**: Scoped query took ~6s for popular terms — PostgreSQL fan-out on `entity_relation` (5.9M annotation rows) produced 4.7M intermediate rows

## Solutions

### Client-side

- Client sends `selectedEntityPks` (integers) and `selectedAnnotationIds` (term IDs) instead of resolving all entity IDs
- `fetchScopedOntologySearch` switched from GET to POST; no entity IDs in URLs
- `SelectedEntity` includes `entityPk` field from search results

### Server-side

- `searchEntities` accepts `entity_pks` (bigint[]) + `annotation_term_ids` (text[]) with OR logic
- `searchScopedOntologyTerms` uses a **bitmap-based** approach for scoped counting (with relational fallback):
  - Builds a `scope_bitmap` by ORing bitmaps of selected annotation terms + selected entity PKs
  - Computes `scoped_count(term) = cardinality(term_bitmap AND scope_bitmap)` via fast bit operations
  - Falls back to the two-phase CTE relational path when the bitmap table is unavailable
- Forces `MATERIALIZED` CTEs to prevent PostgreSQL from inlining and re-triggering the 4.7M fan-out
- **Counts**: now uses accurate scoped counts from bitmap intersections, not global counts

### Database

- Created `entity_annotation` materialized view (`entity_pk, term_entity_pk`) from `entity_relation WHERE relation_category = 'annotation'`
- Created `annotation_term_entity_bitmap` table (`term_entity_pk, entity_bitmap, global_count`) with `roaringbitmap` type
- Populated via `rb_build_agg(entity_pk::integer)` grouped by `term_entity_pk`
- Stored procedure `rebuild_annotation_term_bitmaps()` truncates and repopulates the table
- Indexes: `idx_entity_annotation_entity_term` (unique, covering), `idx_entity_annotation_term`, `entity_canonical_identifier_hash_idx`, `entity_relation_category_object_idx`, `entity_relation_subject_category_idx2`
- Requires `REFRESH MATERIALIZED VIEW entity_annotation` after data changes
- **After refreshing `entity_annotation`, run `CALL rebuild_annotation_term_bitmaps()`** (or `await rebuildAnnotationTermBitmaps()` in Node.js) to keep bitmaps in sync

### Docker / Postgres Extension

- Custom `postgres/Dockerfile` installs the `pg_roaringbitmap` extension
- Both `docker-compose.yaml` and `docker-compose.dev.yaml` build Postgres from `./postgres` instead of using `image: postgres:18`
- Init script `postgres/init-scripts/01-setup-bitmaps.sql` creates the extension and table on fresh databases
- Existing databases must run `postgres/setup-bitmaps.sql` manually

### Performance

| Scenario | Before | After (CTE only) | After (bitmaps) |
|---|---|---|---|
| CHEBI:24431 annotations (194k entities) | ~6.2s | ~0.8s | **< 200ms** |
| R-HSA-162582 scoped search | ~3s+ | ~0.3s | **< 100ms** |
| Entity PKs only | N/A | ~10ms | ~10ms |

## Implementation details

### Bitmap query flow

1. **Build scope bitmap**
   - Resolve `selectedAnnotationIds` → `term_entity_pk` → OR their stored bitmaps
   - Build bitmap from `selectedEntityPks` via `rb_build(entity_pks::integer[])`
   - Aggregate with `rb_or_agg(...)` into a single `scope_bitmap`

2. **Compute scoped counts**
   - Join `ontology_term` → `entity` → `annotation_term_entity_bitmap`
   - Cross-join `scope_bitmap`
   - `rb_cardinality(rb_and(term_bitmap, scope_bitmap))` gives the exact scoped count
   - Filter `scoped_count > 0`, order by `scoped_count DESC`

3. **Fallback**
   - If `annotation_term_entity_bitmap` is missing/empty, or entity PKs exceed 32-bit range, falls back to the relational CTE path

### Important notes

- **32-bit limit**: `pg_roaringbitmap` stores 32-bit integers. If `entity_pk` exceeds `2,147,483,647`, introduce an `entity_ordinal` mapping table and store ordinals instead of raw PKs in the bitmaps.
- **Storage trade-off**: bitmaps use more disk space than the relational table but deliver sub-second scoped counting.
- **Maintenance**: bitmaps are a derived snapshot. They must be rebuilt after every `REFRESH MATERIALIZED VIEW entity_annotation`.
