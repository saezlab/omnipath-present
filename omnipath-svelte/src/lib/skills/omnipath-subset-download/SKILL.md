---
name: omnipath-subset-download
description: Resolve biological entities and ontology terms, discover valid graph filter values from the OmniPath API service, preview slices, and download parquet subsets.
---

# OmniPath Subset Download

Turn biological subset requests into validated OmniPath parquet exports.

## Rule

Do not guess IDs or filter values. Resolve terms/entities and discover valid filters via the API before exporting.

## Setup

```bash
API_BASE=${API_BASE:-https://dev.omnipathdb.org/api}
curl -fsS "$API_BASE/health"
```

## Workflow

1. **Parse intent**: identify entities, ontology concepts, species/taxonomy, relation constraints, sources, and desired output table(s). Ask if ambiguous, e.g. about including ontology descendants.

2. **Resolve ontology concepts**:
   - Search names: `POST /terms/search`
   - Lookup IDs: `POST /terms`
   - Optional hierarchy: `GET /{ontology_id}/term/{term_id}/ancestors|descendants`
   - Use returned term IDs, e.g. `GO:0006915`. Include descendants only if requested/confirmed.

3. **Resolve entities**:
   - `POST /entities/resolve` with symbols, UniProt IDs, or public IDs.
   - Use numeric `entity_pk` values in filters.
   - If multiple matches are plausible, ask the user.

4. **Discover valid filters**:
   - Use `POST /entities/scoped-facets` and `POST /relations/scoped-facets`: returns valid facet values **with counts** for the current scope; with an empty body it acts like global discovery.
   - Use `POST /ontology/scoped-search` to find valid annotation/ontology terms globally or within selected entities.

5. **Build filters**:

   Entity filters:
   - `entity_pks`: numeric internal entity IDs from `/entities/resolve`.
   - `entity_types`: entity classes, e.g. protein, complex, small molecule; discover via `/entities/scoped-facets`.
   - `taxonomy_ids`: species/taxon IDs, e.g. `9606` for human.
   - `sources`: resources contributing entity records; discover via scoped facets.

   ```json
   {"entity_pks":[123],"entity_types":["MI:0326:Protein"],"taxonomy_ids":["9606"],"sources":["uniprot"]}
   ```

   Relation filters:
   - `entity_pks`: keep relations where subject or object is one of these entities.
   - `relation_categories`: one of `interaction`, `membership`, `annotation`.
   - `predicates`: relation verbs, e.g. `positively_regulates`; discover via `/relations/scoped-facets`.
   - `participant_types`: subject/object entity classes involved in relations.
   - `sources`: resources contributing relation records.
   - `annotation_terms`: ontology term IDs annotating relations, e.g. GO/HP/MI terms.

   ```json
   {"entity_pks":[123],"relation_categories":["interaction"],"predicates":["positively_regulates"],"participant_types":["MI:0326:Protein"],"sources":["signor"],"annotation_terms":["GO:0006915"]}
   ```

   Annotation filters:
   - `prefixes`: ontology prefixes, e.g. `GO`, `HP`, `MI`.
   - `entity_pks`: annotation terms attached to these entities.

   ```json
   {"prefixes":["GO"],"entity_pks":[123]}
   ```

   Avoid deprecated `search_*` fields. Normally do **not** use `annotation_scopes`; `annotation_terms` is enough.

6. **Preview before export**:
   - `POST /entities/slice`
   - `POST /relations/slice`
   - Use `limit: 5` first. Check status, `total`, and row plausibility.

7. **Export parquet**:
   - `POST /exports/entities/parquet`
   - `POST /exports/relations/parquet`
   - `POST /exports/annotations/parquet`

   Save the exact JSON payload next to the parquet for reproducibility.

8. **Validate parquet**:

   ```python
   import polars as pl
   df = pl.read_parquet("subset.parquet")
   print(df.shape)
   print(df.head())
   ```

   If available, report `X-Export-Row-Count`, `X-Export-Duration-Ms`, and output path.
