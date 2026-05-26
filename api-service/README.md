# API Service

REST API for querying biological ontologies and the Postgres-backed OmniPath graph.

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

For graph data endpoints, point the service at the Postgres database and schema:

```bash
export DATABASE_URL=postgresql://user:password@localhost:5432/omnipath
export OMNIPATH_PG_SCHEMA=public
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
| POST | `/entities/resolve` | Resolve exact identifier values through `identifier_evidence` and `entity_identifier_lookup`, returning ranked candidates with identifiers, type, taxon, sources, and relation counts |
| POST / GET | `/entities/search` | Search matching entities by exact identifier/name, with optional type, taxon, source, and annotation filters |
| POST | `/entities/by-pks` | Hydrate numeric entity primary keys into entity records and identifiers |
| POST / GET | `/relations/search` | Search relations by entity scope, predicate, category, source, participant type, taxonomy, or ontology term |
| GET | `/relations/{relation_id}` | Return one relation with subject/object entity records |
| GET | `/relations/{relation_id}/evidence` | Return evidence rows and annotations for one relation |
| POST / GET | `/ontology/scoped-search` | Search ontology terms by label, ID, ontology ID, selected entities, or selected terms |
| POST | `/ontology/entities` | Return entities annotated by one or more ontology term IDs |
| POST | `/entities/scoped-facets` | Return entity facet counts for current scope/filters |
| POST | `/relations/scoped-facets` | Return relation facet counts for current scope/filters |
| GET | `/sources` | Return available source values with entity/relation counts |
| GET | `/resources` | Return resource metadata from Postgres |

Relation categories are `interaction` and `association`. Parquet export, slice, and resource zip download endpoints are retired from the active API. The old implementation is archived under `api_service/archive/` for reference.

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

# Resolve exact protein identifiers. Ambiguous matches include candidates for user disambiguation.
curl -X POST http://localhost:8081/entities/resolve \
  -H "Content-Type: application/json" \
  -d '{"identifiers":["TP53","P04637"],"filters":{"entityTypes":["Protein:MI:0326"]},"preferredTaxonomyIds":["9606"]}'

# Search exact entity identifiers with additional filters.
curl -X POST http://localhost:8081/entities/search \
  -H "Content-Type: application/json" \
  -d '{"query":"TP53","filters":{"taxonomyIds":["9606"]},"limit":5}'

# Search interactions involving resolved entities and selected predicates
curl -X POST http://localhost:8081/relations/search \
  -H "Content-Type: application/json" \
  -d '{"filters":{"entityPks":[128747],"relationCategories":["interaction"],"predicates":["positively_regulates"]},"limit":20}'

# Search interactions where at least one participant has the selected taxonomy
curl -X POST http://localhost:8081/relations/search \
  -H "Content-Type: application/json" \
  -d '{"filters":{"taxonomyIds":["9606"]},"limit":20}'

# Search ontology terms, then expand a term to annotated entities
curl -X POST http://localhost:8081/ontology/scoped-search \
  -H "Content-Type: application/json" \
  -d '{"query":"phosphorylation","limit":5}'

curl -X POST http://localhost:8081/ontology/entities \
  -H "Content-Type: application/json" \
  -d '{"termIds":["KW-0597"],"filters":{"sources":["signor"],"taxonomyIds":["9606"]},"limit":20}'

# Discover source filter values
curl http://localhost:8081/sources

# Fetch evidence and annotations for a relation
curl http://localhost:8081/relations/1192857/evidence
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
