# Selection / Explore UI unification plan

## Goal

Replace the current `/selection` results UI with the same primary UI used by `/explore`, while keeping selection-specific behavior:

- same top-level shell and tabbed layout as Explore
- same tab content components where possible
- same sidebar/filter presentation pattern as Explore
- all searches and counts constrained to the current selection scope
- minimal duplication between Explore and Selection

The target state is:

- `/explore` = unscoped browsing
- `/selection` = scoped browsing over the derived selection entity set
- both routes render through a shared page shell and shared tab implementations

---

## Current implementation inventory

### Explore today

Primary file:

- `src/features/explore/page.tsx`

Behavior:

- owns the search bar, species picker, tab strip, selection CTA, and tab layouts
- renders:
  - entity results inline using `SearchResults`
  - interactions via `InteractionsExploreTab`
  - annotations via local `AnnotationResults`
- owns entity and interaction filter sidebars in-page
- drives entity search from local `nuqs` state (`tab`, `q`, `species`)
- drives filters from local React state

Key Explore-specific traits:

- entity tab is already a fully integrated explore layout
- interactions tab already uses a reusable component: `InteractionsExploreTab`
- annotations tab is not yet extracted into a reusable explore/scoped variant

### Selection today

Primary file:

- `src/features/workspace/views/selection-results-view.tsx`

Behavior:

- has its own header UI, tab strip, summary card, and search bar
- uses workspace views for each tab:
  - `EntitiesResultsView`
  - `InteractionsResultsView`
  - `SelectionAnnotationsView`
- computes scope via `useSelectionScope(...)`
- fetches interaction count separately via `searchInteractionsMeilisearch(...)`

Key Selection-specific traits:

- visually similar to Explore, but not the same shell
- split across workspace-specific result views rather than shared explore components
- uses selection URL state (`useSelectionUrlState`) instead of explore URL state
- selection scoping logic is mixed into the page and child views

---

## Current differences to address

### 1. Page shell duplication

Explore and Selection both implement their own:

- search/header card
- tab strip
- empty/loading framing
- tab switching layout
- result-area container layout

This is the highest-level duplication.

### 2. Different entity implementations

Explore entity tab:

- implemented directly inside `src/features/explore/page.tsx`
- owns its own infinite scroll setup
- owns its own filter pane layout
- uses `EntityFilterSidebar`

Selection entity tab:

- uses `EntitiesResultsView`
- comes from the workspace/search stack, not the explore stack
- has different search mode support (`full-text`, `identifier`, `batch`)
- does not match Explore's entity shell

This is the biggest UX mismatch.

### 3. Different annotation implementations

Explore annotations:

- local `AnnotationResults({ query })` in `explore/page.tsx`
- unscoped ontology search/browse behavior

Selection annotations:

- `SelectionAnnotationsView`
- scoped by selected entities
- computes scoped annotation counts by iterating over entity batches

These are conceptually the same tab with different data sources, but currently fully separate.

### 4. Filters are owned in different places

Explore:

- entity filters and interaction filters are page-local React state
- counts are updated inline in the page

Selection:

- filters come from `useSelectionUrlState()`
- entity/interactions/annotations each have different ownership patterns
- counts are partly derived in child views and partly fetched in the page

This makes shared composition harder.

### 5. Selection scope is applied ad hoc

Selection scope today is derived by:

- `useSelectionScope(selectedEntityIds, selectedAnnotationIds)`

Then enforced differently in different child views:

- entities: `lockedEntityIds`
- interactions: `entity_ids` injection plus optional expansion logic
- annotations: explicit `scopedEntityIds` prop and custom fetch logic

The scoping rule is consistent, but the integration points are not.

### 6. Workspace refine pane and Explore main-page sidebar are separate concepts

Today Selection relies on workspace refine-pane components such as:

- `SelectionRefinePanel`
- `EntitiesRefinePanel`
- `InteractionsRefinePanel`
- `SelectionAnnotationsRefinePanel`

Explore instead renders filter sidebars inside the main content layout.

If Selection should look like Explore, Selection should stop relying on a separate workspace-only refine architecture for these tabs.

### 7. URL state models differ

Explore uses route-local state:

- `tab`, `q`, `species`
- local React state for filters

Selection uses route-local URL state:

- `tab`, `q`, `filters`, `entities`

This is fine, but shared UI components need a route-agnostic state adapter.

---

## DRY alignment strategy

The right DRY boundary is **not** “make Selection reuse all of Explore page.tsx directly”.

Instead, extract the common page into composable shared pieces:

1. **shared shell**
2. **shared tab contracts**
3. **shared scoped/unscoped data adapters**
4. **shared filter/count ownership model**

That keeps route state and scope derivation separate from rendering.

---

## Proposed target architecture

## 1. Create a shared browser shell

Add a new shared component, e.g.:

- `src/features/explore/components/explore-browser-shell.tsx`

Responsibilities:

- render the top search card
- render species picker when enabled
- render tabs
- render optional helper text (`/ focuses search`)
- render tab content area
- render optional bottom-right CTA (used by Explore, not Selection)
- support either plain content or content + filter sidebar layout

Suggested shape:

```tsx
interface BrowserTabConfig<TTab extends string> {
  value: TTab;
  label: string;
  badge?: React.ReactNode;
  content: React.ReactNode;
}

interface ExploreBrowserShellProps<TTab extends string> {
  query: string;
  draftQuery: string;
  onDraftQueryChange: (value: string) => void;
  onSubmitSearch: () => void;
  tab: TTab;
  onTabChange: (tab: TTab) => void;
  tabs: BrowserTabConfig<TTab>[];
  searchPlaceholder: string;
  species?: string;
  onSpeciesChange?: (value: string | null) => void;
  showSpeciesPicker?: boolean;
  helperText?: React.ReactNode;
  footerCta?: React.ReactNode;
}
```

This shell should become the outer container for both Explore and Selection.

---

## 2. Extract a shared entities browse tab

Add a reusable entity browser tab component, e.g.:

- `src/features/explore/components/entities-explore-tab.tsx`

Responsibilities:

- perform infinite entity search
- own filter count loading for entity facets
- render `SearchResults`
- render `EntityFilterSidebar`
- support mobile vs desktop filter layout exactly like Explore
- allow optional scoping to a fixed entity set

Suggested props:

```tsx
interface EntitiesExploreTabProps {
  query: string;
  species?: string;
  filters: MeilisearchFilters;
  onFiltersChange: (filters: MeilisearchFilters) => void;
  scopedEntityIds?: string[];
  showSpeciesInFilters?: boolean;
}
```

Important behavior:

- when `scopedEntityIds` exists, always enforce `entity_ids: scopedEntityIds`
- still compute facet counts from the scoped result set only
- request only the facets actually rendered by this tab

Then:

- Explore entity tab uses `EntitiesExploreTab` with no scope
- Selection entity tab uses `EntitiesExploreTab` with `scopedEntityIds`

This removes the current split between inline Explore entity search and workspace `EntitiesResultsView`.

---

## 3. Generalize the annotations tab into scoped/unscoped modes

Add a reusable annotations browser component, e.g.:

- `src/features/explore/components/annotations-explore-tab.tsx` (repurpose/replace current one)
- or `src/features/explore/components/annotation-browser-tab.tsx`

This new component should support two data modes:

### Unscoped mode

For Explore:

- current behavior from `AnnotationResults`
- query search via `searchOntologyTerms(query, limit)`
- browse mode via `browseTopOntologyTerms(species?, limit)`

### Scoped mode

For Selection:

- derive annotation counts only from the scoped entity result set
- support text filtering over those scoped terms
- show same cards and selection controls as Explore

Suggested props:

```tsx
interface AnnotationBrowserTabProps {
  query: string;
  species?: string;
  scopedEntityIds?: string[];
  entityFilters?: MeilisearchFilters;
}
```

Implementation note:

- Extract card rendering into a pure presentational component so both modes share visuals.
- Keep query/browse logic in data hooks.

---

## 4. Keep `InteractionsExploreTab`, but make scoping first-class

`InteractionsExploreTab` is already the strongest shared piece.

Needed improvement:

- make scoped entity filtering a first-class prop instead of requiring wrapper components to inject `entity_ids`

Suggested prop:

```tsx
scopedEntityIds?: string[]
```

Behavior:

- internally merge `scopedEntityIds` into outgoing filters
- optionally preserve existing `include_associated_entities` behavior in a controlled way

Then:

- Explore interactions tab passes no scope
- Selection interactions tab passes `scopedEntityIds`

This should allow retiring or greatly shrinking `workspace/views/interactions-results-view.tsx`.

---

## 5. Introduce shared data hooks for each tab

To keep UI components simple, extract tab data logic into hooks:

- `useEntityBrowser(...)`
- `useInteractionBrowser(...)`
- `useAnnotationBrowser(...)`
- `useScopedSelectionCounts(...)`

These hooks should encapsulate:

- request params
- facet loading
- count loading
- scope enforcement
- infinite scroll wiring

This keeps the shell thin and prevents business logic duplication in page components.

---

## 6. Introduce a route-agnostic browser state adapter layer

Create small adapters that translate route-specific state into the shared browser props.

### Explore adapter

Example:

- `useExploreBrowserState()`

Owns:

- `tab`, `query`, `species`
- local filter state per tab
- selection CTA state

### Selection adapter

Example:

- `useSelectionBrowserState()`

Owns:

- `tab`, `query`, `filters`
- `scopedEntityIds` from `useSelectionScope`
- selection summary badges
- scoped interaction/entity counts

The shared shell should not know whether it is on `/explore` or `/selection`.

---

## 7. Decide what to do with current workspace-specific views

### Candidates to retire after migration

- `src/features/workspace/views/selection-results-view.tsx` as a bespoke UI
- `src/features/workspace/views/interactions-results-view.tsx` wrapper logic
- `src/features/workspace/views/selection-annotations-view.tsx` bespoke annotations tab implementation

### Candidates to keep temporarily as adapters

- `selection-results-view.tsx` can become a thin adapter that renders the shared shell
- `interactions-results-view.tsx` can temporarily wrap `InteractionsExploreTab` until scoped prop support lands

### Candidate to deprecate or narrow in scope

- `EntitiesResultsView`

`EntitiesResultsView` currently serves the old workspace/search workflows and includes identifier and batch lookup modes that do not match Explore.

Recommendation:

- do **not** force Explore to absorb identifier/batch lookup UX
- keep `EntitiesResultsView` only for workflow/search-specific contexts if still needed
- build a separate `EntitiesExploreTab` specifically for the common Explore/Selection browser UX

---

## Proposed phased implementation plan

## Phase 1 — extract shared shell

### Tasks

1. Create `ExploreBrowserShell`.
2. Move the generic Explore header/tabs/container layout out of `explore/page.tsx`.
3. Make `/explore` render through the new shell without changing behavior.

### Output

- no user-visible functional change
- `/explore` is now powered by reusable page chrome

### Risk

- low

---

## Phase 2 — extract `EntitiesExploreTab`

### Tasks

1. Move Explore entity-tab search logic out of `explore/page.tsx`.
2. Create `EntitiesExploreTab` with:
   - infinite scrolling
   - entity filter counts
   - sidebar layout
   - mobile/desktop handling
3. Add scoped entity support.
4. Replace Explore entity inline implementation with `EntitiesExploreTab`.

### Output

- `/explore` entity tab is reusable
- selection can now consume the same component

### Risk

- medium, since entity tab currently has page-local logic

---

## Phase 3 — extract shared annotation browser tab

### Tasks

1. Extract Explore `AnnotationResults` card UI into reusable presentational components.
2. Create a common annotation browser component with:
   - unscoped ontology search/browse mode
   - scoped annotation aggregation mode
3. Replace Explore annotations with the new shared component.
4. Replace `SelectionAnnotationsView` with the same component in scoped mode.

### Output

- same annotation cards and empty/loading states across Explore and Selection

### Risk

- medium, because current Explore and Selection annotation data sources differ

---

## Phase 4 — make `InteractionsExploreTab` natively scoped

### Tasks

1. Add `scopedEntityIds` prop.
2. Move scope enforcement inside the component or a dedicated interaction-browser hook.
3. Keep `include_associated_entities` behavior working in scoped mode.
4. Replace `InteractionsResultsView` wrapper logic with direct use of `InteractionsExploreTab` where possible.

### Output

- Explore and Selection share the same interaction tab component with only different input state

### Risk

- low to medium

---

## Phase 5 — build Selection on top of the shared shell

### Tasks

1. Refactor `selection-results-view.tsx` into a thin adapter.
2. Compute:
   - `scopedEntityIds`
   - summary badges
   - scoped counts
3. Render the same shell and same tab components as Explore:
   - `EntitiesExploreTab` scoped
   - `InteractionsExploreTab` scoped
   - shared annotation browser scoped
4. Keep selection-specific summary copy above or below the shared shell as a small optional slot.

### Output

- `/selection` matches Explore layout closely
- only data scope and counts differ

### Risk

- low once shared components exist

---

## Phase 6 — collapse redundant workspace refine/results code

### Tasks

1. Audit remaining callers of:
   - `SelectionRefinePanel`
   - `SelectionAnnotationsRefinePanel`
   - `InteractionsResultsView`
   - `SelectionAnnotationsView`
2. Remove or shrink adapters that are no longer needed.
3. Ensure only one implementation exists per browser tab.

### Output

- DRY final state
- fewer divergent browser implementations

---

## Recommended component ownership after refactor

### Shared browser components

- `features/explore/components/explore-browser-shell.tsx`
- `features/explore/components/entities-explore-tab.tsx`
- `features/explore/components/interactions-explore-tab.tsx`
- `features/explore/components/annotation-browser-tab.tsx`

### Shared hooks

- `features/explore/hooks/use-entity-browser.ts`
- `features/explore/hooks/use-interaction-browser.ts`
- `features/explore/hooks/use-annotation-browser.ts`
- `features/selection/use-selection-browser-state.ts`

### Thin route adapters

- `features/explore/page.tsx`
- `features/workspace/views/selection-results-view.tsx`

---

## State model recommendation

To avoid prop drilling and route coupling, define a shared browser state contract.

```tsx
type BrowserTab = "entities" | "interactions" | "annotations";

interface BrowserState {
  tab: BrowserTab;
  setTab: (tab: BrowserTab) => void;
  query: string;
  draftQuery: string;
  setDraftQuery: (value: string) => void;
  submitSearch: () => void;
  species?: string;
  setSpecies?: (value: string | null) => void;
  entityFilters: MeilisearchFilters;
  setEntityFilters: (filters: MeilisearchFilters) => void;
  interactionFilters: MeilisearchFilters;
  setInteractionFilters: (filters: MeilisearchFilters) => void;
  scopedEntityIds?: string[];
}
```

Explore and Selection can each implement this contract differently.

---

## Alignment decisions to make before coding

### 1. Should Selection keep the summary card?

Recommendation:

- yes, but as an optional slot above the shared shell content or below the header card
- do not fork the whole page shell for it

### 2. Should Selection keep species switching?

Recommendation:

- likely no, or disabled when scope already determines the result set
- if species is shown, it must only affect filtering within the scoped set

### 3. Should Selection retain separate refine-pane behavior?

Recommendation:

- if the requirement is “same UI we have in Explore”, prefer the Explore-style in-content filter sidebars
- keep workspace refine-pane only where a different workspace mode still needs it

### 4. Should identifier/batch lookup remain in Selection entities?

Recommendation:

- no, not in the shared Explore-like Selection browser
- keep those modes in search/workflow-specific areas only

---

## Success criteria

The migration is complete when:

- `/selection` visually matches `/explore` at the shell/layout level
- entity, interaction, and annotation tabs are shared implementations
- selection scoping is applied centrally, not ad hoc in each view
- filter counts on `/selection` are computed from the scoped set only
- redundant selection-specific result view code is removed or reduced to adapters
- Explore behavior is preserved for unscoped browsing

---

## Suggested implementation order

1. Shared shell extraction
2. Shared entity tab extraction
3. Shared annotation tab extraction
4. Scoped support in `InteractionsExploreTab`
5. Switch `/selection` to shared shell + shared tabs
6. Remove old bespoke selection views

This order minimizes risk because Explore remains the reference implementation throughout, and Selection becomes a scoped adapter over the same browser components.
