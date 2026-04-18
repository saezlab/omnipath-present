# Frontend entity migration handoff: next steps

## Current status

Completed:

- added inferred Drizzle read types in `drizzle/index.ts`
- added direct read helpers in `src/lib/db/reads.ts`
- replaced several search-as-transport helper queries in `src/lib/queries.ts`
- migrated entity hover/details frontend paths to support base Drizzle entity rows via:
  - `src/lib/entities/display.ts`
  - `src/hooks/use-entity.ts`
  - `src/contexts/entity-data-source-context.tsx`
  - `src/features/search/components/result-card.tsx`
  - `src/features/search/components/entity-details-dialog.tsx`
  - `src/components/entity-badge.tsx`
- `pnpm exec tsc --noEmit` passes

Not completed:

- entity search still returns legacy `EntitySearchResult` payloads
- identifier lookup flow still stores `EntitySearchResult[]`
- `getEntitiesByIds()` still uses legacy document fetches
- interaction and association UIs still depend on legacy shared search result DTOs
- `searchEntitiesPostgres()` still assembles compatibility-era fields by default
- `searchInteractionsPostgres()` and `searchAssociationsPostgres()` still embed detail payloads

---

## Highest-priority next steps

## 1. Finish entity search UI migration off `EntitySearchResult`

### Goal
Make entity search results render from base `Entity` rows or a tiny feature-local row shape.

### Files

- `src/features/search/page.tsx`
- `src/features/search/components/identifier-matches.tsx`
- `src/features/search/components/result-card.tsx`
- `src/types/entities.ts`
- `src/types/search-results.ts`
- `src/lib/postgres-search/search.ts`

### Tasks

- replace `lookupEntities: EntitySearchResult[]` in `search/page.tsx` with base entity rows or `EntityLike[]`
- update identifier lookup rendering in `identifier-matches.tsx` to key entities by public ID from `getEntityPublicId()` instead of legacy hit fields
- audit `result-card.tsx` for any remaining reliance on legacy-only fields and remove where practical
- stop exporting `EntitySearchResult` from `result-card.tsx` once callers no longer need it
- reduce `src/types/entities.ts` usage to temporary compatibility-only boundaries
- remove `EntitySearchResult` from `src/types/search-results.ts` once search returns base rows or a search-local row type

### Definition of done

- entity list cards render correctly from base entity rows
- identifier lookup cards render correctly from base entity rows
- no default entity card path requires `names`, `gene_symbols`, `synonyms`, `ontology_terms`, or `num_interactions`
- `EntitySearchResult` is no longer the default frontend entity model

---

## 2. Replace `getEntitiesByIds()` legacy fetch path

### Goal
Stop using `fetchDocuments()` for entity display lookup helpers.

### Files

- `src/lib/queries.ts`
- `src/lib/db/reads.ts`
- `src/features/explore/components/interactions-explore-tab.tsx`

### Tasks

- rewrite `getEntitiesByIds(entityIds)` to use:
  - `getEntitiesByPublicIds()`
  - `getEntityIdentifiersByEntityPks()`
- compute `EntityInfo` locally from:
  - base entity row
  - related identifiers
  - `src/lib/entities/display.ts` helpers where useful
- keep `EntityInfo` feature-local; do not expand it into a new shared canonical DTO
- verify interaction explore table still renders participant labels correctly

### Definition of done

- `getEntitiesByIds()` no longer calls `fetchDocuments()`
- entity display-name derivation lives in frontend/helper logic, not in search payload assembly

---

## 3. Shrink `searchEntitiesPostgres()` payload aggressively

### Goal
Keep only ranking/filter logic in the entity search query; stop assembling compatibility-era entity hit bags.

### Files

- `src/lib/postgres-search/search.ts`
- `src/lib/data/search.ts`
- `src/lib/queries.ts`
- `src/features/search/page.tsx`
- `src/types/entities.ts`
- `src/types/search-results.ts`

### Tasks

- introduce a small search-local entity row type, e.g.

```ts
type EntitySearchRow = {
  entity: Entity;
  matchRank?: number | null;
};
```

- update `searchEntitiesPostgres()` to stop default-selecting:
  - aggregated ontology terms
  - mapped descriptions
  - mapped names/synonyms/gene symbols
  - interaction counts
- only retain fields required for sorting/pagination and immediate list rendering
- if some cards still need annotations/counts, fetch them separately or make them optional feature-local enrichments
- avoid returning `EntitySearchResult` from the search layer once callers are migrated

### Definition of done

- entity search query is mostly base-row oriented
- compatibility mapping in `mapEntityRow()` is deleted or reduced to a temporary adapter with no primary callers
- entity search no longer treats `EntitySearchResult` as its public contract

---

## 4. Migrate identifier lookup API consumers

### Goal
Ensure exact-identifier lookup results also use base rows.

### Files

- `src/lib/queries.ts`
- `src/features/search/page.tsx`
- any API/tooling callers of `resolveEntityIdentifiers`

### Tasks

- inspect `resolveEntityIdentifiers()` result handling in `search/page.tsx`
- change the `entities` payload consumer from raw legacy records to base rows if backend can return them
- if the lookup service still returns legacy-shaped entity objects, add a narrow adapter at the boundary rather than leaking that type through the UI
- keep public ID normalization consistent with `getEntityPublicId()`

### Definition of done

- identifier lookup flow does not require `EntitySearchResult[]`
- any compatibility mapping is localized at the service boundary

---

## 5. Retire `getEntityById()` legacy path

### Goal
Finish the cutover from legacy entity document fetch to direct row fetch.

### Files

- `src/lib/queries.ts`
- `src/hooks/use-entity.ts`
- any remaining imports of `getEntityById`

### Tasks

- search for remaining `getEntityById` usages
- switch callers to `getEntityRowByPublicId()` or `getEntityDetailsByPublicId()` as appropriate
- once no callers remain, delete `getEntityById()`
- if `getEntityDocumentsByIds()` becomes unused, delete it too

### Definition of done

- no live UI path depends on `getEntityById()`
- legacy fetch-document entity read path is removed

---

## 6. Start interaction UI migration off `InteractionSearchResult`

### Goal
Split interaction list rendering from interaction detail payloads.

### Files

- `src/features/explore/components/interactions-explore-tab.tsx`
- `src/features/interactions-search/components/interaction-details.tsx`
- `src/features/interactions-search/components/interaction-details-sheet.tsx`
- `src/lib/postgres-search/search.ts`
- `src/lib/queries.ts`
- `src/types/search.ts`

### Tasks

- define a feature-local interaction list type, e.g.

```ts
type InteractionListRow = {
  interaction: Interaction;
  entityA: Entity;
  entityB: Entity;
};
```

- update `interactions-explore-tab.tsx` to consume that local type instead of `InteractionSearchResult`
- remove dependence on embedded:
  - `evidence`
  - `interaction_annotation_terms` unless truly needed for row rendering
  - `participant_annotation_terms` unless truly needed for row rendering
- update detail components to fetch separately:
  - `getInteractionById()`
  - `getInteractionEvidence()`
  - `getInteractionAnnotations()`
  - participant entities via `getEntitiesByPks()`

### Definition of done

- interaction table uses a local list-row contract
- interaction details are composed from normalized reads
- shared `InteractionSearchResult` is no longer required by the main UI path

---

## 7. Start association UI migration off `AssociationSearchResult`

### Goal
Split association list/detail responsibilities and remove bundled identifier/evidence payloads.

### Files

- `src/features/search/components/entity-details-dialog.tsx`
- any association table or association consumer
- `src/lib/postgres-search/search.ts`
- `src/lib/queries.ts`
- `src/types/search.ts`

### Tasks

- define a feature-local association list type, e.g.

```ts
type AssociationListRow = {
  association: Association;
  parent: Entity;
  member: Entity;
};
```

- update association consumers to stop expecting:
  - `parent_identifiers`
  - `member_identifiers`
  - embedded `evidence`
- fetch separately when needed:
  - `getAssociationById()`
  - `getAssociationEvidence()`
  - related entities
  - identifiers only in detail/open states

### Definition of done

- association list rendering no longer depends on `AssociationSearchResult`
- bundled evidence and identifiers are removed from default list payloads

---

## 8. Delete embedded detail assembly in Postgres search queries

### Goal
Make search queries search-specific only.

### Files

- `src/lib/postgres-search/search.ts`

### Tasks

- in `searchInteractionsPostgres()` remove default aggregation of:
  - evidence rows
  - annotation arrays not needed for rows
- in `searchAssociationsPostgres()` remove default aggregation of:
  - evidence rows
  - parent/member identifiers
- keep custom SQL only for filtering/ranking semantics that still matter
- move detail hydration to separate direct reads from `src/lib/db/reads.ts`

### Definition of done

- Postgres search queries no longer build detail payloads for list endpoints
- search layer is smaller and easier to type with local shapes

---

## 9. Remove legacy shared result DTOs once callers are gone

### Goal
Delete compatibility-era shared result bags after migration.

### Files

- `src/types/entities.ts`
- `src/types/search.ts`
- `src/types/search-results.ts`
- `src/lib/postgres-search/search.ts`
- all remaining imports from those types

### Tasks

- remove remaining imports/usages of:
  - `EntitySearchResult`
  - `InteractionSearchResult`
  - `AssociationSearchResult`
- replace with:
  - `Entity`
  - `Interaction`
  - `Association`
  - feature-local row types
- delete compatibility mapping helpers once unused:
  - `mapEntityRow()`
  - `mapInteractionRow()`
  - `mapAssociationRow()`

### Definition of done

- no app-owned feature depends on legacy shared DTOs
- normalized inferred row types are the default read model

---

## Useful implementation guidance

- prefer `src/lib/entities/display.ts` for display-name/type/identifier derivation instead of re-deriving in each component
- keep any unavoidable joined/search-specific types local to the owning feature
- do not introduce a new global replacement for `EntitySearchResult`; use either base rows or narrow local shapes
- for detail UIs, prefer composition from multiple direct reads over expanding list-query payloads
- when deleting payload fields from search queries, update the UI contract first or in the same change

---

## Recommended execution order

1. migrate `search/page.tsx` + `identifier-matches.tsx` off `EntitySearchResult`
2. rewrite `getEntitiesByIds()` to use direct reads
3. shrink `searchEntitiesPostgres()` payload and retire `EntitySearchResult`
4. migrate interaction list/detail UI off `InteractionSearchResult`
5. migrate association list/detail UI off `AssociationSearchResult`
6. remove embedded detail aggregation from Postgres search queries
7. delete leftover compatibility types and mapping helpers

---

## Quick verification checklist

After each step, run:

- `pnpm exec tsc --noEmit`

For behavior checks, verify:

- entity cards still render names/type badges correctly
- hover cards work from entity rows
- entity details dialog opens and shows counts/tabs
- identifier lookup renders entity cards correctly
- interaction explore participant labels still render correctly
- selection scope / annotation browser counts still match expected results
