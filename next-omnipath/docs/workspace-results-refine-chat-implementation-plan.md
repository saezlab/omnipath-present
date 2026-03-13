# Results / Refine / Chat workspace implementation plan

This document defines the next architecture step for OmniPath Explorer: replace the current page-specific pane logic with a single workspace model built around three panes.

## Goal

Switch the app to a unified single-page-app style workspace with three pane types:

- **Results**
- **Refine**
- **Chat**

The **Results** pane can render one of three views:

- **entities**
- **interactions**
- **selection**

The **Refine** pane combines:

- page/view-specific filter controls
- ontology-based filtering controls
- active filter summary/chips if useful

The **Chat** pane is a first-class workspace pane, not a floating overlay.

This is a full switch, not a transitional fallback architecture.

---

## Product model

## Workspace panes

### 1. Results pane

The primary pane that renders one active result mode:

- `entities`
- `interactions`
- `selection`

### 2. Refine pane

A single secondary pane that merges:

- the current filter sidebar content
- ontology-based filtering controls
- view-specific refinement controls

This pane replaces the split between sidebar filters and separate ontology panel concepts.

### 3. Chat pane

A workspace pane for the assistant that:

- stays integrated in the layout
- can navigate between result modes
- can update URL-backed result state
- can be shown or hidden like the other panes

---

## Desktop behavior

Show up to 3 panes at once:

- Results
- Refine
- Chat

Rules:

- each pane is independently toggleable
- at least 1 pane must remain visible
- visible panes are resizable
- pane order is fixed:
  1. Results
  2. Refine
  3. Chat

---

## Mobile behavior

Show exactly 1 pane at a time:

- Results
- Refine
- Chat

Rules:

- the same controls are used
- controls behave as a one-of-three switch instead of independent toggles
- the selected pane fills the workspace

---

## Canonical state model

## 1. URL state remains canonical for result state

The URL is still the source of truth for:

- active result mode
- query
- filters
- selection entity IDs
- selection tab
- anchored interaction entity IDs

## 2. Workspace UI state is not URL state

The workspace layout state is local UI state:

- visible panes on desktop
- active pane on mobile
- pane widths

This state should be persisted locally, not encoded in the URL.

---

## Routing model

Do not keep separate internal page architectures for:

- `/search`
- `/explore/interactions`
- `/selection`

Instead, introduce a single shared workspace shell and route-level entry points that configure the shell.

### Result modes

Define:

```ts
type ResultsView = "entities" | "interactions" | "selection";
```

### Canonical route direction

Move toward a single route model:

```txt
/workspace?view=entities
/workspace?view=interactions
/workspace?view=selection
```

with additional URL params for query and filters.

### No fallback rule

This migration should switch fully to the new workspace route architecture.
Existing page-specific route implementations should be removed after the workspace route is in place.

---

## Proposed URL model

## `/workspace`

### Shared params

- `view`: `entities | interactions | selection`
- `filters`: serialized `MeilisearchFilters`

### Entities view params

- `q`
- `mode`
- `type`
- `species`

### Interactions view params

- `entity`
- `entities`
- `filters`

### Selection view params

- `entities`
- `tab`
- `filters`

### Examples

```txt
/workspace?view=entities&q=egfr&species=9606&filters=...
/workspace?view=interactions&entities=P:UP:O00688&filters=...
/workspace?view=selection&entities=P:UP:P04637,P:UP:O00688&tab=interactions
```

---

## Shared workspace architecture

## New top-level workspace components

### New

- `next-omnipath/src/features/workspace/workspace-shell.tsx`
- `next-omnipath/src/features/workspace/workspace-controls.tsx`
- `next-omnipath/src/features/workspace/use-workspace-ui-state.ts`
- `next-omnipath/src/features/workspace/results-pane.tsx`
- `next-omnipath/src/features/workspace/refine-pane.tsx`
- `next-omnipath/src/features/workspace/chat-pane.tsx`
- `next-omnipath/src/app/workspace/page.tsx`

### Responsibilities

#### `workspace-shell.tsx`

Owns:

- responsive layout
- pane visibility behavior
- resizable desktop layout
- mobile single-pane rendering
- fixed bottom-right pane controls

#### `workspace-controls.tsx`

Renders the fixed bottom-right controls:

- Results
- Refine
- Chat

Desktop:
- toggles visible panes

Mobile:
- switches the active pane

#### `use-workspace-ui-state.ts`

Owns persisted local UI state:

```ts
type WorkspacePane = "results" | "refine" | "chat";

interface WorkspaceUiState {
  isMobile: boolean;
  desktopVisiblePanes: WorkspacePane[];
  mobileActivePane: WorkspacePane;
  setDesktopVisiblePanes: (panes: WorkspacePane[]) => void;
  toggleDesktopPane: (pane: WorkspacePane) => void;
  setMobileActivePane: (pane: WorkspacePane) => void;
}
```

This is the only workspace pane state model.

#### `results-pane.tsx`

Renders one of:

- entity results view
- interactions results view
- selection results view

based on URL-backed `view` state.

#### `refine-pane.tsx`

Renders refinement UI depending on `view`:

- entities view -> entity filters + ontology refinement
- interactions view -> interaction filters + ontology refinement
- selection view -> selection-scoped refine controls + ontology refinement where relevant

This replaces the old sidebar + ontology split.

#### `chat-pane.tsx`

Hosts the assistant pane inside the workspace shell.

It should reuse the current integrated chat UI and tool-result navigation behavior.

---

## Shared route state hooks

Expand the URL-state layer so the workspace route is the only active route model.

### New

- `next-omnipath/src/lib/navigation/workspace-url-state.ts`

### Proposed API

```ts
interface WorkspaceUrlState {
  view: "entities" | "interactions" | "selection";
  setView: (view: ResultsView) => void;

  entitiesView: ReturnType<typeof useSearchUrlState>;
  interactionsView: ReturnType<typeof useInteractionsUrlState>;
  selectionView: ReturnType<typeof useSelectionUrlState>;
}
```

This centralizes workspace routing around one canonical route.

---

## Replace page-specific panes with shared result views

## New result-view components

### New

- `next-omnipath/src/features/workspace/views/entities-results-view.tsx`
- `next-omnipath/src/features/workspace/views/interactions-results-view.tsx`
- `next-omnipath/src/features/workspace/views/selection-results-view.tsx`

### Responsibilities

#### `entities-results-view.tsx`

Extract the entity results rendering logic currently living in `src/features/search/page.tsx`.

Responsibilities:

- search header/input behavior
- entity result list
- identifier lookup mode
- batch identifier lookup mode
- exports
- result layout concerns only

It should no longer own ontology pane behavior or chat controls.

#### `interactions-results-view.tsx`

Extract the interactions results rendering logic currently living in `src/features/explore/interactions-page.tsx`.

Responsibilities:

- interaction results rendering
- interactions-specific results controls
- result layout concerns only

#### `selection-results-view.tsx`

Extract the selection workspace logic currently living in `src/app/selection/page.tsx`.

Responsibilities:

- selected entity result set
- interaction tab for selection scope
- associations tab for selection scope
- selection-scoped view rendering

---

## Replace sidebar content injection with explicit refine rendering

Current sidebar content injection through `SidebarContentProvider` should no longer be the main refinement architecture.

The Refine pane should render explicitly from workspace state and active result view.

### New refine components

- `next-omnipath/src/features/workspace/refine/entities-refine-panel.tsx`
- `next-omnipath/src/features/workspace/refine/interactions-refine-panel.tsx`
- `next-omnipath/src/features/workspace/refine/selection-refine-panel.tsx`
- `next-omnipath/src/features/workspace/refine/ontology-refine-section.tsx`

### Responsibilities

#### `entities-refine-panel.tsx`

Merge:

- entity filters
- ontology term filters

#### `interactions-refine-panel.tsx`

Merge:

- interaction filters
- ontology/annotation-driven participant filters

#### `selection-refine-panel.tsx`

Merge:

- selection-scoped filters for the active selection tab
- ontology-based refinement where applicable

---

## Chat integration requirements

The chat pane must work across all workspace views.

### Rules

- chat is never a floating overlay in the workspace architecture
- chat is always rendered as the Chat pane
- the assistant can switch the active results view
- the assistant can update URL-backed state for the active results view
- the assistant can request that Refine be shown if refinement is relevant

### Structured action model

Add explicit workspace actions:

```ts
type WorkspaceAction =
  | { type: "open-results-view"; view: "entities" | "interactions" | "selection" }
  | { type: "set-visible-panes"; panes: Array<"results" | "refine" | "chat"> }
  | { type: "set-mobile-pane"; pane: "results" | "refine" | "chat" };
```

These actions complement existing URL-navigation/result actions.

---

## Chat guidance update

The assistant should no longer think in terms of navigating to unrelated pages.

It should think in terms of controlling the workspace:

- switch Results view to entities/interactions/selection
- update URL-backed result state
- open Refine when ontology/filter work is relevant
- keep Chat visible only when useful

### Required prompt changes

Add instructions that the assistant should:

- treat the app as a workspace with Results / Refine / Chat panes
- treat `entities`, `interactions`, and `selection` as Results modes
- use the workspace route and workspace actions as the primary navigation model
- prefer opening Refine when the user’s task involves ontology/filter refinement

---

## Migration phases

## Phase 1 — create the shared workspace shell

### Deliverables

- add `use-workspace-ui-state.ts`
- add `workspace-shell.tsx`
- add `workspace-controls.tsx`
- add desktop/mobile pane behavior
- add fixed bottom-right pane controls

### Result

A shared shell exists with:

- Results pane
- Refine pane
- Chat pane

---

## Phase 2 — create the `/workspace` route and route-level URL state

### Deliverables

- add `src/app/workspace/page.tsx`
- add `workspace-url-state.ts`
- support `view=entities | interactions | selection`
- wire existing search/interactions/selection URL state into one route

### Result

The workspace route becomes the canonical route surface.

---

## Phase 3 — extract result views into reusable components

### Deliverables

- extract entities result view
- extract interactions result view
- extract selection result view
- mount them through `results-pane.tsx`

### Result

The Results pane can switch between all result modes inside one workspace shell.

---

## Phase 4 — extract and unify refinement UI

### Deliverables

- create entities/interactions/selection refine panels
- create shared ontology refine section
- stop using sidebar injection as the primary refine architecture

### Result

The Refine pane becomes the sole refinement surface.

---

## Phase 5 — move chat into the workspace shell fully

### Deliverables

- add `chat-pane.tsx`
- reuse current chat panel and tool-result navigation
- add workspace actions for pane visibility and results-view switching

### Result

Chat becomes a workspace-native pane.

---

## Phase 6 — remove legacy route-specific page architecture

### Remove

- old page-specific pane logic from `src/features/search/page.tsx`
- old page-specific pane logic from `src/features/explore/interactions-page.tsx`
- old page-specific selection page composition from `src/app/selection/page.tsx`
- old global floating assistant architecture
- old split between sidebar filters and separate ontology pane

### Result

Only the unified workspace architecture remains.

---

## File targets

## New

- `next-omnipath/src/app/workspace/page.tsx`
- `next-omnipath/src/lib/navigation/workspace-url-state.ts`
- `next-omnipath/src/features/workspace/workspace-shell.tsx`
- `next-omnipath/src/features/workspace/workspace-controls.tsx`
- `next-omnipath/src/features/workspace/use-workspace-ui-state.ts`
- `next-omnipath/src/features/workspace/results-pane.tsx`
- `next-omnipath/src/features/workspace/refine-pane.tsx`
- `next-omnipath/src/features/workspace/chat-pane.tsx`
- `next-omnipath/src/features/workspace/views/entities-results-view.tsx`
- `next-omnipath/src/features/workspace/views/interactions-results-view.tsx`
- `next-omnipath/src/features/workspace/views/selection-results-view.tsx`
- `next-omnipath/src/features/workspace/refine/entities-refine-panel.tsx`
- `next-omnipath/src/features/workspace/refine/interactions-refine-panel.tsx`
- `next-omnipath/src/features/workspace/refine/selection-refine-panel.tsx`
- `next-omnipath/src/features/workspace/refine/ontology-refine-section.tsx`
- `next-omnipath/docs/workspace-results-refine-chat-implementation-plan.md`

## Update

- `next-omnipath/src/app/api/chat/route.ts`
- `next-omnipath/src/lib/navigation/url-codecs.ts`
- `next-omnipath/src/lib/navigation/url-state.ts`
- current result page components that are being extracted into workspace views
- chat components involved in result navigation and pane control

## Remove

- `next-omnipath/src/features/chat-floating/*`
- old page-specific workspace toggle implementations
- old ontology-pane-specific layout logic

---

## Non-goals

The following are explicitly out of scope for this step:

- preserving old route-specific pane architecture in parallel
- keeping floating chat as a secondary chat mode
- keeping separate ontology pane architecture alongside the new Refine pane
- fallback logic that supports both old and new workspace systems indefinitely

---

## Summary

The app should fully switch to a unified workspace model:

- **Results** pane
- **Refine** pane
- **Chat** pane

with the Results pane switching between:

- **entities**
- **interactions**
- **selection**

The Refine pane should merge filters and ontology refinement into one surface.
The Chat pane should remain integrated into the workspace.
The bottom-right controls should toggle workspace panes.
The URL should remain canonical for result state.
The workspace shell should fully replace the current page-specific pane architecture.
