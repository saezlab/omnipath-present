# Relation Query Consolidation Plan

## Goal

Make `relation.ts` and `relation-evidence.ts` the only query-layer entry points for relation data.

That means:
- relation list/detail views use `relation.ts`
- evidence is fetched only on demand via `relation-evidence.ts`
- feature adapters like `interaction-search.ts`, `interaction-details.ts`, `membership-search.ts`, and `relation-details.ts` are removed
- UI components stop depending on derived interaction/association payloads that eagerly combine relation rows with evidence rows

## Current findings

### Current query files
- `src/lib/queries/relation.ts`
- `src/lib/queries/relation-evidence.ts`
- `src/lib/queries/relation-details.ts` ← should be removed
- `src/lib/queries/interaction-search.ts` ← adapter, should be removed
- `src/lib/queries/interaction-details.ts` ← adapter, should be removed
- `src/lib/queries/membership-search.ts` ← adapter/wrapper, should be removed

### Current violations of the target architecture

#### 1. Search eagerly fetches evidence
`src/lib/queries/interaction-search.ts`
- calls `searchRelations(...)`
- then calls `getRelationDetailsByPks(...)`
- which in turn fetches evidence for every relation on the page
- then derives direction/sign from evidence

This violates the new rule:
- search should return relations + hydrated entities only
- evidence should not be fetched during search

#### 2. `relation-details.ts` couples relation + evidence
`src/lib/queries/relation-details.ts`
- fetches relation rows and evidence rows together
- encourages consumers to treat evidence as part of the base relation payload

This should be removed entirely.

#### 3. Interaction details still depend on adapter payload shaping
`src/lib/queries/interaction-details.ts`
- uses `getRelationDetailsByPk(...)`
- computes an interaction-specific payload with derived evidence semantics

This should be replaced by direct use of:
- `getRelationByPk(...)`
- `getEntitiesByPks(...)` or the entities already on the relation response
- `getEvidenceByRelationPk(...)` only when the details panel opens

#### 4. Membership/association wrappers still exist
`src/lib/queries/membership-search.ts`
- still represents a feature-specific query surface
- even if currently small, it preserves the old abstraction boundary

This should be removed after consumers switch to `searchRelations(...)` directly.

## Target architecture

### Base query layer

#### `src/lib/queries/relation.ts`
Owns:
- searching relations
- filtering by category, predicate, subject/object/entity PKs, sources
- fetching one relation by PK
- generic relation filter options
- generic relation-associated entity lookup helpers

#### `src/lib/queries/relation-evidence.ts`
Owns:
- fetching evidence by relation PK
- fetching evidence by relation PKs when explicitly needed

### Consumer responsibilities

#### Relation list/search consumers
Consumers should:
1. call `searchRelations(...)`
2. collect subject/object PKs from the returned rows
3. call `getEntitiesByPks(...)`
4. render relation rows directly

Consumers should **not**:
- fetch relation evidence in search/list views
- infer sign/direction/stoichiometry in the query layer

#### Relation detail consumers
Consumers should:
1. call `getRelationByPk(...)`
2. fetch entities if needed
3. only when the evidence panel/details sheet is opened, call `getEvidenceByRelationPk(...)`
4. render raw evidence JSON or lightweight client-side formatting

## Required refactors by area

### 1. Interactions explore list
File:
- `src/features/explore/components/interactions-explore-tab.tsx`

Current state:
- imports `searchInteractions` from `src/lib/queries/interaction-search.ts`
- receives derived `InteractionListRow`

Refactor plan:
- replace `searchInteractions(...)` with `searchRelations(...)` filtered to `relationCategories: ["interaction"]`
- hydrate subject/object entities in the component (or a local server action scoped to this feature)
- update row shape from `{ interaction, entityA, entityB }` to something relation-native, e.g.
  - `{ relation, subjectEntity, objectEntity }`
- render `relation.predicate`, `relation.evidenceCount`, `relation.sources`
- stop using evidence-derived direction/sign in the list view

Important:
- do not fetch evidence during infinite scroll page loads
- do not use `getEvidenceByRelationPks(...)` from the list view

### 2. Interaction details sheet
File:
- `src/features/interactions-search/components/interaction-details-sheet.tsx`

Current state:
- imports `getInteractionDetails` from `src/lib/queries/interaction-details.ts`

Refactor plan:
- replace that with direct fetching from:
  - `/api/relations/[id]` for base relation + entities
  - `/api/relations/[id]/evidence` for evidence
- or call `getRelationByPk(...)` and `getEvidenceByRelationPk(...)` separately in a server action boundary
- split the fetch lifecycle:
  - relation metadata loads first
  - evidence loads only for the opened sheet

UI changes:
- `InteractionDetails` should accept a relation-native type
- evidence rendering should use raw evidence rows or a thin presentation transform local to the component
- remove dependency on `InteractionRecord`, `InteractionDetailsData`, and evidence-derived sign/direction payloads

### 3. Interaction details component
File:
- `src/features/interactions-search/components/interaction-details.tsx`

Current state:
- heavily depends on `InteractionDetailsData`
- expects derived direction/sign and parsed annotations

Refactor plan:
- convert input props to something like:
  - `relation`
  - `subjectEntity`
  - `objectEntity`
  - `evidence`
- make any annotation extraction local presentation logic, not query-layer logic
- prefer showing:
  - `relation.predicate`
  - `relation.relationCategory`
  - `relation.evidenceCount`
  - raw evidence JSON sections
- if sign/direction chips are still desired temporarily, keep that logic in the component, not in query files

### 4. Membership/association consumers
Current visible usage is small, but the rule should be the same.

Refactor plan:
- replace `membership-search.ts` usage with `searchRelations({ relationCategories: ["membership"] })`
- hydrate entities separately
- fetch evidence only inside association detail UI, not in list/search
- remove query-layer derivation of `roleTermId` and `stoichiometry`
- if those are still displayed, derive them locally in the UI from raw evidence rows

### 5. Entity details dialog
File:
- `src/features/shared/entity-results/entity-details-dialog.tsx`

Current state:
- imports `getAssociatedEntityIds` from `membership-search.ts`

Refactor plan:
- replace that import with a generic relation-layer helper from `relation.ts`
- if needed, add a better-named generic helper there rather than routing through a feature adapter

## Proposed rollout order

### Phase 1 — Stop introducing new adapter patterns
- do not add any new feature-specific query wrappers
- treat `relation-details.ts` as deprecated immediately

### Phase 2 — Refactor interaction list view
- migrate `interactions-explore-tab.tsx` to `searchRelations(...)`
- hydrate entities separately
- remove evidence fetching from list/search flows

### Phase 3 — Refactor interaction details flow
- migrate `interaction-details-sheet.tsx` to fetch relation metadata and evidence separately
- update `interaction-details.tsx` to render relation-native data
- remove `interaction-details.ts`

### Phase 4 — Refactor association/membership flows
- migrate any remaining `membership-search.ts` consumers to `relation.ts`
- fetch evidence only on demand in detail views
- remove `membership-search.ts`

### Phase 5 — Delete temporary consolidation layer
- remove `relation-details.ts`
- remove `interaction-search.ts`
- remove `interaction-details.ts`
- remove any old feature types that only exist to support those adapters

### Phase 6 — Simplify semantics layer
- audit `src/lib/relations/semantics.ts`
- move any remaining needed formatting into components
- remove query-oriented summarizers once no consumer depends on them

## Concrete file changes to make next

### Delete after migration
- `src/lib/queries/relation-details.ts`
- `src/lib/queries/interaction-search.ts`
- `src/lib/queries/interaction-details.ts`
- `src/lib/queries/membership-search.ts`

### Update imports in UI
- `src/features/explore/components/interactions-explore-tab.tsx`
- `src/features/interactions-search/components/interaction-details-sheet.tsx`
- `src/features/interactions-search/components/interaction-details.tsx`
- `src/features/shared/entity-results/entity-details-dialog.tsx`

### Keep as canonical query layer
- `src/lib/queries/relation.ts`
- `src/lib/queries/relation-evidence.ts`

## Acceptance criteria

This cleanup is complete when all of the following are true:
- no UI component imports `interaction-search.ts`
- no UI component imports `interaction-details.ts`
- no UI component imports `membership-search.ts`
- `relation-details.ts` does not exist
- no relation list/search path fetches evidence rows
- evidence is fetched only by explicit detail/evidence interactions
- relation list/detail UIs render from raw relation rows plus separately hydrated entities
- typecheck passes with only `relation.ts` and `relation-evidence.ts` as the relation query surface

## Summary

The intended end state is simple:
- `relation.ts` for relations
- `relation-evidence.ts` for evidence
- no combined relation+evidence query helper
- no interaction/membership-specific query adapters
- evidence fetched only on demand
