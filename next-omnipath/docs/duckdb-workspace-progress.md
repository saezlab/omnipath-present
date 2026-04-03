# DuckDB workspace progress

## Goal

Create a parallel DuckDB-backed workspace under `duckdb/` without changing the existing Meilisearch-backed workspace.

The DuckDB workspace should:

- consume the existing server subset export endpoints
- load Parquet artifacts in the browser with DuckDB WASM
- support local filtering and exploration over the subset
- progressively converge on the same UI as the main workspace

---

## What has been achieved

### 1. Parallel DuckDB route and workspace scaffold

Added a separate route namespace and feature area:

- `src/app/duckdb/page.tsx`
- `src/app/duckdb/workspace/page.tsx`
- `src/app/duckdb/explore/page.tsx`
- `src/features/duckdb/workspace/*`

This keeps the main app intact while allowing side-by-side validation of the DuckDB architecture.

### 2. Browser DuckDB WASM integration

Added DuckDB WASM support and a browser adapter:

- `src/lib/duckdb/browser.ts`
- `src/lib/duckdb/sql.ts`

Implemented:

- DuckDB initialization in browser
- registration of Parquet files as DuckDB buffers
- local SQL queries for
  - page queries
  - counts
  - basic facets
  - entity ID extraction
  - entity lookup from the local entity subset

### 3. Reuse of existing subset export pipeline

Added subset client wrappers:

- `src/lib/subsets/client.ts`
- `src/types/subsets.ts`

The DuckDB workspace now uses the same server subset export endpoints already used elsewhere:

- `/api/exports/interactions/parquet`
- `/api/exports/entities/parquet`

### 4. Interaction subset + local DuckDB querying

The DuckDB workspace now:

1. materializes an interactions subset from the server
2. loads it into DuckDB in the browser
3. runs local filtering and pagination over that subset

Local interaction filters currently include:

- interaction type
- sign
- directedness
- source
- interaction annotation terms
- participant annotation terms

### 5. Entity subset loading for hover cards and badges

To support UI parity for entity rendering, the DuckDB workspace now also:

1. extracts distinct entity IDs from the loaded interaction subset
2. materializes a matching entities subset from the server
3. loads that entity subset into DuckDB
4. uses it for local entity lookup

This enables:

- `EntityBadge` rendering from local subset data
- `useEntity(...)` to work inside the DuckDB workspace via a custom entity data source
- entity hover cards without depending on Meilisearch in the DuckDB workspace

### 6. Entity adaptation and display-name parity improvements

A substantial normalization layer was added so DuckDB-loaded entity rows are adapted into the shapes expected by the current UI.

Implemented fixes include:

- support for Arrow/DuckDB object-like list encodings
- normalization of
  - `names`
  - `gene_symbols`
  - `descriptions`
  - `references`
  - `sources`
  - `synonyms`
  - `ontology_terms`
  - `cv_terms`
  - `identifiers`
- reuse of display-name heuristics similar to the existing app:
  - proteins: gene symbol / UniProt / name
  - small molecules: ChEMBL / meaningful short name / PubChem / fallback
  - other entities: gene symbol / name / identifier fallback

### 7. API service entity export fixed for richer UI rendering

The API service entity export path was updated so entity subsets no longer drop:

- `names`
- `synonyms`
- `gene_symbols`

This was necessary for:

- human-readable entity names in the DuckDB workspace
- descriptions in hover cards
- richer entity rendering parity with the main workspace

Changed file:

- `api-service/api_service/exports.py`

### 8. DuckDB asset loading made browser-safe

DuckDB worker/module loading was adjusted to avoid cross-origin worker issues by converting fetched CDN assets to local blob URLs before instantiation.

This resolved the browser security error around loading the DuckDB worker from jsDelivr.

### 9. Results pane improved toward parity

The DuckDB results pane now uses:

- `EntityBadge`
- source/target layout closer to the main interactions table
- evidence badge column
- sign arrow / undirected marker styling

This is not yet a full reuse of the main interactions results UI, but it is much closer than the initial prototype table.

### 10. Refine pane migrated toward main workspace structure

The DuckDB refine pane now uses the same structural components as the main workspace:

- `RefinePanelLayout`
- `RefineSection`
- `SelectedFiltersSection`

It now includes:

- selected filter chips
- subset materialization section
- interaction properties section
- annotations section

### 11. Ontology term filters added

DuckDB refine now supports:

- interaction annotation term filters
- participant annotation term filters

Important design choice:

- ontology labels / metadata come from the ontology API
- actual subset filtering remains local in DuckDB

This means:

- ontology term search uses `/api/ontology/search`
- selected term labels use `OntologyTermLabel`
- hover cards use `CvTermHoverCard`
- local DuckDB filtering uses list membership against loaded subset columns

### 12. Multiple frontend shape bugs resolved

Several issues were debugged and fixed during migration, including:

- cross-origin DuckDB worker load failure
- stale file registration due to reused filenames
- Arrow internals being rendered as descriptions
- object-like arrays causing invalid UI rendering
- entity result-card crashes due to non-array identifier/list values
- hover card failures due to partial or differently shaped entity rows

### 13. Export fetches marked no-store and staged loading feedback added

The DuckDB workspace now avoids relying on HTTP caching for subset export responses in the Next proxy + browser fetch path by using `cache: "no-store"` and explicit `Cache-Control: no-store` response headers for:

- `src/app/api/exports/interactions/parquet/route.ts`
- `src/app/api/exports/entities/parquet/route.ts`
- `src/lib/subsets/client.ts`

The workspace also now exposes staged loading state so the UI can distinguish between:

- checking local dataset cache
- instantiating DuckDB WASM
- requesting the interaction subset
- downloading the interaction subset
- loading the interaction subset into DuckDB
- requesting/downloading the entity subset
- loading the entity subset into DuckDB
- running local DuckDB queries

This is surfaced in the DuckDB refine/results panes with a status label and progress bar.

### 14. Local IndexedDB dataset cache + saved dataset browser added

The DuckDB workspace now persists materialized subset sessions in browser IndexedDB via:

- `src/lib/duckdb/cache.ts`

Behavior now includes:

- exact-match subset requests can be reopened from local cache after refresh
- freshly fetched server subsets are written back into the local cache
- saved sessions keep both interaction and entity Parquet artifacts plus metadata
- the workspace tracks whether the currently loaded dataset came from cache or server
- the chat pane now includes a local “Saved datasets” browser with open/delete actions

This gives the DuckDB prototype an explicit local dataset/session model rather than depending on browser HTTP cache behavior.

---

## Current state

The DuckDB workspace is now a functional parallel analytical client that:

- materializes interaction subsets from the server
- materializes matching entity subsets from the server
- loads both into DuckDB WASM in the browser
- supports local filtering and pagination
- supports entity hover cards from local subset data
- supports ontology-based annotation filtering using ontology API labels + local DuckDB filtering
- uses refine panel structure much closer to the main workspace

The main Meilisearch-backed workspace remains unchanged.

---

## What is still not fully complete

### 1. Full UI parity with the main interactions results view

The current DuckDB results pane is closer to the main UI, but it is still a custom implementation rather than a full reuse/adapter of the main interactions results stack.

Still missing or incomplete:

- full reuse of `interactions-results-view` / `interactions-explore-tab`
- row click to full interaction details parity
- graph/network mode parity
- exact loading / empty / error states parity
- exact action/header parity

### 2. Full refine-panel parity

The DuckDB refine pane now matches the structure well, but does not yet fully reuse the main filter sidebar implementation.

Still missing or simplified:

- full `FilterSidebar` reuse
- full `AnnotationFilterSidebar` reuse
- Meilisearch-style facet-count behavior
- some advanced annotation grouping/prefix handling

### 3. Shared backend abstraction layer

The UI is still not fully backend-agnostic.

Longer term we likely want shared interfaces such as:

- interactions backend
- entity lookup backend
- facet/query backend

with implementations for:

- Meilisearch
- DuckDB subset session

### 4. Wider resource coverage

Current progress is strongest for interactions + supporting entities.

Not yet migrated in the same way:

- entities workspace
n- associations workspace
- explore pages beyond the current DuckDB prototype area

### 5. Molecule/details verification

Hover cards and descriptions are working much better, but more validation is still needed for:

- molecule structure rendering across representative examples
- edge-case entity types
- complex / phenotype / pathway-like entities

---

## Recommended next steps

### Near-term

1. **Add a dataset discovery / subset-builder page before the workspace**
   - create a page where users can intentionally build a DuckDB dataset around what they care about
   - primary entry modes:
     - **Entities**: get everything related to one or more selected entities
     - **Ontology terms**: get interactions/entities annotated with selected terms
     - **Sources**: get everything contributed by selected sources or source categories
   - this page should sit *before* the current workspace materialization flow and answer: “what dataset do you want to open locally?”

   Proposed UX structure:
   - route candidate: `src/app/duckdb/explore/page.tsx`
   - top-level cards or tabs for **Entities**, **Ontology terms**, and **Sources**
   - persistent summary panel showing:
     - selected scope inputs
     - estimated row counts if available
     - target artifact types to materialize
     - button to materialize + open in workspace
   - explicit distinction between:
     - **server-side subset scope** (what gets exported as Parquet)
     - **local DuckDB filters** (what gets refined after the subset is loaded)

   Notes per entry mode:
   - **Entities**
     - reuse the current entity selection UX where possible
     - materialize interactions touching any selected entity
     - optionally show related entity expansion cues before loading
   - **Ontology terms**
     - support term search via `/api/ontology/search`
     - allow choosing scope such as:
       - participant/entity ontology terms
       - interaction annotation terms
     - likely useful to allow multiple terms with OR semantics first, then add stricter combinations later
   - **Sources**
     - support direct source selection plus grouped source-category selection
     - source grouping should preferably come from the sources index / source metadata rather than a hardcoded frontend map
     - selected categories should expand to concrete sources before export materialization

2. **Define a source-category taxonomy for dataset discovery**
   Initial examples that make sense for end users:
   - **Pathways**
     - WikiPathways
     - Reactome
   - **Signaling**
     - SIGNOR
     - potentially other causal/signaling-oriented resources, but these should be derived from source metadata rather than guessed in the UI
   - **Small molecule ↔ protein**
     - better label candidates:
       - **Chemical–protein interactions**
       - **Compound–protein interactions**
       - **Drug–target interactions**
       - **Ligand–protein interactions**
     - recommendation: **Chemical–protein interactions**
       - broad enough to cover BindingDB-like resources
       - less drug-centric than “drug–target”
       - clearer and more standard than “small molecule protein”
   - **PPI / physical interaction**
     - label candidates:
       - **Protein–protein interactions (PPI)**
       - **Physical interactions**
       - **Molecular interactions**
     - recommendation:
       - use **Protein–protein interactions (PPI)** when the grouped sources are predominantly protein-centric resources like IntAct
       - use **Physical interactions** if the category needs to remain broader than protein-only

   Implementation note:
   - if source metadata already exposes content/function categories, map those first
   - if not, introduce a small curated source→category mapping layer on the server so the UI receives stable category definitions
   - avoid baking category logic into the DuckDB client if this taxonomy is likely to be reused elsewhere

3. **Bring the DuckDB results pane to full interaction-view parity**
   - reuse more of the existing interactions results/explore components
   - preserve the same row interactions and details flow

4. **Unify the refine pane more deeply**
   - either reuse or adapt the main `FilterSidebar` / `AnnotationFilterSidebar`
   - keep the DuckDB filter engine underneath

5. **Add interaction details parity**
   - row click to details drawer/sheet
   - ensure required columns/detail fetch paths exist

6. **Audit hover cards and small-molecule examples**
   - confirm descriptions, labels, and structure rendering across representative entities

### Medium-term

5. **Introduce a backend adapter interface**
   - allow shared workspace UI to run on either Meilisearch or DuckDB

6. **Migrate more workspace/explore surfaces to DuckDB**
   - entities
   - associations
   - explore tabs/pages

7. **Decide the long-term search split**
   - keep Meilisearch only for global discovery, or
   - replace it with smaller canonical lookup/search endpoints

### Long-term

8. **Move from parallel prototype to unified UI with swappable backend**
   - one UI layer
   - two backend strategies during cutover
   - eventual removal of Meilisearch where no longer needed

---

## Summary

The project has successfully validated the core architectural direction:

- the server remains responsible for trusted subset materialization as Parquet
- the browser can consume those same subset artifacts using DuckDB WASM
- the DuckDB workspace can now support meaningful local analytical exploration
- entity hover cards and ontology-driven filtering work without relying on Meilisearch in that workspace

The remaining work is primarily **UI parity and component reuse**, not proof-of-feasibility.
