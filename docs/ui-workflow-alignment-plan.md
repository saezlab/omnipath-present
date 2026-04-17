# UI workflow alignment plan

## Goal
Shift the main app from page structures that mirror backend/data types toward clearer user workflows.

## Target changes

### 1. Reframe the current entity page as a workflow page
The current entity page should move away from being primarily a generic search/results surface.

Target primary workflows:
- **Entities → Annotations**: start with one or more entities and summarize/explore their annotations.
- **Annotations → Entities**: start with ontology/annotation terms and find matching entities.

Target secondary workflow:
- **Direct entity lookup**: preserve full-text, identifier lookup, and batch lookup, but make this supportive rather than the main identity of the page.

### 2. Align the main app more closely with the DuckDB annotation model
We want the normal app to align with the clearer workflow framing already present in the DuckDB annotation area.

Important constraint:
- align at the **product / information architecture / workflow** level
- do **not** blindly copy the DuckDB code structure
- keep shared workspace infrastructure where it still makes sense

### 3. Remove the associations page/tab as a separate concept
The current associations surface in selection should be removed as a standalone destination.

Replace it with an interaction/entity-scope expansion filter such as:
- **Include associated entities**

Initial meaning of that filter:
- when searching or scoping to entities such as `PLN`, also include complexes containing that entity
- also include reactions containing that entity
- expose indirect matches in interaction results, e.g. `PLN via X Complex`

Design principles:
- off by default
- explicit about what kinds of associated entities are included
- result rows should explain why an indirect match was included

## Intended UX direction

### Entities area
Navigation can still say **Entities**, but the page itself should present explicit workflow modes:
- Entities → Annotations
- Annotations → Entities
- Direct lookup

### Interactions area
Keep interactions as the main network/interactions exploration surface, but add opt-in scope expansion:
- exact selected entities only
- include associated entities

This should replace the need for a separate associations page.

## Milestones

### Milestone 1 — Product and UX definition
- confirm final workflow framing for the Entities area
- confirm naming/copy for:
  - Entities → Annotations
  - Annotations → Entities
  - Direct lookup
- confirm semantics and label for **Include associated entities**
- define how indirect matches are explained in results

### Milestone 2 — Entity page restructuring
- redesign the main entity page around the new workflow modes
- demote direct search/lookup into a secondary mode
- define which existing search/filter components are reused versus replaced

### Milestone 3 — Annotation workflow parity in the main app
- bring the normal app to functional parity with the DuckDB annotation workflow
- support both directions:
  - entities to annotation summaries
  - annotation terms to matching entities
- ensure selection handoff and downstream navigation are smooth

### Milestone 4 — Replace associations with scope expansion
- remove the standalone associations tab/page from selection
- add **Include associated entities** to the interactions workflow
- support at least:
  - complexes containing selected entities
  - reactions containing selected entities
- annotate results with the indirect match reason

### Milestone 5 — Query/model integration
- implement backend support so entity-scoped interaction search can expand from seed entities to associated entities
- make expanded scope understandable in UI state, counts, and result labels
- validate behavior for representative cases such as `PLN`

### Milestone 6 — Cleanup and convergence
- remove obsolete associations-specific navigation and code paths
- simplify selection so it no longer owns an associations concept
- review whether the normal and DuckDB surfaces now share the right workflow model

## Success criteria
- the Entities area is understood as a workflow surface, not just a generic search page
- users can move clearly between entities and annotations in both directions
- associations are no longer a separate destination
- indirect context expansion is available directly where users search for and inspect interactions
- the main app and DuckDB area feel conceptually aligned, even if their implementations differ
