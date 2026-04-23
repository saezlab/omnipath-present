# Query Refactor & UI Adaptation Plan

## What was done

### Old structure
- `lib/graph/*` — thin Drizzle wrappers per table (`entities.ts`, `entity-identifiers.ts`, `relations.ts`, `relation-evidence.ts`, `ontology-terms.ts`)
- `lib/queries/*` — feature-specific query files (`entity-search.ts`, `interaction-search.ts`, `membership-search.ts`, `annotation-browser.ts`, `interaction-details.ts`, `entity-details.ts`, `identifier-resolution.ts`, etc.)
- `lib/queries/types.ts` — a large custom type file mapping old schema shapes to UI-specific types (`HydratedEntity`, `EntitySearchHit`, `InteractionRecord`, `InteractionDetailsResult`, `MembershipSearchHit`, etc.)
- `lib/graph/relation-semantics.ts` — 300+ lines of business logic parsing evidence annotations, inferring interaction direction/sign from ontology accessions, mapping custom association shapes

### New structure
- `lib/db/client.ts` — merges `drizzle/schema` and `drizzle/relations` so relational queries are available
- `lib/queries/entity.ts` — model queries for `entity` table
- `lib/queries/entity-identifier.ts` — model queries for `entity_identifier` table
- `lib/queries/relation.ts` — model queries for `entity_relation` table
- `lib/queries/relation-evidence.ts` — model queries for `entity_relation_evidence` table
- `lib/queries/ontology-term.ts` — model queries for `ontology_term` table
- `lib/relations/semantics.ts` — moved from `lib/graph/relation-semantics.ts`; still contains old annotation-parsing helpers but is now isolated and can be removed when the UI no longer needs it

### Design principles applied
1. **One file per data model** — `entity`, `entity_identifier`, `relation`, `relation_evidence`, `ontology_term`
2. **Drizzle inferred types everywhere** — `Entity`, `EntityRelation`, `EntityRelationEvidence`, `OntologyTerm`, `EntityIdentifier`
3. **No feature-specific query files** — `searchInteractions`, `searchMemberships`, `getInteractionDetails`, etc. are gone
4. **Composed in consumers** — API routes and server actions compose the model queries directly

---

## What to simplify / remove

The old UI expected payloads with **derived fields** that were computed in the query layer. These derived fields are specific to the old schema and the old client-side assumptions. We should not preserve them.

### Remove: interaction direction/sign inference
- The old code looked at ontology accessions in evidence annotations (e.g. `MI:0840`, `OM:0901`) to infer whether an interaction was "positive" or "negative" and whether it was directional
- This was business logic embedded in the query layer
- **New approach:** the UI shows the raw `predicate` string and `relationCategory` from `entity_relation`. If the user wants to know direction, they read the `predicate` (e.g. `increases`, `decreases`, `interacts with`) or look at the raw evidence annotations

### Remove: annotation value parsing (`extractAnnotationValues`, `toLegacyLabeledValue`, `parseCvValue`)
- The old code parsed `jsonb` annotation fields into `{ term, value, unit }` objects with specially formatted term strings
- This was needed because the old UI displayed annotations in a specific way
- **New approach:** the UI receives raw `jsonb` from `record_attributes`, `subject_attributes`, `object_attributes`, `evidence`. The frontend can render JSON directly, or pick specific keys it cares about. No universal parsing layer

### Remove: `InteractionRecord`, `InteractionDetailsResult`, `MembershipSearchHit`, etc.
- These were custom types that combined multiple tables into a single "view model"
- **New approach:** consumers work with the raw model types. If a page needs both a relation and its two entities, it calls `getRelationByPk()` and `getEntitiesByPks()` separately and renders them

### Remove: `HydratedEntity`, `EntitySearchHit`
- `HydratedEntity` was `Entity & { identifiers?: Identifier[] }`
- `EntitySearchHit` added even more UI-specific fields (`id`, `entity_id`, `type: "entity"`, `matchRank`)
- **New approach:** use `EntityWithIdentifiers` from `lib/queries/entity.ts` (just `Entity & { identifiers: EntityIdentifier[] }`). If the UI needs a public ID string, it calls `getEntityPublicId(entity)`. If it needs a display name, it calls `getEntityDisplayName(entity)`

### Remove: complex search result mapping in entity search
- Old `searchEntities` returned `{ hits: EntitySearchHit[], total, nextCursor }` where each hit had pre-aggregated identifiers and UI-specific fields
- **New approach:** `searchEntities` returns `{ entities: Entity[], total, nextCursor }`. Callers that need identifiers fetch them separately with `getIdentifiersByEntityPks(entityPks)` or use `getEntityByPublicId` for detail views

---

## UI adaptation plan

### 1. Entity views (search, details, cards)

**Current pattern:**
```ts
const { hits } = await searchEntities({ query, filters })
// hits are EntitySearchHit with identifiers, display_name, etc.
```

**New pattern:**
```ts
const { entities, total, nextCursor } = await searchEntities({ query, filters })
// entities are plain Entity rows

// For a list view, plain Entity is enough (canonical_identifier is the name)
// For a detail view:
const entity = await getEntityByPublicId(publicId)
// entity is EntityWithIdentifiers — has identifiers array
```

**What to change in components:**
- Stop expecting `display_name`, `entity_id`, `type: "entity"`, `matchRank` on search results
- Use `getEntityDisplayName(entity)` from `lib/entities/display.ts` when rendering
- Use `getEntityPublicId(entity)` to build links
- Entity cards/lists render `entity.canonicalIdentifier` as fallback name

### 2. Interaction views (search, details)

**Current pattern:**
```ts
const { hits } = await searchInteractions({ query, filters })
// hits are InteractionSearchHit = { interaction: InteractionRecord, entityA, entityB }
// InteractionRecord has derived direction (-1 | 0 | 1 | null) and sign
```

**New pattern:**
```ts
// Step 1: search relations
const { relations, total } = await searchRelations({
  filters: { relationCategories: ["interaction"], /* other filters */ },
  limit,
  offset,
})

// Step 2: fetch entities for the page
const entityPks = [...new Set(relations.flatMap(r => [r.subjectEntityPk, r.objectEntityPk]))]
const entities = await getEntitiesByPks(entityPks)
const entityByPk = new Map(entities.map(e => [e.entityPk, e]))

// Step 3: render
relations.map(r => ({
  relation: r,
  subjectEntity: entityByPk.get(r.subjectEntityPk),
  objectEntity: entityByPk.get(r.objectEntityPk),
}))
```

**What to change in components:**
- Stop expecting `interaction.direction` and `interaction.sign` as derived numbers
- Show `relation.predicate` directly (it's a human-readable string from the database)
- Show `relation.evidenceCount` and `relation.sources`
- For evidence details, fetch `getEvidenceByRelationPk(relationPk)` and show raw `source`, `recordAttributes`, `subjectAttributes`, `objectAttributes` as JSON or pick specific keys

### 3. Association / membership views

**Current pattern:**
```ts
const { hits } = await searchMemberships(query, filters, limit, offset)
// hits are MembershipSearchHit = { association: MembershipRecord, parent, member }
// MembershipRecord has derived roleTermId and stoichiometry
```

**New pattern:**
```ts
// Same as interactions — use searchRelations with relationCategories: ["membership"]
const { relations, total } = await searchRelations({
  filters: { relationCategories: ["membership"], /* parent/member entity filters */ },
  limit,
  offset,
})
// Fetch entities separately
// Render predicate, evidenceCount, sources directly
// For evidence: fetch raw evidence rows and render JSON
```

**What to change in components:**
- Stop expecting `roleTermId` and `stoichiometry` as derived top-level fields
- These were extracted from evidence annotations. The UI can show raw evidence JSON instead
- Simpler tables: just show parent entity, member entity, predicate, evidence count, sources

### 4. Annotation / ontology browser

**Current pattern:**
```ts
const terms = await browseAnnotationTerms({ query, scopedEntityIds, entityFilters })
// returns AnnotationBrowserTerm with label, namespace, definition
```

**New pattern:**
```ts
// Search ontology terms directly
const terms = await searchOntologyTerms({ query, prefixes: ["GO", "MI"], limit: 24 })
// terms are OntologyTerm — render termId, label, definition, ontologyPrefix directly

// To find entities annotated with a term:
const entityIds = await getEntityIdsForAnnotationTerms([termId])
```

**What to change in components:**
- Use `OntologyTerm` type directly instead of `AnnotationBrowserTerm`
- `ontologyPrefix` replaces old `namespace`
- `termId` is the canonical ID

### 5. Chat API tools

The chat route currently calls `searchEntities`, `searchInteractions`, `searchMemberships`, `resolveEntityIdentifiers`, `resolveOntologyTerms` as monolithic functions.

**New pattern:**
- `searchEntities` tool → call `searchEntities` from `lib/queries/entity.ts` directly
- `resolveEntityIdentifiers` tool → call `resolveEntityIdentifiers` from `lib/queries/entity-identifier.ts` directly
- `resolveOntologyTerms` tool → call `getOntologyTermsByIds` from `lib/queries/ontology-term.ts` directly
- `searchInteractions` tool → compose `searchRelations` + `getEntitiesByPks` in the execute function
- `searchAssociations` tool → compose `searchRelations` + `getEntitiesByPks` in the execute function

**Payload simplification:**
- Return raw `Entity[]`, `EntityRelation[]`, `OntologyTerm[]` instead of derived hit types
- Chat components render simple previews using `getEntityDisplayName()` and `relation.predicate`

### 6. API routes

**`/api/interactions/[id]`**
- Currently calls `getInteractionDetails()` which returns a complex derived object
- New implementation already composes `getRelationByPk`, `getEntitiesByPks`, `getEvidenceByRelationPk`
- Returns raw relation + entities + evidence rows
- Frontend fetches this and renders `predicate`, `evidenceCount`, raw evidence JSON

---

## Recommended deletion order

After adapting consumers, delete:

1. `lib/graph/entities.ts`
2. `lib/graph/entity-identifiers.ts`
3. `lib/graph/relations.ts`
4. `lib/graph/relation-evidence.ts`
5. `lib/graph/ontology-terms.ts`
6. `lib/queries/entity-search.ts`
7. `lib/queries/entity-details.ts`
8. `lib/queries/interaction-search.ts`
9. `lib/queries/interaction-details.ts`
10. `lib/queries/membership-search.ts`
11. `lib/queries/annotation-browser.ts`
12. `lib/queries/identifier-resolution.ts`
13. `lib/queries/relations-browser.ts`
14. `lib/queries/selection-scope.ts`
15. `lib/queries/shared.ts`
16. `lib/queries/types.ts`

Then remove or simplify `lib/relations/semantics.ts` once no consumer needs the old annotation parsing helpers.

---

## Summary

The new query layer is **5 model files** returning **Drizzle inferred types**. The UI should be adapted to:
1. Work with raw schema types instead of derived view models
2. Use `predicate` and `relationCategory` instead of inferred direction/sign
3. Render raw `jsonb` evidence fields instead of parsed annotation objects
4. Compose model queries in consumers instead of calling monolithic feature queries
5. Use helper functions (`getEntityDisplayName`, `getEntityPublicId`) for presentation concerns, not query shaping
