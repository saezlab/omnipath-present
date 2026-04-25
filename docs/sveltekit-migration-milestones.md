# SvelteKit Migration — Milestones

## Done

### Shared TypeScript
- **Split mixed modules** (`entity-public-id.ts`, `entity-filter.ts`) into browser-safe (`$lib/`) and server-only (`$lib/server/`) variants. Drizzle-dependent helpers (SQL builders, `publicEntityIdWhere`, `normalizedEntityTypeDrizzleSql`) live in `$lib/server`. Pure string/data helpers (`parsePublicEntityId`, `toPublicEntityId`, `normalizeEntityTypeFilterValue`) remain in `$lib` for browser use.
- Drizzle schema lives under `$lib/drizzle` and is imported by both app and server query modules. No root `drizzle/` copy is needed for now; migrations can reference `omnipath-svelte/src/lib/drizzle` or use the existing Next app schema during the transition.

### Server/Database Layer
- Created `$lib/server/queries/` modules:
  - `entity.ts` — `searchEntities`, `getEntityByPublicId`, `getEntitiesByPublicIds`, `getEntitiesByPks`, `getEntityFilterOptions`
  - `relation.ts` — `searchRelations`, `countRelations`, `getRelationByPk`, `getRelationFilterOptions`, `getAssociatedEntityIds`
  - `relation-evidence.ts` — `getEvidenceByRelationPk`, `getEvidenceByRelationPks`
  - `ontology-term.ts` — `searchOntologyTerms`, `searchScopedOntologyTerms`, `getOntologyTermsByIds`, `getOntologyPrefixes`, `getEntityIdsForAnnotationTerms`
  - `entity-details.ts` — `getEntityDetails`
  - `entity-identifier.ts` — `resolveEntityIdentifiers`, `getIdentifiersByEntityPk`, `getIdentifiersByEntityPks`
- `DATABASE_URL` configured via `$env/dynamic/private` in `$lib/server/db/client.ts`.

### Local App API Endpoints (`/app-api/*`)
All endpoints implemented and building successfully:

| Endpoint | Status |
|----------|--------|
| `POST /app-api/terms` | Done |
| `GET /app-api/relations/[id]` | Done |
| `GET /app-api/relations/[id]/evidence` | Done |
| `GET/POST /app-api/entities/search` | Done |
| `POST /app-api/entities/resolve` | Done |
| `POST /app-api/entities/by-public-ids` | Done |
| `GET /app-api/entities/[id]` | Done |
| `GET /app-api/entities/filter-options` | Done |
| `GET /app-api/ontology/search` | Done |
| `GET/POST /app-api/ontology/scoped-search` | Done |
| `GET /app-api/ontology/prefixes` | Done |
| `POST /app-api/ontology/entity-ids` | Done |
| `GET/POST /app-api/relations/search` | Done |
| `GET /app-api/relations/filter-options` | Done |
| `POST /app-api/resources/download` | Done (proxies to FastAPI) |

### URL State and Selection Stores
- `url-codecs.ts` — reused framework-neutral codec functions (unchanged).
- `selection.svelte.ts` — reactive global selection store. Uses `$state`/`$derived`/`$effect`, persists to localStorage (browser-gated), and syncs entity/annotation IDs to URL search params via `goto()`.
- `url-state.svelte.ts` — helpers for reading/writing explore and selection URL state via `URLSearchParams`.
- Selection supports: add/remove/clear entities and annotations, isSelected checks, localStorage fallback when no URL params present.
- No dependency on `nuqs`.

### Explore Page Shell
- `ExploreBrowserShell.svelte` — search input, species picker, tab navigation (entity/relations/ontology).
- URL-backed state for `tab`, `q`, `species`.
- Keyboard shortcuts: `/` focuses search; `s` navigates to `/selection` when selection exists.
- Floating "Open Selection" CTA button.

### Entity Search Tab
- `EntitiesExploreTab.svelte` — fetches from `/app-api/entities/search`.
- Infinite scroll via custom `infiniteScroll` Svelte action.
- Result cards with Add/Remove selection buttons.
- Mobile filter sheet + desktop sidebar layout (filter UI is a minimal stub; data fetching is wired).

### Selection Workspace
- `/selection` page with tabbed shell: Entities / Interactions / Annotations.
- `selection-scope.svelte.ts` — resolves annotation term IDs to scoped entity IDs via `/app-api/ontology/entity-ids`.
- Reuses `EntitiesExploreTab` with `scopedEntityIds`.
- Selection sheet: entity/annotation lists, counts, individual remove, clear all.
- Empty state when selection is empty.

### Resources Page — Downloads
- `/app-api/resources/download` implemented; proxies POST to `API_SERVICE_URL`.

### Relations/Interactions Tab
- `RelationsExploreTab.svelte` — infinite-scroll interaction search table wired to `/app-api/relations/search`.
- `InteractionFilterSidebar.svelte` — filters for relation categories, predicates, participant types (interaction types), and sources. Fetches filter options from `/app-api/relations/filter-options`.
- `InteractionDetailsSheet.svelte` + `InteractionDetails.svelte` — relation details sheet with evidence aggregation, summary table, PubMed links, and annotation chips grouped by source.
- `EntityBadge.svelte` — simplified entity badge with type-based icon/color coding (hover cards deferred to polish milestone).
- `/app-api/relations/search` endpoint updated to resolve public entity IDs to numeric PKs and map client filter keys (`relation_categories`, `entity_ids`, `ontology_terms`, etc.) to server query keys.
- `selection/+page.svelte` passes `scopedEntityIds` and `scopedAnnotationIds` to `RelationsExploreTab`.

### Ontology/Annotation Tab
- `AnnotationBrowserTab.svelte` — infinite-scroll ontology term search with prefix filtering. Uses `/app-api/ontology/search` for general search and `/app-api/ontology/scoped-search` when `scopedEntityIds` are present.
- Prefix filter sidebar fetched from `/app-api/ontology/prefixes`.
- Annotation selection wired to selection store (add/remove with `addAnnotation`/`removeAnnotation`).
- Mobile filter sheet + desktop sidebar layout.

### Infrastructure Fixes
- Created `omnipath-svelte/.env` with `DATABASE_URL` and other required env vars copied from root `.env`.
- Fixed BigInt serialization errors across all app-api endpoints by switching from SvelteKit's `json()` to `jsonBigIntSafe()` (converts `bigint` → `number` before JSON.stringify).
- Fixed `effect_orphan` runtime error by removing top-level `$effect` runes from `selection.svelte.ts` and replacing with explicit localStorage writes inside mutation functions.

---

## Remaining

### Entity Results Polish
- Port `ResultCard` features: entity details dialog, descriptions/sections, identifiers section, molecule structure, ontology term hover cards.
- Port `EntityBadge` component.
- Port `SearchResults` grid with proper empty/loading states.

### Future Milestones (explicitly out of scope for now)
- AI chat and floating chat window.
- Docker/deployment parity and cut-over from Next.js to SvelteKit.

---

## Suggested Implementation Order

1. ~~Move server/database query modules.~~
2. ~~Port app-local data API endpoints.~~
3. ~~Port URL state and selection stores.~~
4. ~~Port `/explore` shell.~~
5. ~~Port basic entity search tab.~~
6. ~~Port relations tab (search, filters, details sheet, evidence).~~
7. ~~Port ontology tab (search, scoped browse, annotation selection).~~
8. Polish entity result cards (details dialog, descriptions, identifiers, hover cards).
9. Re-add AI chat (future).
10. Docker/deployment cut-over (future).
