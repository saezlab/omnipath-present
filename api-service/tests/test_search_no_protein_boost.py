"""Entity search must not preferentially rank protein-typed nodes.

The canonicalised graph is uniformly gene-typed — a gene product is a gene, with
its protein form recorded as a state — so the old search-scoring bonus for
``Protein:MI:0326`` nodes is obsolete: it would only skew ranking toward a node
type that no longer carries the base interactions. This guards against the bonus
being reintroduced into the entity-resolution scoring. No DB required.
"""

from __future__ import annotations

import re
from pathlib import Path

_GRAPH = Path(__file__).resolve().parents[1] / 'api_service' / 'graph.py'


def test_search_scoring_has_no_protein_entity_type_bonus():
    text = _GRAPH.read_text(encoding='utf-8')
    # A per-entity-type score bonus keyed on the protein CV accession, e.g.
    #   + CASE WHEN <entity_type> = 'Protein:MI:0326' THEN 10 ELSE 0 END
    offenders = re.findall(
        r"CASE\s+WHEN[^\n]*'Protein:MI:0326'[^\n]*THEN\s+\d+", text
    )
    assert not offenders, (
        'entity search should not boost Protein:MI:0326 nodes; '
        f'found: {offenders}'
    )
