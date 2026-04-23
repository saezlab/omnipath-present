# `src/lib` graph-native refactor plan

## Goal

Refactor `next-omnipath/src/lib` so the app queries the new graph schema directly and no longer relies on legacy domain entry points such as:

- `src/lib/entity.ts`
- `src/lib/interaction.ts`
- `src/lib/association.ts`
- `src/lib/annotation.ts`
- `src/lib/search_data/search.ts`
- `src/lib/postgres-search/search.ts`

The target is not a compatibility layer. The target is a new query surface that is:

- graph-native
- use-case oriented
- typed around the current Drizzle schema
- explicit about derived read models
- and decoupled from old table-era naming

---

## Decision

The earlier plan kept old domain entry points as temporary facades.

That is not the right end state if we want a deeper refactor.

### Revised decision

Do **not** preserve the old app query API shape as the organizing principle.

Instead:

1. create a new graph-native query package
2. migrate every live consumer to that new package
3. delete the old entry points once the new imports land

This means the migration must cover both:

- `src/lib` internals
- and the feature/hook/route call sites that currently import those modules

---

## Why the deeper refactor is worth it

The current `src/lib` surface still encodes deleted storage concepts:

- interactions as a base table
- associations as a base table
- annotations as a special join table
- embedded entity identifiers
- one catch-all `SearchFilters` contract

If we keep those entry points alive, even as wrappers, we preserve the wrong mental model in:

- feature code
- chat tools
- API routes
- shared types

That makes every later change more expensive.

The deeper refactor should instead force the app to speak in one of three vocabularies only:

1. graph primitives
   - entity
   - relation
   - relation evidence
   - ontology term
2. graph-derived read models
   - interaction list item
   - membership list item
   - annotation browser item
3. explicit use-case queries
   - entity details
   - interaction details
   - selection scope expansion
   - identifier resolution

---

## Schema reality the plan must target

The plan should target the implemented schema in [schema.ts](/Users/jschaul/Code/omnipath-present/next-omnipath/drizzle/schema.ts), not only the conceptual target in [target-graph-schema.md](/Users/jschaul/Code/omnipath-present/next-omnipath/docs/target-graph-schema.md).

### Current base tables

- `entity`
- `entity_identifier`
- `ontology_term`
- `entity_relation`
- `entity_relation_evidence`

### Important consequences

- `entity.identifiers` does not exist
- `interaction` and `association` do not exist as base tables
- `entity_annotation` does not exist as a base table
- `annotation_term` does not exist; term metadata now lives in `ontology_term`
- there is no first-class `entity_summary`
- there is no first-class `annotation_term_search`
- `entity_relation.predicate` is currently `text`, not an FK

The refactor must therefore assume that some old app contracts have to disappear rather than be mapped mechanically.

---

## Live consumer surface to migrate

These are the direct consumers of the old entry points in the current codebase.

### Hooks and client components

- `src/hooks/use-entity.ts`
- `src/features/explore/components/entities-explore-tab.tsx`
- `src/features/explore/components/entity-search-workspace.tsx`
- `src/features/explore/components/interactions-explore-tab.tsx`
- `src/features/explore/components/annotation-browser-tab.tsx`
- `src/features/shared/entity-results/entity-details-dialog.tsx`
- `src/features/interactions-search/components/interaction-details-sheet.tsx`
- `src/features/selection/selection-scope.ts`

### Server routes

- `src/app/api/interactions/[id]/route.ts`
- `src/app/app-api/chat/route.ts`

### Shared types tightly coupled to the old query surface

- `src/features/interactions-search/types.ts`
- `src/types/search-results.ts`
- `src/types/search.ts`
- parts of `src/lib/entities/display.ts`

This is the actual cutover surface. The plan needs to replace these imports, not just rewire what happens behind them.

---

## Target architecture

Use two layers:

1. a graph access layer
2. a use-case query layer

The old domain modules should not survive as public query entry points.

## A. Graph access layer

Create a new package, for example:

- `src/lib/graph/entities.ts`
- `src/lib/graph/entity-identifiers.ts`
- `src/lib/graph/relations.ts`
- `src/lib/graph/relation-evidence.ts`
- `src/lib/graph/ontology-terms.ts`
- `src/lib/graph/relation-semantics.ts`

### Responsibilities

- read base tables only
- return Drizzle rows or tiny joined row shapes
- centralize predicate normalization
- centralize evidence JSON parsing helpers
- contain no UI- or screen-shaped payload assembly

### Typical functions

- `getEntityByPublicId(...)`
- `getEntitiesByPks(...)`
- `getEntityIdentifiersByEntityPks(...)`
- `getRelationById(...)`
- `getRelationsByCategory(...)`
- `getRelationEvidenceByRelationPk(...)`
- `getOntologyTermsByIds(...)`

## B. Use-case query layer

Create a new package, for example:

- `src/lib/queries/entity-search.ts`
- `src/lib/queries/entity-details.ts`
- `src/lib/queries/identifier-resolution.ts`
- `src/lib/queries/annotation-browser.ts`
- `src/lib/queries/interaction-search.ts`
- `src/lib/queries/interaction-details.ts`
- `src/lib/queries/membership-search.ts`
- `src/lib/queries/selection-scope.ts`
- `src/lib/queries/facets.ts`
- `src/lib/queries/ontology-terms.ts`

### Responsibilities

- assemble feature-facing result DTOs
- hide graph-table joins from the UI
- own search/facet logic
- own derived read-model queries
- become the only import surface for features/routes

### Design rule

The use-case query layer should be organized by app needs, not by old table names.

Good names:

- `searchInteractionRelations`
- `getInteractionDetails`
- `browseAnnotationTerms`
- `getEntityDetails`
- `getSelectionScopedEntityIds`

Bad names:

- `searchAssociations` if it still implies an old physical table
- `getInteractionById` if the return type is really a relation-backed DTO rather than a raw DB row

Where old vocabulary is still useful in the UI, it should exist only at the use-case layer, not in the graph access layer.

---

## What should be deleted

After the migration, delete these as public query modules:

- `src/lib/entity.ts`
- `src/lib/interaction.ts`
- `src/lib/association.ts`
- `src/lib/annotation.ts`
- `src/lib/search_data/search.ts`
- `src/lib/postgres-search/search.ts`

### Notes

- `src/lib/identifier.ts` should likely become `src/lib/queries/identifier-resolution.ts`
- `src/lib/ontology.ts` may survive, but only for external ontology-service calls
- `src/lib/entities/display.ts` should survive as a display helper module, but it must stop pretending raw entity rows include embedded identifiers

Deleting these files matters because otherwise they will remain the default import path and the deeper refactor will collapse back into wrappers.

---

## Type-system refactor

The current types leak persistence assumptions directly into UI code.

### Problems to remove

- `EntitySearchRow extends Entity` but assumes embedded identifiers
- `InteractionListRow` embeds old `Interaction` row semantics
- one broad `SearchFilters` type mixes entity, interaction, association, and annotation concerns
- features import Drizzle types that no longer match the actual app read models

## A. Replace old shared result types with DTOs

Introduce explicit query result types under the new query layer.

Examples:

- `EntitySearchHit`
- `EntityDetailsResult`
- `InteractionSearchHit`
- `InteractionDetailsResult`
- `MembershipSearchHit`
- `AnnotationBrowserTerm`
- `ResolvedEntityMatch`

These should be feature-facing DTOs, not direct `InferSelectModel` aliases.

## B. Keep Drizzle row types in the graph layer only

Use Drizzle types for:

- base table reads
- internal query composition
- graph-layer helper contracts

Do not make feature components consume raw `EntityRelation` or `EntityRelationEvidence` rows directly unless there is a compelling reason.

## C. Split filter types

Replace the broad `SearchFilters` contract with narrower filter shapes:

- `EntitySearchFilters`
- `InteractionSearchFilters`
- `MembershipSearchFilters`
- `AnnotationBrowseFilters`

This is a key part of the deeper refactor. A single filter object is what keeps old search-era coupling alive.

---

## Data model mapping rules

These rules should be encoded once, then reused by all queries.

## 1. Entity annotations

Annotations are not a special join table anymore.

Recommended interpretation:

- `entity_relation.relation_category = 'annotation'`
- `subject_entity_pk` is the annotated entity
- `object_entity_pk` is the annotation object entity
- object entity metadata resolves to `ontology_term` via canonical identifier to `term_id`

## 2. Interactions

Interactions are relation rows with:

- `relation_category = 'interaction'`
- subject = left/member A
- object = right/member B

Any old interaction-only concepts such as:

- sign
- direction
- interaction annotation terms

must be derived from `entity_relation_evidence` or from graph-native materialized views.

## 3. Memberships

Associations should become membership/composition queries over:

- `relation_category = 'membership'`
- subject = parent/composite
- object = member/component

Any old membership-specific fields such as:

- role term
- stoichiometry

must come from evidence attributes or a dedicated derived read model.

## 4. Ontology terms

Use `ontology_term` directly as the term registry.

Do not preserve the old `annotation_term` naming inside new query APIs.

## 5. Predicate semantics

Because `predicate` is still text, define one central registry in `src/lib/graph/relation-semantics.ts` for:

- interaction predicates
- membership predicates
- annotation predicates
- any temporary normalization or label mapping

Do not scatter predicate string logic across the codebase.

---

## Derived read models we should allow

A deeper refactor does not mean “never materialize anything”.

It means derived views are explicit and graph-native.

### Good derived views or materialized views

- interaction search rows derived from `entity_relation`
- membership search rows derived from `entity_relation`
- annotation term counts derived from annotation relations
- relation evidence projections that extract sign/direction/method terms
- entity summary/count views derived from relations

### Naming rule

Use graph-native names such as:

- `interaction_relation_search_mv`
- `membership_relation_search_mv`
- `annotation_term_counts_mv`
- `entity_summary_mv`

Avoid names that imply the old base tables still exist.

---

## Query package design

The new query package should be consumer-oriented.

## 1. `src/lib/queries/entity-search.ts`

### Owns

- free-text / identifier-backed entity search
- entity search facets

### Returns

- `EntitySearchHit[]`
- `EntitySearchFacets`

### Used by

- `entities-explore-tab.tsx`
- `entity-search-workspace.tsx`
- chat entity search tool

## 2. `src/lib/queries/entity-details.ts`

### Owns

- full entity detail assembly
- identifiers
- descriptions
- annotation summaries
- relation counts
- associated entity scope if kept as part of details

### Returns

- `EntityDetailsResult`

### Used by

- `use-entity.ts`
- `entity-details-dialog.tsx`

## 3. `src/lib/queries/identifier-resolution.ts`

### Owns

- exact identifier resolution through `entity_identifier`

### Returns

- `ResolvedEntityLookupResult`

### Used by

- `entity-search-workspace.tsx`
- chat identifier tool

## 4. `src/lib/queries/annotation-browser.ts`

### Owns

- annotation browsing
- annotation term resolution
- annotation-to-entity lookup

### Returns

- `AnnotationBrowserTerm[]`
- `ResolvedOntologyTermMap`
- `string[]` for entity IDs when needed

### Used by

- `annotation-browser-tab.tsx`
- `selection-scope.ts`
- chat ontology term resolution tool

## 5. `src/lib/queries/interaction-search.ts`

### Owns

- interaction relation list search
- interaction-specific filter mapping
- interaction facets

### Returns

- `InteractionSearchHit[]`
- `InteractionSearchFacets`

### Used by

- `interactions-explore-tab.tsx`
- chat interaction search tool

## 6. `src/lib/queries/interaction-details.ts`

### Owns

- one interaction detail record
- hydrated entities
- parsed evidence payload

### Returns

- `InteractionDetailsResult`

### Used by

- `interaction-details-sheet.tsx`
- `/api/interactions/[id]`

## 7. `src/lib/queries/membership-search.ts`

### Owns

- membership/composition search
- associated entity expansion

### Returns

- `MembershipSearchHit[]`
- `AssociatedEntityScopeResult`

### Used by

- `entity-details-dialog.tsx`
- chat association tool if that tool remains

## 8. `src/lib/queries/selection-scope.ts`

### Owns

- annotation selection -> entity scope expansion

### Used by

- `features/selection/selection-scope.ts`

This query should not live under `entity.ts`. It is a selection workflow query.

---

## Consumer migration map

These are the concrete import migrations the plan should drive.

## 1. `src/hooks/use-entity.ts`

### Current

- imports `getEntity` from `@/lib/entity`

### Target

- import a point-lookup query from `@/lib/queries/entity-details` or `@/lib/queries/entity-search`

Preferred outcome:

- use a minimal `getEntitySummaryByPublicId(...)` query if the hook only needs a lightweight entity record

## 2. `src/features/explore/components/entities-explore-tab.tsx`

### Current

- imports `searchEntities` and `getEntityFilterCounts` from `@/lib/entity`

### Target

- import from `@/lib/queries/entity-search`

## 3. `src/features/explore/components/entity-search-workspace.tsx`

### Current

- imports entity search and identifier resolution from old modules

### Target

- import from:
  - `@/lib/queries/entity-search`
  - `@/lib/queries/identifier-resolution`

## 4. `src/features/explore/components/interactions-explore-tab.tsx`

### Current

- imports `searchInteractions` and `getInteractionFilterCounts` from `@/lib/interaction`

### Target

- import from `@/lib/queries/interaction-search`

This file is a good example of why we should not keep the old domain entry point name. It is consuming a list-query DTO, not a raw interaction row API.

## 5. `src/features/interactions-search/components/interaction-details-sheet.tsx`

### Current

- imports `getInteractionDetails` from `@/lib/interaction`

### Target

- import from `@/lib/queries/interaction-details`

## 6. `src/features/shared/entity-results/entity-details-dialog.tsx`

### Current

- imports `getEntityDetails` and `getAssociatedEntityIds` from `@/lib/entity`

### Target

- import from:
  - `@/lib/queries/entity-details`
  - `@/lib/queries/membership-search`

This is the strongest example that “entity” was overloaded. The associated-scope query is not entity persistence; it is a membership workflow query.

## 7. `src/features/explore/components/annotation-browser-tab.tsx`

### Current

- imports `browseAnnotationTerms` from `@/lib/annotation`

### Target

- import from `@/lib/queries/annotation-browser`

## 8. `src/features/selection/selection-scope.ts`

### Current

- imports `getEntityIdsForAnnotationTerms` from `@/lib/entity`

### Target

- import from `@/lib/queries/selection-scope` or `@/lib/queries/annotation-browser`

Prefer `selection-scope.ts` if we want the workflow semantics to stay explicit.

## 9. `src/app/api/interactions/[id]/route.ts`

### Current

- imports `getInteractionDetails` from `@/lib/interaction`

### Target

- import from `@/lib/queries/interaction-details`

## 10. `src/app/app-api/chat/route.ts`

### Current

- imports from `entity`, `interaction`, `association`, `annotation`, `identifier`

### Target

- import only from the new query package:
  - `entity-search`
  - `interaction-search`
  - `membership-search`
  - `annotation-browser`
  - `identifier-resolution`
  - `ontology-terms`

The chat route should not be the last consumer keeping old modules alive.

---

## Type migration work

## 1. `src/features/interactions-search/types.ts`

This file currently imports old Drizzle `Interaction` types directly.

Rewrite it so it defines feature DTOs such as:

- `InteractionSearchHit`
- `InteractionDetailsResult`
- `InteractionEvidenceItem`

These DTOs should match the new query outputs, not old table row names.

## 2. `src/types/search-results.ts`

This file still carries a compatibility-era document mindset.

Refactor or split it into:

- entity search DTOs
- annotation browse DTOs
- feature-local result types where appropriate

## 3. `src/types/search.ts`

This should stop being a single omnibus filter type.

Replace it with separate per-query filter contracts and migrate consumers accordingly.

This is a large but important cleanup because it removes a major source of accidental cross-domain coupling.

---

## Implementation order

## Phase 0. Stabilize the schema boundary

1. align `drizzle/index.ts` with the actual new schema
2. remove imports of tables/types that no longer exist
3. replace all `entity.identifiers` assumptions with normalized identifier hydration

### Exit condition

The app compiles against the real Drizzle schema without fake legacy exports.

---

## Phase 1. Build the graph access layer

1. create `src/lib/graph/entities.ts`
2. create `src/lib/graph/entity-identifiers.ts`
3. create `src/lib/graph/relations.ts`
4. create `src/lib/graph/relation-evidence.ts`
5. create `src/lib/graph/ontology-terms.ts`
6. create `src/lib/graph/relation-semantics.ts`

### Exit condition

All base-table reads can be performed without touching any old `src/lib` domain module.

---

## Phase 2. Define new DTOs and filter contracts

1. add new query result types under `src/lib/queries` or feature-local query type files
2. split `SearchFilters` into narrower contracts
3. update display helpers to accept hydrated identifier bundles explicitly

### Exit condition

The new query package can expose stable result shapes without leaking deleted schema assumptions.

---

## Phase 3. Implement new use-case queries

Recommended order:

1. `identifier-resolution.ts`
2. `entity-search.ts`
3. `annotation-browser.ts`
4. `selection-scope.ts`
5. `interaction-search.ts`
6. `interaction-details.ts`
7. `membership-search.ts`
8. `entity-details.ts`

### Why this order

- identifier and entity search unlock many screens quickly
- annotation queries are needed to replace `entity_annotation` assumptions
- interaction search/details are the most structurally different and should build on the new graph layer
- entity details should come after memberships and annotation summaries are available

---

## Phase 4. Migrate consumers vertically

Migrate imports and payload usage in this order:

1. `use-entity.ts`
2. explore entity screens
3. annotation browser and selection scope
4. interactions explore
5. interaction details sheet and interaction API route
6. entity details dialog
7. chat route

### Rule

Each consumer migration should remove its dependency on the old module entirely before moving on.

Do not add wrappers like:

- `src/lib/interaction.ts -> queries/interaction-search.ts`
- `src/lib/entity.ts -> queries/entity-details.ts`

That would preserve the wrong public surface.

---

## Phase 5. Delete the old modules

Delete:

- `src/lib/entity.ts`
- `src/lib/interaction.ts`
- `src/lib/association.ts`
- `src/lib/annotation.ts`
- `src/lib/search_data/search.ts`
- `src/lib/postgres-search/search.ts`

Then remove any leftover imports, dead types, and compatibility comments.

### Exit condition

There is no live app import of the old domain entry points.

---

## Phase 6. Rebuild derived views and facets cleanly

After the consumer cutover, revisit search/facet performance.

At that point:

- add graph-native materialized views where needed
- rename old facet sources if they still exist
- make the derived read-model boundary explicit in code and docs

This is when to optimize. It should not block the architectural cleanup.

---

## Risks to manage explicitly

## 1. Interaction sign/direction semantics

The old app expects these as first-class fields.

The new base schema does not provide them directly.

Recommendation:

- define a single parser/deriver in the graph layer
- optionally materialize the derived values later for search performance

## 2. Entity summary expectations

`entity-details-dialog.tsx` currently expects summary-like counts.

Decide explicitly whether these counts come from:

- direct derived SQL
- a materialized `entity_summary_mv`
- or on-demand relation count queries

Do not preserve a fake `entitySummary` table type.

## 3. Membership semantics

The UI still says “associations”.

That is acceptable at the presentation layer, but the new query architecture should model them as membership/composition relations.

## 4. Chat-tool contracts

Chat tools currently reflect the old app query surface strongly.

If we do not migrate them deliberately, they will become the main reason legacy modules survive.

---

## Recommended first implementation slice

For the deepest architectural leverage with manageable risk:

1. fix `drizzle/index.ts`
2. add the graph access layer
3. implement:
   - `queries/identifier-resolution.ts`
   - `queries/entity-search.ts`
   - `queries/annotation-browser.ts`
4. migrate:
   - `entity-search-workspace.tsx`
   - `entities-explore-tab.tsx`
   - `annotation-browser-tab.tsx`
   - `selection-scope.ts`
5. delete the parts of the old query surface those screens no longer need

### Why this slice

It removes the stale schema assumptions early, establishes the new architecture, and clears a full vertical path across:

- entity lookup
- entity search
- ontology browsing
- selection scope expansion

That creates the foundation needed before touching the more complex interaction and membership flows.

---

## End-state criteria

The refactor is complete when all of the following are true:

1. no feature, hook, or route imports from `src/lib/entity.ts`, `interaction.ts`, `association.ts`, or `annotation.ts`
2. no app query path assumes `entity.identifiers` is embedded
3. no search path depends on old physical-table vocabulary
4. feature DTOs no longer mirror deleted table row types
5. filter types are split by use case
6. derived views, if any, are graph-native and explicitly named as such

That is the point where `src/lib` will actually reflect the new schema rather than translating it back into the old one.
