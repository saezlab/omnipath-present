"""Facet-registration consistency (Milestone H / FR-026).

The derived classification facets must be registered in BOTH the api-service
(`facets.py::CLASSIFICATION_FACETS`) and the SvelteKit entity query
(`entity.ts` `addFacetFilter(..., "<facet>", ...)`), since there is no shared
registry — a divergence would let one surface filter by a facet the other can't.
No DB required.
"""

from __future__ import annotations

import re
from pathlib import Path

_HERE = Path(__file__).resolve()
_API_FACETS = _HERE.parents[1] / 'api_service' / 'facets.py'
_SVELTE_ENTITY = (
    _HERE.parents[2]
    / 'omnipath-svelte' / 'src' / 'lib' / 'server' / 'queries' / 'entity.ts'
)

_EXPECTED = {'chemical_class', 'metabolic_domain', 'structural_specificity'}


def _api_classification_facets() -> set[str]:
    text = _API_FACETS.read_text(encoding='utf-8')
    match = re.search(r'CLASSIFICATION_FACETS\s*=\s*\(([^)]*)\)', text)
    assert match, 'CLASSIFICATION_FACETS not found in facets.py'
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def _svelte_classification_facets() -> set[str]:
    text = _SVELTE_ENTITY.read_text(encoding='utf-8')
    registered = set(
        re.findall(r'addFacetFilter\(\s*"[^"]+"\s*,\s*"([^"]+)"', text)
    )
    return registered & _EXPECTED


def test_api_registers_all_classification_facets():
    assert _api_classification_facets() == _EXPECTED


def test_svelte_registers_all_classification_facets():
    assert _svelte_classification_facets() == _EXPECTED


def test_both_surfaces_agree():
    assert _api_classification_facets() == _svelte_classification_facets()
