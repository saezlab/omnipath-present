# PostgreSQL port status

## Current status
- Postgres search is wired and enabled via env.
- Entity search, interaction search, entity fetch-by-id, and association search all have Postgres implementations.
- Query wrappers now return a consistent response type.
- The combined Postgres import was rerun successfully.

## Filter support
- Added precomputed Postgres materialized views in `../omnipath_build`:
  - `public.entity_filter_counts`
  - `public.interaction_filter_counts`
- The frontend now uses these backend-provided filter counts instead of deriving them from the first page of hits.
- Interaction type counts are normalized order-independently.

## UI fixes made
- Fixed entity type filter normalization for Postgres.
- Fixed source filter behavior in the entity sidebar.
- Made small-molecule structure rendering lazy on click to avoid blocking the page.
- Suppressed the empty-state ontology message when no ontology query is entered.

## Current state
- TypeScript passes in `next-omnipath`.
- Postgres-backed entity and interaction filtering is working much better.
- Global filter counts now come from Postgres materialized views rather than client-side fallbacks.

## Next steps
1. Validate entity filters end-to-end with real UI testing, especially `small molecule`, `protein`, and source combinations.
2. Validate interaction filters end-to-end, especially interaction type combinations and sign/direction filters.
3. Decide whether ontology term counts also need a precomputed Postgres view, or whether search-only ontology browsing is enough.
4. Validate association search thoroughly; it still has the least coverage.
5. Test with Meilisearch fully stopped and clean up any remaining fallback-only code.
