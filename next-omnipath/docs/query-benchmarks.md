# Query benchmark notes

Generated: 2026-04-23T12:44:09.928Z

## Method

- Script: `scripts/benchmark-queries.ts`
- Runtime: `NODE_PATH=./scripts/shims npx tsx scripts/benchmark-queries.ts`
- Each query is executed once as a warmup and once as the recorded measurement.
- Timings are wall-clock milliseconds from a local run against the configured PostgreSQL database.
- These numbers are useful for relative comparison only; rerun after schema or query changes.
- `scripts/shims/server-only.js` is a tiny local shim so these server-only modules can be imported from a standalone script.

## Sample inputs used

- publicId: `MI:1097:Uniprot|A0A024R1R8`
- publicIds: `MI:1097:Uniprot|A0A024R1R8`, `MI:1097:Uniprot|A0A075B6H7`
- entityPk: `1`
- entityPks: `1, 2`
- identifiers: `112268293`, `A0A024R1R8`
- annotation terms: `CHEBI:10036`, `CHEBI:102167`
- ontology prefixes: `chebi`, `go`
- relationPk: `1`
- relationPks: `1, 2`
- relation category/predicate/source: `annotation` / `has_annotation` / `uniprot`
- membership object entity pks: `321, 434`

## Results

| File | Query | Example | Time (ms) | Result summary |
| --- | --- | --- | ---: | --- |
| `entity-details.ts` | `getEntityDetails` | `getEntityDetails("MI:1097:Uniprot\|A0A024R1R8")` | 1.88 | annotations=0, interactionCount=0 |
| `entity-identifier.ts` | `getIdentifiersByEntityPk` | `getIdentifiersByEntityPk(1)` | 47.46 | array(length=8) |
| `entity-identifier.ts` | `getIdentifiersByEntityPks` | `getIdentifiersByEntityPks([1, 2])` | 49.41 | array(length=15) |
| `entity-identifier.ts` | `resolveEntityIdentifiers` | `resolveEntityIdentifiers(["112268293", "A0A024R1R8"])` | 0.46 | entities=1, matches=2 |
| `entity.ts` | `getEntityByPublicId` | `getEntityByPublicId("MI:1097:Uniprot\|A0A024R1R8")` | 0.68 | object(keys=entityPk,canonicalIdentifier,canonicalIdentifierType,entityType,taxonomyId,entityAttributes,sources,identifiers) |
| `entity.ts` | `getEntitiesByPublicIds` | `getEntitiesByPublicIds(["MI:1097:Uniprot\|A0A024R1R8", "MI:1097:Uniprot\|A0A075B6H7"])` | 58.65 | array(length=2) |
| `entity.ts` | `getEntitiesByPks` | `getEntitiesByPks([1, 2])` | 78.32 | array(length=2) |
| `entity.ts` | `searchEntities` | `searchEntities({ query: "PLN", limit: 10 })` | 0.61 | entities=8, total=8, nextCursor=null |
| `entity.ts` | `getEntityFilterOptions` | `getEntityFilterOptions()` | 0.00 | object(keys=entity_types,sources) |
| `ontology-term.ts` | `getOntologyTermsByIds` | `getOntologyTermsByIds(["CHEBI:10036", "CHEBI:102167"])` | 0.68 | array(length=2) |
| `ontology-term.ts` | `searchOntologyTerms` | `searchOntologyTerms({ query: "CHEBI", prefixes: ["chebi"], limit: 10 })` | 0.82 | array(length=10) |
| `ontology-term.ts` | `getOntologyPrefixes` | `getOntologyPrefixes()` | 0.00 | array(length=6) |
| `ontology-term.ts` | `getEntityIdsForAnnotationTerms` | `getEntityIdsForAnnotationTerms(["CHEBI:10036", "CHEBI:102167"])` | 21.60 | array(length=130) |
| `relation-evidence.ts` | `getEvidenceByRelationPk` | `getEvidenceByRelationPk(1)` | 0.48 | array(length=1) |
| `relation-evidence.ts` | `getEvidenceByRelationPks` | `getEvidenceByRelationPks([1, 2])` | 0.33 | array(length=2) |
| `relation.ts` | `getRelationByPk` | `getRelationByPk(1)` | 0.63 | object(keys=relationPk,subjectEntityPk,predicate,objectEntityPk,relationCategory,evidenceCount,sources,subjectEntity,objectEntity) |
| `relation.ts` | `getRelationsByPks` | `getRelationsByPks([1, 2])` | 0.76 | array(length=2) |
| `relation.ts` | `searchRelations` | `searchRelations({ filters: { relationCategories: ["annotation"], predicates: ["has_annotation"], subjectEntityPks: [1], entityPks: [1], sources: ["uniprot"] }, limit: 10, offset: 0 })` | 0.66 | relations=0, total=0 |
| `relation.ts` | `countRelations` | `countRelations({ relationCategories: ["annotation"], predicates: ["has_annotation"] })` | 152.01 | 5507102 |
| `relation.ts` | `getRelationFilterOptions` | `getRelationFilterOptions()` | 0.00 | object(keys=predicatesByCategory,sources) |
| `relation.ts` | `getAssociatedEntityIds` | `getAssociatedEntityIds([321, 434])` | 0.98 | array(length=2) |
