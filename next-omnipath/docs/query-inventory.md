# Query inventory

Last updated: 2026-04-18

This inventory is the starting point for the refactor described in `docs/query-refactor-plan.md`.
It focuses on **query entry points and query helpers used by the app**: app-level search/query wrappers, Postgres implementations, feature-local query modules, component-local query helpers, and chat/API-service lookups that currently participate in the app's query surface.

## Summary

### Current app query layers

1. **Temporary canonical-ish app data layer**
   - `src/lib/data/search.ts`
2. **Legacy compatibility layer**
   - `src/lib/meilisearch/search.ts`
3. **Feature-local query modules**
   - `src/features/search/api/queries.ts`
   - `src/features/interactions-search/api/queries.ts`
   - `src/features/explore/api/queries.ts`
4. **Component/local query helpers that should move out**
   - `src/features/selection/selection-scope.ts`
   - `src/lib/associations/associated-entities.ts`
   - `src/features/explore/components/annotation-browser-tab.tsx`
   - `src/features/workspace/views/selection-results-view.tsx`
5. **Implementation layer**
   - `src/lib/postgres-search/search.ts`
6. **Chat tool query surface**
   - `src/app/app-api/chat/route.ts`

### High-level count

- **5** app-level query functions in `src/lib/data/search.ts`
- **7** Postgres implementation/query functions in `src/lib/postgres-search/search.ts`
- **4** Meilisearch compatibility functions in `src/lib/meilisearch/search.ts`
- **9** feature-local exported query functions across feature `queries.ts` files
- **5** component/local query helpers outside central query modules
- **7** chat tool operations that issue app queries or API-service lookups

---

## A. App-level query layer

### `src/lib/data/search.ts`

| Function | Line | Kind | Calls | Current shape / notes |
|---|---:|---|---|---|
| `search` | 28 | app query router | `searchEntitiesPostgres`, `searchInteractionsPostgres`, `searchAssociationsPostgres` | Generic target-based router; still uses search-engine-style terminology (`target`) |
| `searchEntities` | 69 | app query wrapper | `search` | Entity search wrapper |
| `searchInteractions` | 73 | app query wrapper | `search` | Interaction search wrapper |
| `searchAssociations` | 77 | app query wrapper | `search` | Association search wrapper |
| `fetchDocuments` | 81 | app document fetch wrapper | `fetchDocumentsPostgres` | Legacy document-oriented fetch API |
| `getInteractionStats` | 88 | stats query | `getInteractionStatsPostgres` | Aggregate/stats helper |

**Refactor note**
- This is the closest thing to the current central query layer, but it still exposes legacy search/document concepts.

---

## B. Postgres implementation layer

### `src/lib/postgres-search/search.ts`

| Function | Line | Kind | Current responsibility | Notes |
|---|---:|---|---|---|
| `getEntityFilterFacetDistributionPostgres` | 252 | facet query | Entity facet counts | Uses materialized view fast path or filtered SQL |
| `getInteractionFilterFacetDistributionPostgres` | 352 | facet query | Interaction facet counts | Materialized-view-backed |
| `searchEntitiesPostgres` | 409 | search query | Entity search against Postgres | Returns legacy-ish mapped `SearchResponse` hits |
| `fetchEntityRowsByPublicIds` | 526 | direct row fetch helper | Fetch entities by public IDs | Internal helper for document fetch |
| `fetchDocumentsPostgres` | 561 | document fetch query | Fetch entity "documents" by IDs | Only supports `search_entities` |
| `searchInteractionsPostgres` | 673 | search query | Interaction search against Postgres | Joins entities, annotations, evidence |
| `searchAssociationsPostgres` | 854 | search query | Association search against Postgres | Joins parent/member entities and evidence |
| `getInteractionStatsPostgres` | 942 | stats query | Interaction document count | Legacy naming (`numberOfDocuments`) |

**Refactor note**
- This file currently contains the real backing queries, but most return shapes are still adapted into legacy search result forms.

---

## C. Legacy Meilisearch compatibility layer

### `src/lib/meilisearch/search.ts`

| Function | Line | Kind | Calls | Notes |
|---|---:|---|---|---|
| `searchMeilisearch` | 28 | compatibility wrapper | `search` | Search-engine naming only |
| `searchInteractionsMeilisearch` | 33 | compatibility wrapper | `searchInteractions` | Thin alias |
| `fetchMeilisearchDocuments` | 40 | compatibility wrapper | `fetchDocuments` | Thin alias |
| `searchAssociationsMeilisearch` | 50 | compatibility wrapper | `searchAssociations` | Thin alias |

**Refactor note**
- Pure compatibility surface; candidate for deletion after callers are migrated.

---

## D. Feature-local query modules

### `src/features/search/api/queries.ts`

| Function | Line | Kind | Calls | Notes |
|---|---:|---|---|---|
| `searchEntities` | 12 | feature query wrapper | `lib/data/search.search` | Accepts both `target` and `index`; exposes legacy naming |
| `fetchEntityDocuments` | 61 | feature document fetch | `fetchDocuments` | Legacy document API |
| `searchMeilisearch` | 72 | compatibility alias | `searchEntities` | Search-engine naming |

Additional aliases:
- `searchResults = searchEntities`
- `fetchSearchDocuments = fetchEntityDocuments`

### `src/features/interactions-search/api/queries.ts`

| Function | Line | Kind | Calls | Notes |
|---|---:|---|---|---|
| `searchInteractions` | 22 | feature query wrapper | `lib/data/search.searchInteractions` | Mostly response reshaping / defensive fallback |
| `fetchEntitiesByIds` | 85 | entity summary helper | `fetchDocuments(SEARCH_TARGETS.ENTITIES, ids)` | Builds lightweight display info from legacy entity documents |
| `searchAssociations` | 156 | feature query wrapper | `lib/data/search.searchAssociations` | Thin wrapper |

### `src/features/explore/api/queries.ts`

| Function | Line | Kind | Calls | Notes |
|---|---:|---|---|---|
| `resolveOntologyTerms` | 50 | API-service lookup | `POST ${getApiServiceUrl()}/terms` | Resolves canonical term IDs |
| `browseOntologyTermsFromEntityHits` | 86 | derived query helper | `searchEntities`, `resolveOntologyTerms` | Internal helper; computes top terms from entity hit payloads |
| `searchOntologyTerms` | 121 | API-service lookup + fallback | `POST /terms/search`, fallback to `browseOntologyTermsFromEntityHits` | Mixed direct search + derived fallback |
| `browseTopOntologyTerms` | 182 | browse query | `browseOntologyTermsFromEntityHits` | Browsing derived from entity hits |

**Refactor note**
- These modules are exactly the feature-local query surfaces called out in the plan for consolidation.

---

## E. Query helpers outside query modules

### `src/features/selection/selection-scope.ts`

| Function | Line | Kind | Calls | Notes |
|---|---:|---|---|---|
| `fetchEntityIdsForSelectedAnnotations` | 35 | derived lookup query | `features/search/api/queries.searchEntities` | Paginates entity search with `ontology_terms` filter to derive entity IDs |

### `src/lib/associations/associated-entities.ts`

| Function | Line | Kind | Calls | Notes |
|---|---:|---|---|---|
| `getAssociatedEntityScope` | 9 | derived association scope query | `lib/data/search.searchAssociations` | Expands selected entity set via association parents |

### `src/features/explore/components/annotation-browser-tab.tsx`

| Function | Line | Kind | Calls | Notes |
|---|---:|---|---|---|
| `fetchScopedAnnotationTerms` | 47 | derived aggregation query | `features/search/api/queries.searchEntities`, `resolveOntologyTerms` | Fetches entity batches, aggregates ontology terms in UI layer |

### `src/features/workspace/views/selection-results-view.tsx`

| Function | Line | Kind | Calls | Notes |
|---|---:|---|---|---|
| `fetchCounts` | 29 | local aggregate helper | `interactions-search/api/queries.searchInteractions` | Gets selection-scoped interaction total |

**Refactor note**
- These should move behind one central `src/lib/queries.ts` surface.

---

## F. Chat tool query surface

### `src/app/app-api/chat/route.ts`

These are not exported query functions, but they are part of the app's effective query API because the chat system uses them to drive result navigation and filtering.

| Tool / helper | Approx line | Kind | Calls | Notes |
|---|---:|---|---|---|
| `normalizeOntologyFilterValues` | 71 | API-service lookup helper | `POST ${getApiServiceUrl()}/terms` | Expands canonical ontology IDs into filterable values |
| `tools.searchEntities.execute` | 177 | chat entity search | `lib/data/search.searchEntities` | Broad entity search tool |
| `tools.resolveEntityIdentifiers.execute` | 302 | API-service lookup | `POST ${getApiServiceUrl()}/entity-lookup` | Exact entity resolution |
| `tools.searchOntologyTerms.execute` | 365 | API-service lookup | `POST ${getApiServiceUrl()}/terms/search` | Free-text ontology lookup |
| `tools.resolveOntologyTerms.execute` | 412 | API-service lookup | `POST ${getApiServiceUrl()}/terms` | Canonical ontology resolution |
| `tools.exploreOntologyTree.execute` | 459 | API-service lookup | `POST ${getApiServiceUrl()}/tree` | Ontology tree expansion |
| `tools.searchInteractions.execute` | 510 | chat interaction search | `lib/data/search.searchInteractions` | Builds normalized `SearchFilters` first |
| `tools.searchAssociations.execute` | 668 | chat association search | `lib/data/search.searchAssociations` | Association query surface for chat |

**Refactor note**
- Chat has its own parallel query-contract layer and still carries search-era naming heavily.

---

## G. Relationship map: wrappers -> implementations

### Entity queries

- `features/search/api/queries.searchEntities`
  -> `lib/data/search.search`
  -> `lib/postgres-search/search.searchEntitiesPostgres`
- `features/search/api/queries.fetchEntityDocuments`
  -> `lib/data/search.fetchDocuments`
  -> `lib/postgres-search/search.fetchDocumentsPostgres`
- `features/interactions-search/api/queries.fetchEntitiesByIds`
  -> `lib/data/search.fetchDocuments`
  -> `lib/postgres-search/search.fetchDocumentsPostgres`
- `features/selection/selection-scope.fetchEntityIdsForSelectedAnnotations`
  -> `features/search/api/queries.searchEntities`
- `features/explore/components/annotation-browser-tab.fetchScopedAnnotationTerms`
  -> `features/search/api/queries.searchEntities`

### Interaction queries

- `features/interactions-search/api/queries.searchInteractions`
  -> `lib/data/search.searchInteractions`
  -> `lib/postgres-search/search.searchInteractionsPostgres`
- `features/workspace/views/selection-results-view.fetchCounts`
  -> `features/interactions-search/api/queries.searchInteractions`
- `chat.tools.searchInteractions.execute`
  -> `lib/data/search.searchInteractions`

### Association queries

- `features/interactions-search/api/queries.searchAssociations`
  -> `lib/data/search.searchAssociations`
  -> `lib/postgres-search/search.searchAssociationsPostgres`
- `lib/associations/associated-entities.getAssociatedEntityScope`
  -> `lib/data/search.searchAssociations`
- `chat.tools.searchAssociations.execute`
  -> `lib/data/search.searchAssociations`

### Ontology/API-service queries

- `features/explore/api/queries.resolveOntologyTerms`
  -> `POST /terms`
- `features/explore/api/queries.searchOntologyTerms`
  -> `POST /terms/search`
  -> fallback `browseOntologyTermsFromEntityHits`
- `features/explore/api/queries.browseTopOntologyTerms`
  -> `browseOntologyTermsFromEntityHits`
- `chat.normalizeOntologyFilterValues`
  -> `POST /terms`
- `chat.tools.searchOntologyTerms.execute`
  -> `POST /terms/search`
- `chat.tools.resolveOntologyTerms.execute`
  -> `POST /terms`
- `chat.tools.exploreOntologyTree.execute`
  -> `POST /tree`
- `chat.tools.resolveEntityIdentifiers.execute`
  -> `POST /entity-lookup`

---

## H. Main duplication / overlap hotspots

### Entity search and entity fetch duplication
- `src/lib/data/search.ts`
- `src/features/search/api/queries.ts`
- `src/lib/meilisearch/search.ts`
- `src/features/interactions-search/api/queries.ts` (`fetchEntitiesByIds`)

### Interaction search duplication
- `src/lib/data/search.ts`
- `src/features/interactions-search/api/queries.ts`
- `src/lib/meilisearch/search.ts`
- `src/app/app-api/chat/route.ts`
- `src/features/workspace/views/selection-results-view.tsx` (`fetchCounts`)

### Association search duplication
- `src/lib/data/search.ts`
- `src/features/interactions-search/api/queries.ts`
- `src/lib/meilisearch/search.ts`
- `src/lib/associations/associated-entities.ts`
- `src/app/app-api/chat/route.ts`

### Ontology lookup duplication
- `src/features/explore/api/queries.ts`
- `src/app/app-api/chat/route.ts`
- `src/features/explore/components/annotation-browser-tab.tsx` (indirectly)

---

## I. Immediate candidates for `src/lib/queries.ts`

If we start centralization now, these are the most obvious first moves:

### Direct moves
- `searchEntities`
- `getEntitiesByIds` or `getEntitySummariesByIds` (replace `fetchEntityDocuments` / `fetchEntitiesByIds` / `fetchEntityDocument`)
- `searchInteractions`
- `searchAssociations`
- `resolveOntologyTerms`
- `searchOntologyTerms`
- `browseTopOntologyTerms`
- `getAssociatedEntityScope`
- `getEntityIdsForAnnotationTerms` (replace `fetchEntityIdsForSelectedAnnotations`)
- `getScopedAnnotationTerms` (replace `fetchScopedAnnotationTerms`)
- `getSelectionInteractionCount` (replace local `fetchCounts` if kept)

### Strong rename candidates
- `fetchDocuments` -> remove or replace with explicit entity fetch API
- `fetchEntityDocuments` -> `getEntitiesByIds` / `getEntityById`
- `fetchSearchDocuments` -> remove alias
- `searchMeilisearch` / `fetchMeilisearchDocuments` -> delete after migration

---

## J. Suggested next step after this inventory

1. Create `src/lib/queries.ts`.
2. Move the feature-local exported query functions there first.
3. Replace document-oriented entity fetch helpers with explicit entity summary/detail queries.
4. Move component-local helpers next.
5. Leave `src/lib/postgres-search/search.ts` as an implementation detail until result-shape redesign is done.
