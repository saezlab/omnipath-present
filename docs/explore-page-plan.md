# Explore page plan

## Goal
Implement the first page in the refined 2-page workflow:

1. **Explore** — search the full dataset and add entities or annotations to a shared selection
2. **Selection** — search a filtered dataset derived from the current selection

This document covers **Explore only**.

Reference inspiration: `/Users/jschaul/Library/Application Support/CleanShot/media/media_gNYN0FKkQ6/CleanShot 2026-04-17 at 07.45.42@2x.png`

## Explore page definition
The Explore page should be the universal entry point for discovery across the whole dataset.

Core behaviors:
- global search across the full dataset
- tabs below the search bar:
  - **Entities**
  - **Interactions**
  - **Annotations**
- users can add **entities** or **annotations** to the shared selection
- adding an **annotation** to selection means:
  - the annotation term becomes part of the selection state
  - downstream, the app can show all entities matching that annotation
- if selection is non-empty, show an obvious action and keybinding to jump to **Selection**

## Product framing
The Explore page is not just “search results”. It is the page where the user:
- searches the full corpus
- pivots between result types
- accumulates selection seeds
- decides when to move into scoped analysis on the Selection page

That makes Explore the broad, unscoped discovery surface.

## Page structure

### 1. Header search row
A full-width search bar at the top.

Recommended contents:
- search icon
- query input
- organism dropdown on the right if that remains part of the current app model
- explicit search submit button if needed, though keyboard submit should also work

Behavior:
- query applies to the currently active tab
- search state should be URL-backed
- empty query should still allow browsing/tab switching if supported by current APIs

### 2. Result type tabs
Immediately below the search bar:
- Entities
- Interactions
- Annotations

Behavior:
- tabs switch the active result set while preserving shared query state
- tab state should also be URL-backed
- counts are optional for v1; if cheap to compute they are useful, but should not block implementation

### 3. Results area
Shared layout beneath tabs, but tab-specific result rendering.

#### Entities tab
Purpose:
- show matching entities from the full dataset
- allow adding entity results directly to selection

Row actions:
- add entity to selection
- possibly inspect/open detail later, but not required for the first pass

#### Interactions tab
Purpose:
- search/browse full interaction results
- useful as an exploration surface, but **not** directly selectable in the initial workflow unless there is already a strong interaction-selection model

Initial recommendation:
- make interactions view read-only for this milestone
- defer adding interactions themselves to selection unless there is a clear product need

#### Annotations tab
Purpose:
- search ontology/annotation terms across the full dataset
- allow adding annotation terms to selection

Row actions:
- add annotation to selection

Important semantic rule:
- adding an annotation does **not** immediately replace the Explore result set with entities
- it only updates shared selection state
- the Selection page will then use that annotation seed to derive/filter matching entities

### 4. Persistent selection affordance
When selection is non-empty, show a clear affordance to move to Selection.

Recommended options:
- sticky button in the header area: **Open Selection**
- badge with current selection count
- keyboard shortcut shown in UI copy

Examples:
- `Open Selection (3)`
- `Press S to open Selection`

This should feel fast and always available once the user has started collecting entities/annotations.

## Selection model required for Explore
Explore introduces a more explicit multi-type selection model.

Minimum selection types:
- selected entity IDs
- selected annotation identifiers/terms

Recommended state shape:
- `entities: string[]`
- `annotations: AnnotationSelection[]`

Where `AnnotationSelection` should ideally capture enough identity to be stable:
- annotation/ontology ID if available
- display label
- optional source / namespace

Example:
```ts
interface AnnotationSelection {
  id: string
  label: string
  namespace?: string
}
```

Important rule:
- selection should deduplicate by stable ID
- selection should remain shared across Explore and Selection pages
- selection state should be reflected in URL, shared store, or both depending on current app architecture

## UX rules

### Search behavior
- one query input per Explore page
- active tab determines which index/query path is used
- tab changes should not clear the query
- result loading/empty/error states should be explicit

### Add-to-selection behavior
For entities:
- primary row action: add entity to selection
- if already selected, show selected state instead of add

For annotations:
- primary row action: add annotation to selection
- if already selected, show selected state instead of add

For interactions:
- no add action required in v1 unless product decision changes

### Selection CTA behavior
- hidden when selection is empty
- visible and prominent when selection is non-empty
- should indicate count and destination clearly

### Keyboard behavior
Suggested initial shortcuts:
- `/` focuses search input
- `s` or `g s` opens Selection when selection is non-empty
- arrow/enter navigation can be added later if the result list architecture supports it

## Information architecture and routing

### Recommended routes
Use Explore as a top-level page family.

Potential route shape:
- `/explore`
- optional URL params for:
  - `tab=entities|interactions|annotations`
  - `q=...`
  - `organism=...`

Example:
- `/explore?tab=annotations&q=kinase`

### Relationship to existing pages
Current app already has:
- `/explore`
- `/explore/entities`
- `/explore/interactions`
- `/selection`

Recommended direction:
- consolidate toward a single Explore surface instead of separate Explore subpages for entities/interactions
- keep old routes temporarily as redirects or compatibility entry points if needed
- make `/selection` the destination for working within the scoped subset

## Implementation plan

### Milestone 1 — Confirm Explore IA and selection semantics
- confirm that Explore is a single page with 3 tabs
- confirm interactions are read-only in Explore v1
- confirm annotation selection payload shape
- confirm jump-to-selection button copy and keybinding

Deliverable:
- finalized Explore contract before UI coding spreads across multiple pages/components

### Milestone 2 — Build Explore shell
- create/update a unified `/explore` page
- add full-width search bar
- add tabs for Entities / Interactions / Annotations
- make query + tab URL-backed
- add non-empty, loading, and empty states

Deliverable:
- navigation-ready Explore scaffold with working tab switching

### Milestone 3 — Wire tab-specific search results
- connect Entities tab to entity search source
- connect Interactions tab to interaction search source
- connect Annotations tab to annotation search source
- preserve shared query across tabs

Deliverable:
- all three Explore tabs returning real data

### Milestone 4 — Add selection actions
- add “Add to selection” on entity rows
- add “Add to selection” on annotation rows
- reflect already-selected state in results
- support dedupe and removal from the shared selection state if needed from result rows

Deliverable:
- Explore can accumulate the cross-type selection seeds needed for Selection

### Milestone 5 — Add persistent Selection CTA
- show sticky or prominent **Open Selection** action whenever selection is non-empty
- include count badge
- add keybinding and visible hint
- ensure navigation preserves shared selection context

Deliverable:
- smooth handoff from broad discovery into scoped analysis

### Milestone 6 — Cleanup and migration
- review whether `/explore/entities` and `/explore/interactions` should redirect into `/explore`
- remove or demote legacy workflow copy that conflicts with the new Explore/Selection model
- document the Explore page as the new primary discovery entry point

Deliverable:
- coherent routing and UX without duplicate concepts

## Component plan

### Likely reusable pieces
- existing search input styles/components
- existing tab components
- existing entity result row patterns
- existing selection badge/count infrastructure
- existing URL-state helpers

### Likely new pieces
- unified `ExplorePage` container
- tab-aware search controller
- annotation result row with add-to-selection action
- selection CTA component shared across Explore and possibly other pages
- shared multi-type selection helpers

## Data and state needs

### Search/data layer
Need one query path per tab:
- entities search
- interactions search
- annotations search

### Shared state layer
Need selection state capable of storing:
- entity selections
- annotation selections

### URL/state synchronization
Need URL-backed Explore state for:
- active tab
- query
- optional organism

Selection itself may remain in existing shared selection state if that architecture is already established.

## Open questions to resolve before implementation
1. Should Explore default to **Entities** or to the last-used tab?
2. Should the search submit explicitly fetch, or should it debounce live as the user types?
3. What exact annotation identity do we have available in search results: term label, ontology ID, source, all of the above?
4. Do we want interactions to support any selection action in v1, or stay strictly exploratory?
5. Should organism be global app state, Explore-only state, or just a query parameter?
6. How should the selection count be presented when both entities and annotations are selected:
   - combined total
   - separated counts
   - both
7. Should old `/explore/entities` and `/explore/interactions` routes remain visible in navigation during the migration?

## Recommended v1 decisions
To keep implementation focused, I recommend:
- **single `/explore` page** with 3 tabs
- default tab = **Entities**
- search query shared across tabs
- interactions tab is **read-only** for now
- only entities + annotations can be added to selection
- prominent **Open Selection** CTA when selection is non-empty
- URL-backed state for `tab`, `q`, and optional `organism`
- keep legacy explore subroutes only as temporary compatibility paths

## Success criteria
- users can search the full dataset from one place
- users can switch between Entities, Interactions, and Annotations without losing context
- users can add entities and annotations to a shared selection
- users can clearly tell when they have an active selection
- users have a fast, obvious path from Explore into Selection
- Explore feels like the broad discovery surface, while Selection is clearly the scoped analysis surface
