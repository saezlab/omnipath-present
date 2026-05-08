# API Service

REST API for querying biological ontologies and serving graph-native OmniPath data slices/exports.

## Preloaded Ontologies

| Ontology | Terms | Description |
|----------|-------|-------------|
| OmniPath | ~300 | OmniPath controlled vocabulary |
| PSI-MI | ~3,000 | Proteomics Standards Initiative Molecular Interactions CV |
| Gene Ontology | ~45,000 | GO terms (biological process, molecular function, cellular component) |
| UniProt Keywords | ~1,200 | UniProt keyword hierarchy |

Additional ontologies from OBO Foundry are loaded on-demand.

## Quick Start

```bash
# Install dependencies
uv sync

# Run locally
uv run uvicorn api_service.main:app --reload --port 8081
```

For graph data endpoints, point the service at the combined parquet folder and Postgres database. For resource downloads, point it at the gold zip root if it is not auto-detected:

```bash
export ONTOLOGY_DATA_DIR=/path/to/omnipath_build/data/combined
export OMNIPATH_GOLD_ROOT=/path/to/omnipath_build/data/gold
export DATABASE_URL=postgresql://user:password@localhost:5432/omnipath
```

## API Endpoints

### Health & Discovery
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/ontologies` | List available ontologies |

### Term Lookup
| Method | Path | Description |
|--------|------|-------------|
| GET | `/{ontology}/term/{id}` | Get term info (name, definition) |
| POST | `/terms` | Batch term lookup |
| POST | `/terms/search` | Search ontology terms by label or synonym |

### Navigation
| Method | Path | Description |
|--------|------|-------------|
| GET | `/{ontology}/term/{id}/parents` | Direct parents |
| GET | `/{ontology}/term/{id}/ancestors` | All ancestors (`?depth=N`) |
| GET | `/{ontology}/term/{id}/children` | Direct children |
| GET | `/{ontology}/term/{id}/descendants` | All descendants (`?depth=N`) |

### Hierarchy / Tree
| Method | Path | Description |
|--------|------|-------------|
| GET | `/{ontology}/term/{id}/trajectories` | All paths from root to term |
| POST | `/tree` | Merged tree for multiple terms |

### Graph data
| Method | Path | Description |
|--------|------|-------------|
| POST | `/entities/resolve` | Resolve identifiers to numeric `entity_pk` values using Postgres |
| POST | `/entities/slice` | Return a filtered JSON slice from `entity.parquet` |
| POST | `/relations/slice` | Return a filtered JSON slice from `entity_relation.parquet` |
| POST / GET | `/exports/entities/parquet` | Export filtered entities as Parquet subset |
| POST / GET | `/exports/relations/parquet` | Export filtered relations as Parquet subset |
| GET | `/relations/{relation_pk}/evidence` | Return evidence rows for a relation |
| GET | `/relation-evidence/{relation_evidence_pk}` | Return one relation evidence row |
| GET | `/resources/{resource_id}/download` | Download `gold/<resource>/<resource>.zip` |
| POST | `/resources/download` | Bundle multiple selected resource zip archives into one zip |

Relation categories are `interaction` and `association`. Resource workspace endpoints and old `search_*.parquet` export endpoints are retired.

## Examples

```bash
# Get PSI-MI term
curl http://localhost:8081/psi_mi/term/MI:0018

# Get GO term ancestors
curl "http://localhost:8081/gene_ontology/term/GO:0008150/ancestors?depth=2"

# Get all paths from root to a term
curl http://localhost:8081/psi_mi/term/MI:0018/trajectories

# Get merged tree for multiple terms (UI grouping)
curl -X POST http://localhost:8081/psi_mi/tree \
  -H "Content-Type: application/json" \
  -d '{"term_ids": ["MI:0018", "MI:0045"]}'
```

## Tree Response

The `/tree` endpoint merges multiple term paths into a single tree with shared ancestors:

```json
{
  "root": {
    "id": "MI:0000",
    "name": "molecular_interaction",
    "distance": -2,
    "children": [
      {
        "id": "MI:0001",
        "name": "interaction_detection_method",
        "distance": -1,
        "children": [...]
      }
    ]
  }
}
```

## Docker

```bash
docker build -t api-service .
docker run -p 8081:8081 api-service
```
