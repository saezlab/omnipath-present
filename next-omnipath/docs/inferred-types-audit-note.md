# Inferred types audit: Drizzle/Postgres vs custom app types

## Summary

Given the current direction, the app should aim to use the **base Drizzle/Postgres table types directly wherever possible**, instead of preserving compatibility-era search/result view models.

In particular, if we no longer want to depend on:

- aggregated ontology term arrays on entity hits
- derived interaction counts on entity hits
- extracted `names` / `gene_symbols` / `synonyms` bundles on entity hits
- aggregated evidence payloads on interaction/association hits
- mixed legacy-style result bags spanning entity/CV term/source

then a lot of the current shared custom typing becomes unnecessary.

That changes the conclusion from the previous draft:

- `EntitySearchResult` should no longer be treated as a necessary long-term model.
- `InteractionSearchResult` and `AssociationSearchResult` should no longer be treated as necessary long-term result types either.
- The preferred direction should be:
  1. **Drizzle inferred table row types first**
  2. **small local helper props/select shapes only when a component truly needs them**
  3. **no shared aggregated search hit types unless they are unavoidable**

Under that goal, most of the current custom types are either **replaceable** or should be **query-local transitional types**.

---

## Inventory

| Type / shape | Where used | Current kind | Classification | Notes |
|---|---|---|---|---|
| `Identifier = DrizzleIdentifier` in `src/types/entities.ts` | result cards, entity typing | Drizzle-inferred alias | **replaceable** | Can be imported directly from `@next-omnipath/drizzle`. |
| `EntityRecord = Entity` in `src/types/entities.ts` | entity field references | Drizzle-inferred alias | **replaceable** | Shared alias file adds little value. |
| `EntitySearchResult` in `src/types/entities.ts` | `result-card.tsx`, `entity-details-dialog.tsx`, `use-entity.ts`, `entity-data-source-context.tsx`, `identifier-matches.tsx`, `queries.ts`, `postgres-search/search.ts` | Shared custom entity result type | **replaceable** | Mostly a compatibility/search convenience shape. If the UI can work from `Entity` rows plus direct identifier/annotation table lookups, this should go away. |
| `CvTermSearchResult` in `src/types/search-results.ts` | effectively only implied by `result-card.tsx` hover-card fetch | Shared custom UI result type | **should be query-local** | Keep only as a local prop/API shape if term cards remain. |
| `SourceSearchResult` in `src/types/search-results.ts` | currently only via `SearchResult` mixed rendering | Shared custom UI result type | **should be query-local** | Legacy-style shared result type; localize or remove. |
| `SearchResult` in `src/types/search-results.ts` | `result-card.tsx`, `search-results.tsx`, `search/page.tsx`, `entities-explore-tab.tsx`, `url-state.ts` | Broad mixed-result catch-all | **replaceable** | Main compatibility-era type to remove. |
| `InteractionAnnotation`, `InteractionEvidence`, `InteractionDirection` in `src/types/search.ts` | interaction details UI | Custom nested result types | **replaceable** | If evidence is read directly from base tables instead of returned as aggregated query payloads, these shared types are no longer needed in current form. |
| `InteractionSearchResult` in `src/types/search.ts` | interaction explore/details UI, queries, postgres search | Shared custom interaction result type | **replaceable** | If interaction views can use `Interaction` row types plus separately loaded entity/evidence data, this should not remain a shared result type. |
| `AssociationAnnotation`, `AssociationEvidence`, `IdentifierEntry`, `AssociationSearchResult` in `src/types/search.ts` | entity details dialog, queries, postgres search | Shared custom association result type | **replaceable** | Same story as interactions: shared aggregated result shape should be removed if base tables are enough. |
| `CvTermReference` in `src/types/search.ts` | no obvious active use in audited files | Custom shared type | **replaceable** | Likely removable. |
| `SearchFilters` in `src/types/search.ts` | many pages/components/routes | Shared request/filter contract | **necessary** | Still useful as shared filter API unless replaced by route-/query-specific filter types. |
| `SearchParams` in `src/types/search.ts` | little/no obvious use in audited files | Shared request contract | **should be query-local** | Remove or localize. |
| `SearchSource`, `SourceFunctionRecord` in `src/types/search.ts` | source-oriented legacy typing | Shared custom type | **should be query-local** | Remove if source search is no longer a first-class mixed result type. |
| `InteractionSearchResponse` in `src/types/search.ts` | `queries.ts` return type | Custom response wrapper | **replaceable** | Better as generic `SearchResponse<T>`. |
| `SearchResponse` in `src/lib/search/types.ts` | search/query boundary | Shared generic-less transport type | **replaceable** | Should become generic to remove unsafe casts. |
| Drizzle `Entity`, `Interaction`, `Association`, `EntityIdentifier` from `@next-omnipath/drizzle` | `src/types/entities.ts`, `src/lib/postgres-search/search.ts` | Inferred Drizzle table-row types | **preferred** | These should become the default types for most frontend/server boundaries. |
| ad-hoc row shapes in `src/lib/postgres-search/search.ts` (`row: any`) | entity/interaction/association row mappers | Untyped query projection | **should be query-local** | Transitional only; if we stop building aggregated shared result objects, much of this mapping layer can shrink or disappear. |

---

## Where each style is used today

### 1) Fully custom shared types

- `src/types/entities.ts`
  - `EntitySearchResult`
- `src/types/search-results.ts`
  - `SearchResult`
  - `CvTermSearchResult`
  - `SourceSearchResult`
- `src/types/search.ts`
  - `InteractionSearchResult`
  - `AssociationSearchResult`
  - evidence/annotation helper types
  - `SearchFilters`

### 2) Partially custom view-model types

These are the types that currently bundle or reshape base-table data for UI convenience:

- `EntitySearchResult`
  - public `entity_id`
  - normalized `entity_type`
  - extracted `names` / `gene_symbols` / `synonyms`
  - aggregated `ontology_terms`
  - derived `num_interactions`
- `InteractionSearchResult`
  - joined participant fields
  - derived participant IDs
  - aggregated evidence arrays
  - derived annotation-term arrays
- `AssociationSearchResult`
  - joined parent/member fields
  - derived public IDs
  - aggregated evidence arrays
  - bundled identifiers for both sides
- `EntityInfo` in `src/lib/queries.ts`
  - compact computed display model

If the goal is to use base tables directly, these should be treated as **transitional conveniences**, not target architecture.

### 3) Inferred Drizzle types

Currently available and underused as end-to-end app types:

- `drizzle/index.ts`
  - `Entity`
  - `EntityIdentifier`
  - `Interaction`
  - `Association`
- generated schema in `drizzle/schema.ts`
  - confirms the core fields already exist in base tables

These should become the primary source of truth for most data flow.

---

## Main findings

### A. `SearchResult` is still the biggest compatibility-era holdover

`src/types/search-results.ts#SearchResult` still mixes unrelated fields for:

- entities
- CV terms
- sources

This creates a broad optional-field bag that hides what each page actually consumes.

That leads to:

- pages typed as `SearchResult[]` even when they only show entities
- components carrying lots of optional legacy fields
- URL/cache state storing a broad mixed `fullResult`
- difficulty moving toward direct table-based typing

**Recommendation:** remove `SearchResult` entirely. Use concrete types per route/query/component.

### B. `EntitySearchResult` should be treated as replaceable, not canonical

`EntitySearchResult` currently duplicates and reshapes entity data into a compatibility/search-oriented payload:

- `entity_id` synthesized from identifier type + identifier
- normalized/legacy-ish `entity_type`
- names/synonyms/gene symbols extracted from identifiers
- aggregated `ontology_terms`
- derived `num_interactions`

If those aggregated/convenience fields are no longer required, then this type is **not necessary**.

Preferred replacement direction:

- use `Entity` directly for base entity records
- use `EntityIdentifier[]` when a component actually needs identifiers
- use `entity_annotation` rows when a component actually needs annotations
- use `entity_summary` or counts only in the specific place that truly needs counts

In other words, stop treating a pre-assembled “entity search hit” as the default data model.

### C. `InteractionSearchResult` should also be treated as replaceable

Today it bundles:

- interaction row fields
- participant public IDs and participant types
- aggregated evidence payloads
- derived annotation term arrays

If the goal is to use base tables directly and not return aggregated evidence payloads, then this should no longer be the default shared interaction type.

Preferred replacement direction:

- use `Interaction` directly for the main result list
- load participant `Entity` rows separately if/when needed
- load `interaction_evidence` rows separately when the details panel opens
- load `interaction_annotation` rows separately if/when needed

That removes the need for a global “search interaction result” model.

### D. `AssociationSearchResult` should also be treated as replaceable

Today it bundles:

- association row fields
- parent/member public IDs and types
- bundled parent/member identifiers
- aggregated evidence payloads

If association UIs can work from base tables, the target should be:

- `Association` for the main record
- `Entity` rows for parent/member data when needed
- `EntityIdentifier` rows loaded separately when needed
- `association_evidence` rows loaded separately in details views

So this is another shared custom type that should be phased out.

### E. The current query layer still assumes aggregation-heavy result assembly

`src/lib/postgres-search/search.ts` currently maps SQL rows into custom app-specific shapes with functions like:

- `mapEntityRow(row: any): EntitySearchResult`
- `mapInteractionRow(row: any): InteractionSearchResult`
- `mapAssociationRow(row: any): AssociationSearchResult`

This mapping layer is doing a lot of work specifically to preserve non-table result shapes.

If we want the frontend to consume base tables directly, this file likely needs a more structural simplification than just stronger typing:

- fewer custom mapping functions
- fewer aggregated selects
- fewer JSON-built evidence bundles
- more direct return of base-table rows or narrow query-local joins

### F. `SearchResponse` is still too weakly typed

Current `src/lib/search/types.ts` uses:

```ts
export interface SearchResponse {
  hits: Record<string, unknown>[];
  ...
}
```

That forces downstream casts such as:

- `response.hits as unknown as SearchResult[]`
- `documents[0] as unknown as EntitySearchResult`

Even if we move to base table types, we still want:

```ts
SearchResponse<Entity>
SearchResponse<Interaction>
SearchResponse<Association>
```

So this remains a worthwhile cleanup.

### G. Several components are currently coupled to aggregated/custom result fields

Examples:

- `src/features/search/components/result-card.tsx`
  - expects `names`, `gene_symbols`, `descriptions`, `ontology_terms`, `num_interactions`, etc.
- `src/features/search/components/entity-details-dialog.tsx`
  - assumes an `EntitySearchResult`
- `src/features/explore/components/interactions-explore-tab.tsx`
  - assumes `InteractionSearchResult` instead of `Interaction`
- `src/features/interactions-search/components/interaction-details.tsx`
  - assumes embedded aggregated evidence objects

These are the main UI surfaces that would need adaptation if we stop returning pre-assembled search payloads.

---

## Recommended changes

### 1. Make the target explicit: base table types are the default

Adopt this rule:

- use `Entity` for entity records
- use `Interaction` for interaction records
- use `Association` for association records
- use `EntityIdentifier` / annotation / evidence table row types when those related records are needed

Only introduce a custom result type when a component truly needs a non-table computed shape.

### 2. Retire `EntitySearchResult`

Instead of maintaining a shared assembled entity search type:

- use `Entity` for search hits and entity fetches where possible
- compute public IDs locally where needed
- load identifiers/annotations lazily or via dedicated query helpers
- keep any display-only helper type local to the component that needs it

This means `src/types/entities.ts` should likely disappear or shrink dramatically.

### 3. Retire shared `InteractionSearchResult` and `AssociationSearchResult`

Instead of returning aggregated interaction/association payloads:

- return `Interaction[]` / `Association[]` from list/search queries
- fetch evidence rows only when details are opened
- fetch related entity rows only when labels/badges are needed
- fetch annotation rows separately if filter or detail views need them

This moves the app away from large search-hit view models and toward composable base-table reads.

### 4. Remove aggregated evidence payloads from the query contract

Current evidence typing in `src/types/search.ts` exists mainly because the query layer builds bundled evidence arrays.

If that is no longer desired:

- stop serializing evidence into aggregated hit payloads
- use the base evidence tables directly in details screens
- keep evidence row types local and inferred from schema/query

This should substantially simplify interaction/association typing.

### 5. Remove aggregated entity adornments from the default query contract

If no longer needed by default, stop returning these as standard hit fields:

- `ontology_terms`
- `cv_terms`
- `num_interactions`
- extracted `names` / `gene_symbols` / `synonyms`
- computed descriptions assembled from attributes

Instead:

- either render directly from base fields
- or create tiny local helpers where a specific component needs a display label

### 6. Make `SearchResponse` generic

Still recommended:

```ts
export interface SearchResponse<THit = Record<string, unknown>> {
  hits: THit[];
  estimatedTotalHits: number;
  limit: number;
  offset: number;
  processingTimeMs: number;
  query: string;
  facetDistribution?: Record<string, Record<string, number>>;
}
```

Then use concrete types such as:

- `SearchResponse<Entity>`
- `SearchResponse<Interaction>`
- `SearchResponse<Association>`

### 7. Move any unavoidable custom shapes next to the query/component that owns them

If a UI still needs a custom card prop shape or details view model, it should be:

- small
- explicit
- local to that feature
- not stored as a global “search result” type

---

## Suggested order of implementation

### Low-risk step 1
Make `SearchResponse` generic and remove `unknown`-based casts.

This helps regardless of the deeper migration.

### Low-risk step 2
Stop typing entity-only result lists as `SearchResult[]`.

Move them either to:

- `Entity[]` directly, or
- a very small local transitional type if a component still temporarily needs extra fields

Affected places include:

- `src/features/search/page.tsx`
- `src/features/explore/components/entities-explore-tab.tsx`
- `src/features/search/components/search-results.tsx`
- `src/lib/navigation/url-state.ts`

### Medium-risk step 3
Refactor `src/lib/postgres-search/search.ts` to stop constructing shared aggregated hit objects.

Concretely:

- remove `mapEntityRow()` assembly of `EntitySearchResult`
- remove `mapInteractionRow()` assembly of aggregated interaction payloads
- remove `mapAssociationRow()` assembly of aggregated association payloads
- return base rows or minimal local projections instead

### Medium-risk step 4
Adapt UI components away from aggregate fields.

Examples:

- `result-card.tsx`
  - stop assuming `names`, `gene_symbols`, `num_interactions`, `ontology_terms`
- `entity-details-dialog.tsx`
  - accept `Entity` plus separately fetched related rows if needed
- `interactions-explore-tab.tsx`
  - use `Interaction` and resolve entity display data separately
- `interaction-details.tsx`
  - fetch/render evidence from base evidence rows

### Medium-risk step 5
Delete or collapse the old shared type files.

Candidates:

- `src/types/entities.ts`
- `src/types/search-results.ts`
- large parts of `src/types/search.ts`
- `src/types/meilisearch.ts`

Keep only what still has a real shared purpose, such as `SearchFilters`.

---

## Bottom line

If the new tables already contain everything we need, then the audit should favor a **much stronger simplification** than the previous draft.

The target should be:

- **base Drizzle table types directly** for entities, interactions, associations, identifiers, annotations, evidence
- **no default aggregated entity search hit model**
- **no default aggregated interaction/association evidence payload model**
- **no giant mixed `SearchResult` type**
- only **small local custom types** where a specific component truly needs them

Under that direction, the main shared custom result types are not “necessary”; they are mostly **migration leftovers that should be removed**.
