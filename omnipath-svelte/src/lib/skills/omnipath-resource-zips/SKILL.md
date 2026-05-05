---
name: omnipath-resource-zips
description: Download and reuse complete OmniPath per-resource zip archives, unpack their parquet files locally, and analyze resource-specific graph data with entity/relation/evidence joins. Use when the user asks to work with individual OmniPath resources directly rather than filtered API subsets.
---

# OmniPath Resource Zips

Use this skill when the user wants complete data from one or more individual OmniPath resources, e.g. SIGNOR, Reactome, IntAct, UniProt, CORUM.

## Rule

Prefer resource zips for full-resource, offline, repeatable analysis. Prefer subset exports when the user wants a small filtered slice.

## Setup

Use the API service only.

```bash
API_BASE=${API_BASE:-https://dev.omnipathdb.org/api}
DATA_DIR=${DATA_DIR:-omnipath-data}
mkdir -p "$DATA_DIR"
curl -fsS "$API_BASE/health"
```

## Workflow

1. **List resources**:

   ```bash
   curl -sS "$API_BASE/resources"
   ```

   Use the returned `resource_id` values exactly.

2. **Download resource zip(s)**:

   Single resource:
   ```bash
   curl -L "$API_BASE/resources/{resource_id}/download" \
     -o "$DATA_DIR/{resource_id}.zip"
   ```

   Multiple resources as one bundle:
   ```bash
   curl -L "$API_BASE/resources/download" \
     -H 'Content-Type: application/json' \
     -o "$DATA_DIR/resources_bundle.zip" \
     -d '{"resource_ids":["signor","reactome"]}'
   ```

3. **Reuse downloads**:
   - Save all zips under `omnipath-data/`.
   - If a zip already exists and the user did not request refresh, reuse it.

4. **Unpack/read parquet locally**:

   ```bash
   unzip -n "$DATA_DIR/signor.zip" -d "$DATA_DIR/signor"
   find "$DATA_DIR/signor" -name '*.parquet'
   ```

5. **Understand graph files**:
   - `entity.parquet`: nodes/entities.
   - `entity_relation.parquet`: edges/relations.
   - `entity_relation_evidence.parquet`: provenance/evidence for relations.

6. **Join safely**:
   - Within one resource, join relations to entities by local `entity_pk`.
   - Across different resource zips, do **not** join by `entity_pk`; those IDs are resource-local.
   - Cross-resource joins should use stable identifiers such as `canonical_identifier` plus `canonical_identifier_type`.

7. **Analyze with local graph joins**:

   ```python
   import polars as pl
   root = "omnipath-data/signor"

   entities = pl.scan_parquet(f"{root}/**/entity.parquet")
   relations = pl.scan_parquet(f"{root}/**/entity_relation.parquet")
   evidence = pl.scan_parquet(f"{root}/**/entity_relation_evidence.parquet")

   graph = (
       relations
       .join(entities.select([
           pl.col("entity_pk").alias("subject_entity_pk"),
           pl.col("canonical_identifier").alias("subject_id"),
       ]), on="subject_entity_pk", how="left")
       .join(entities.select([
           pl.col("entity_pk").alias("object_entity_pk"),
           pl.col("canonical_identifier").alias("object_id"),
       ]), on="object_entity_pk", how="left")
   )

   print(graph.limit(5).collect())
   ```