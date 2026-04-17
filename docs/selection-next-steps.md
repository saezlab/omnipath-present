# Explore implementation summary and Selection next steps

## What was implemented

### Explore page
Built a new unified `/explore` page with:
- a full-width search bar
- tabs for:
  - **Entities**
  - **Interactions**
  - **Annotations**
- URL-backed state for query, tab, and species
- a clear **Open Selection** CTA when anything is selected
- keyboard shortcuts:
  - `/` focuses search
  - `S` opens Selection

### Entities tab
Implemented full-dataset entity search with:
- the existing entity result UI
- the existing entity filter UI (`EntityFilterSidebar`)
- filters shown as a **right-side resizable pane**
- add/remove entity from shared selection

### Interactions tab
Implemented full-dataset interaction exploration with:
- the existing interaction results UI (`InteractionsExploreTab`)
- the existing interaction filter UI (`FilterSidebar`)
- filters shown as a **right-side resizable pane**

### Annotations tab
Implemented annotation exploration with:
- ontology term search
- no organism filter
- add/remove annotation from shared selection
- fallback browsing/search behavior so terms can still appear even when facet-based browsing is unavailable

### Shared selection model
Extended selection to support both:
- entities
- annotations

Selection state now tracks:
- selected entity IDs
- selected annotation IDs + metadata

## Current gap
The **Explore** page is now working as the broad discovery surface.

The remaining gap is that **Selection** does not yet cleanly behave as the scoped version of the same UI.

Right now, annotation-only selection is stored correctly, but Selection is not yet fully deriving its scoped datasets from both selected entities and selected annotations.

## Target Selection behavior
Selection should use the **same UI model** as Explore, but scoped to the current selection.

That means:
- same overall page structure
- same tabs:
  - **Entities**
  - **Interactions**
  - **Annotations**
- same search-first workflow
- same right-side filter panes
- but all data should be constrained by the active selection

## Desired Selection semantics

### 1. Entities tab in Selection
Show/search the entity subset derived from the current selection.

Selection scope should come from:
- explicitly selected entities
- entities matched by selected annotations

So the Selection Entities tab should:
- search **within the scoped entity set only**
- use the same entity results UI as Explore
- use the same entity filter pane UI as Explore

### 2. Interactions tab in Selection
Show/search interactions involving the scoped entities.

Scope should include:
- interactions involving explicitly selected entities
- interactions involving entities matched by selected annotations

So the Selection Interactions tab should:
- search within interactions connected to the scoped entity set
- use the same interaction results UI as Explore
- use the same interaction filter pane UI as Explore

### 3. Annotations tab in Selection
Show/search annotation terms within the current scoped entity set.

Scope should include annotations belonging to:
- explicitly selected entities
- entities matched by selected annotations

So the Selection Annotations tab should:
- search only within annotations present in the scoped entity set
- use the same annotation UI pattern as Explore
- reflect both entity-derived and annotation-derived scope

## Recommended implementation approach

### Step 1 — Define a canonical scoped entity set
Build one shared derivation for Selection:
- start with selected entity IDs
- expand with entity IDs matched by selected annotation IDs
- deduplicate into one `scopedEntityIds` set

This becomes the core Selection scope for all 3 tabs.

### Step 2 — Rebuild Selection as Explore-in-scope
Refactor Selection to mirror Explore structurally:
- shared search bar
- shared tabs
- same results layouts
- same resizable right-side filter pane

Main difference:
- Explore queries the full dataset
- Selection queries only within `scopedEntityIds`

### Step 3 — Scope the Entities tab
Entities tab should query entity search with:
- `entity_ids = scopedEntityIds`
- current Selection search query
- current Selection entity filters

### Step 4 — Scope the Interactions tab
Interactions tab should query interactions with:
- `entity_ids = scopedEntityIds`
- current Selection search query / filter state

This yields all interactions involving the scoped entities.

### Step 5 — Scope the Annotations tab
Annotations tab should derive terms from the scoped entity set.

Recommended behavior:
- when `scopedEntityIds` changes, fetch entities in scope
- aggregate their ontology/CV terms
- resolve term metadata
- search/filter only inside that aggregated term set

### Step 6 — Keep selection type awareness in UI
Selection should still visibly communicate:
- how many entities were explicitly selected
- how many annotations were explicitly selected
- how many entities are in the final scoped set

That helps users understand why Selection results look the way they do.

## Suggested deliverables

### Deliverable A
A new scoped Selection shell that visually mirrors Explore.

### Deliverable B
A shared helper for deriving:
- `selectedEntityIds`
- `selectedAnnotationIds`
- `annotationMatchedEntityIds`
- `scopedEntityIds`

### Deliverable C
Selection tabs implemented as:
- **Entities in scope**
- **Interactions in scope**
- **Annotations in scope**

### Deliverable D
Consistent filter-pane behavior across Explore and Selection.

## Practical next task order
1. create a shared `deriveSelectionScope()` helper
2. refactor Selection to match Explore layout and tab structure
3. wire scoped Entities tab
4. wire scoped Interactions tab
5. wire scoped Annotations tab
6. add clear UI copy explaining explicit selection vs derived scope

## End state
After this work:
- **Explore** = search the full dataset and collect seeds
- **Selection** = same UI, but all search/results/filtering are constrained to the scoped subset derived from the current selection
