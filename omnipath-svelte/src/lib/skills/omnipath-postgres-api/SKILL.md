---
name: omnipath-postgres-api
description: Query OmniPath through the Postgres-backed API service endpoints for entity, relation, ontology, and resource workflows. Use when a user asks an agent to inspect or subset OmniPath data.
---

# OmniPath Postgres API

Use the API service as the source of truth for graph data. Start from entity, relation, and ontology graph endpoints; facets are supporting metadata, not the primary workflow. Do not call parquet export endpoints, resource download endpoints, or local parquet files.

## Base URL

Use the deployment-provided API base URL. In local development this is usually:

```bash
http://localhost:8081
```

## Core Workflow

1. Resolve or search proteins/entities before relation filtering.
   - `POST /entities/resolve`
   - Body: `{"identifiers":["P04637","TP53"],"filters":{"entityTypes":["Protein:MI:0326"]},"preferredTaxonomyIds":["9606"]}`
   - Resolution uses exact `id_hash`/`value_hash` matching and returns candidates with all known identifiers, taxonomy, entity type, canonical ID, sources, relation count, and match metadata.
   - If `ambiguous` is true, do not guess unless the user supplied a taxon or another disambiguating identifier.
   - `POST /entities/search`
   - Body: `{"query":"TP53","filters":{"entityTypes":["Protein:MI:0326"]},"limit":10}`
   - `/entities/search` also uses exact `id_hash`/`value_hash` matching. There are no fuzzy modes for entity lookup.
   - `POST /entities/by-pks`
   - Body: `{"entityPks":[128747,137920]}`

2. Retrieve relations for the resolved entities.
   - `POST /relations/search`
   - Body: `{"filters":{"entityPks":[128747],"relationCategories":["interaction"],"predicates":["positively_regulates"]},"limit":50}`
   - Add `requireBothParticipants:true` when `entityPks` is a selected set and both relation endpoints must be inside that set.
   - Use `GET /relations/{relationPk}` for one relation and `GET /relations/{relationPk}/evidence` for evidence rows and annotations.

3. Search ontology terms, expand them to annotated entities, then retrieve relations among those entities.
   - `POST /ontology/scoped-search`
   - Body: `{"query":"phosphorylation","limit":10}`
   - Do not require `ontologyIds` unless the user explicitly wants to constrain the ontology. Search across available ontologies by default.
   - `POST /ontology/entities`
   - Body: `{"termIds":["KW-0597"],"filters":{"sources":["signor"],"entityTypes":["Protein:MI:0326"],"taxonomyIds":["9606"]},"limit":200}`
   - Then call `POST /relations/search` with returned `entityPks`, usually with `requireBothParticipants:true`.

4. Use facets only to summarize or refine a known scope.
   - `POST /entities/scoped-facets`
   - Useful filters: `entityPks`, `annotationTermIds`, `entityTypes`, `sources`, `ncbi_tax_id`, `query`
   - `POST /relations/scoped-facets`
   - Useful filters: `entityPks`, `annotationTermIds`, `predicates`, `participantTypes`, `interactionTypes`, `sources`

5. List resource metadata from Postgres.
   - `GET /sources`
   - Use this to discover valid source filters. Optional query: `?domain=entity` or `?domain=relation`.
   - `GET /resources`
   - This returns metadata only; resource zip downloads are not part of the active API.

## Example: Phosphoprotein Interaction Subgraph

Use this when the user asks for proteins connected to phosphorylation biology without already knowing the exact proteins.

1. Find the ontology term.
   - `POST /ontology/scoped-search`
   - Body: `{"query":"phosphoprotein","limit":5}`
   - Pick `KW-0597` if the returned label is `Phosphoprotein`.

2. Expand the term to annotated protein entities.
   - `POST /ontology/entities`
   - Body: `{"termIds":["KW-0597"],"filters":{"entityTypes":["Protein:MI:0326"],"taxonomyIds":["9606"],"sources":["signor"]},"limit":200}`
   - Keep the returned `entityPk` values and candidate identifiers for display.

3. Retrieve interactions among those proteins.
   - `POST /relations/search`
   - Body: `{"filters":{"entityPks":[...],"relationCategories":["interaction"],"requireBothParticipants":true},"limit":100}`
   - Add `predicates` when the question is directional, for example `["positively_regulates","negatively_regulates"]`.

4. Inspect evidence for high-priority relations.
   - `GET /relations/{relationPk}/evidence`
   - Report sources and key annotations, especially PubMed IDs when present.

This produces a defensible subgraph because entity selection comes from ontology annotation, relation retrieval is explicit, and evidence is available for every selected relation.

## Rules

- Prefer IDs returned by the API over guessed labels or aliases.
- Use exact resolution before relation search. A gene symbol without taxon can still be ambiguous, so inspect returned candidates.
- Do not add `ontologyIds` to ontology searches unless the user asked for an ontology-specific answer.
- Use `sources` filters only with values returned by `GET /sources`.
- Treat `entityPks`, relation PKs, and ontology term IDs as durable handles between calls.
- Prefer `/relations/search` for data retrieval; facet endpoints should not be used as a substitute for relation rows.
- Do not use `/exports/*/parquet`, `/entities/slice`, `/relations/slice`, `/resources/{id}/download`, or `/resources/download`.
- If an endpoint is missing, report that the active API is Postgres-only and does not expose parquet/download surfaces.
