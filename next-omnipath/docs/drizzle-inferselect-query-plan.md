# Drizzle `InferSelect` query replacement plan

## Goal

Replace query paths that currently:

- read a single base table or materialized view
- fetch a small set of related rows
- map raw SQL rows into shared compatibility-era result types

with:

- Drizzle `select()` queries
- `InferSelectModel<typeof table>` / `typeof table.$inferSelect`
- small feature-local join/select shapes only where a screen genuinely needs a joined row

This does **not** mean every query should become a simple Drizzle select immediately. But the plan should be aggressive: whenever a query is only custom because the UI still depends on a compatibility-era payload, that UI dependency should be turned into an explicit migration task rather than treated as a permanent blocker.

---

## Current read model inventory

Already exported in `drizzle/index.ts`:

- `Entity`
- `EntityIdentifier`
- `Interaction`
- `Association`

Available in schema and good candidates to export next:

- `entityAnnotation`
- `interactionAnnotation`
- `interactionEvidence`
- `associationEvidence`
- `entitySummary`
- optionally `entityFilterCounts`
- optionally `interactionFilterCounts`

### Recommended additional exports

```ts
export type EntityAnnotation = InferSelectModel<typeof entityAnnotation>;
export type InteractionAnnotation = InferSelectModel<typeof interactionAnnotation>;
export type InteractionEvidence = InferSelectModel<typeof interactionEvidence>;
export type AssociationEvidence = InferSelectModel<typeof associationEvidence>;
export type EntitySummary = InferSelectModel<typeof entitySummary>;
```

---

## Replacement rubric

### Good `InferSelect` candidates

A query is a strong candidate when it is mostly:

1. a point lookup or direct filter on one table
2. a read of related rows from one adjacent table
3. a detail fetch where the UI can compose data from multiple simple queries
4. not relying on `jsonb_agg`, `array_agg`, or ranking logic

### Poor `InferSelect` candidates for now

A query may still need custom SQL or Drizzle SQL when it depends on:

1. search ranking
2. facet aggregation
3. full-text-ish identifier matching
4. annotation-driven membership/filter semantics

However, this should **not** be treated as justification for keeping compatibility-era payload assembly. Even when a query remains custom, its return shape should still be simplified toward base rows or tiny feature-local list shapes.

---

## Function-by-function replacement map

## 1) `src/lib/queries.ts#getEntityById`

### Current

- fetches an entity via `fetchDocuments()`
- returns `EntitySearchResult | null`
- depends on public-id lookup plus compatibility mapping

### Replace with

- `getEntityByPublicId(publicId): Promise<Entity | null>`

### Why

This is fundamentally a point lookup. It should not return an assembled search-hit model.

### Supporting follow-up queries

- `getEntityIdentifiers(entityPk): Promise<EntityIdentifier[]>`
- `getEntityAnnotations(entityPk): Promise<EntityAnnotation[]>`
- `getEntitySummary(entityPk): Promise<EntitySummary | null>`

### Migration note

The entity details dialog should accept composed base-table data instead of an `EntitySearchResult`.

---

## 2) `src/lib/postgres-search/search.ts#fetchDocumentsPostgres`

### Current

- only supports `search_entities`
- fetches by public IDs
- maps rows through `mapEntityRow()` into `EntitySearchResult`

### Replace with

- `getEntitiesByPublicIds(publicIds): Promise<Entity[]>`

### Why

This is still just entity loading, with an alternate lookup key.

### Keep as helper

A helper is still useful:

```ts
function toPublicEntityId(entity: Entity): string {
  return `${entity.canonicalIdentifierType}|${entity.canonicalIdentifier}`;
}
```

### Migration note

Do not preserve `EntitySearchResult` just because the caller currently expects `entity_id`, `names`, or `gene_symbols`.

---

## 3) `src/lib/queries.ts#getEntitiesByIds`

### Current

- fetches entity documents
- derives display names from embedded identifier bundles
- returns `Map<string, EntityInfo>`

### Classification

**Partially replaceable**

### Replace core fetch with

- `getEntitiesByPublicIds(publicIds): Promise<Entity[]>`
- `getEntityIdentifiersByEntityPks(entityPks): Promise<EntityIdentifier[]>`

### Keep local computed output

`EntityInfo` can stay as a local, feature-level computed display model.

### Why

The lookup itself is not search. The display-name derivation is UI logic and should be separated from persistence reads.

---

## 4) `src/lib/queries.ts#searchInteractions`

### Current

- wraps `searchInteractionsData()`
- returns `SearchResponse<InteractionSearchResult>`

### Classification

**Partially replace now; split list and detail responsibilities**

### Replaceable sub-queries

For interaction details or row hydration, split into:

- `getInteractionById(interactionPk): Promise<Interaction | null>`
- `getInteractionEvidence(interactionPk): Promise<InteractionEvidence[]>`
- `getInteractionAnnotations(interactionPk): Promise<InteractionAnnotation[]>`
- `getEntitiesByPks([entityAPk, entityBPk]): Promise<Entity[]>`

### Why not fully replace now

The current search query still handles:

- list filtering
- participant/public-id matching
- annotation-based filtering
- joined participant typing
- aggregated evidence payload assembly

That means the current implementation is still doing search-layer work. But the evidence aggregation should not remain part of the long-term contract.

### Required migration tasks

- change interaction details UI to fetch `InteractionEvidence[]` separately instead of expecting embedded `evidence`
- change interaction details UI to fetch `InteractionAnnotation[]` separately instead of expecting `interaction_annotation_terms` on the hit
- change interaction row rendering to use joined `Entity` rows or a local list-row shape instead of `InteractionSearchResult`
- then shrink the list query payload to the minimum fields needed for table rendering

### Recommended end state

- interaction list query returns a minimal local list shape
- interaction detail query uses base-table reads only
- shared `InteractionSearchResult` is deleted

---

## 5) `src/lib/queries.ts#searchAssociations`

### Current

- wraps association search
- returns aggregated association hit rows

### Classification

**Partially replace now; split list and detail responsibilities**

### Replaceable sub-queries

- `getAssociationById(associationPk): Promise<Association | null>`
- `getAssociationEvidence(associationPk): Promise<AssociationEvidence[]>`
- `getEntitiesByPks([parentEntityPk, memberEntityPk]): Promise<Entity[]>`
- `getEntityIdentifiersByEntityPks([parentEntityPk, memberEntityPk]): Promise<EntityIdentifier[]>`

### Why

Association detail views can be composed from normalized rows without keeping `AssociationSearchResult`.

### Required migration tasks

- change association consumers to fetch `AssociationEvidence[]` separately instead of expecting embedded `evidence`
- stop expecting bundled parent/member identifiers on every association hit
- use related `Entity` rows for parent/member identity and fetch `EntityIdentifier[]` only where actually needed
- then shrink the association list query to a minimal local row shape

---

## 6) `src/lib/queries.ts#getAssociatedEntityScope`

### Current

- calls `searchAssociations()` with a large limit
- extracts `parent_entity_id` values from aggregated association hits

### Classification

**Good candidate for direct Drizzle query**

### Better replacement

Use a direct select on `association` joined to `entity` for the parent side:

- filter by `memberEntityPk` or resolved member public IDs
- select parent entity rows directly
- return public IDs after projection

### Why

This is not really a search query. It is a relationship traversal query.

### Likely return type

Either:

- `string[]` of parent public IDs, or
- `Entity[]` if callers would benefit from the parent rows themselves

---

## 7) `src/lib/queries.ts#getEntityIdsForAnnotationTerms`

### Current

- pages through `searchEntities()`
- filters with `ontology_terms`
- extracts `entity_id` from search hits

### Classification

**Strong candidate for direct Drizzle select**

### Better replacement

Query `entityAnnotation` joined to `entity`:

- filter `entityAnnotation.cvTerm IN (...)`
- select distinct entity rows or distinct `entityPk`
- project to public IDs only if needed

### Why

This is a simple annotation-membership query, not search.

---

## 8) `src/lib/queries.ts#getScopedAnnotationTerms`

### Current

- batches through `searchEntities()`
- depends on `ontology_terms` / `cv_terms` attached to entity hits
- counts term frequency client-side

### Classification

**Strong candidate for direct Drizzle aggregation**

### Better replacement

Query `entityAnnotation` directly:

- filter by scoped entity PKs
- group by `cvTerm`
- count distinct entity PKs
- resolve ontology labels afterward if needed

### Why

This is annotation aggregation over a known entity set, not entity search.

### Note

This is not a “simple one-table select” in the strictest sense because it groups, but it is still much simpler and more schema-native than paging through search hits.

---

## 9) `src/lib/queries.ts#getSelectionInteractionCount`

### Current

- calls `searchInteractions()` with `limit=1`
- uses `estimatedTotalHits`

### Classification

**Good candidate for direct count query**

### Better replacement

Query `interaction` directly with the same filter semantics you actually need for selection count:

- if only entity scoping matters, count matching interactions directly
- if more advanced interaction filters are required, keep a small dedicated count query

### Why

Using the search API just to obtain a count is heavier than necessary.

---

## 10) `src/lib/postgres-search/search.ts#searchEntitiesPostgres`

### Current

- does identifier ranking
- supports facets
- conditionally includes identifiers/ontology terms
- maps through `mapEntityRow()` to `EntitySearchResult`

### Classification

**Replace aggressively by first changing the UI contract**

### Immediate query-level improvements

Even before the query is fully replaced, we should:

- stop treating `EntitySearchResult` as canonical
- shrink the selected payload
- stop returning aggregated fields by default
- make any remaining non-table shape local to the search feature

### Required UI migration tasks

The following are not future possibilities; they are required tasks:

- change `result-card.tsx` so the default entity card does **not** require `names`
- change `result-card.tsx` so the default entity card does **not** require `gene_symbols`
- change `result-card.tsx` so the default entity card does **not** require `synonyms`
- change `result-card.tsx` so the default entity card does **not** require `ontology_terms`
- change `result-card.tsx` so the default entity card does **not** require `num_interactions`
- change `entity-details-dialog.tsx` so it accepts `Entity` plus separately fetched related rows instead of `EntitySearchResult`
- move display-label extraction from bundled hit payloads into local helper logic built from `Entity` plus optional `EntityIdentifier[]`

### Recommended end state

- `searchEntitiesPostgres()` returns either `Entity[]` or a very small search-local row shape
- identifier-derived labels are computed locally when needed
- ontology annotations are fetched separately when needed
- interaction counts are fetched separately when needed
- shared `EntitySearchResult` is deleted

---

## 11) `src/lib/postgres-search/search.ts#searchInteractionsPostgres`

### Current

- joins entity A/B
- filters by interaction and participant-related criteria
- aggregates annotation arrays
- aggregates evidence rows
- maps into `InteractionSearchResult`

### Classification

**Replace aggressively by deleting embedded detail payloads first**

### Required migration tasks

- remove embedded evidence aggregation from the default interaction list/query contract
- remove embedded annotation arrays from the default interaction list/query contract where possible
- update `interactions-explore-tab.tsx` to consume a local list-row shape instead of shared `InteractionSearchResult`
- update `interaction-details.tsx` and `interaction-details-sheet.tsx` to fetch evidence/annotations separately from the selected interaction row

### Better intermediate target

Split responsibilities:

- list query: minimal row shape for table rendering
- detail query: base-table reads (`Interaction`, `InteractionEvidence[]`, `InteractionAnnotation[]`, participant `Entity[]`)

### Local type

If needed, use a feature-local list row shape such as:

```ts
type InteractionListRow = {
  interaction: Interaction;
  entityA: Entity;
  entityB: Entity;
};
```

Not a shared global `InteractionSearchResult`.

---

## 12) `src/lib/postgres-search/search.ts#searchAssociationsPostgres`

### Current

- joins parent/member entities
- aggregates identifiers and evidence
- maps into `AssociationSearchResult`

### Classification

**Replace aggressively by deleting embedded identifiers/evidence from hit payloads first**

### Required migration tasks

- remove embedded evidence aggregation from the default association query contract
- stop returning bundled parent/member identifiers on every hit
- update entity details and any association consumers to fetch association evidence and identifiers separately when details are opened

### Better intermediate target

- list query: narrow local row shape
- detail query: `Association`, related `Entity` rows, `AssociationEvidence[]`, optional `EntityIdentifier[]`

---

## 13) facet distribution queries

### Functions

- `getEntityFilterFacetDistributionPostgres()`
- `getInteractionFilterFacetDistributionPostgres()`

### Classification

**Simplify aggressively, even if they remain aggregation queries**

### Current state

Entity facets are partly split already:

- when there is no query and no filters, entity facets come from the `entity_filter_counts` materialized view
- otherwise they are recomputed dynamically from a filtered entity set

Interaction facets are only partially modeled in materialized form:

- `interaction_filter_counts` covers `is_directed`, `sign`, and `interaction_type`
- annotation-term facets and any source facets still need dynamic handling elsewhere

### Simplification opportunities

- separate global/default facets from query-scoped facets explicitly
- keep materialized views for cheap global counts
- compute scoped facets only when the UI truly needs scoped counts
- reuse the same filtered entity / interaction set used by the list query instead of rebuilding logic ad hoc
- challenge whether free-text query must affect facet counts, or whether only structured filters need to scope facets

### Why

These are still aggregation queries, so they are not classic `InferSelect` reads. But they can be made much smaller, more modular, and less coupled to compatibility-era search-hit assembly.

---

## 14) `getInteractionStatsPostgres()`

### Classification

**Depends on current implementation and caller needs**

If this is just a few counts from base tables, it can move to direct Drizzle count queries. If it is a dashboard-style aggregate, keep it custom until needed.

---

## Queries that may remain custom but should still lose aggregated payloads

The important distinction is:

- some queries may still need custom filtering/ranking SQL
- but that does **not** mean they should keep returning compatibility-era DTOs

### A. Ranked entity search

The ranked entity search is custom today because it combines:

- identifier matching
- exact / prefix / contains ranking
- structured filtering
- compatibility-era entity hit assembly

The first three may remain custom for a while. The last one should not.

#### Simplification target

- compute match rank once in a reusable filtered/matched entity set
- return `Entity[]` or a tiny search-local row shape
- stop embedding default identifiers, ontology terms, descriptions, and interaction counts into every hit

#### Required UI tasks

- keep the `result-card.tsx` migration tasks from above as blockers to remove
- once cards no longer require `names`, `gene_symbols`, `synonyms`, `ontology_terms`, and `num_interactions`, ranked search can return much smaller rows

#### Recommended target shape

```ts
type EntitySearchRow = {
  entity: Entity;
  matchRank: number | null;
};
```

If even `matchRank` is not needed outside pagination/sorting, the external contract can simply be `Entity[]`.

### B. Facet queries

Facet queries are still real aggregation queries, but they should be made more explicit.

#### Entity facets

Split into:

- global/default facets from materialized views
- scoped facets computed from the current filtered entity set

#### Interaction facets

Split into:

- base interaction facets (`sign`, `is_directed`, `interaction_type`, optionally `sources`)
- annotation-term facets computed directly from annotation tables

#### Product question to resolve

Do facets need to reflect the free-text query, or only the active structured filters?

If facets do **not** need to depend on free-text query, they become substantially cheaper and simpler.

### C. Interaction list queries with filter semantics

The interaction list query may still need custom filtering for:

- public-id membership
- interaction type
- sign/direction
- annotation-term filters
- participant identifier query matching

But it should still lose embedded detail payloads.

#### Remove from default list payload

- embedded `evidence`
- embedded `interaction_annotation_terms` where not needed for row rendering
- embedded `participant_annotation_terms` where not needed for row rendering

#### Keep in default list payload only if needed

- interaction primary key
- participant public IDs
- participant types or display-ready local fields
- sign
- direction / directedness
- evidence count

#### Recommended target shape

```ts
type InteractionListRow = {
  interaction: Interaction;
  entityA: Entity;
  entityB: Entity;
};
```

If even that is too large, use a flatter feature-local row shape with only the fields needed by the table.

### D. Association list queries with filter semantics

The association list query may still need custom filtering for:

- parent/member entity membership
- parent/member entity type filters
- source filters
- participant identifier query matching

But it should still lose bundled identifiers and evidence payloads.

#### Remove from default list payload

- embedded `evidence`
- bundled `parent_identifiers`
- bundled `member_identifiers`

#### Keep in default list payload only if needed

- association primary key
- parent/member public IDs
- parent/member entity types
- sources

#### Recommended target shape

```ts
type AssociationListRow = {
  association: Association;
  parent: Entity;
  member: Entity;
};
```

If the list only needs IDs and types, flatten further and keep the type local to the association feature.

---

## Recommended replacement functions

## Entity reads

```ts
getEntityByPublicId(publicId): Promise<Entity | null>
getEntitiesByPublicIds(publicIds): Promise<Entity[]>
getEntitiesByPks(entityPks): Promise<Entity[]>
getEntityIdentifiers(entityPk): Promise<EntityIdentifier[]>
getEntityIdentifiersByEntityPks(entityPks): Promise<EntityIdentifier[]>
getEntityAnnotations(entityPk): Promise<EntityAnnotation[]>
getEntityAnnotationsByEntityPks(entityPks): Promise<EntityAnnotation[]>
getEntitySummary(entityPk): Promise<EntitySummary | null>
```

## Interaction reads

```ts
getInteractionById(interactionPk): Promise<Interaction | null>
getInteractionsByEntityPks(entityPks, filters?): Promise<Interaction[]>
getInteractionEvidence(interactionPk): Promise<InteractionEvidence[]>
getInteractionAnnotations(interactionPk): Promise<InteractionAnnotation[]>
```

## Association reads

```ts
getAssociationById(associationPk): Promise<Association | null>
getAssociationsByMemberEntityPks(entityPks): Promise<Association[]>
getAssociationEvidence(associationPk): Promise<AssociationEvidence[]>
```

## Annotation-driven helpers

```ts
getEntityPublicIdsForAnnotationTerms(termIds): Promise<string[]>
getAnnotationTermCountsForEntityPks(entityPks, filters?): Promise<Array<{ cvTerm: string; entityCount: number }>>
```

---

## Migration tasks and order

## Step 1: export more inferred read types

Add exports for:

- `EntityAnnotation`
- `InteractionAnnotation`
- `InteractionEvidence`
- `AssociationEvidence`
- `EntitySummary`

## Step 2: remove UI dependencies on compatibility-era hit fields

This is a required step, not a future maybe.

### Entity UI tasks

- update `src/features/search/components/result-card.tsx` to render from `Entity` as the default base model
- remove required dependence on `names`, `gene_symbols`, `synonyms`, `ontology_terms`, and `num_interactions`
- move label/summary extraction into local helpers that can use `EntityIdentifier[]` and `EntityAnnotation[]` when available
- update `src/features/search/components/entity-details-dialog.tsx` to accept `Entity` and fetch related rows separately
- stop exporting entity UI contracts through shared search-result types

### Interaction UI tasks

- update `src/features/explore/components/interactions-explore-tab.tsx` to consume a local list-row shape or `Interaction`-centric model
- update `src/features/interactions-search/components/interaction-details.tsx` to fetch evidence and annotations separately
- update `src/features/interactions-search/components/interaction-details-sheet.tsx` to stop depending on embedded evidence payloads

### Association UI tasks

- update `src/features/search/components/entity-details-dialog.tsx` and any association consumers to stop depending on `AssociationSearchResult`
- fetch association evidence and related identifiers separately when details are opened

## Step 3: replace point/detail fetches with Drizzle reads

First wave:

- `getEntityById` → `getEntityByPublicId`
- `fetchDocumentsPostgres` → `getEntitiesByPublicIds`
- interaction detail reads
- association detail reads

These are the highest-confidence `InferSelect` wins.

## Step 4: replace helper queries that currently misuse search

Next wave:

- `getEntityIdsForAnnotationTerms`
- `getScopedAnnotationTerms`
- `getAssociatedEntityScope`
- `getSelectionInteractionCount`
- `getEntitiesByIds` core fetch path

These are currently using search as a transport layer for queries that are not really search.

## Step 5: shrink or replace the remaining search queries

After the UI contracts above are changed, rework:

- `searchEntitiesPostgres`
- `searchInteractionsPostgres`
- `searchAssociationsPostgres`
- facet query paths

Target state:

- entity search keeps only necessary ranking logic and returns `Entity[]` or a tiny search-local select shape
- interaction search keeps only necessary filter semantics and returns a small list-row shape without embedded evidence payloads
- association search keeps only necessary filter semantics and returns a small list-row shape without embedded identifier/evidence payloads
- facet queries are split into global/materialized and scoped/dynamic paths as needed
- shared `SearchResult`, `EntitySearchResult`, `InteractionSearchResult`, and `AssociationSearchResult` are deleted or reduced to temporary feature-local types only

---

## Bottom line

### Replace now with Drizzle + `InferSelect`

Best candidates:

- entity by public ID
- entities by public IDs
- entity identifiers
- entity annotations
- interaction by ID
- interaction evidence
- interaction annotations
- association by ID
- association evidence
- annotation-membership queries
- scoped annotation term counting
- selection count queries
- associated-entity traversal queries

### Keep custom only where truly necessary during migration

- ranked entity search logic
- facet aggregation queries
- any remaining list query that still needs ranking/filter semantics not yet moved to direct reads

Even in these cases:

- keep only the custom filtering/ranking/aggregation logic
- remove compatibility-era result assembly
- return base rows or tiny feature-local list shapes instead of shared DTO bags

The main architectural shift should be:

- use Drizzle inferred table/view types as the default read model
- change UI components so they no longer require compatibility-era aggregated hit fields
- compose detail screens from multiple simple reads
- keep any unavoidable joined/search-specific types local to the owning feature
- stop preserving shared legacy result bags as the default app contract
- treat query simplification and UI contract simplification as the same migration, not separate future phases
