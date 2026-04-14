# Export API minimal spec (entities, interactions, associations)

This document defines a minimal, explicit API contract for dataset exports based on the three search tables:

- `search_interactions`
- `search_entities`
- `search_associations`

It also documents ontology integration for iterative exploration and ontology-term-based filtering.

---

## 1) Data model: the 3 exportable tables

## 1.1 `search_interactions`

Primary purpose: interaction-level retrieval and export.

### Core fields

- `interaction_id: int64` (deterministic ID for export/subsetting)
- `interaction_key: string` (stable interaction-state key)
- `member_a_id: string`
- `member_b_id: string`
- `member_types: string[]`
- `interaction_type: string`
- `is_directed: boolean`
- `sign: int8` (`-1` inhibition/negative, `0` unsigned/unknown, `1` activation/positive)
- `evidence: object[]`
- `evidence_count: int64`
- `sources: string[]`
- `interaction_annotation_terms: string[]`
- `participant_annotation_terms_go: string[]`
- `participant_annotation_terms_mi: string[]`
- `participant_annotation_terms_om: string[]`
- `participant_annotation_terms_hp: string[]`
- `participant_annotation_terms_kw: string[]`

### Notes

- Interaction documents are now split by interaction state.
- Direction and sign are represented directly on each interaction document via `is_directed` and `sign`.
- Older helper fields such as `has_direction`, `has_positive_sign`, `has_negative_sign`, and `directions[]` are no longer part of the canonical export schema.

### Filter-facing values

#### Direction filter

- `direction: "any" | "directed" | "undirected"`

#### Sign filter

- `sign: "any" | "positive" | "negative" | "mixed"`

Examples:

- `direction: "directed"` -> directed interactions only
- `direction: "undirected"` -> undirected interactions only
- `sign: "positive"` -> positive interactions
- `sign: "negative"` -> negative interactions
- `sign: "mixed"` -> interactions carrying both positive and negative evidence
- `sign: "any"` -> no sign restriction

---

## 1.2 `search_entities`

Primary purpose: entity-level retrieval and export.

### Core fields

- `entity_id: int64`
- `entity_type: string`
- `names: string[]`
- `synonyms: string[]`
- `gene_symbols: string[]`
- `descriptions: string[]`
- `references: string[]`
- `ncbi_tax_id: string`
- `sources: string[]`
- `identifiers: { key: string, value: string }[]`

### Relationship/summary fields

- `complexes: int64[]`
- `pathways: int64[]`
- `reactions: int64[]`
- `reactants: int64[]`
- `products: int64[]`
- `stoichiometry: string[]`
- `pathway_steps: string[]`
- `num_interactions: uint32`

### Ontology term fields (prefix-scoped)

- `cv_terms_go: string[]`
- `cv_terms_mi: string[]`
- `cv_terms_om: string[]`
- `cv_terms_hp: string[]`
- `cv_terms_kw: string[]`

### Entity type values (currently observed)

- `complex:MI:0314`
- `cv term:OM:0012`
- `degradation:OM:0019`
- `double stranded deoxyribonucleic acid:MI:0681`
- `food:OM:0020`
- `lipid:OM:0011`
- `molecule set:MI:1304`
- `pathway:OM:0014`
- `phenotype:MI:2261`
- `physical entity:OM:0016`
- `protein family:OM:0010`
- `protein:MI:0326`
- `reaction:OM:0015`
- `ribonucleic acid:MI:0320`
- `small molecule:MI:0328`
- `stimulus:MI:2260`

---

## 1.3 `search_associations`

Primary purpose: parent-member associations (e.g. complex members, pathway members).

### Core fields

- `association_id: int64`
- `association_key: string`
- `parent_entity_id: int64`
- `parent_entity_type: string`
- `member_entity_id: int64`
- `member_entity_type: string`
- `sources: string[]`
- `evidence: object[]`
- `association_annotation_terms: string[]`

### Type values (currently observed)

#### `parent_entity_type`

- `complex:MI:0314`
- `degradation:OM:0019`
- `food:OM:0020`
- `pathway:OM:0014`
- `protein family:OM:0010`
- `reaction:OM:0015`

#### `member_entity_type`

- `complex:MI:0314`
- `double stranded deoxyribonucleic acid:MI:0681`
- `interaction:OM:0013`
- `pathway:OM:0014`
- `physical entity:OM:0016`
- `protein family:OM:0010`
- `protein:MI:0326`
- `reaction:OM:0015`
- `ribonucleic acid:MI:0320`
- `small molecule:MI:0328`

---

## 2) Minimal export API contract

Current resource-specific endpoints:

- `POST /exports/interactions/parquet`
- `POST /exports/entities/parquet`
- `POST /exports/associations/parquet`

Common request envelope:

```json
{
  "query": "",
  "filters": {},
  "filename": "optional_name"
}
```

Common response:

- Body: parquet file stream
- `Content-Type: application/x-parquet`
- `Content-Disposition: attachment; filename=...`
- `X-Export-Row-Count: <int>`

---

## 3) Ontology integration (iterative exploration)

The ontology service is tightly integrated with export filtering:

1. User explores ontology terms via ontology endpoints
2. User selects one or more terms
3. Selected terms are used directly as export filters
4. User iterates (expand ancestors/descendants, refine terms, re-export)

### Ontology exploration endpoints

- `GET /ontologies` -> available ontologies and load status
- `GET /{ontology_id}/term/{term_id}` -> term metadata
- `GET /{ontology_id}/term/{term_id}/parents`
- `GET /{ontology_id}/term/{term_id}/children`
- `GET /{ontology_id}/term/{term_id}/ancestors?depth=N`
- `GET /{ontology_id}/term/{term_id}/descendants?depth=N`
- `GET /{ontology_id}/term/{term_id}/trajectories`
- `POST /tree` with `term_ids[]` (cross-ontology merged tree)
- `POST /terms` with `term_ids[]` (batch term resolution)

### How ontology terms map into export filters

#### Interactions

- `interaction_annotation_terms[]` accepts ontology term IDs directly
- Typical terms: `MI:*`, `OM:*` (and other indexed term IDs)

#### Entities

- Prefix-routed term filters:
  - `GO:*` -> `cv_terms_go[]`
  - `MI:*` -> `cv_terms_mi[]`
  - `OM:*` -> `cv_terms_om[]`
  - `HP:*` -> `cv_terms_hp[]`
  - `KW:*` -> `cv_terms_kw[]`

#### Associations

- `association_annotation_terms[]` accepts ontology term IDs directly

### Iterative workflow pattern

1. Start broad (root/ancestor terms)
2. Expand descendants in ontology browser
3. Select narrower terms
4. Apply as filters on entities/interactions/associations
5. Export subset
6. Repeat until desired specificity is reached

---

## 4) Currently supported ontologies

Core ontologies (preloaded):

- `omnipath` — OmniPath extended PSI-MI CV
- `gene_ontology` — Gene Ontology
- `uniprot_keywords` — UniProt Keywords
- `hpo` — Human Phenotype Ontology

Term-prefix auto-detection:

- `GO` -> `gene_ontology`
- `MI` -> `omnipath`
- `OM` -> `omnipath`
- `KW` -> `uniprot_keywords`
- `HP` -> `hpo`

Additional ontologies can be lazy-loaded on demand from OBO Foundry.

---

## 5) Suggested filter vocabulary (API-facing)

To keep the API minimal and explicit:

### Interactions filters

- `entity_ids: string[]`
- `member_a_id: string`
- `member_b_id: string`
- `interaction_types: string[]`
- `direction: "any" | "directed" | "undirected"`
- `sign: "any" | "positive" | "negative" | "mixed"`
- `interaction_annotation_terms: string[]`
- `participant_annotation_terms: string[]`
- `ontology_terms: string[]` (alias merged into `interaction_annotation_terms`)
- `sources: string[]`

### Entities filters

- `entity_ids: int[]`
- `entity_types: string[]`
- `taxonomy_ids: string[]` (maps to `ncbi_tax_id`)
- ontology term arrays (`cv_terms_go`, `cv_terms_mi`, `cv_terms_om`, `cv_terms_hp`, `cv_terms_kw`)
- `sources: string[]`

### Associations filters

- `parent_entity_ids: int[]`
- `member_entity_ids: int[]`
- `parent_entity_types: string[]`
- `member_entity_types: string[]`
- `association_annotation_terms: string[]`
- `sources: string[]`

This keeps the contract minimal while preserving current capabilities.
