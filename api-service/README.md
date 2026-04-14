# API Service

REST API for querying biological ontologies using [ontograph](https://github.com/saezlab/ontograph).

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

For resource download endpoints, point the service at the gold resource root if it is not auto-detected:

```bash
export OMNIPATH_GOLD_ROOT=/path/to/omnipath_build/data_v2/gold
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
| POST | `/entity-lookup` | Resolve raw identifiers to candidate entity IDs and attached entity documents |

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

### Data Export
| Method | Path | Description |
|--------|------|-------------|
| POST | `/exports/interactions/parquet` | Export filtered interactions as Parquet subset |
| POST | `/exports/entities/parquet` | Export filtered entities as Parquet subset |
| POST | `/exports/associations/parquet` | Export filtered associations as Parquet subset |
| GET | `/resources/{resource_id}/download` | Download the current gold artifact set for one resource |
| POST | `/resources/download` | Bundle multiple selected resource gold artifact sets into one zip |

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
