"""Configuration for ontology sources."""

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class OntologyConfig:
    """Configuration for an ontology source."""
    source: str  # File path, URL, or OBO Foundry ID
    description: str
    preload: bool = False  # If True, load at startup


# Data directory for local OBO files
DATA_DIR = os.getenv("ONTOLOGY_DATA_DIR", "./data")


def _discover_local_ontologies(data_dir: str) -> dict[str, OntologyConfig]:
    result: dict[str, OntologyConfig] = {}
    path = Path(data_dir)
    if not path.exists():
        return result

    seen: set[Path] = set()
    for root, _dirs, files in os.walk(path, followlinks=True):
        root_path = Path(root)
        for filename in sorted(files):
            if not filename.endswith('.obo'):
                continue
            obo_path = (root_path / filename).resolve()
            if obo_path in seen:
                continue
            seen.add(obo_path)
            ontology_id = obo_path.stem
            if ontology_id in {"omnipath_mi"}:
                continue
            result[ontology_id] = OntologyConfig(
                source=str(obo_path),
                description=f"Auto-discovered local ontology: {ontology_id}",
                preload=True,
            )

    return result


# Core ontologies - preloaded at startup
CORE_ONTOLOGIES: dict[str, OntologyConfig] = {
    "omnipath": OntologyConfig(
        source=f"{DATA_DIR}/omnipath_mi.obo",
        description="OmniPath extended PSI-MI CV (combined ontology)",
        preload=True,
    ),
    "gene_ontology": OntologyConfig(
        source="go",  # OBO Foundry ID
        description="Gene Ontology",
        preload=True,
    ),
    "hpo": OntologyConfig(
        source="hp",  # OBO Foundry ID for Human Phenotype Ontology
        description="Human Phenotype Ontology",
        preload=True,
    ),
}

# Merge in all local OBO files produced by the build/output pipeline.
CORE_ONTOLOGIES.update(_discover_local_ontologies(DATA_DIR))

# Cache directory for downloaded ontologies
CACHE_DIR = os.getenv("ONTOLOGY_CACHE_DIR", "./cache")


# Map well-known term prefixes to ontology IDs for auto-detection.
# Additional local OBO ontologies are discovered dynamically in get_ontology_for_term.
PREFIX_TO_ONTOLOGY: dict[str, str] = {
    "GO": "gene_ontology",
    "MI": "omnipath",
    "OM": "omnipath",
    "HP": "hpo",
}


def get_ontology_for_term(term_id: str) -> str | None:
    """Get ontology ID from term prefix or accession pattern."""
    normalized = term_id.strip()

    if normalized.upper().startswith("WP") and normalized[2:].isdigit():
        return "wikipathways"

    if normalized.upper().startswith("R-"):
        return "reactome_pathways"

    if ":" not in normalized:
        return None

    prefix = normalized.split(":", 1)[0].upper()
    if prefix in PREFIX_TO_ONTOLOGY:
        return PREFIX_TO_ONTOLOGY[prefix]

    # Fall back to an auto-discovered local ontology whose stem matches the prefix.
    lowered = prefix.lower()
    if lowered in CORE_ONTOLOGIES:
        return lowered

    return None
