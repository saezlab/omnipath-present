# PostgreSQL port status

## What I changed

### Search backend wiring
- Added a Postgres-backed compatibility layer in:
  - `next-omnipath/src/lib/postgres-search/search.ts`
- Wired existing search entrypoints to use Postgres first, with Meilisearch fallback:
  - `next-omnipath/src/lib/meilisearch/search.ts`

### Pages partially ported
- Entity page search path now has a Postgres implementation.
- Interactions page search path now has a Postgres implementation.
- Entity hydration/fetch by ID now has a Postgres implementation.
- Association search also has an initial Postgres implementation, but was not fully validated.

### Env/config
- Added Postgres env vars to:
  - `next-omnipath/.env`
  - `.env`
- Values were taken from `../omnipath_build/docker-compose.postgres18.yml`:
  - `DATABASE_URL=postgresql://omnipath:omnipath@localhost:55432/omnipath`
  - `OMNIPATH_PG_SCHEMA=public`
  - `SEARCH_BACKEND=postgres`

## Important fixes made
- Fixed a Postgres bind-parameter bug in entity search when the query string was empty.

## Current state
- Postgres search path is present and env-configured.
- TypeScript compiled successfully before the last attempted UI fallback patch.
- I then started removing expensive facet-count queries and adding frontend-derived fallback filter options.
- That last fallback patch is incomplete and was aborted.

## Known issues / incomplete work
- Expensive facet-count queries from Postgres were removed, which made some filter sidebars empty.
- I started patching the frontend to derive filter options from currently loaded hits instead of backend facet counts, but did not finish.
- Current likely issue area:
  - `next-omnipath/src/features/search/page.tsx`
  - possibly `next-omnipath/src/features/explore/components/interactions-explore-tab.tsx`
- Last seen TS issue during that aborted patch:
  - `SearchResponse | { hits: never[]; error: string; }` handling in `src/features/search/page.tsx`

## Recommended next steps
1. **Stabilize entity filters without backend facet counts**
   - Derive `entity_type`, `sources`, `ncbi_tax_id`, and `ontology_terms` from visible hits on the frontend.
2. **Do the same for interactions filters**
   - Derive `interaction_type`, `is_directed`, `sign`, `sources`, and annotation-term options from visible hits.
3. **Make the query wrappers return one consistent response type**
   - Avoid unions like `SearchResponse | { error: string }` in UI callsites.
4. **Only after UI fallback is stable, decide whether any lightweight backend facet support is still needed.**
5. **Then validate end-to-end with Meilisearch stopped.**

## Suggested short-term goal
Get entity and interactions pages working with:
- Postgres result loading
- no backend facet aggregation
- lightweight frontend-derived filter options from current results
