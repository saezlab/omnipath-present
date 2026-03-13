# Chat ontology/tool workflow notes

This note captures working examples gathered against the current local backends on 2026-03-13.

## Main finding

For ontology-constrained interaction searches, the current split should be:

- use `interactionAnnotationTerms` for **interaction-level MI annotations**
- use `participantAnnotationTermsGo|Mi|Om|Hp|Kw` for **participant-level annotations**
- use `resolveEntityIdentifiers` first for concrete genes/proteins/accessions

## Ontology name lookup is now available

The ontology API can now resolve free-text names and synonyms to ontology accessions.

Current ontology endpoints:

- `POST /api/ontology/terms/search` accepts free-text `queries`
- `POST /api/ontology/terms` accepts concrete `termIds`
- `POST /api/ontology/tree` accepts concrete `termIds`

So this now works:

```json
{ "queries": ["dephosphorylation", "nucleus"], "prefixes": ["MI", "GO"] }
```

This means the model can reliably go from user text like **"dephosphorylation"** to **`MI:0203`**, and from **"nucleus"** to **`GO:0005634`**, before calling the interaction search tools.

---

## Verified endpoint calls

### 1) Ontology term search by name

Query:

```bash
curl -X POST http://localhost:8081/terms/search \
  -H "Content-Type: application/json" \
  -d '{"queries":["dephosphorylation","nucleus"],"prefixes":["MI","GO"],"limit":3}'
```

Expected/observed top matches include:

- `MI:0203` — `dephosphorylation reaction`
- `GO:0005634` — `nucleus`

### 2) Ontology term resolution

Query:

```bash
curl -X POST http://localhost:8081/terms \
  -H "Content-Type: application/json" \
  -d '{"term_ids":["MI:0217","MI:0203","GO:0005634"]}'
```

Observed result:

```json
{
  "terms": {
    "MI:0217": {
      "id": "MI:0217",
      "name": "phosphorylation reaction"
    },
    "MI:0203": {
      "id": "MI:0203",
      "name": "dephosphorylation reaction"
    },
    "GO:0005634": {
      "id": "GO:0005634",
      "name": "nucleus",
      "namespace": "cellular_component"
    }
  }
}
```

### 3) Ontology tree lookup

Query:

```bash
curl -X POST http://localhost:8081/tree \
  -H "Content-Type: application/json" \
  -d '{"term_ids":["GO:0005634"]}'
```

Observed result includes the expected path:

- `GO:0005575 cellular_component`
- `GO:0110165 cellular anatomical structure`
- `GO:0043226 organelle`
- `GO:0043231 intracellular membrane-bounded organelle`
- `GO:0005634 nucleus`

### 4) Identifier lookup

Query:

```bash
curl -X POST http://localhost:8080/lookup \
  -H "Content-Type: application/json" \
  -d '{"identifiers":["TP53","EGFR"]}'
```

Observed result:

```json
{
  "results": {
    "TP53": [
      "D:SN:RST:R-HSA-6797244:REACTOME_OM_1151.121143",
      "P:UP:P02340",
      "P:UP:P04637",
      "P:UP:P10361"
    ],
    "EGFR": [
      "C:RST:R-HSA-9837684",
      "D:SN:RST:R-HSA-8874800:REACTOME_OM_1151.121452",
      "P:UP:O00688",
      "P:UP:Q01279"
    ]
  }
}
```

---

## Verified search observations

These were checked against Meilisearch with the local master key.

### Entity search: TP53

Broad entity search for `TP53` returned `1281` hits.
Top hit:

- `P:UP:P04637`
- type: `protein:MI:0326`
- names include `Cellular tumor antigen p53`, `P53_HUMAN`, `TP53`
- `num_interactions: 333`

### Entity search: EGFR

Broad entity search for `EGFR` returned `646` hits.
Top hit:

- `P:UP:O00688`
- type: `protein:MI:0326`
- names include `EGFR`, `EGFRvIII`, `Epidermal growth factor receptor`
- `num_interactions: 302`

### Interaction search counts

Using the labeled ontology values stored in the interaction index:

- `interactionAnnotationTerms = ["phosphorylation reaction:MI:0217"]` -> `9761` interactions
- `interactionAnnotationTerms = ["dephosphorylation reaction:MI:0203"]` -> `1176` interactions
- `entityIds = ["P:UP:O00688"]` -> `141` interactions
- `entityIds = ["P:UP:O00688"], interactionAnnotationTerms = ["phosphorylation reaction:MI:0217"]` -> `68` interactions
- `entityIds = ["P:UP:P04637"], interactionAnnotationTerms = ["phosphorylation reaction:MI:0217"], participantAnnotationTermsGo = ["nucleus:GO:0005634"]` -> `87` interactions

---

## Example workflows

## Example 1 — “Find all interactions involving EGFR protein”

### Recommended tool sequence

1. `resolveEntityIdentifiers({ identifiers: ["EGFR"] })`
2. choose the canonical protein entity ID `P:UP:O00688`
3. `searchInteractions({ entityIds: ["P:UP:O00688"] })`

### Why this is correct

- this is an anchored entity query
- it should **not** start with ontology tools
- it should **not** use broad `searchEntities` as the primary anchoring step

### Verified result

Using `entityIds = ["P:UP:O00688"]` returned:

- total interactions: `141`

Observed top partners included:

- `GAB1` (`P:UP:A8K152`)
- `CAMK2A` (`P:UP:Q9UL21`)
- `GRB2` (`P:UP:P29354`)

---

## Example 2 — “Tell me about TP53 — what kind of protein is it?”

### Recommended tool sequence

1. `searchEntities({ query: "TP53" })`
2. summarize the top entity hit

### Why this is correct

- this is an entity-description question, not an anchored interaction query
- broad entity search is appropriate here

### Verified result

Top hit for `TP53`:

- entity ID: `P:UP:P04637`
- type: `protein:MI:0326`
- names: `Cellular tumor antigen p53`, `P53_HUMAN`, `TP53`
- interaction count: `333`

---

## Example 3 — “Show me phosphorylation interactions”

### Recommended tool sequence

1. `searchOntologyTerms({ queries: ["phosphorylation"], prefixes: ["MI"] })`
2. take the top returned match `MI:0217` / `phosphorylation reaction`
3. optionally validate with `resolveOntologyTerms({ termIds: ["MI:0217"] })`
4. call:

```json
{
  "interactionAnnotationTerms": ["phosphorylation reaction:MI:0217"]
}
```

### Why this is correct

- phosphorylation is an **interaction-level MI annotation**
- it belongs in `interactionAnnotationTerms`
- it should **not** go into a participant annotation field

### Verified result

- total interactions: `9761`

Note: many returned interaction documents contain multiple annotation terms across aggregated evidence, so top hits can include both phosphorylation and dephosphorylation among their combined annotation sets.

---

## Example 4 — “Show me dephosphorylation interactions”

### Recommended tool sequence

1. `searchOntologyTerms({ queries: ["dephosphorylation"], prefixes: ["MI"] })`
2. take the top returned match `MI:0203` / `dephosphorylation reaction`
3. optionally validate with `resolveOntologyTerms({ termIds: ["MI:0203"] })`
4. call `searchInteractions` with:

```json
{
  "interactionAnnotationTerms": ["dephosphorylation reaction:MI:0203"]
}
```

### Verified result once the accession is known

- `MI:0203` resolves to `dephosphorylation reaction`
- total interactions: `1176`

### Important note

For interaction-level mechanism queries, constrain ontology search with `prefixes: ["MI"]` so the top match comes from the MI ontology.

---

## Example 5 — advanced: combine interaction-level MI + participant-level GO

User question:

> Show phosphorylation interactions involving TP53 where participants are nuclear.

### Recommended tool sequence

1. `resolveEntityIdentifiers({ identifiers: ["TP53"] })`
2. pick `P:UP:P04637`
3. `searchOntologyTerms({ queries: ["phosphorylation", "nucleus"], prefixes: ["MI", "GO"] })`
4. optionally validate the returned IDs with `resolveOntologyTerms({ termIds: ["MI:0217", "GO:0005634"] })`
5. call:

```json
{
  "entityIds": ["P:UP:P04637"],
  "interactionAnnotationTerms": ["phosphorylation reaction:MI:0217"],
  "participantAnnotationTermsGo": ["nucleus:GO:0005634"]
}
```

### Why this is correct

- `phosphorylation reaction:MI:0217` is an **interaction-level** filter
- `nucleus:GO:0005634` is a **participant-level GO** filter
- these should be combined, not collapsed into a single ontology field

### Verified result

- total interactions: `87`

Observed top partners for TP53 in this filtered set included:

- `CHEK2` (`P:UP:A8K3Y9`)
- `MAPK14` (`P:UP:A6ZJ92`)
- `ATM` (`P:UP:B2RNX5`)

---

## Prompt-adaptation implications

The prompt should now strongly prefer the following behavior:

1. **Concrete entity names** -> `resolveEntityIdentifiers`
2. **Interaction mechanism / causal process terms** like phosphorylation or dephosphorylation -> `searchOntologyTerms(... prefixes: ["MI"])` -> `interactionAnnotationTerms`
3. **GO / HP / KW / OM / participant MI annotations** about the participants -> `searchOntologyTerms` with the matching prefix -> the matching `participantAnnotationTerms*` field
4. For mixed queries, combine both levels explicitly

### Proposed behavioral rules

- If the user asks about a concrete gene/protein/accession, resolve entity IDs first.
- If the user asks for an interaction mechanism like phosphorylation or dephosphorylation, search ontology terms first with `prefixes: ["MI"]`.
- Use `interactionAnnotationTerms` only for **interaction-level MI** terms.
- Use `participantAnnotationTermsGo|Mi|Om|Hp|Kw` only for **participant-level annotations**.
- If both are present in the question, use both.
- Use `resolveOntologyTerms` only when labels/definitions for known IDs are useful, and `exploreOntologyTree` when hierarchy inspection is needed.
