# Chat-driven navigation and URL state implementation plan

This document proposes a URL-first navigation model for chat-driven browsing and selection management.

## Goals

Treat chat as a navigation/controller layer that:

- researches the correct entities, ontology terms, and filters
- chooses the right destination page
- encodes the resulting state in the URL
- navigates there directly

Additional architectural goals:

- the **URL is the single source of truth** for page state and selection state
- avoid redundant state stores
- preserve the existing `/chat` page for now
- introduce a **new floating/minimizable chat window** at the app layout level

---

## Main architecture decisions

## 1. URL is canonical, not React context

Selection should no longer be managed by a separate `EntitySelectionContext` once the URL-based approach is in place.

That means:

- `/selection` must be reproducible from the URL alone
- selected entities are encoded in the URL
- active selection tab is encoded in the URL
- page-local filters are encoded in the URL
- browser navigation and shared links work naturally

The existing selection context should be removed as part of the migration, not retained as a parallel source of truth.

## 2. Use `nuqs` for URL state management

Preferred library: **`nuqs`**.

Reasoning:

- this is a Next.js App Router app
- we want typed query-state handling
- we want less boilerplate than raw `useSearchParams` + `router.replace`
- we want reusable page-specific URL state hooks
- we want to avoid hand-rolled parsing/sync logic in multiple pages

`nuqs` should be used for:

- query param parsing/serialization
- updating URL state
- defaults and normalization
- reusable search-param state hooks

We should still keep a small app-specific codec/helper layer for domain details like:

- `MeilisearchFilters`
- canonical entity ID arrays
- selection tab enums

## 3. Keep `/chat`, add a new layout-level chat window

Do **not** replace the existing `/chat` page yet.

Instead, create a new chat implementation that:

- uses the same AI elements / primitives
- is mounted at the **root layout level**
- renders as an **absolutely positioned floating window**
- can be minimized / restored
- can drive navigation across the app

This allows us to:

- preserve the current `/chat` route as a full-page experience
- experiment safely with a more agentic assistant UX
- make chat available from anywhere in the app
- avoid coupling the first iteration to the old `/chat` page architecture

---

## Product rules

### 1. Use `/search` for entity result sets

Use the entity search page when the user wants a set of entities defined by:

- free-text search
- taxonomy
- entity type
- source filters
- ontology/CV term filters

Examples:

- “show human kinases involved in apoptosis”
- “find seizure-associated proteins”
- “show entities annotated with nucleus”

### 2. Use `/explore/interactions` for interaction result sets

Use the interactions page when the user wants a set of interactions defined by:

- anchored entity IDs
- interaction MI terms
- participant GO/MI/OM/HP/KW terms
- direction/sign/source filters

Examples:

- “show phosphorylation interactions involving EGFR”
- “show inhibitory TP53 interactions in the nucleus”
- “show dephosphorylation interactions”

### 3. Use `/selection` for workspace-style multi-entity exploration

Use the selection page when the user wants to:

- collect entities into a working set
- compare or explore a set of entities together
- pivot between selected entities, their interactions, and their associations

Examples:

- “add TP53 and EGFR to my selection”
- “collect seizure-associated proteins into my selection”
- “add these proteins and show their interactions”

---

## URL model

## Shared conventions

Use explicit params for common, stable fields and a serialized `filters` payload for the full filter object.

### Basic conventions

- arrays encoded as comma-separated values where practical
- booleans encoded as `true` / `false`
- complex filter objects encoded in `filters=<urlencoded-json>`
- page-specific convenience params can coexist with `filters`

---

## `/search`

### Query params

- `q`: free-text query
- `mode`: `full-text | identifier | batch`
- `type`: initial search type, initially `search_entities`
- `species`: convenience alias for the selected taxonomy ID
- `filters`: serialized `MeilisearchFilters`

### Example

```txt
/search?q=egfr&species=9606&filters=%7B%22cv_terms_go%22%3A%5B%22nucleus%3AGO%3A0005634%22%5D%7D
```

---

## `/explore/interactions`

### Query params

- `entity`: convenience alias for one anchored entity ID
- `entities`: convenience alias for multiple entity IDs
- `filters`: serialized `MeilisearchFilters`

### Example

```txt
/explore/interactions?filters=%7B%22entity_ids%22%3A%5B%22P%3AUP%3AO00688%22%5D%2C%22interaction_annotation_terms%22%3A%5B%22phosphorylation%20reaction%3AMI%3A0217%22%5D%7D
```

---

## `/selection`

### Query params

- `tab`: `selection | interactions | associations`
- `entities`: comma-separated canonical selected entity IDs
- `filters`: optional serialized filter state for the active tab/page

### Example

```txt
/selection?tab=interactions&entities=P:UP:P04637,P:UP:O00688
```

### Notes

- `entities` defines the selected working set
- `tab=selection` means the entity-results tab for the selected set
- `tab=interactions` means the interaction tab scoped to that selected set
- `tab=associations` means the association/entity tab scoped to the associated entities derived from that selected set

This keeps selection reproducible and URL-addressable.

---

## Data model decisions

## 1. Canonical selection payload

Define a normalized URL selection model:

```ts
interface UrlSelectionState {
  entityIds: string[];
  tab?: "selection" | "interactions" | "associations";
}
```

Initial version: store only canonical entity IDs in the URL.

### Why IDs only

- stable and compact
- enough to reconstruct entity details from the backend
- avoids duplicating labels and metadata in the URL

Potential future extension if URL length becomes an issue:

```ts
selection=<compressed-payload-or-token>
```

## 2. No selection context in the final architecture

Once the migration is complete, the app should not rely on `EntitySelectionContext`.

Instead:

- `/selection` reads `entities` and `tab` from the URL
- downstream pages/tabs receive selected entity IDs from URL state hooks
- components that currently depend on the selection context should be updated to consume URL-derived props or route-level state hooks

This avoids dual state sources and removes synchronization complexity.

## 3. Filters remain page-specific

Selection scope and page filters are different concerns.

- selection scope: `entities=` on `/selection`
- page filters: `filters=` for entity/interactions filtering within that page

This separation avoids overloading `filters.entity_ids` with two meanings.

---

## State management approach with `nuqs`

## Recommended structure

### Library layer

Use `nuqs` for the URL state primitives.

### App-specific codec layer

Create a small domain wrapper around `nuqs`, for example:

- `src/lib/navigation/url-codecs.ts`
- `src/lib/navigation/url-state.ts`

Responsibilities:

- parse and serialize `MeilisearchFilters`
- parse and serialize canonical entity ID arrays
- parse and serialize selection tabs
- normalize empty/default states

### Page-specific hooks

Build reusable hooks such as:

- `useSearchUrlState()`
- `useInteractionsUrlState()`
- `useSelectionUrlState()`

These hooks should hide raw query-param mechanics from page components.

### Example responsibilities

#### `useSearchUrlState()`

Returns:

- `query`
- `mode`
- `species`
- `filters`
- setters that update the URL

#### `useInteractionsUrlState()`

Returns:

- `entityIds`
- `filters`
- setters that update the URL

#### `useSelectionUrlState()`

Returns:

- `entityIds`
- `tab`
- optional active-tab filters
- setters that update the URL

This is the main mechanism for avoiding redundancy across pages.

---

## Floating chat window architecture

## Requirements

Create a new chat implementation that:

- is mounted in `src/app/layout.tsx`
- is available on every page
- can be opened, minimized, restored, and closed
- uses the same AI elements/primitives as the current chat UI
- can trigger navigation actions directly

## Why this is the right next step

- it lets us test the new agentic workflow without rewriting the current `/chat` route
- it makes the assistant feel like a site-wide controller
- it aligns with the URL-first state model because the assistant can navigate anywhere and update URL state

## Proposed UI behavior

- default state: minimized launcher button
- expanded state: floating panel anchored to a corner of the app
- optional draggable/resizable behavior can wait until later
- navigation actions should close or minimize the panel only if that feels natural; default should likely keep it open during iteration

## Initial implementation boundaries

- keep `/chat` intact
- build a new `FloatingChatWindow` component tree
- mount it near the end of `RootLayout`
- reuse existing message rendering / AI primitives where possible
- keep result-side behavior focused on **navigation actions**, not embedded result panels

---

## Implementation phases

## Phase 1 — add `nuqs` and shared URL codecs

### Deliverables

- install and configure `nuqs`
- create `src/lib/navigation/url-codecs.ts`
- create `src/lib/navigation/url-state.ts`
- add tests for parsing/serialization edge cases

### Responsibilities

- parse filters safely from `filters`
- normalize entity ID arrays
- normalize booleans/enums/defaults
- define common helpers shared by all route hooks

---

## Phase 2 — make `/search` URL-driven with `nuqs`

Update `src/features/search/page.tsx`.

### Add support for

- `q`
- `mode`
- `type`
- `species`
- `filters`

### Behavior

- initialize state from the URL
- update the URL through the URL-state hook instead of local-only state
- preserve embedded-mode prop behavior where needed
- route-mounted mode should rely on URL state

### Notes

This also fixes the existing inconsistency where the header links to `/search?q=...` but the page does not currently hydrate from `q`.

---

## Phase 3 — make `/explore/interactions` URL-driven with `nuqs`

Update `src/features/explore/interactions-page.tsx`.

### Keep existing support

- `entity`
- `entities`

### Add support for

- `filters`

### Behavior

- merge `entity` / `entities` convenience params into filter state
- update URL state when filters change
- preserve embedded behavior when interactions page is rendered inside selection-like flows

---

## Phase 4 — make `/selection` fully URL-driven

Update `src/app/selection/page.tsx`.

### Add support for

- `tab`
- `entities`
- optional `filters`

### Behavior

- selected entity IDs come from URL state
- active tab comes from URL state
- entity hydration for display is done from the selected IDs
- tab changes update the URL
- selection mutations are URL mutations

### Important architectural point

This phase should move us away from context-based selection entirely.

---

## Phase 5 — remove `EntitySelectionContext`

Update the app to eliminate the selection context after URL-based equivalents are in place.

### Work items

- remove `EntitySelectionProvider` from `src/app/layout.tsx`
- remove `src/contexts/entity-selection-context.tsx`
- refactor components currently using `useEntitySelection()`
- pass URL-derived entity IDs and hydrated entity data through props/hooks instead

### Expected impact areas

- selection page
- explore page pieces currently reading selected entities
- result cards that add/remove selection
- sidebar selection counts/badges

### Replacement pattern

- route-level URL hooks define selection state
- reusable helpers perform entity hydration/fetching
- UI components receive explicit props

---

## Phase 6 — add a floating layout-level chat window

Create a new chat implementation mounted in `RootLayout`.

### Proposed new components

- `src/features/chat-floating/floating-chat-window.tsx`
- `src/features/chat-floating/floating-chat-launcher.tsx`
- `src/features/chat-floating/use-floating-chat-state.ts`

### Behavior

- absolutely positioned overlay window
- minimizable / restorable
- independent of the `/chat` page
- capable of issuing navigation actions

### Keep

- `/chat` page unchanged for now
- existing AI elements/primitives reused where practical

---

## Phase 7 — add chat navigation actions

Define a structured action model used by the new floating chat UI.

### Proposed action model

```ts
type ChatNavigationAction =
  | {
      type: "open-search";
      query?: string;
      filters?: MeilisearchFilters;
    }
  | {
      type: "open-interactions";
      filters?: MeilisearchFilters;
    }
  | {
      type: "open-selection";
      entityIds: string[];
      tab?: "selection" | "interactions" | "associations";
      filters?: MeilisearchFilters;
    };
```

### Behavior

- build canonical URLs from these actions
- navigate directly
- prefer navigation over embedded result rendering

---

## Phase 8 — teach chat when to choose which page

Update chat guidance so the agent chooses the correct destination intentionally.

### Decision rule

- if the user wants a set of entities, open `/search`
- if the user wants a set of interactions, open `/explore/interactions`
- if the user wants a working set across tabs, open `/selection`

### Examples

#### Entity result set

User: “show seizure-associated proteins”

Action:

```ts
{
  type: "open-search",
  filters: {
    cv_terms_hp: ["seizure:HP:0001250"]
  }
}
```

#### Interaction result set

User: “show EGFR phosphorylation interactions in the nucleus”

Action:

```ts
{
  type: "open-interactions",
  filters: {
    entity_ids: ["P:UP:O00688"],
    interaction_annotation_terms: ["phosphorylation reaction:MI:0217"],
    participant_annotation_terms_go: ["nucleus:GO:0005634"]
  }
}
```

#### Selection workflow

User: “add TP53 and EGFR to my selection and show their interactions”

Action:

```ts
{
  type: "open-selection",
  entityIds: ["P:UP:P04637", "P:UP:O00688"],
  tab: "interactions"
}
```

---

## Migration strategy

## Step 1

Introduce `nuqs` and shared URL codecs.

## Step 2

Convert `/search` and `/explore/interactions` to URL-first state hooks.

## Step 3

Convert `/selection` to `tab` + `entities` URL state.

## Step 4

Replace selection-context consumers with URL-state consumers and explicit props.

## Step 5

Remove `EntitySelectionContext` and its provider.

## Step 6

Add the layout-level floating chat window.

## Step 7

Teach the floating chat to emit navigation actions and navigate directly.

## Step 8

Optionally revisit the `/chat` page later and decide whether to keep, simplify, or merge it.

---

## Risks and mitigations

## Risk 1 — URL length

Large selections can make `/selection?entities=...` long.

### Mitigation

Start with plain `entities=` because it is simple and inspectable.
If we hit practical limits, introduce a compressed payload or token later.

## Risk 2 — hydration flicker

Selection and entity display may briefly render before entity documents are fetched.

### Mitigation

Add explicit loading states for URL-derived entity hydration.

## Risk 3 — over-encoding filters in many params

Trying to represent every filter as its own top-level param would create noise and code duplication.

### Mitigation

Use explicit params for stable routing primitives and `filters=` for the full filter object.

## Risk 4 — migration complexity while context still exists

Temporary overlap between URL state and context would create confusing bugs.

### Mitigation

Treat context removal as an explicit migration phase and do not keep both architectures indefinitely.

## Risk 5 — chat overlay complexity

A global floating chat can create z-index, focus, and mobile UX issues.

### Mitigation

Start with a simple desktop-first minimizable overlay and iterate after the navigation flow is working.

---

## Concrete file targets

### New

- `next-omnipath/src/lib/navigation/url-codecs.ts`
- `next-omnipath/src/lib/navigation/url-state.ts`
- `next-omnipath/src/features/chat-floating/floating-chat-window.tsx`
- `next-omnipath/src/features/chat-floating/floating-chat-launcher.tsx`
- `next-omnipath/src/features/chat-floating/use-floating-chat-state.ts`
- `next-omnipath/docs/chat-url-state-navigation-plan.md`

### Update

- `next-omnipath/src/app/layout.tsx`
- `next-omnipath/src/features/search/page.tsx`
- `next-omnipath/src/features/explore/interactions-page.tsx`
- `next-omnipath/src/app/selection/page.tsx`
- chat components involved in result handling/navigation
- components currently consuming `useEntitySelection()`

### Remove later

- `next-omnipath/src/contexts/entity-selection-context.tsx`

---

## Recommended first slice

Implement the following minimal end-to-end slice first:

1. add `nuqs` plus shared URL codecs
2. `/search` reads/writes `q` and `filters`
3. `/explore/interactions` reads/writes `entities` and `filters`
4. `/selection` reads/writes `tab` and `entities`
5. remove the selection provider from the new path as soon as equivalent URL-based hooks exist
6. add the new floating chat shell in the layout
7. let chat trigger `open-search`, `open-interactions`, and `open-selection`

That validates the whole navigation model while keeping `/chat` intact.

---

## Summary

The intended model is:

- URL is the canonical state manager for page state
- URL is also the canonical state manager for selection scope
- `nuqs` is the preferred query-state library
- selection context is removed rather than kept in parallel
- a new floating, minimizable layout-level chat window becomes the agentic UI entry point
- `/chat` stays in place for now as a separate experience

This gives us:

- reproducible navigation
- shareable result and selection views
- browser-native history behavior
- less duplicated state logic
- a cleaner path to chat-driven page control across the whole app
