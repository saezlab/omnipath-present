# Frontend query surface by model

Concise inventory of the **frontend-facing reads** grouped by data model.

Schema reference checked from:
- `drizzle/schema.ts`

---

## Entity

### Tables / views
- `entity`
- `entity_identifier`
- `entity_annotation`
- `entity_summary`

### UI fetches
- search entity results
- fetch entity filter facets
- hydrate one entity by public ID
- fetch full entity details for the details dialog
- fetch associated entity IDs for the associations tab
- fetch entity IDs matching selected annotation terms

### Minimal queries

#### `searchEntities`
Used by:
- `src/features/explore/components/entities-explore-tab.tsx`
- embedded search in entity associations tab

UI requires:
- `hits: Entity[] | EntitySearchRow[]`
- `total`

Common filters:
- `query`
- `entity_ids`
- `entity_types`
- `sources`
- `ncbi_tax_id`
- `ontology_terms`
- `limit`
- `offset`

Note:
- do not expose Meilisearch-era fields like `estimatedTotalHits` or `facetDistribution`
- result queries should return a generic `total`
- entity filter sidebars should own a separate filter-count query

#### `getEntity`
Used by:
- `src/hooks/use-entity.ts`

UI requires:
- one `entity` row by public ID

#### `getEntityDetails`
Used by:
- `src/features/search/components/entity-details-dialog.tsx`

UI requires:
- `entity`
- `identifiers`
- `annotations`
- `summary`

#### `getAssociatedEntityIds`
Used by:
- `src/features/search/components/entity-details-dialog.tsx`

UI requires:
- `seedEntityIds`
- `associatedEntityIds`

#### `getEntityIdsForAnnotationTerms`
Used by:
- `src/features/selection/selection-scope.ts`

UI requires:
- `string[]` of entity public IDs for selected annotation term IDs

---

## Interaction

### Tables / views
- `interaction`
- `interaction_annotation`
- `interaction_evidence`

### UI fetches
- search interaction results
- fetch interaction filter facets
- fetch interaction details for the details sheet
- fetch interaction count for selection/workspace badges
- fetch larger interaction set for network view

### Minimal queries

#### `searchInteractions`
Used by:
- `src/features/explore/components/interactions-explore-tab.tsx`
- embedded interactions tab in entity details
- selection workspace interaction results

UI requires:
- `hits: InteractionListRow[]`
- `total`

Common filters:
- `entity_ids`
- `interaction_types`
- `interaction_annotation_terms`
- `participant_annotation_terms`
- `sources`
- `is_directed`
- `signs`
- `limit`
- `offset`

Notes:
- selection interaction count should come from this query with `limit: 0`
- network mode uses the same query with a high `limit`
- do not expose Meilisearch-era fields like `estimatedTotalHits` or `facetDistribution`
- interaction filter sidebars should own a separate filter-count query

#### `getInteractionDetails`
Used by:
- `src/features/interactions-search/components/interaction-details-sheet.tsx`

UI requires:
- `interaction`
- `entityA`
- `entityB`
- `interactionAnnotations`
- `evidence`
- optional `rawEvidence`

---

## Association

### Tables
- `association`
- `association_evidence`

### UI fetches
Current frontend does **not** have a first-class association search/details flow.

Current usage:
- entity details dialog only needs **associated entity IDs**, not association rows/evidence

### Minimal queries
None required as standalone frontend queries right now.

If associations become first-class UI results later, likely queries would be:
- `searchAssociations`
- `getAssociationDetails`

---

## Annotation / Ontology

### Backing models
- DB side: `entity_annotation`, `interaction_annotation`
- external ontology service:
  - term lookup
  - term search
  - ontology tree/metadata APIs

### UI fetches
- resolve ontology IDs to labels/definitions
- search ontology terms by text
- browse top annotation terms
- browse scoped annotation terms with counts
- power annotation filter sidebars and hovercards

### Minimal queries

#### `resolveOntologyTerms`
Used by:
- `src/features/ontology/use-ontology-terms.ts`
- `src/features/search/components/result-card.tsx`
- `src/features/interactions-search/components/filter-sidebar.tsx`

UI requires:
- `terms: Record<termId, { id, name, definition, namespace } | null>`

#### `searchOntologyTerms`
Used by:
- `src/features/interactions-search/components/filter-sidebar.tsx`
- annotation browser when text query is present

UI requires:
- per query, matching terms with:
  - `id`
  - `name`
  - `definition`
  - `namespace`
  - `matched_text`
  - `match_type`
  - `score`

#### `browseAnnotationTerms`
Used by:
- `src/features/explore/components/annotation-browser-tab.tsx`

UI requires:
- list of terms with:
  - `id`
  - `label`
  - `definition`
  - `namespace`
  - optional `entityCount`
  - optional match metadata

Should cover both modes:
- unscoped top terms browse
- scoped annotation terms for `scopedEntityIds + entityFilters`

This can replace the current split between:
- `browseTopOntologyTerms`
- `getScopedAnnotationTerms`
- part of `searchOntologyTerms`

---

## Identifier resolution

### Backing model
- `entity_identifier`
- `entity`

### UI fetches
- single identifier lookup
- batch identifier lookup
- identifier-to-entity resolution for anchored search flows

### Refactoring note
- replace the current external `/api/entity-lookup` dependency with a Postgres-backed identifier resolver
- serve identifier resolution directly from `entity_identifier`
- canonical identifiers are now also present in `entity_identifier`, so no union with `entity.canonical_identifier` is needed for lookup
- the frontend should use this Postgres identifier search as the single identifier-resolution path

### Minimal queries

#### `resolveEntityIdentifiers`
Used by:
- `src/features/search/page.tsx`

UI requires:
- `matches: Array<{ identifier, entityIds }>`
- `entities: Entity[]` for display/hydration of candidate matches

---

## Resource catalog

### Backing model
- external API service, not in `drizzle/schema.ts`

### UI fetches
- list resources for the catalog page

### Minimal queries

#### `listResources`
Used by:
- `src/app/resources/page.tsx`

UI requires:
- resource metadata rows including:
  - ids / names
  - descriptions
  - categories / ontologies
  - counts
  - sizes
  - build/download status

---

## Commands, not read queries

These are frontend-triggered, but they should stay outside the read-query surface.

### Exports
- `exportEntitiesSubset`
- `exportInteractionsSubset`

### Downloads
- `downloadResource(resourceId)`
- `downloadResourceSelection(resourceIds)`

---

## Note on totals and filter counts

`estimatedTotalHits` and `facetDistribution` are Meilisearch-era transport terms and should not define the new query surface.

Recommended direction:
- result queries return `{ hits, total }`
- filter sidebars own separate filter-count queries
- filter/count responses should be named by domain, not by search-engine internals

Examples:
- `searchEntities(...) -> { hits, total }`
- `getEntityFilterCounts(...) -> { entity_type, sources, ncbi_tax_id, ontology_terms }`
- `searchInteractions(...) -> { hits, total }`
- `getInteractionFilterCounts(...) -> { interaction_type, is_directed, sign, interaction_annotation_terms, participant_annotation_terms, sources }`

---

## Recommended minimal set

Grouped by model, the current frontend only really needs these reads:

### Note on totals and filter counts
- keep totals and filter counts separate in the refactor
- result queries should return `{ hits, total }`
- filter sidebars should own separate filter-count queries
- do not carry forward `estimatedTotalHits` or `facetDistribution`

### Entity
- `searchEntities`
- `getEntity`
- `getEntityDetails`
- `getAssociatedEntityIds`
- `getEntityIdsForAnnotationTerms`
- `getEntityFilterCounts`

### Interaction
- `searchInteractions`
- `getInteractionDetails`
- `getInteractionFilterCounts`

### Annotation / Ontology
- `resolveOntologyTerms`
- `searchOntologyTerms`
- `browseAnnotationTerms`

### Identifier resolution
- `resolveEntityIdentifiers` (Postgres-backed, from `entity_identifier`)

### Resources
- `listResources`

---

## Refactoring summary

1. Split result queries from filter-count queries.
2. Keep `searchEntities` and `searchInteractions` focused on results + total only.
3. Move entity and interaction sidebar facets into dedicated queries:
   - `getEntityFilterCounts`
   - `getInteractionFilterCounts`
4. Replace the current external identifier lookup path with Postgres-backed `resolveEntityIdentifiers` using `entity_identifier`.
5. Collapse annotation browsing into `browseAnnotationTerms`.
6. Keep association reads out of the frontend surface until associations become first-class UI results.
7. Keep export/download endpoints separate from query modules.
8. Name refactored query/action files by domain, not by generic role.
9. Prefer the Drizzle query builder for these reads instead of custom transport-shaped query layers wherever practical.

### File/module naming
The refactor should produce modules named by domain, for example:
- `entity.ts`
- `interaction.ts`
- `annotation.ts`
- `ontology.ts`
- `identifier.ts`
- `resource.ts`

Avoid catch-all files like:
- `queries.ts`
- large mixed-domain action modules

### Query implementation note
- prefer implementing the new reads with the Drizzle query builder directly
- keep result shapes aligned to UI/domain needs, not search-engine-era response contracts
- only drop to raw SQL where the query builder is clearly insufficient or much less readable
