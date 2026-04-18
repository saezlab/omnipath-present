# Query refactor plan

## Goal

Move the app away from the old Meilisearch-shaped response model and toward a query layer that reflects the actual Postgres/Drizzle schema.

## First-principles direction

Instead of:
- querying Postgres,
- reshaping rows into old Meilisearch-style documents,
- and teaching the frontend to keep consuming those legacy shapes,

we should:
- define the frontend data needs per screen / interaction,
- query the Postgres schema directly for those needs,
- use Drizzle types as the source of truth wherever possible,
- return small, explicit view models or query result types,
- and update the frontend to consume those new shapes.

## Temporary rule

For now, **centralize app querying in a single `queries.ts` module** rather than spreading data access across:
- feature-local `queries.ts`
- `lib/data/search.ts`
- `lib/postgres-search/search.ts`
- component-local async helpers

This is a temporary consolidation step to make the next round of refactoring easier.

---

## Current problems to address

1. **Legacy Meilisearch response emulation**
   - We still map Postgres rows into legacy shapes like entity/interactions/associations “documents”.
   - This keeps old field names and old assumptions alive in the UI.

2. **Query logic is split across many layers**
   - Search/data fetching currently lives in multiple files and some components still do their own ad hoc fetch shaping.

3. **UI types are too coupled to old backend shapes**
   - The frontend still expects `Meilisearch*` style payloads, even when the backing data is relational.

4. **Search-oriented API leaked everywhere**
   - Concepts like `index`, `documents`, and Meilisearch-era filter contracts are still present in many places.

5. **Postgres queries are still mostly hand-shaped SQL adapters**
   - We introduced a shared Drizzle DB client, but most query/result design is still legacy-adapter driven.

---

## Desired target state

### One central query module
Create one temporary canonical module, likely:
- `src/lib/queries.ts`

This module should own all app-level query functions for now.

### Query functions should be screen/use-case oriented
Prefer functions like:
- `getEntityByPublicId(...)`
- `searchEntities(...)`
- `getEntitySearchFacets(...)`
- `searchInteractions(...)`
- `getInteractionById(...)`
- `searchAssociations(...)`
- `getAssociatedEntityScope(...)`
- `resolveOntologyTerms(...)`
- `browseTopOntologyTerms(...)`

Avoid generic legacy shapes like:
- `fetchDocuments(...)`
- `searchMeilisearch(...)`
- `index: "search_entities"`

### Use Drizzle as source of truth
Guidelines:
- Use Drizzle schema types for full-row/select typing.
- Use explicit query result/view-model types for frontend payloads.
- Do **not** generate a fake search-document layer unless the UI actually needs it.
- Keep raw SQL only where Drizzle query builder is too cumbersome, but still wrap it in typed query functions.

### Frontend should consume new shapes
Examples:
- entity views should consume entity-centric data, not “entity search document” data
- interaction detail views should consume interaction rows + joined participants/evidence
- association views should consume association rows + parent/member info
- filters/facets should be requested as dedicated facet queries, not piggybacked on search document conventions

---

## Queries to centralize and redesign

Below is the current inventory of query-like functions that should be reviewed and moved into one `queries.ts` module.

### A. Core search / data layer

#### `src/lib/data/search.ts`
- `search`
- `searchEntities`
- `searchInteractions`
- `searchAssociations`
- `fetchDocuments`
- `getInteractionStats`

**Action**
- Move into central `queries.ts`.
- Rename away from generic search engine terminology where needed.
- Reevaluate whether `fetchDocuments` should exist at all.

#### `src/lib/postgres-search/search.ts`
- `getEntityFilterFacetDistributionPostgres`
- `getInteractionFilterFacetDistributionPostgres`
- `searchEntitiesPostgres`
- `fetchDocumentsPostgres`
- `searchInteractionsPostgres`
- `searchAssociationsPostgres`
- `getInteractionStatsPostgres`

**Action**
- Keep only as implementation detail temporarily, or fold into `queries.ts`.
- Redesign return shapes around actual UI/use-case needs.
- Reduce mapping into old `SearchResult` / legacy document forms.

#### `src/lib/meilisearch/search.ts`
- compatibility only

**Action**
- Keep as a temporary shim only if needed.
- Delete once all callers are migrated.

---

### B. Feature query modules to merge into one `queries.ts`

#### `src/features/search/api/queries.ts`
- `searchEntities`
- `fetchEntityDocuments`

**Action**
- Move into central `queries.ts`.
- Replace `fetchEntityDocuments` with a more direct entity query, likely `getEntitiesByIds` / `getEntityById`.

#### `src/features/interactions-search/api/queries.ts`
- `searchInteractions`
- `fetchEntitiesByIds`
- `searchAssociations`

**Action**
- Move into central `queries.ts`.
- Rework `fetchEntitiesByIds` to return a deliberate lightweight entity summary type.
- Avoid parsing “entity documents” for interaction UI helpers.

#### `src/features/explore/api/queries.ts`
- `resolveOntologyTerms`
- `searchOntologyTerms`
- `browseTopOntologyTerms`
- internal: `browseOntologyTermsFromEntityHits`

**Action**
- Move into central `queries.ts`.
- Revisit `browseOntologyTermsFromEntityHits`; this is currently derived from entity search hits and may deserve a dedicated backend query.

---

### C. Query logic currently living outside query modules

#### `src/features/selection/selection-scope.ts`
- `fetchEntityIdsForSelectedAnnotations`

**Action**
- Move into central `queries.ts`.
- Likely replace with a direct annotation → entity lookup query.

#### `src/lib/associations/associated-entities.ts`
- `getAssociatedEntityScope`

**Action**
- Move into central `queries.ts`.
- Design around association rows instead of association search hits if possible.

#### `src/features/explore/components/annotation-browser-tab.tsx`
- `fetchScopedAnnotationTerms`

**Action**
- Move into central `queries.ts`.
- Replace current “search entities then aggregate ontology terms in the UI layer” approach with a dedicated query.

#### `src/features/interactions-search/components/graph-view.tsx`
- `fetchEntityDocument`

**Action**
- Remove component-local query helper.
- Replace with central entity query.

#### `src/features/workspace/views/selection-results-view.tsx`
- local `fetchCounts`

**Action**
- Move logic into central `queries.ts` if it is reusable or domain-level.

---

## Frontend surfaces that need shape redesign

These UI areas are still likely consuming legacy search-document style data and should be updated to consume schema-driven results.

### Entity search + entity details
Likely files:
- `src/features/search/page.tsx`
- `src/hooks/use-entity.ts`
- `src/features/search/components/result-card.tsx`
- `src/features/search/components/entity-details-dialog.tsx`

**Needs**
- Define a proper entity summary type for list views.
- Define a proper entity detail type for detail dialogs.
- Stop using generic search-document payloads where a typed entity DTO would be clearer.

### Interaction explore / interaction details
Likely files:
- `src/features/explore/components/interactions-explore-tab.tsx`
- `src/features/interactions-search/components/interaction-details.tsx`
- `src/features/interactions-search/components/interaction-details-sheet.tsx`
- `src/features/interactions-search/components/filter-sidebar.tsx`

**Needs**
- Define interaction list row shape.
- Define interaction detail shape.
- Define interaction facet/filter result shape separately.
- Stop carrying over Meilisearch-era interaction compatibility fields unless the UI truly needs them.

### Association flows
Likely files:
- `src/features/search/components/entity-details-dialog.tsx`
- `src/lib/associations/associated-entities.ts`

**Needs**
- Define a true association row shape.
- Decide whether association evidence needs a separate detail query.

### Ontology / annotation browsing
Likely files:
- `src/features/explore/components/annotation-browser-tab.tsx`
- `src/features/explore/api/queries.ts`
- `src/features/selection/selection-scope.ts`

**Needs**
- Direct annotation aggregation queries.
- Direct annotation → entities lookup.
- Avoid deriving ontology browsing entirely from fetched entity hit payloads.

### Chat tools / tool result navigation
Likely files:
- `src/app/app-api/chat/route.ts`
- `src/features/chat/tool-result-navigation.ts`
- `src/features/chat/components/results-panel.tsx`

**Needs**
- Update tool contracts to emit/use backend-neutral filters and result shapes.
- Remove remaining dependency on `index` / Meilisearch naming.

---

## Proposed next implementation steps

### Phase 1: centralize
- [ ] Create `src/lib/queries.ts`.
- [ ] Move all feature query helpers into it.
- [ ] Make components/hooks call only `src/lib/queries.ts`.
- [ ] Keep old modules as re-export shims temporarily if needed.

### Phase 2: define new result models from UI needs
- [ ] Define `EntityListItem`
- [ ] Define `EntityDetails`
- [ ] Define `InteractionListItem`
- [ ] Define `InteractionDetails`
- [ ] Define `AssociationListItem`
- [ ] Define `OntologyTermSummary`
- [ ] Define explicit facet result types

### Phase 3: replace legacy adapters
- [ ] Remove generic “document” fetch pattern where not needed.
- [ ] Remove `index`/`documents` terminology from app-level APIs.
- [ ] Remove Meilisearch compatibility fields from result types unless explicitly required.
- [ ] Replace UI assumptions based on old search documents.

### Phase 4: increase Drizzle usage
- [ ] Move more query typing to Drizzle inferred types.
- [ ] Use dedicated query DTOs instead of hand-maintained legacy object shapes.
- [ ] Consider dedicated repository helpers by domain if `queries.ts` gets too large.

### Phase 5: delete compatibility layer
- [ ] Delete `src/lib/meilisearch/search.ts`
- [ ] Delete `src/lib/search/indexes.ts`
- [ ] Delete `src/types/meilisearch.ts`
- [ ] Remove remaining `Meilisearch*` names from comments, types, and variable names

---

## Short-term rule of thumb

When touching a query next:
1. Put it in one central `queries.ts`.
2. Name it by domain/use-case, not by old search engine concepts.
3. Return the smallest useful typed shape for the UI.
4. Prefer adapting the frontend to the schema-backed result, rather than adapting the backend result to an old Meilisearch document format.
