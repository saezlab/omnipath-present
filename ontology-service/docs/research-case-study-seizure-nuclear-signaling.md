# Research case study: seizure-associated nuclear signaling module

## Research question

Can we identify a **human, seizure-associated, nuclear protein module**, then characterize:

1. its interaction profile (direction/sign, phosphorylation context), and
2. its reaction/complex associations?

This showcases end-to-end capability: **ontology exploration -> ontology-term filtering -> entity export -> interaction/association analysis**.

---

## Step 0 — Ontology-guided term discovery

### GO (cellular compartment)

- Seed term: `GO:0005634` (nucleus)
- Ontology exploration:
  - `GET /gene_ontology/term/GO:0005634`
  - `GET /gene_ontology/term/GO:0005634/descendants?depth=1`

Depth-1 descendants include terms such as `GO:0043076`, `GO:0043073`, `GO:0045120`.

### HPO (phenotype)

- Seed term: `HP:0001250` (Seizure)
- Ontology exploration:
  - `GET /hpo/term/HP:0001250`
  - `GET /hpo/term/HP:0001250/descendants?depth=1`

Depth-1 descendants include terms such as `HP:0002069` and `HP:0002133`.

---

## Step 1 — Define the entity cohort

Filter strategy:

- human proteins (`taxonomy_ids=["9606"]`, `entity_types=["protein:MI:0326"]`)
- annotated with both:
  - nucleus (`GO:0005634`)
  - seizure (`HP:0001250`)

Export request (entities):

```json
{
  "query": "",
  "filters": {
    "taxonomy_ids": ["9606"],
    "entity_types": ["protein:MI:0326"],
    "ontology_terms": ["GO:0005634", "HP:0001250"]
  },
  "filename": "cohort_nucleus_seizure_human_proteins"
}
```

Result: **582 entities**.

Narrower phenotype variants (same GO + species + type):

- `HP:0002069` -> **107 entities**
- `HP:0002133` -> **49 entities**

Interpretation: phenotype descendants provide a natural, ontology-driven specificity dial.

---

## Step 2 — Interaction neighborhood of the cohort

Use the 582 entity IDs as `entity_ids` filter in interaction exports.

### 2.1 Overall interaction neighborhood

- Interactions touching at least one cohort member: **6327**
- Internal edges (both endpoints in cohort): **495**
- External edges (one endpoint outside cohort): **5832**

Interpretation: most signal is in broader context wiring, while ~500 edges define the cohort-internal core.

### 2.2 Direction/sign profile

Among 6327 interactions:

- directed, positive-only: **3085**
- directed, negative-only: **1732**
- directed, mixed-sign: **1117**
- undirected/no-sign: **393**

Interpretation: directed causal edges dominate; inhibitory and mixed evidence are substantial (not a purely activating network).

### 2.3 Phosphorylation-focused slice (MI)

Filter with interaction ontology term `MI:0217` (phosphorylation reaction):

- phosphorylation interactions: **2734**
- phosphorylation + `sign=positive`: **1205**
- phosphorylation + `sign=negative`: **678**

Top sources in phosphorylation subset:

- `SIGNOR:88949`: **2732**
- `IntAct:13539`: **15**

Interpretation: this cohort is strongly represented in curated causal signaling data, especially phosphorylation context.

---

## Step 3 — Association context (complexes/reactions)

Use cohort IDs as `member_entity_ids` in associations.

Total associations involving cohort members: **3434**.

Parent type distribution:

- `complex:MI:0314`: **2171**
- `reaction:OM:0015`: **1215**
- `protein family:OM:0010`: **48**

Role annotations (association ontology terms):

- `reactant:OM:0310`: **914**
- `product:OM:0311`: **440**

Interpretation: the cohort is heavily structured by complex membership and reaction participation, with a reactant-heavy skew.

---

## What this case study demonstrates

1. **Ontology-first exploration**
   - Start from biological concepts (compartment + phenotype), inspect descendants, iteratively refine.

2. **Cross-ontology intersection filtering**
   - Combine GO and HPO directly via `ontology_terms` on entities.

3. **Typed interaction semantics**
   - Use `direction` and `sign` enums for interpretable causal slicing.

4. **Seamless drill-down from entities -> interactions -> associations**
   - Cohort definition and mechanistic/contextual characterization in one API workflow.

---

## Reproducibility notes

- Canonical ontology IDs were used in payloads (e.g., `GO:0005634`, `HP:0001250`, `MI:0217`), relying on API-side term variant expansion.
