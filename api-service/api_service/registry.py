"""Ontology registry with preload and lazy-load support."""

import logging
from pathlib import Path
from typing import Any

try:
    from ontograph.client import ClientOntology
except ModuleNotFoundError:  # pragma: no cover - only used in minimal test/dev envs
    ClientOntology = Any

from .config import CORE_ONTOLOGIES, CACHE_DIR, OntologyConfig

ONTOLOGY_ALIASES = {
    # Accept the OBO Foundry-style PSI-MI ID as an API alias.
    "psi-mi": "psi_mi",
}

logger = logging.getLogger(__name__)


class OntologyRegistry:
    """Manages multiple ontologies with preload and lazy-load support.
    
    Core ontologies are preloaded at startup.
    Other ontologies are loaded on-demand and cached.
    """
    
    def __init__(self, cache_dir: str = CACHE_DIR):
        self._cache_dir = Path(cache_dir)
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._ontologies: dict[str, ClientOntology] = {}
        self._configs: dict[str, OntologyConfig] = dict(CORE_ONTOLOGIES)
    
    def preload_core_ontologies(self) -> None:
        """Preload all core ontologies at startup."""
        for ontology_id, config in CORE_ONTOLOGIES.items():
            if config.preload:
                logger.info(f"Preloading ontology: {ontology_id}")
                try:
                    self._load_ontology(ontology_id, config)
                    logger.info(f"Successfully loaded: {ontology_id}")
                except Exception as e:
                    logger.error(f"Failed to load {ontology_id}: {e}")
    
    def _source_has_term_prefix(self, source: str, prefix: str) -> bool:
        path = Path(source)
        if not path.exists() or not path.is_file():
            return False
        needle = f"id: {prefix}:"
        try:
            with path.open("r", encoding="utf-8", errors="ignore") as handle:
                return any(line.startswith(needle) for line in handle)
        except OSError:
            return False

    def _standalone_omnipath_source(self, omnipath_source: str) -> str:
        """Return a loadable standalone OmniPath OBO source.

        The build now emits PSI-MI and OmniPath as separate files. Some OM terms
        still carry ``is_a: MI:*`` parent links, but pronto requires referenced
        parents to be present in the same file. Keep the ontologies separate by
        removing those cross-ontology parent edges from a cache-local copy.
        """
        if not self._source_has_term_prefix(omnipath_source, "OM"):
            return omnipath_source

        path = Path(omnipath_source)
        if not path.exists() or not path.is_file():
            return omnipath_source

        standalone = self._cache_dir / "omnipath_standalone.obo"
        try:
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
            filtered = [line for line in lines if not line.startswith("is_a: MI:")]
            standalone.write_text("\n".join(filtered) + "\n", encoding="utf-8")
            return str(standalone)
        except OSError as exc:
            logger.warning("Failed to build standalone OmniPath OBO: %s", exc)
            return omnipath_source

    def _load_ontology(self, ontology_id: str, config: OntologyConfig) -> ClientOntology:
        """Load an ontology from its source."""
        if ClientOntology is Any:
            raise RuntimeError("ontograph is not installed")
        source = (
            self._standalone_omnipath_source(config.source)
            if ontology_id == "omnipath"
            else config.source
        )
        client = ClientOntology(cache_dir=str(self._cache_dir))
        client.load(source=source, backend="pronto")
        self._ontologies[ontology_id] = client
        return client
    
    def get(self, ontology_id: str) -> ClientOntology | None:
        """Get an ontology client by ID.
        
        Returns cached client if available, otherwise loads on-demand.
        Returns None if ontology is not configured.
        """
        ontology_id = ONTOLOGY_ALIASES.get(ontology_id, ontology_id)

        # Return cached
        if ontology_id in self._ontologies:
            return self._ontologies[ontology_id]
        
        # Load on-demand if configured
        if ontology_id in self._configs:
            config = self._configs[ontology_id]
            try:
                return self._load_ontology(ontology_id, config)
            except Exception as e:
                logger.error(f"Failed to load {ontology_id}: {e}")
                return None
        
        # Try loading from OBO Foundry catalog
        logger.info(f"Attempting to load {ontology_id} from OBO Foundry")
        try:
            config = OntologyConfig(
                source=ontology_id,  # OBO Foundry ID
                description=f"On-demand: {ontology_id}",
                preload=False,
            )
            self._configs[ontology_id] = config
            return self._load_ontology(ontology_id, config)
        except Exception as e:
            logger.error(f"Failed to load {ontology_id} from OBO Foundry: {e}")
            return None
    
    def list_available(self) -> dict[str, str]:
        """List all available ontologies with descriptions."""
        return {
            ontology_id: config.description
            for ontology_id, config in self._configs.items()
        }
    
    def is_loaded(self, ontology_id: str) -> bool:
        """Check if an ontology is currently loaded."""
        return ontology_id in self._ontologies


# Global registry instance
registry = OntologyRegistry()
