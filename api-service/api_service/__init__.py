"""API service package."""

# Configures the logging tree for the whole package; must stay first and must
# not be removed, or every module falls back to the host's logging config.
from ._session import session as _session

__version__ = "0.1.0"

__all__ = ["__version__"]
