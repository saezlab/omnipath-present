# SvelteKit Migration Milestones

This document outlines a staged migration plan from `next-omnipath/` to a new SvelteKit application in `svelte-omnipath/`.

The intended approach is **not** to rewrite the existing Next.js app in place. Instead, create a new sibling app, establish the framework and shared foundations, then move functionality over route by route and feature by feature until the SvelteKit app reaches parity.

## Goals

- Create a new `svelte-omnipath/` frontend alongside `next-omnipath/`.
- Preserve the existing OmniPath visual language using Tailwind CSS and shadcn-svelte.
- Reuse framework-neutral TypeScript logic where possible.
- Move database/server logic into explicit SvelteKit server-only modules.
- Replace implicit client-side imports of database query functions with SvelteKit endpoints or server `load` functions.
- Port the AI chat using Vercel AI SDK Svelte patterns.
- Maintain deployment parity with the current frontend service on port `8082`.

## Non-goals

- Do not attempt a big-bang replacement.
- Do not migrate by mechanically renaming React files to Svelte files.
- Do not keep browser components importing PostgreSQL/Drizzle query modules directly.
- Do not remove `next-omnipath/` until the SvelteKit app reaches functional parity.

---

# Milestone 1 — Bootstrap `svelte-omnipath/`

## Objective

Create a clean SvelteKit project that can run independently next to the current Next.js app.

## Tasks

- Create `svelte-omnipath/` as a sibling of `next-omnipath/`.
- Initialize SvelteKit with TypeScript.
- Add `@sveltejs/adapter-node` for production deployment.
- Configure the dev server to use frontend port `8082` or a temporary alternate port while both apps coexist.
- Add baseline scripts:
  - `dev`
  - `build`
  - `preview`
  - `check`
  - `lint`, if desired
- Set up project aliases:
  - `$lib`
  - `$lib/server`
- Add environment variable handling for:
  - `DATABASE_URL`
  - `API_SERVICE_URL`
  - `DOCKERIZED`
  - `CHAT_MODEL_PROVIDER`
  - model provider API keys

## Initial dependency candidates

```bash
pnpm add ai @ai-sdk/google @ai-sdk/cerebras @openrouter/ai-sdk-provider zod
pnpm add drizzle-orm pg
pnpm add lucide-svelte mode-watcher svelte-sonner
pnpm add @tanstack/svelte-query
pnpm add tailwind-merge clsx class-variance-authority
pnpm add -D @sveltejs/adapter-node drizzle-kit openapi-typescript tsx
```

## Acceptance criteria

- `svelte-omnipath/` exists and runs with `pnpm dev`.
- A placeholder SvelteKit route renders successfully.
- The app can build with `pnpm build`.
- Environment variables are documented in `.env.example`.

---

# Milestone 2 — Styling, Tailwind, and shadcn-svelte foundation

## Objective

Replicate the design foundation of the Next.js app in SvelteKit.

## Tasks

- Set up Tailwind CSS v4.
- Initialize shadcn-svelte.
- Port the CSS variables and theme tokens from:

```txt
next-omnipath/src/app/globals.css
```

to:

```txt
svelte-omnipath/src/app.css
```

- Add shadcn-svelte components needed by the current UI:
  - accordion
  - alert
  - avatar
  - badge
  - button
  - card
  - checkbox
  - collapsible
  - command
  - dialog
  - dropdown-menu
  - hover-card
  - input
  - label
  - popover
  - progress
  - radio-group
  - resizable
  - scroll-area
  - select
  - separator
  - sheet
  - sidebar
  - slider
  - switch
  - table
  - tabs
  - textarea
  - tooltip
- Replace React icon usage with `lucide-svelte`.
- Add dark mode support with `mode-watcher`.
- Add toast support with `svelte-sonner`.

## Acceptance criteria

- The SvelteKit app uses the same color tokens, radii, and base typography as the Next app.
- Light/dark mode works.
- Basic shadcn-svelte components render correctly.
- A temporary component gallery/test page can be used to verify styling.

---

# Milestone 3 — Application shell and layout

## Objective

Port the global application shell before migrating feature pages.

## Source files to study

```txt
next-omnipath/src/app/layout.tsx
next-omnipath/src/components/layout/app-sidebar.tsx
next-omnipath/src/components/layout/main-layout.tsx
next-omnipath/src/components/layout/site-footer.tsx
next-omnipath/src/components/providers.tsx
next-omnipath/src/contexts/sidebar-content-context.tsx
```

## Target files

```txt
svelte-omnipath/src/routes/+layout.svelte
svelte-omnipath/src/lib/components/layout/AppSidebar.svelte
svelte-omnipath/src/lib/components/layout/SiteFooter.svelte
svelte-omnipath/src/lib/stores/sidebar.ts
```

## Tasks

- Port the root layout.
- Port the sidebar navigation.
- Replace `next/link` with normal `<a href>` links.
- Replace `usePathname()` with `$page.url.pathname`.
- Replace `next/image` with `<img>`.
- Replace React context with Svelte stores or Svelte context.
- Add route placeholders for:
  - `/explore`
  - `/selection`
  - `/resources`
  - `/chat`

## Acceptance criteria

- The SvelteKit app has a working sidebar and global shell.
- Navigation between placeholder routes works.
- The layout visually resembles the current Next.js app.

---

# Milestone 4 — Shared TypeScript and utility migration

## Objective

Move framework-neutral code into the SvelteKit app before porting feature UI.

## Reusable candidates

These files are expected to be reusable with minimal changes:

```txt
next-omnipath/src/lib/entities/display.ts
next-omnipath/src/lib/entity-filter.ts
next-omnipath/src/lib/entity-public-id.ts
next-omnipath/src/lib/navigation/url-codecs.ts
next-omnipath/src/lib/ontology-term-id.ts
next-omnipath/src/lib/relations/semantics.ts
next-omnipath/src/lib/utils/*
next-omnipath/src/types/*
next-omnipath/drizzle/*
```

## Target layout

```txt
svelte-omnipath/src/lib/entities/display.ts
svelte-omnipath/src/lib/entity-filter.ts
svelte-omnipath/src/lib/entity-public-id.ts
svelte-omnipath/src/lib/navigation/url-codecs.ts
svelte-omnipath/src/lib/ontology-term-id.ts
svelte-omnipath/src/lib/relations/semantics.ts
svelte-omnipath/src/lib/utils/*
svelte-omnipath/src/lib/types/*
svelte-omnipath/drizzle/*
```

## Tasks

- Copy framework-neutral files.
- Update import aliases from `@/...` to `$lib/...`.
- Preserve the Drizzle schema alias or replace it with a SvelteKit-friendly path.
- Keep browser-safe code out of `$lib/server`.
- Keep server-only code inside `$lib/server`.

## Acceptance criteria

- Shared types and utilities compile in the SvelteKit project.
- No browser module imports `$lib/server`.
- Framework-neutral URL codec functions are available for later route migration.

---

# Milestone 5 — Server/database layer migration

## Objective

Move PostgreSQL, Drizzle, resource, and query logic into explicit SvelteKit server-only modules.

## Source files

```txt
next-omnipath/src/lib/db/client.ts
next-omnipath/src/db/index.ts
next-omnipath/src/lib/queries/*
next-omnipath/src/lib/resource.ts
next-omnipath/src/ai/index.ts
```

## Target files

```txt
svelte-omnipath/src/lib/server/db/client.ts
svelte-omnipath/src/lib/server/queries/*
svelte-omnipath/src/lib/server/resource.ts
svelte-omnipath/src/lib/server/ai/index.ts
```

## Tasks

- Move the database client to `$lib/server/db/client.ts`.
- Remove `server-only`; SvelteKit uses the `$lib/server` convention.
- Move query modules to `$lib/server/queries`.
- Move AI model provider setup to `$lib/server/ai`.
- Update all imports.
- Confirm database queries can run from SvelteKit server code.

## Acceptance criteria

- The SvelteKit app can connect to PostgreSQL using `DATABASE_URL`.
- Query modules compile in server-only paths.
- No client-side Svelte component imports Drizzle, `pg`, or `$lib/server`.

---

# Milestone 6 — Local app API endpoints

## Objective

Port existing Next route handlers and add explicit endpoints for data currently accessed directly from React client components.

## Existing Next route handlers to port

```txt
next-omnipath/src/app/app-api/chat/route.ts
next-omnipath/src/app/api/terms/route.ts
next-omnipath/src/app/api/relations/[id]/route.ts
next-omnipath/src/app/api/relations/[id]/evidence/route.ts
```

## Target SvelteKit endpoints

```txt
svelte-omnipath/src/routes/app-api/chat/+server.ts
svelte-omnipath/src/routes/app-api/terms/+server.ts
svelte-omnipath/src/routes/app-api/relations/[id]/+server.ts
svelte-omnipath/src/routes/app-api/relations/[id]/evidence/+server.ts
```

## Additional endpoints likely needed

```txt
svelte-omnipath/src/routes/app-api/entities/search/+server.ts
svelte-omnipath/src/routes/app-api/entities/resolve/+server.ts
svelte-omnipath/src/routes/app-api/entities/by-public-ids/+server.ts
svelte-omnipath/src/routes/app-api/entities/[id]/+server.ts
svelte-omnipath/src/routes/app-api/ontology/search/+server.ts
svelte-omnipath/src/routes/app-api/ontology/scoped-search/+server.ts
svelte-omnipath/src/routes/app-api/ontology/prefixes/+server.ts
svelte-omnipath/src/routes/app-api/relations/search/+server.ts
svelte-omnipath/src/routes/app-api/relations/filter-options/+server.ts
svelte-omnipath/src/routes/app-api/resources/download/+server.ts
```

## Important routing decision

The current Next app uses `/api/*` both for local frontend endpoints and for fallback proxying to the FastAPI service.

For SvelteKit, prefer this separation:

- `/app-api/*` for frontend-owned SvelteKit endpoints.
- `/api/*` reserved for the external FastAPI service or reverse-proxy routing.

This avoids conflicts and makes deployment routing clearer.

## Tasks

- Port each existing route handler.
- Replace `NextResponse.json` with `json()` from `@sveltejs/kit`.
- Replace dynamic route params with SvelteKit `params`.
- Keep BigInt-safe JSON serialization where needed.
- Add validation with `zod` for POST bodies.
- Add frontend-owned data endpoints for entity/relation/ontology search.

## Acceptance criteria

- Existing app-local API behavior works under `/app-api/*`.
- Data needed by browser UI can be fetched through endpoints instead of direct database imports.
- Chat streaming endpoint returns a valid AI SDK UI message stream.

---

# Milestone 7 — AI chat migration

## Objective

Port the AI chat backend and frontend using Vercel AI SDK Svelte patterns.

## Source files to study

```txt
next-omnipath/src/app/app-api/chat/route.ts
next-omnipath/src/features/chat/components/chat.tsx
next-omnipath/src/features/chat/components/chat-panel.tsx
next-omnipath/src/features/chat/components/message.tsx
next-omnipath/src/features/chat/components/tool-response.tsx
next-omnipath/src/features/chat/components/tool-result-card.tsx
next-omnipath/src/features/chat/components/dual-mode-interface.tsx
next-omnipath/src/features/chat/types.ts
next-omnipath/src/features/chat/tool-result-navigation.ts
next-omnipath/src/features/chat-floating/*
```

## Target files

```txt
svelte-omnipath/src/routes/app-api/chat/+server.ts
svelte-omnipath/src/routes/chat/+page.svelte
svelte-omnipath/src/lib/components/chat/Chat.svelte
svelte-omnipath/src/lib/components/chat/ChatPanel.svelte
svelte-omnipath/src/lib/components/chat/Message.svelte
svelte-omnipath/src/lib/components/chat/ToolResultCard.svelte
svelte-omnipath/src/lib/components/chat/FloatingChatLauncher.svelte
svelte-omnipath/src/lib/components/chat/FloatingChatWindow.svelte
svelte-omnipath/src/lib/chat/types.ts
svelte-omnipath/src/lib/chat/tool-result-navigation.ts
```

## Tasks

- Port `getChatModel()` and model provider selection to `$lib/server/ai`.
- Port the chat tool definitions almost directly to SvelteKit.
- Use the AI SDK Svelte approach from `vercel/ai-chatbot-svelte` for the client.
- Preserve endpoint path `/app-api/chat`.
- Port message rendering.
- Port tool result cards.
- Port tool-result-to-navigation behavior.
- Port floating chat after the standalone chat route works.

## Acceptance criteria

- `/chat` can send a message and receive a streamed response.
- Tool calls execute successfully.
- Tool results render in the chat UI.
- Clicking a navigable tool result routes to the appropriate SvelteKit page/state.
- Floating chat works after core chat is stable.

---

# Milestone 8 — Resources page

## Objective

Port the simplest data-loaded page to validate server `load` and rendering patterns.

## Source files

```txt
next-omnipath/src/app/resources/page.tsx
next-omnipath/src/features/resources/page.tsx
next-omnipath/src/lib/resource.ts
next-omnipath/src/lib/resource-downloads.ts
```

## Target files

```txt
svelte-omnipath/src/routes/resources/+page.server.ts
svelte-omnipath/src/routes/resources/+page.svelte
svelte-omnipath/src/lib/server/resource.ts
svelte-omnipath/src/lib/resource-downloads.ts
```

## Tasks

- Implement `+page.server.ts` that calls `listResources()` and `summarizeResources()`.
- Port the resources UI to Svelte.
- Implement or port resource download behavior.
- Ensure frontend-owned downloads use `/app-api/resources/download` or another clear endpoint.

## Acceptance criteria

- `/resources` renders real resource data from the database/server layer.
- Resource summary values match the Next app.
- Downloads work or have a clearly documented follow-up task.

---

# Milestone 9 — URL state and selection stores

## Objective

Replace `nuqs` and React contexts with SvelteKit navigation helpers and stores.

## Source files

```txt
next-omnipath/src/lib/navigation/url-state.ts
next-omnipath/src/lib/navigation/url-codecs.ts
next-omnipath/src/contexts/entity-selection-context.tsx
next-omnipath/src/contexts/entity-data-source-context.tsx
next-omnipath/src/contexts/sidebar-content-context.tsx
```

## Target files

```txt
svelte-omnipath/src/lib/navigation/url-codecs.ts
svelte-omnipath/src/lib/navigation/url-state.ts
svelte-omnipath/src/lib/stores/selection.ts
svelte-omnipath/src/lib/stores/entity-data-source.ts
svelte-omnipath/src/lib/stores/sidebar.ts
```

## Tasks

- Reuse framework-neutral codec functions from `url-codecs.ts`.
- Rewrite `url-state.ts` around:
  - `$page.url`
  - `goto()` from `$app/navigation`
  - `URLSearchParams`
- Port localStorage-backed selected entities and selected annotations.
- Ensure localStorage access is browser-only.
- Provide helpers for:
  - explore tab/query/species state
  - interaction filters
  - selection route state
  - entity IDs and annotation IDs

## Acceptance criteria

- URL query state updates without full page reloads.
- Selection persists in localStorage.
- Selection can be represented in URLs.
- No code depends on `nuqs`.

---

# Milestone 10 — Explore page shell

## Objective

Port the main `/explore` page structure before porting each result tab.

## Source files

```txt
next-omnipath/src/app/explore/page.tsx
next-omnipath/src/features/explore/page.tsx
next-omnipath/src/features/explore/components/explore-browser-shell.tsx
next-omnipath/src/features/explore/components/search-bar.tsx
```

## Target files

```txt
svelte-omnipath/src/routes/explore/+page.svelte
svelte-omnipath/src/lib/components/explore/ExploreBrowserShell.svelte
svelte-omnipath/src/lib/components/explore/SearchBar.svelte
```

## Tasks

- Port the explore page shell.
- Implement tab state:
  - `entity`
  - `relations`
  - `ontology`
- Implement query state.
- Implement species picker state.
- Port keyboard shortcuts:
  - `/` focuses search
  - `s` opens selection when selection exists
- Add placeholder content for each tab.

## Acceptance criteria

- `/explore` renders the search shell and tab navigation.
- Query, tab, and species state are URL-backed.
- Keyboard shortcuts work.
- Selection CTA appears when selection store has items.

---

# Milestone 11 — Explore entity search tab

## Objective

Port entity search and entity result rendering.

## Source files

```txt
next-omnipath/src/features/explore/components/entities-explore-tab.tsx
next-omnipath/src/features/explore/components/entity-filter-sidebar.tsx
next-omnipath/src/features/shared/entity-results/search-results.tsx
next-omnipath/src/features/shared/entity-results/result-card.tsx
next-omnipath/src/features/shared/entity-results/entity-details-dialog.tsx
next-omnipath/src/features/shared/entity-results/entity-identifiers-section.tsx
next-omnipath/src/components/entity-badge.tsx
next-omnipath/src/hooks/use-infinite-scroll.ts
next-omnipath/src/hooks/use-mobile.ts
next-omnipath/src/hooks/use-entity.ts
```

## Target files

```txt
svelte-omnipath/src/lib/components/explore/EntitiesExploreTab.svelte
svelte-omnipath/src/lib/components/explore/EntityFilterSidebar.svelte
svelte-omnipath/src/lib/components/entity-results/SearchResults.svelte
svelte-omnipath/src/lib/components/entity-results/ResultCard.svelte
svelte-omnipath/src/lib/components/entity-results/EntityDetailsDialog.svelte
svelte-omnipath/src/lib/components/entity-results/EntityIdentifiersSection.svelte
svelte-omnipath/src/lib/components/EntityBadge.svelte
svelte-omnipath/src/lib/actions/infinite-scroll.ts
svelte-omnipath/src/lib/stores/media.ts
```

## Tasks

- Replace direct `searchEntities()` client imports with calls to `/app-api/entities/search`.
- Port infinite scroll.
- Port mobile filter sheet behavior.
- Port entity filter sidebar.
- Port result cards.
- Port entity detail dialog.
- Port entity selection interactions.
- Port ontology term hover/label lookups through `/app-api/terms`.

## Acceptance criteria

- Entity search works from `/explore?tab=entity`.
- Results match the Next app for representative queries.
- Infinite scroll works.
- Filters work.
- Entity details render.
- Entity selection works and persists.

---

# Milestone 12 — Explore relations/interactions tab

## Objective

Port relation and interaction search functionality.

## Source files

```txt
next-omnipath/src/features/explore/components/relations-explore-tab.tsx
next-omnipath/src/features/interactions-search/components/filter-sidebar.tsx
next-omnipath/src/features/interactions-search/components/interaction-details.tsx
next-omnipath/src/features/interactions-search/components/interaction-details-sheet.tsx
next-omnipath/src/features/interactions-search/types.ts
next-omnipath/src/lib/queries/relation.ts
next-omnipath/src/lib/queries/relation-evidence.ts
```

## Target files

```txt
svelte-omnipath/src/lib/components/explore/RelationsExploreTab.svelte
svelte-omnipath/src/lib/components/interactions/FilterSidebar.svelte
svelte-omnipath/src/lib/components/interactions/InteractionDetails.svelte
svelte-omnipath/src/lib/components/interactions/InteractionDetailsSheet.svelte
svelte-omnipath/src/lib/types/interactions.ts
```

## Tasks

- Replace direct relation query imports with `/app-api/relations/search`.
- Replace relation evidence fetches with `/app-api/relations/[id]/evidence`.
- Port relation filter options endpoint.
- Port interaction details sheet.
- Port evidence table rendering.
- Preserve sign/direction/source/ontology filters.

## Acceptance criteria

- Relations tab renders interaction results.
- Filtering works.
- Interaction details sheet opens.
- Evidence loads for a selected relation.
- Results match the Next app for representative filter combinations.

---

# Milestone 13 — Explore ontology/annotation tab

## Objective

Port ontology and annotation browsing/search.

## Source files

```txt
next-omnipath/src/features/explore/components/annotation-browser-tab.tsx
next-omnipath/src/features/ontology/ontology-term-label.tsx
next-omnipath/src/features/ontology/use-ontology-terms.ts
next-omnipath/src/lib/queries/ontology-term.ts
next-omnipath/src/lib/ontology.ts
```

## Target files

```txt
svelte-omnipath/src/lib/components/explore/AnnotationBrowserTab.svelte
svelte-omnipath/src/lib/components/ontology/OntologyTermLabel.svelte
svelte-omnipath/src/lib/stores/ontology-terms.ts
svelte-omnipath/src/lib/server/queries/ontology-term.ts
svelte-omnipath/src/lib/server/ontology.ts
```

## Tasks

- Port ontology term search endpoints.
- Port scoped ontology search behavior.
- Port ontology prefixes endpoint.
- Port annotation selection behavior.
- Port term labels and definitions.
- Ensure term lookups use `/app-api/terms` or dedicated ontology endpoints.

## Acceptance criteria

- Ontology tab searches terms.
- Scoped ontology browsing works.
- Annotation filters and selection work.
- Selected annotations persist in selection state.

---

# Milestone 14 — Selection workspace

## Objective

Port the `/selection` route and workspace views that combine selected entities, annotations, interactions, and associations.

## Source files

```txt
next-omnipath/src/app/selection/page.tsx
next-omnipath/src/features/workspace/views/selection-results-view.tsx
next-omnipath/src/features/selection/selection-scope.ts
next-omnipath/src/features/explore/components/entities-explore-tab.tsx
next-omnipath/src/features/explore/components/relations-explore-tab.tsx
next-omnipath/src/features/explore/components/annotation-browser-tab.tsx
```

## Target files

```txt
svelte-omnipath/src/routes/selection/+page.svelte
svelte-omnipath/src/lib/components/workspace/SelectionResultsView.svelte
svelte-omnipath/src/lib/stores/selection-scope.ts
```

## Tasks

- Port selection route state.
- Port selected entity and annotation scope calculations.
- Reuse migrated explore tabs where possible.
- Port workspace tabs:
  - entities
  - selection
  - interactions
  - annotations
  - associations
- Port keyboard shortcuts.
- Port mobile sheet/refine UI.

## Acceptance criteria

- `/selection` opens from selected entities/annotations.
- URL-provided entity and annotation IDs initialize state correctly.
- Selection-scoped entity, relation, and annotation views work.
- The page can be used as the main result workspace.

---

# Milestone 15 — Floating chat and result navigation integration

## Objective

Integrate chat as a navigation/controller layer across the SvelteKit app.

## Source files

```txt
next-omnipath/src/features/chat-floating/floating-chat-launcher.tsx
next-omnipath/src/features/chat-floating/floating-chat-window.tsx
next-omnipath/src/features/chat-floating/use-floating-chat-state.ts
next-omnipath/src/features/chat/tool-result-navigation.ts
```

## Target files

```txt
svelte-omnipath/src/lib/components/chat/FloatingChatLauncher.svelte
svelte-omnipath/src/lib/components/chat/FloatingChatWindow.svelte
svelte-omnipath/src/lib/stores/floating-chat.ts
svelte-omnipath/src/lib/chat/tool-result-navigation.ts
```

## Tasks

- Port floating chat open/closed state.
- Persist floating chat state in localStorage.
- Port minimized/maximized behavior.
- Port tool result navigation to SvelteKit `goto()`.
- Ensure chat can open entity, relation, and selection result sets.

## Acceptance criteria

- Floating chat works on explore/selection pages.
- Chat state persists across reloads.
- Tool result clicks navigate to URL-backed result states.

---

# Milestone 16 — React-specific dependency replacement and graph review

## Objective

Audit and replace any remaining React/Next-only dependencies.

## React/Next dependencies to eliminate from Svelte app

- `next`
- `react`
- `react-dom`
- `next-themes`
- `nuqs`
- `@tanstack/react-query`
- `lucide-react`
- `@radix-ui/react-*`
- `react-resizable-panels`
- `react-hook-form`, unless replaced with Svelte forms
- `framer-motion`, unless replaced by Svelte animation/motion alternatives
- `@xyflow/react`
- `reactflow`

## Graph/network visualization review

The current dependency list includes React-specific graph packages:

```txt
@xyflow/react
reactflow
```

Investigate whether graph features are active in the current UI. If so, choose one:

- use a Svelte-compatible XYFlow/Svelte Flow package,
- use Cytoscape directly,
- defer graph-specific parity to a later milestone.

## Acceptance criteria

- The Svelte app has no React or Next runtime dependency.
- Any graph visualization gap is either migrated or explicitly tracked.
- Bundle/dependency list is clean and Svelte-native where practical.

---

# Milestone 17 — Docker, deployment, and proxy parity

## Objective

Make `svelte-omnipath/` deployable as a replacement frontend service.

## Tasks

- Add a SvelteKit Dockerfile using adapter-node output.
- Expose port `8082`.
- Use:
  - `HOST=0.0.0.0`
  - `PORT=8082`
- Update docker-compose dev setup when ready.
- Decide how `/api/*` is handled:
  - proxy to FastAPI via reverse proxy, or
  - SvelteKit `handle` proxy, or
  - Vite dev proxy for local-only behavior.
- Add security headers equivalent to `next.config.js` headers.
- Disable telemetry/noise where applicable.
- Confirm production env variables.

## Acceptance criteria

- SvelteKit app runs in Docker.
- App can reach PostgreSQL and the API service in Docker.
- App works behind the same reverse proxy assumptions as the Next app.
- Production build starts successfully with `node build`.

---

# Milestone 18 — Parity testing and cutover

## Objective

Validate the SvelteKit app against the Next app and prepare for replacement.

## Test areas

- Layout/sidebar/theme
- `/resources`
- `/chat`
- AI tool calling
- `/explore?tab=entity`
- `/explore?tab=relations`
- `/explore?tab=ontology`
- entity details dialog
- interaction details sheet
- ontology term labels
- entity/annotation selection
- `/selection`
- floating chat
- resource downloads
- Docker deployment

## Representative checks

- Entity search for common symbols such as `EGFR`, `TP53`, `AKT1`.
- Identifier resolution for UniProt/gene identifiers.
- Interaction search involving a known entity.
- Ontology lookup for terms such as `phosphorylation`, `nucleus`, `seizure`.
- Chat prompt: `Show phosphorylation interactions involving EGFR where participants are nuclear`.
- Chat prompt: `Show interactions involving TP53 where participants are associated with seizure`.

## Tasks

- Compare results between Next and SvelteKit for representative queries.
- Fix route/state mismatches.
- Fix styling regressions.
- Fix deployment issues.
- Switch frontend service from `next-omnipath` to `svelte-omnipath` when parity is acceptable.
- Keep `next-omnipath/` available for rollback until the SvelteKit app is stable.

## Acceptance criteria

- SvelteKit app reaches functional parity for core workflows.
- Known differences are documented.
- Deployment points to the SvelteKit frontend.
- Rollback path is understood.

---

# Suggested implementation order

1. Bootstrap `svelte-omnipath/`.
2. Add Tailwind/shadcn-svelte/theme foundation.
3. Port global app shell/sidebar.
4. Move shared TypeScript utilities.
5. Move server/database/query layer.
6. Port app-local API endpoints.
7. Port AI chat endpoint and standalone `/chat` UI.
8. Port `/resources`.
9. Port URL state and selection stores.
10. Port `/explore` shell.
11. Port entity search tab.
12. Port relations tab.
13. Port ontology tab.
14. Port `/selection`.
15. Add floating chat integration.
16. Resolve React-specific dependency leftovers.
17. Add Docker/deployment parity.
18. Run parity testing and cut over.

---

# Notes from current project exploration

Current `next-omnipath/` characteristics:

- Next.js 16 app router.
- React 19.
- Tailwind CSS v4.
- shadcn React/Radix UI components.
- Vercel AI SDK chat endpoint and client.
- Drizzle + PostgreSQL direct query modules.
- Several browser components currently import query modules directly.
- Current local routes:
  - `/explore`
  - `/selection`
  - `/resources`
  - `/chat`
- Current local API routes:
  - `/app-api/chat`
  - `/api/terms`
  - `/api/relations/[id]`
  - `/api/relations/[id]/evidence`

The most important migration principle is to make server/client boundaries explicit early. SvelteKit makes this clean through `$lib/server`, `+server.ts`, and `+page.server.ts`; the migration should lean into that rather than reproducing the current direct-query-from-client pattern.
