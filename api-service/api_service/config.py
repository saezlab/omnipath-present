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
ONTOLOGY_DIR = os.getenv("ONTOLOGY_DATA_DIR", "./data")

# Cache directory for downloaded ontologies
CACHE_DIR = os.getenv("ONTOLOGY_CACHE_DIR", "./cache")


def _find_obo(ontology_dir: str, *filenames: str) -> str | None:
    """Find an OBO file by name, searching recursively in the data directory."""
    root = Path(ontology_dir)
    if not root.exists():
        return None
    for filename in filenames:
        for path in root.rglob(filename):
            return str(path)
    return None


def _discover_local_ontologies(ontology_dir: str) -> dict[str, OntologyConfig]:
    result: dict[str, OntologyConfig] = {}
    path = Path(ontology_dir)
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
psi_mi_source = (
    _find_obo(ONTOLOGY_DIR, "psi_mi.obo", "psi-mi.obo")
    or _find_obo(CACHE_DIR, "psi_mi.obo", "psi-mi.obo")
    or "psi-mi"  # OBO Foundry ID
)
omnipath_source = (
    _find_obo(ONTOLOGY_DIR, "omnipath.obo", "omnipath_mi.obo")
    or f"{ONTOLOGY_DIR}/omnipath_mi.obo"
)

CORE_ONTOLOGIES: dict[str, OntologyConfig] = {
    "psi_mi": OntologyConfig(
        source=psi_mi_source,
        description="PSI-MI controlled vocabulary",
        preload=True,
    ),
    "omnipath": OntologyConfig(
        source=omnipath_source,
        description="OmniPath ontology (loaded with PSI-MI dependency when split)",
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

# Merge in all local OBO files produced by the build/output pipeline without
# clobbering the curated core IDs/aliases above.
for _ontology_id, _config in _discover_local_ontologies(ONTOLOGY_DIR).items():
    CORE_ONTOLOGIES.setdefault(_ontology_id, _config)


# Map well-known term prefixes to ontology IDs for auto-detection.
# Additional local OBO ontologies are discovered dynamically in get_ontology_for_term.
PREFIX_TO_ONTOLOGY: dict[str, str] = {
    "GO": "gene_ontology",
    "MI": "psi_mi",
    "OM": "omnipath",
    "HP": "hpo",
    "KW": "uniprot_keywords",
    "CHEBI": "chebi",
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
