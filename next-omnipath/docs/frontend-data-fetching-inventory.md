# Frontend data fetching inventory and minimal query surface

This document inventories the data the UI currently fetches and proposes the **minimal backend query surface** needed to support it after refactoring.

The goal is to describe the UI's **actual data needs**, not preserve the current `src/lib/queries.ts` shape.

---

## Scope

Included:
- client-side data fetching from React components/hooks
- server-side page data that directly hydrates a frontend view
- current server actions used by client components
- direct browser fetches to `/api/*`

Excluded:
- internal implementation details inside search/DB layers
- chat tool orchestration in `src/app/app-api/chat/route.ts` unless it is required by a visible UI flow

---

## 1. Current frontend fetches

## A. Entity search and entity result facets

### Used by
- `src/features/search/page.tsx`
- `src/features/explore/components/entities-explore-tab.tsx`

### Current behavior
- fetch paginated entity search results
- fetch entity facet counts separately for filter sidebars
- supports:
  - free-text query
  - species filter
  - entity type filter
  - source filter
  - ontology-term filter
  - scoped entity IDs in some embedded contexts

### Current call shape
- `searchEntities(...)` from `@/lib/queries`
- usually called twice:
  1. hits query
  2. facet-only query

### UI data needed
- entity hit list
- total hit count
- optional facet distributions:
  - `entity_type`
  - `sources`
  - `ncbi_tax_id`
  - `ontology_terms`

### Normalized requirement
**Entity search query** with optional facets.

---

## B. Single entity row for lightweight entity hydration

### Used by
- `src/hooks/use-entity.ts`

### Current behavior
- fetch one entity by public ID for UI display when no custom entity source is installed

### Current call shape
- `getEntityRowByPublicId(entityId)` from `@/lib/queries`

### UI data needed
- one entity row

### Normalized requirement
**Get entity by public ID**.

---

## C. Entity details dialog

### Used by
- `src/features/search/components/entity-details-dialog.tsx`

### Current behavior
Two separate fetches when dialog opens:
1. entity details
2. associated entity scope

### Current call shape
- `getEntityDetailsByPublicId(entityId)`
- `getAssociatedEntityScope([entityId])`

### UI data needed
For the details panel:
- entity row
- entity identifiers
- entity annotations
- entity summary

For the associations tab/count:
- associated entity public IDs for the current seed entity
- count of associated entities

### Normalized requirement
- **Get entity details by public ID**
- **Get associated entity IDs for seed entity IDs**

Note: the associations tab currently renders those associated IDs through the normal entity search UI, so there is **no separate frontend association search requirement** for this flow.

---

## D. Interaction search and interaction facets

### Used by
- `src/features/explore/components/interactions-explore-tab.tsx`
- indirectly by `src/features/search/components/entity-details-dialog.tsx` through embedded interactions tab
- indirectly by `src/features/workspace/views/selection-results-view.tsx` for scoped interaction results

### Current behavior
- fetch paginated interaction results
- use returned facet distributions to populate filters
- sometimes fetch a large result set for network mode
- selection view also needs an interaction count badge for the current scope

### Current call shape
- `searchInteractions(query, filters, limit, offset)` from `@/lib/queries`

### UI data needed
- interaction hit list
- total hit count
- facet distributions:
  - `interaction_type`
  - `is_directed`
  - `sign`
  - `interaction_annotation_terms`
  - `participant_annotation_terms`
  - `sources`

### Normalized requirement
**Interaction search query** with optional facets and count-only capability.

Important: the selection view interaction badge does **not** need a dedicated query if interaction search can return `estimatedTotalHits` with `limit: 0`.

---

## E. Interaction details sheet

### Used by
- `src/features/interactions-search/components/interaction-details-sheet.tsx`

### Current behavior
- browser fetch to `/api/interactions/:id`

### Current call shape
- `fetch(`/api/interactions/${interactionId}`)`

### UI data needed
- interaction row
- entity A row
- entity B row
- interaction evidence
- interaction annotations
- normalized display-ready evidence payload

### Normalized requirement
**Get interaction details by ID**.

---

## F. Ontology term resolution

### Used by
- `src/features/ontology/use-ontology-terms.ts`
- `src/features/search/components/result-card.tsx` (`CvTermHoverCard`)
- `src/features/interactions-search/components/filter-sidebar.tsx` via `useOntologyTerms(...)`

### Current behavior
- browser POST to `/api/terms`
- resolve ontology IDs to label/definition/namespace

### Current call shape
- `fetch("/api/terms", { body: { term_ids } })`

### UI data needed
For one or many ontology term IDs:
- id
- name
- definition
- namespace

### Normalized requirement
**Resolve ontology term IDs**.

---

## G. Ontology term search

### Used by
- `src/features/interactions-search/components/filter-sidebar.tsx`
- `src/features/explore/components/annotation-browser-tab.tsx` through `searchOntologyTerms(...)`

### Current behavior
- browser POST to `/api/terms/search` in filter sidebar
- server action wrapper in annotation browser
- free-text ontology search for GO/MI/OM/HP/KW-like terms

### Current call shape
- `fetch("/api/terms/search", { body: { queries, limit } })`
- `searchOntologyTerms(query, limit)` from `@/lib/queries`

### UI data needed
For a text query:
- matched ontology terms
- id
- label/name
- definition
- namespace
- match metadata (`match_type`, `matched_text`, `score`)

### Normalized requirement
**Search ontology terms by text**.

---

## H. Annotation browser: top terms and scoped annotation terms

### Used by
- `src/features/explore/components/annotation-browser-tab.tsx`

### Current behavior
Two modes:
1. **Unscoped**
   - free-text query -> ontology term search
   - empty query -> browse top ontology terms from entity search facets
2. **Scoped**
   - fetch annotation term counts for a set of scoped entity IDs
   - resolve those term IDs to names/definitions
   - filter client-side by text

### Current call shape
- `searchOntologyTerms(query, 30)`
- `browseTopOntologyTerms(species, 30)`
- `getScopedAnnotationTerms(scopedEntityIds, entityFilters)`

### UI data needed
- list of ontology terms with label/definition/namespace
- optional `entityCount`
- optional scope/filter awareness

### Normalized requirement
This can be satisfied by either:

#### Option 1: keep two backend queries
- **Search ontology terms by text**
- **List annotation terms for an entity scope**

#### Option 2: unify into one frontend-facing query
- **Browse annotation terms** with parameters:
  - `query?`
  - `species?`
  - `scopedEntityIds?`
  - `entityFilters?`
  - `limit`

Option 2 is probably the cleaner refactor target.

---

## I. Selection scope expansion from annotation IDs

### Used by
- `src/features/selection/selection-scope.ts`

### Current behavior
- when annotations are selected, fetch entity IDs matching those annotation terms

### Current call shape
- `getEntityIdsForAnnotationTerms(annotationIds)`

### UI data needed
- entity public IDs matching selected annotation term IDs

### Normalized requirement
**Get entity IDs for annotation term IDs**.

---

## J. Selection workspace interaction count

### Used by
- `src/features/workspace/views/selection-results-view.tsx`

### Current behavior
- calls `getSelectionInteractionCount(filters, scopedEntityIds)` from `@/lib/queries`
- this helper is referenced by the UI but is not present in the current `src/lib/queries.ts`

### UI data needed
- interaction count for current scoped entity set and filters

### Normalized requirement
No dedicated endpoint is necessary if **Interaction search** supports:
- `limit: 0`
- returning `estimatedTotalHits`

Otherwise:
- **Get interaction count for filters/scope**

Recommendation: use the interaction search query as the count source.

---

## K. Identifier lookup

### Used by
- `src/features/search/page.tsx`

### Current behavior
- browser POST to `/api/entity-lookup`
- used in identifier lookup and batch identifier modes

### Current call shape
- `fetch("/api/entity-lookup", { body: { identifiers } })`

### UI data needed
- match groups by input identifier
- candidate entity IDs per identifier
- optional hydrated entity previews for display

### Normalized requirement
**Resolve identifiers to canonical entity IDs and candidate entities**.

---

## L. Resources catalog

### Used by
- `src/app/resources/page.tsx`
- `src/features/resources/page.tsx`

### Current behavior
- server-side fetch to external API service through `getResources()`
- browser can also trigger resource archive downloads

### Current call shape
- `getResources()` -> `${apiServiceUrl}/resources`
- `fetch("/api/resources/download", ...)`
- direct link to `/api/resources/:resourceId/download`

### UI data needed
Catalog page:
- resource metadata list
- counts and sizes
- download status info

Downloads:
- archive download stream / zip bundle

### Normalized requirement
Queries:
- **List resources**

Commands/downloads:
- **Download one resource archive**
- **Download selected resource bundle**

---

## M. Export/materialize subset artifacts

### Used by
- `src/features/search/page.tsx`
- `src/features/explore/components/interactions-explore-tab.tsx`
- `src/lib/subsets/client.ts`

### Current behavior
- browser POSTs to export endpoints for entities/interactions parquet subsets

### Current call shape
- `/api/exports/entities/parquet`
- `/api/exports/interactions/parquet`

### UI data needed
- downloadable artifact stream
- optional row count / duration headers

### Normalized requirement
These are not really read queries; they are **materialization/export commands**.

---

## 2. Minimal frontend query surface

If we normalize the UI to the smallest useful set of frontend-facing reads, we need roughly the following.

## Core queries

### 1. `searchEntities`
Search entities with pagination and optional facets.

**Needs to cover:**
- search page entity results
- explore entity results
- filter sidebar facets
- embedded association tab result rendering via entity IDs
- top ontology term browse if we keep deriving top terms from entity facets

**Suggested shape**
```ts
searchEntities({
  query,
  filters,
  limit,
  offset,
  facets?,
}) => {
  hits,
  estimatedTotalHits,
  facetDistribution?,
}
```

### 2. `getEntity`
Fetch one entity row by public ID.

**Needs to cover:**
- `useEntity`

**Suggested shape**
```ts
getEntity({ publicId }) => Entity | null
```

### 3. `getEntityDetails`
Fetch one entity plus the extra data needed by the entity details dialog.

**Needs to cover:**
- entity details dialog body

**Suggested shape**
```ts
getEntityDetails({ publicId }) => {
  entity,
  identifiers,
  annotations,
  summary,
}
```

### 4. `getAssociatedEntityIds`
Fetch associated entity public IDs for one or more seed entity IDs.

**Needs to cover:**
- entity details association tab/count

**Suggested shape**
```ts
getAssociatedEntityIds({ seedEntityIds }) => {
  seedEntityIds,
  associatedEntityIds,
}
```

### 5. `searchInteractions`
Search interactions with pagination, total count, and optional facets.

**Needs to cover:**
- interactions explore tab
- entity details embedded interactions tab
- selection results interaction tab
- selection interaction badge count via `limit: 0`
- network-mode bulk load

**Suggested shape**
```ts
searchInteractions({
  query,
  filters,
  limit,
  offset,
  facets?,
}) => {
  hits,
  estimatedTotalHits,
  facetDistribution?,
}
```

### 6. `getInteractionDetails`
Fetch one interaction plus display-ready evidence data.

**Needs to cover:**
- interaction details sheet

**Suggested shape**
```ts
getInteractionDetails({ id }) => {
  interaction,
  entityA,
  entityB,
  evidence,
  interactionAnnotations,
  rawEvidence?,
}
```

### 7. `resolveOntologyTerms`
Resolve ontology IDs to metadata.

**Needs to cover:**
- term hover cards
- ontology label hydration in sidebars

**Suggested shape**
```ts
resolveOntologyTerms({ termIds }) => {
  terms: Record<string, {
    id,
    name,
    definition,
    namespace,
  } | null>
}
```

### 8. `searchOntologyTerms`
Search ontology terms by text.

**Needs to cover:**
- ontology autocomplete in filter sidebar
- annotation browser term search

**Suggested shape**
```ts
searchOntologyTerms({ queries, limit, prefixes? }) => {
  results: Record<string, Array<{
    id,
    name,
    definition,
    namespace,
    matched_text,
    match_type,
    score,
  }>>
}
```

### 9. `browseAnnotationTerms`
Unified annotation browser query.

**Needs to cover:**
- top terms browse
- scoped annotation term counts
- scoped annotation filtering

**Suggested shape**
```ts
browseAnnotationTerms({
  query?,
  species?,
  scopedEntityIds?,
  entityFilters?,
  limit,
}) => Array<{
  id,
  label,
  definition,
  namespace,
  entityCount?,
  matchType?,
  matchedText?,
  score?,
}>
```

Notes:
- this replaces the current split between:
  - `browseTopOntologyTerms`
  - `getScopedAnnotationTerms`
  - part of `searchOntologyTerms`
- if we do **not** unify this surface, then the minimal set becomes two queries instead:
  - `searchOntologyTerms`
  - `getScopedAnnotationTerms`

### 10. `resolveEntityIdentifiers`
Resolve identifiers/gene symbols/accessions to canonical entity IDs and candidate entities.

**Needs to cover:**
- identifier lookup
- batch identifier lookup

**Suggested shape**
```ts
resolveEntityIdentifiers({ identifiers }) => {
  matches: Array<{
    identifier,
    entityIds,
  }>,
  entities: Entity[],
}
```

### 11. `getEntityIdsForAnnotationTerms`
Fetch entity IDs matching selected annotation IDs.

**Needs to cover:**
- selection scope expansion

**Suggested shape**
```ts
getEntityIdsForAnnotationTerms({ termIds }) => string[]
```

### 12. `listResources`
Fetch resource catalog rows.

**Needs to cover:**
- resources page

**Suggested shape**
```ts
listResources() => ResourceRecord[]
```

---

## 3. Minimal query set if we optimize harder

If we aggressively collapse overlapping reads, the frontend could potentially live on this smaller set:

1. `searchEntities`
2. `getEntityDetails`
3. `searchInteractions`
4. `getInteractionDetails`
5. `resolveOntologyTerms`
6. `searchOntologyTerms`
7. `browseAnnotationTerms`
8. `resolveEntityIdentifiers`
9. `listResources`

To make that work, we would fold these into other queries:
- `getEntity` -> use `getEntityDetails` without extra expansions or with `include` flags
- `getAssociatedEntityIds` -> include in `getEntityDetails` when requested
- `getEntityIdsForAnnotationTerms` -> expose as a mode on `browseAnnotationTerms` or a generic annotation/entity mapping query
- interaction count -> use `searchInteractions(limit: 0)`

This is probably **too collapsed** for clarity, but it shows the real lower bound.

---

## 4. Recommended refactor target

Recommended frontend-facing query surface:

### Keep as distinct queries
- `searchEntities`
- `getEntity`
- `getEntityDetails`
- `getAssociatedEntityIds`
- `searchInteractions`
- `getInteractionDetails`
- `resolveOntologyTerms`
- `searchOntologyTerms`
- `browseAnnotationTerms`
- `resolveEntityIdentifiers`
- `getEntityIdsForAnnotationTerms`
- `listResources`

### Treat separately as commands/downloads, not queries
- `exportEntitiesSubset`
- `exportInteractionsSubset`
- `downloadResource(resourceId)`
- `downloadResourceSelection(resourceIds)`

This split is small enough to replace the current catch-all `src/lib/queries.ts`, while still keeping each query aligned to a real UI need.

---

## 5. Mapping from current frontend calls to proposed queries

| Current call / endpoint | Used by | Proposed query |
|---|---|---|
| `searchEntities(...)` | search page, explore entities | `searchEntities` |
| `getEntityRowByPublicId(...)` | `useEntity` | `getEntity` |
| `getEntityDetailsByPublicId(...)` | entity details dialog | `getEntityDetails` |
| `getAssociatedEntityScope(...)` | entity details dialog | `getAssociatedEntityIds` |
| `searchInteractions(...)` | interactions explore, selection, embedded details tab | `searchInteractions` |
| `/api/interactions/:id` | interaction details sheet | `getInteractionDetails` |
| `/api/terms` | term hover cards, ontology label hydration | `resolveOntologyTerms` |
| `/api/terms/search` | ontology search/autocomplete | `searchOntologyTerms` |
| `browseTopOntologyTerms(...)` | annotation browser | `browseAnnotationTerms` |
| `getScopedAnnotationTerms(...)` | annotation browser | `browseAnnotationTerms` |
| `getEntityIdsForAnnotationTerms(...)` | selection scope | `getEntityIdsForAnnotationTerms` |
| `/api/entity-lookup` | identifier lookup | `resolveEntityIdentifiers` |
| `getResources()` | resources page | `listResources` |

---

## 6. Main refactoring observations

1. `src/lib/queries.ts` currently mixes three concerns:
   - DB reads/composition
   - search reads
   - ontology/API-service reads

2. The frontend does **not** need one giant `queries.ts` module.

3. The frontend query surface naturally breaks into domains:
   - entities
   - interactions
   - ontology/annotations
   - identifiers
   - resources

4. The biggest overlap to simplify is annotation/ontology browsing.
   - That is the best candidate for a single purpose-built frontend query.

5. Interaction count for selection should come from interaction search totals, not a dedicated helper.

6. The current UI already points toward a clean split:
   - search queries
   - details queries
   - ontology queries
   - download/export commands

---

## 7. Suggested module split after refactor

One possible shape:

- `src/lib/actions/entities.ts`
  - `searchEntities`
  - `getEntity`
  - `getEntityDetails`
  - `getAssociatedEntityIds`

- `src/lib/actions/interactions.ts`
  - `searchInteractions`
  - `getInteractionDetails`

- `src/lib/actions/ontology.ts`
  - `resolveOntologyTerms`
  - `searchOntologyTerms`
  - `browseAnnotationTerms`
  - `getEntityIdsForAnnotationTerms`

- `src/lib/actions/identifiers.ts`
  - `resolveEntityIdentifiers`

- `src/lib/actions/resources.ts`
  - `listResources`

- `src/lib/actions/exports.ts`
  - export/download commands only

This would let us delete `src/lib/queries.ts` without forcing the frontend to import `src/lib/db/reads.ts` directly.
