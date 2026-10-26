"""A second identifier per endpoint: the namespaces a caller asks to be named in.

`entity.canonical_identifier` is one string holding one namespace, and which
namespace it holds is the build's choice rather than the caller's. The column
mixes namespaces inside one dataset — a chemical end leads with an InChIKey and
a protein end with a gene id — and position does not disambiguate it. So a
request may name the namespaces it wants each end reported in, and gets an
array per namespace per node beside the canonical identifier rather than
instead of it.

**Every field is an array, and that is a property of the data rather than a
style.** UniProt averages 2.78 values per endpoint over this build and reaches
275 on one of them; SSTR2 below carries seven. There is no stored consensus to
collapse them to: `gene_protein_representative`, the only table that ever held
a representative accession, has no rows. A scalar would therefore be a
lexicographic pick among equals presented as a choice, which is worse than no
scalar at all.

**`[]` is the one spelling for absence**, T098's rule applied to a field whose
type has an empty form. A namespace the request names reaches every node of
every row whether or not the build holds a mapping for it, because a key that
appears on the chemical rows and not the protein ones is a column a frame
consumer cannot read.

**The two fixtures are real and one interaction carries both ends.**
Prosomatostatin acts on SSTR2 in STITCH: the chemical end has an InChIKey and
one HMDB id and **no ChEBI at all**, which is the acceptance sentence's "and
whichever of HMDB or ChEBI resolved" and the `[]` case on the same row; the
protein end is Entrez-canonical and carries seven UniProt accessions, which is
the multiplicity case and the defect the task names — a caller asking for
UniProt on that endpoint used to get `6752`.

    DATABASE_URL=... pytest tests/test_interactions_endpoint_identifiers.py -v
"""

from __future__ import annotations

import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason = 'DATABASE_URL not set; the identifier read needs a built DB',
)

#: The resource asserting the fixture pair. It is in the MetaLinksDB preset's
#: scope, and the pair is also asserted by BindingDB, which the preset
#: excludes — so the row survives that exclusion through STITCH.
RESOURCE = 'stitch'

#: `Prosomatostatin`, InChIKey-canonical: one InChIKey, one HMDB id, no ChEBI.
CHEMICAL = 'b4cf8803-1a37-207f-740d-9897b0c72375'
CHEMICAL_INCHIKEY = 'GGYTXJNZMFRSLX-UHFFFAOYSA-N'
CHEMICAL_HMDB = 'HMDB0247329'

#: `SSTR2`, Entrez-canonical: one gene id and seven UniProt accessions.
PROTEIN_GENE_ID = '6752'
PROTEIN_UNIPROT = 'P30874'
PROTEIN_UNIPROTS = 7

#: The selector both acceptance sentences are written against, in the spelling
#: a query string carries.
SELECTOR = (
    'protein:uniprot,protein:entrez,'
    'chemical:inchikey,chemical:hmdb,chemical:chebi'
)

#: The columns that selector puts on each side, in the same order.
SELECTED = ('uniprots', 'gene_ids', 'inchikeys', 'hmdbs', 'chebis')

#: The two sides, as the tabular output names them.
SIDES = ('source', 'target')

#: A slug no namespace of this build answers to.
UNKNOWN_SLUG = 'mygeneinfo'

#: A page wide enough to hold both kinds of endpoint several times over.
PAGE = 50


@pytest.fixture(scope = 'module')
def db():
    """An open read-only connection to the built database."""

    pytest.importorskip('psycopg')

    import psycopg
    from psycopg.rows import dict_row

    conn = psycopg.connect(DATABASE_URL, row_factory = dict_row)

    try:

        yield conn

    finally:

        conn.close()


def _run(db, payload: dict[str, Any]) -> dict[str, Any]:
    """Answer one request through the engine, on the test's own connection.

    Args:
        db: An open connection.
        payload: The request.

    Returns:
        The engine's answer.
    """

    from api_service.interactions import engine

    return engine.run(payload, conn = db)


def _fixture_page(db, **extra: Any) -> list[dict[str, Any]]:
    """The rows naming the chemical fixture, as one resource asserts them.

    Args:
        db: An open connection.
        extra: Further request terms.

    Returns:
        The rows.
    """

    return _run(
        db,
        {
            'filters': {'resources': [RESOURCE], 'entities': [CHEMICAL]},
            'limit': PAGE,
            **extra,
        },
    )['interactions']


def _ends(rows: list[dict[str, Any]], column: str, value: Any) -> list[tuple]:
    """Every (row, side) whose end carries one value in one column.

    Args:
        rows: The page.
        column: The column suffix to read, without the side.
        value: The value to look for.

    Returns:
        `(row, side)` pairs.
    """

    return [
        (row, side) for row in rows for side in SIDES
        if value in (row.get(f'{side}_{column}') or ())
    ]


@pytest.fixture(scope = 'module')
def selected_rows(db) -> list[dict[str, Any]]:
    """The fixture's page, with both acceptance sentences' namespaces named."""

    rows = _fixture_page(db, identifiers = SELECTOR)

    if not rows:

        pytest.skip(f'{RESOURCE} returned no row naming the chemical fixture')

    return rows


# ── The two acceptance sentences ────────────────────────────────────────────


def test_a_protein_endpoint_reports_uniprot_and_entrez_together(selected_rows):
    """The defect, on a row a test can pin: `6752` *and* its accessions.

    The endpoint is Entrez-canonical, so a caller who wanted UniProt used to
    get a gene id and nothing beside it. Membership and length are asserted
    rather than equality to a one-element list, because seven accessions is
    the point: there is no best one stored to choose among them.
    """

    found = _ends(selected_rows, 'gene_ids', PROTEIN_GENE_ID)

    assert found, (
        f'no end of this page reports the gene id {PROTEIN_GENE_ID}, so the '
        f'fixture the rest of this file is written against is not on it'
    )

    for row, side in found:

        accessions = row[f'{side}_uniprots']

        assert PROTEIN_UNIPROT in accessions, (
            f'{side} reports gene {PROTEIN_GENE_ID} and the accessions '
            f'{accessions}, which do not include {PROTEIN_UNIPROT}'
        )
        assert len(accessions) == PROTEIN_UNIPROTS, (
            f'the endpoint carries {PROTEIN_UNIPROTS} UniProt accessions and '
            f'{len(accessions)} came back; a renderer that collapsed them '
            f'would have picked one arbitrarily'
        )


def test_a_chemical_endpoint_reports_its_inchikey_and_whichever_resolved(selected_rows):
    """The InChIKey, the HMDB id it has, and `[]` for the ChEBI it has not.

    Both halves of the sentence are on one end of one row, which is what makes
    this the acceptance: the namespace that resolved and the namespace that did
    not are rendered side by side, in the same shape.
    """

    found = _ends(selected_rows, 'inchikeys', CHEMICAL_INCHIKEY)

    assert found, f'no end of this page reports the InChIKey {CHEMICAL_INCHIKEY}'

    for row, side in found:

        assert row[f'{side}_hmdbs'] == [CHEMICAL_HMDB]
        assert row[f'{side}_chebis'] == [], (
            f'{side} carries no ChEBI accession in this build and came back '
            f'with {row[f"{side}_chebis"]!r}'
        )


def test_a_namespace_with_no_mapping_renders_the_empty_array_not_a_missing_key(
        selected_rows,
):
    """T098's rule: every namespace named, on every node, empty or filled.

    The chemical namespaces are absent from a protein end and the protein ones
    from a chemical end, and neither absence is allowed to be a missing key.
    A frame consumer reads columns, and a column that exists on half a page is
    not one.
    """

    for row in selected_rows:

        for side in SIDES:

            for column in SELECTED:

                name = f'{side}_{column}'

                assert name in row, f'{name} is absent from a row'
                assert isinstance(row[name], list), (
                    f'{name} came back as {type(row[name]).__name__}; the '
                    f'empty value of this field is [] and never null'
                )


def test_a_namespace_field_is_a_list_even_where_one_value_resolved(selected_rows):
    """One value is a one-element array, never a bare string."""

    single = [
        row[f'{side}_{column}']
        for row in selected_rows
        for side in SIDES
        for column in SELECTED
        if len(row[f'{side}_{column}'] or ()) == 1
    ]

    assert single, 'no endpoint on this page resolved exactly one value'

    for values in single:

        assert isinstance(values, list) and len(values) == 1


# ── What naming a namespace may not change ──────────────────────────────────


def test_the_selector_does_not_change_the_row_set(db, selected_rows):
    """A projection selects no different keys, exactly as `view` does not."""

    def keys(rows: list[dict[str, Any]]) -> list[tuple]:

        return [
            (
                str(row['subject_entity_id']),
                str(row['object_entity_id']),
                int(row['interaction_class_id']),
            )
            for row in rows
        ]

    assert keys(_fixture_page(db)) == keys(selected_rows), (
        'naming a namespace changed which interactions came back, so the '
        'selector is a filter rather than a projection'
    )


def test_a_namespace_nobody_asked_for_reaches_no_column(db):
    """A namespace costs a column on the request that names it and no other."""

    rows = _fixture_page(db, identifiers = 'chemical:hmdb')

    assert rows, 'the one-namespace request returned no row'

    for row in rows:

        for side in SIDES:

            assert f'{side}_hmdbs' in row
            assert f'{side}_chebis' not in row, (
                'a namespace the request never named came back as a column, '
                'so the vocabulary is rendered rather than the selector'
            )


def test_the_selector_reaches_the_participants_array(db):
    """The nested form carries the same arrays, with the side stripped off.

    The array is named in the request because it is rebuildable over an
    ordered pair, where it is the flat columns rearranged, and it left the
    default row for that reason.
    """

    rows = _fixture_page(
        db, identifiers = SELECTOR, attributes = ['participants'],
    )

    assert rows, 'the request naming the participant array returned no row'

    for row in rows:

        for side, participant in zip(SIDES, row['participants']):

            for column in SELECTED:

                assert participant[column] == row[f'{side}_{column}'], (
                    f'{column} disagrees between the flat pair and the '
                    f'participant array, so one of the two was rendered twice'
                )


def test_an_unknown_namespace_slug_is_dropped_rather_than_refused(db):
    """FR-045: an unknown projection target is empty, never a 4xx.

    It reaches no column either, because there is no column to name: a slug
    the build cannot resolve has no stored namespace and no suffix. What it
    must not do is refuse the request or take the namespaces beside it away.
    """

    rows = _fixture_page(db, identifiers = f'chemical:{UNKNOWN_SLUG},chemical:hmdb')

    assert rows, 'an unknown namespace slug cost the caller the whole page'

    for row in rows:

        for side in SIDES:

            assert f'{side}_hmdbs' in row, (
                'an unknown slug took the namespace named beside it away'
            )
            assert f'{side}_{UNKNOWN_SLUG}s' not in row


# ── The two routes ──────────────────────────────────────────────────────────


def test_the_dataset_sugar_route_does_not_drop_the_selector(db, selected_rows):
    """`/interactions/{dataset}` declares its own parameters and loses what it
    does not name, which is how `exclude_resources` went missing from it.

    The engine is reached directly rather than over HTTP, so what is asserted
    is that the dataset path renders the selector at all — the route's own
    parameter list is asserted by reading the signature, because a parameter
    FastAPI never binds cannot be observed in an answer.
    """

    from inspect import signature

    from api_service import main

    for route in (main.get_interactions, main.get_interactions_dataset):

        assert 'identifiers' in signature(route).parameters, (
            f'{route.__name__} declares no `identifiers` parameter, so the '
            f'route silently drops it'
        )

    rows = _run(
        db,
        {
            'filters': {
                'resources': [RESOURCE],
                'entities': [CHEMICAL],
                'datasets': ['metalinksdb'],
            },
            'identifiers': SELECTOR,
            'limit': PAGE,
        },
    )['interactions']

    assert rows, 'the preset returned no row naming the chemical fixture'

    for row in rows:

        for column in SELECTED:

            assert f'source_{column}' in row and f'target_{column}' in row


# ── Discovery ───────────────────────────────────────────────────────────────


def test_the_selector_is_a_projection_parameter_of_its_own(db):
    """It is not a name in `attributes`, and the parameter groups say so."""

    from api_service.interactions import params

    assert 'identifiers' in params.PARAMETER_GROUPS['projection']
    assert 'identifiers' not in params.PARAMETER_GROUPS['selection']
