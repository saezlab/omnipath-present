# Tutorial: ontology-guided prior-knowledge subsetting in OmniPath

This tutorial shows a full local workflow:

1. Explore ontologies (GO + HPO + MI + OM)
2. Build a biologically meaningful entity cohort
3. Retrieve interactions and associations for that cohort
4. Analyze term/source distributions in the exported parquet files
5. Form concrete hypotheses for follow-up

All commands below are exactly what was used locally.

---

## Prerequisites

- Ontology service running on `http://localhost:8081`
- Export Parquet tables available under `ONTOLOGY_DATA_DIR` (`search_entities.parquet`, `search_interactions.parquet`, `search_associations.parquet`)
- `python` with `polars` available locally (or use the ontology-service venv)

Optional convenience:

```bash
source /Users/jschaul/Code/omnipath-present/ontology-service/.venv/bin/activate
```

Create a workspace for tutorial artifacts:

```bash
mkdir -p /tmp/op_tutorial
rm -f /tmp/op_tutorial/*
```

---

## Step 1 — Discover candidate ontology terms

### 1.1 Check available ontologies

```bash
curl -sS http://localhost:8081/ontologies | python -m json.tool
```

### 1.2 GO term: nucleus

```bash
curl -sS http://localhost:8081/gene_ontology/term/GO:0005634 | python -m json.tool
curl -sS "http://localhost:8081/gene_ontology/term/GO:0005634/descendants?depth=1" | python -m json.tool
```

### 1.3 HPO term: seizure

```bash
curl -sS http://localhost:8081/hpo/term/HP:0001250 | python -m json.tool
curl -sS "http://localhost:8081/hpo/term/HP:0001250/descendants?depth=1" | python -m json.tool
```

Interpretation:
- `GO:0005634` gives the nuclear compartment context.
- `HP:0001250` gives neurological phenotype context.
- Descendants can later refine specificity.

---

## Step 2 — Export a cross-ontology entity cohort

Research cohort definition:
- species: human (`taxonomy_ids = ["9606"]`)
- type: proteins (`entity_types = ["protein:MI:0326"]`)
- annotations include nucleus + seizure (`GO:0005634`, `HP:0001250`)

```bash
curl -sS -D /tmp/op_tutorial/entities.headers \
  -o /tmp/op_tutorial/entities.parquet \
  -X POST http://localhost:8081/exports/entities/parquet \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "",
    "filters": {
      "taxonomy_ids": ["9606"],
      "entity_types": ["protein:MI:0326"],
      "ontology_terms": ["GO:0005634", "HP:0001250"]
    },
    "filename": "cohort_nucleus_seizure_human_proteins"
  }'

grep -i 'x-export-row-count\|content-disposition' /tmp/op_tutorial/entities.headers
```

Observed row count: **582 entities**.

---

## Step 3 — Use cohort IDs to export interactions and associations

Extract `entity_id` list from the entity subset and generate payloads:

```bash
python - <<'PY'
import json, polars as pl
ids = pl.read_parquet('/tmp/op_tutorial/entities.parquet', columns=['entity_id'])['entity_id'].to_list()

with open('/tmp/op_tutorial/interactions_all.json','w') as f:
    json.dump({'query':'','filters':{'entity_ids':ids},'filename':'cohort_interactions_all'}, f)
with open('/tmp/op_tutorial/interactions_phospho.json','w') as f:
    json.dump({'query':'','filters':{'entity_ids':ids,'ontology_terms':['MI:0217']},'filename':'cohort_interactions_phospho'}, f)
with open('/tmp/op_tutorial/interactions_phospho_pos.json','w') as f:
    json.dump({'query':'','filters':{'entity_ids':ids,'ontology_terms':['MI:0217'],'sign':'positive'},'filename':'cohort_interactions_phospho_pos'}, f)
with open('/tmp/op_tutorial/interactions_phospho_neg.json','w') as f:
    json.dump({'query':'','filters':{'entity_ids':ids,'ontology_terms':['MI:0217'],'sign':'negative'},'filename':'cohort_interactions_phospho_neg'}, f)

with open('/tmp/op_tutorial/associations_all.json','w') as f:
    json.dump({'query':'','filters':{'member_entity_ids':ids},'filename':'cohort_member_associations'}, f)
with open('/tmp/op_tutorial/associations_reactant.json','w') as f:
    json.dump({'query':'','filters':{'member_entity_ids':ids,'ontology_terms':['OM:0310']},'filename':'cohort_member_reactants'}, f)
with open('/tmp/op_tutorial/associations_product.json','w') as f:
    json.dump({'query':'','filters':{'member_entity_ids':ids,'ontology_terms':['OM:0311']},'filename':'cohort_member_products'}, f)

print('entity_ids:', len(ids))
PY
```

Run exports:

```bash
for name in interactions_all interactions_phospho interactions_phospho_pos interactions_phospho_neg associations_all associations_reactant associations_product; do
  curl -sS -D /tmp/op_tutorial/${name}.headers \
    -o /tmp/op_tutorial/${name}.parquet \
    -X POST http://localhost:8081/exports/${name%%_*}/parquet \
    -H 'Content-Type: application/json' \
    --data-binary @/tmp/op_tutorial/${name}.json >/dev/null
  echo -n "$name: "
  grep -i "x-export-row-count" /tmp/op_tutorial/${name}.headers | tr -d '\r' | awk '{print $2}'
done
```

Observed counts:
- `interactions_all`: **6327**
- `interactions_phospho` (`MI:0217`): **2734**
- `interactions_phospho_pos`: **1205**
- `interactions_phospho_neg`: **678**
- `associations_all`: **3434**
- `associations_reactant` (`OM:0310`): **914**
- `associations_product` (`OM:0311`): **440**

---

## Step 4 — Analyze annotation distributions in the subset

## 4.1 Entity annotation landscape

```bash
python - <<'PY'
import polars as pl
edf = pl.read_parquet('/tmp/op_tutorial/entities.parquet')

print('entities', edf.height)
print('\nTop sources')
print(edf.select(pl.col('sources').explode().alias('s')).drop_nulls().group_by('s').len().sort('len', descending=True).head(10))

print('\nTop GO terms')
print(edf.select(pl.col('cv_terms_go').explode().alias('t')).drop_nulls().group_by('t').len().sort('len', descending=True).head(12))

print('\nTop HP terms')
print(edf.select(pl.col('cv_terms_hp').explode().alias('t')).drop_nulls().group_by('t').len().sort('len', descending=True).head(12))

print('\nnum_interactions summary')
print(edf.select([
    pl.col('num_interactions').mean().alias('mean'),
    pl.col('num_interactions').median().alias('median'),
    pl.col('num_interactions').quantile(0.9).alias('p90'),
    pl.col('num_interactions').max().alias('max')
]))
PY
```

Observed highlights:
- all 582 entities are annotated by UniProt + HPO
- GO top terms include `nucleoplasm`, `cytosol`, `cytoplasm` in addition to nucleus
- HP top terms include `Global developmental delay`, `Intellectual disability`, `Hypotonia`
- connectivity is heavy-tailed (`median num_interactions=3`, `max=1758`)

## 4.2 Interaction semantics for the cohort neighborhood

```bash
python - <<'PY'
import polars as pl
idf = pl.read_parquet('/tmp/op_tutorial/interactions_all.parquet')

print('interactions_all', idf.height)
print('\nDirection/sign composition')
print(idf.group_by(['has_direction','has_positive_sign','has_negative_sign']).len().sort('len', descending=True))

print('\nTop interaction annotation terms')
print(idf.select(pl.col('interaction_annotation_terms').explode().alias('t')).drop_nulls().group_by('t').len().sort('len', descending=True).head(10))

print('\nTop sources')
print(idf.select(pl.col('sources').explode().alias('s')).drop_nulls().group_by('s').len().sort('len', descending=True).head(10))
PY
```

Observed highlights:
- directed interactions dominate
- substantial positive, negative, and mixed-sign evidence
- phosphorylation (`MI:0217`) is a major annotation term
- source signal is strongly dominated by SIGNOR in this subset

## 4.3 Association context of the same cohort

```bash
python - <<'PY'
import polars as pl
adf = pl.read_parquet('/tmp/op_tutorial/associations_all.parquet')

print('associations_all', adf.height)
print('\nParent entity types')
print(adf.group_by('parent_entity_type').len().sort('len', descending=True))

print('\nAssociation annotation terms')
print(adf.select(pl.col('association_annotation_terms').explode().alias('t')).drop_nulls().group_by('t').len().sort('len', descending=True))

print('\nTop association sources')
print(adf.select(pl.col('sources').explode().alias('s')).drop_nulls().group_by('s').len().sort('len', descending=True).head(10))
PY
```

Observed highlights:
- parent types are mostly `complex` and `reaction`
- `reactant` role appears about 2x as often as `product` for these members

---

## Step 5 — Hypotheses to investigate next

Based on this ontology-guided prior-knowledge subset, three concrete hypotheses emerge:

1. **Phospho-regulatory bias hypothesis**
   - In seizure-associated nuclear proteins, phosphorylation-mediated regulation is overrepresented and skewed toward activating edges.
   - Follow-up: compare phospho fraction vs a matched control cohort (e.g., nucleus proteins without HP:0001250).

2. **Complex-first mechanism hypothesis**
   - Disease-relevant signal may be mediated by complex membership more than direct pathway membership.
   - Follow-up: rank parent complexes by enrichment of cohort members and inspect shared source/evidence patterns.

3. **Phenotype-stratified subnetwork hypothesis**
   - Descendant HPO terms (e.g., `HP:0002069`, `HP:0002133`) define more specific mechanistic subnetworks with different sign/source compositions.
   - Follow-up: rerun the full workflow for each descendant and compare interaction term/source distributions.

---

## Why this is useful in practice

This workflow shows OmniPath as a **richly annotated prior-knowledge substrate**:

- ontology-aware filtering across entity/interaction/association layers,
- explicit direction/sign semantics,
- evidence/source-rich exports in portable parquet,
- immediate transition from biological question -> reproducible local analysis.
