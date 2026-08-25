"""What a caller can learn about a dataset without reading its definition.

A dataset here is a registry row, not a query function, and the whole promise
of that arrangement is that a consumer can *discover* one. Discovery is not a
convenience: a client that has to be told out of band which datasets exist,
what each one scopes to, and which fields it always returns is a client coupled
to the build's source tree. So the registry has to answer four questions per
dataset over the wire — what it is called, what kind of thing it is, what it
selects, and what it returns — and this file pins all four.

It also pins the one attribute rule that has no other guard. A dataset's
**default** attributes are what a caller gets for asking nothing, and a caller
who asks for something else replaces them. Its **mandatory** attributes are
different in kind: they are the fields the dataset's contract promises, so they
survive a request that names other fields. Nothing else in the suite asserts
that difference, and the difference is one line of engine code — exactly the
shape of rule that regresses silently.

Two things are deliberately *not* asserted here. The values a particular
dataset declares belong to that dataset's own contract test, so this file reads
them from the registry rather than writing them down. And the enumeration is
not given a route of its own: it belongs beside the other reachable values,
where a caller already looks to find out what a parameter accepts.

    DATABASE_URL=... pytest tests/test_interactions_registry.py -v
"""

from __future__ import annotations

import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason = 'DATABASE_URL not set; dataset discovery needs a built registry',
)

#: The four questions the enumeration answers, as the field carrying each.
#: `kind` is what the dataset is, `included_sources` and
#: `interaction_class_scope` are what it selects, and the two attribute lists
#: are what it returns.
SPEC_FIELDS = (
    'kind',
    'included_sources',
    'interaction_class_scope',
    'default_attributes',
    'mandatory_attributes',
)

#: The fold a dataset declares. A caller comparing two datasets' row counts
#: needs it, because the counts are not comparable across modes.
COLLAPSE_FIELD = 'collapse_mode'

#: The columns of `network_registry` that describe a matview rather than a
#: preset. They are on their way out, and a caller must not learn to read them.
MATVIEW_ERA_FIELDS = ('schema_name', 'combined_relation')

#: A small page, because these tests read the dataset spec and not its rows.
PAGE = 5


@pytest.fixture(scope = 'module')
def client():
    """A test client over the running app."""

    pytest.importorskip('fastapi')
    pytest.importorskip('psycopg')

    from fastapi.testclient import TestClient

    from api_service.main import app

    return TestClient(app)


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


@pytest.fixture(scope = 'module')
def registered(db) -> dict[str, dict[str, Any]]:
    """Every dataset the build registered, read from the registry itself.

    The expectations come from the table rather than from this file, so a
    cycle that registers a further dataset extends the assertions instead of
    breaking them.

    Args:
        db: An open connection to the built database.

    Returns:
        `{name: row}` for every registered dataset.
    """

    rows = db.execute(
        f"""
        SELECT name, kind, included_sources, interaction_class_scope,
               default_attributes, mandatory_attributes, collapse_mode,
               attribute_sources, composition
        FROM {SCHEMA}.network_registry
        ORDER BY name
        """
    ).fetchall()

    assert rows, (
        'no dataset is registered, so every assertion below would pass '
        'vacuously; run the build before this file'
    )

    return {row['name']: dict(row) for row in rows}


@pytest.fixture(scope = 'module')
def enumerated(client) -> dict[str, dict[str, Any]]:
    """The datasets as the service enumerates them.

    Returns:
        `{name: entry}` for every dataset the enumeration names.
    """

    response = client.get(
        '/interactions/parameter-values', params = {'parameters': 'datasets'},
    )

    assert response.status_code == 200, (
        f'the parameter surface does not answer: {response.status_code} '
        f'{response.text[:400]}'
    )

    entry = response.json()['parameters']['datasets']

    return {item['value']: item for item in entry.get('values', [])}


def test_every_registered_dataset_is_enumerated(registered, enumerated):
    """A dataset the build registered is a dataset a caller can find."""

    assert set(enumerated) == set(registered), (
        f'the enumeration names {sorted(enumerated)} and the registry holds '
        f'{sorted(registered)}; a dataset missing from the enumeration is '
        f'reachable only by a caller who already knew its name'
    )


@pytest.mark.parametrize('field', SPEC_FIELDS)
def test_the_enumeration_carries_the_dataset_spec(registered, enumerated, field):
    """Name, kind, scope and attribute contract all arrive over the wire."""

    missing = [name for name, item in enumerated.items() if field not in item]

    assert not missing, (
        f'{missing} are enumerated without {field!r}, so a client cannot tell '
        f'what they select or return without reading the build; that is the '
        f'coupling the registry exists to remove'
    )


@pytest.mark.parametrize('field', SPEC_FIELDS)
def test_the_enumerated_spec_matches_the_registry(registered, enumerated, field):
    """The enumeration reports what was registered, not a default of its own."""

    for name, item in enumerated.items():

        stored = registered[name][field]
        served = item[field]

        if isinstance(stored, list) or isinstance(served, list):

            assert sorted(served or []) == sorted(stored or []), (
                f'{name} is enumerated with {field} {served!r} and registered '
                f'with {stored!r}'
            )

        else:

            assert served == stored, (
                f'{name} is enumerated with {field} {served!r} and registered '
                f'with {stored!r}'
            )


def test_the_enumeration_names_the_fold(registered, enumerated):
    """A dataset says how it folds, because its row count means nothing without."""

    for name, item in enumerated.items():

        assert item.get(COLLAPSE_FIELD) == registered[name][COLLAPSE_FIELD], (
            f'{name} does not report its collapse mode; two datasets folding '
            f'differently return counts a caller would otherwise compare'
        )


def test_the_enumeration_hides_the_matview_era_columns(enumerated):
    """The columns on their way out are not part of the public answer."""

    for name, item in enumerated.items():

        leaked = [field for field in MATVIEW_ERA_FIELDS if field in item]

        assert not leaked, (
            f'{name} is enumerated with {leaked}, which describe a matview and '
            f'retire with the last one; a client that learns to read them '
            f'breaks when they go'
        )


def test_a_composed_dataset_says_it_is_composed(registered, enumerated):
    """A dataset assembled from components is not passed off as one query."""

    composed = [
        name for name, row in registered.items() if row['composition'] is not None
    ]

    if not composed:

        pytest.skip('no dataset is registered as a composition yet')

    for name in composed:

        assert enumerated[name].get('composition'), (
            f'{name} is a composition in the registry and is enumerated as a '
            f'plain parameter set; a caller reproducing it from its scope '
            f'alone gets a different row set'
        )


def test_every_enumerated_dataset_answers(client, enumerated):
    """Enumerable and queryable are the same claim, so both are asserted."""

    for name in enumerated:

        response = client.get(f'/interactions/{name}', params = {'limit': PAGE})

        assert response.status_code == 200, (
            f'{name} is enumerated and does not answer: '
            f'{response.status_code} {response.text[:300]}'
        )


#: How a node-level attribute reaches the row. The classification belongs to
#: an endpoint rather than to the interaction, so it arrives once per side
#: under a prefixed name rather than once under the name that was requested.
SIDE_PREFIXES = ('source_', 'target_', 'subject_', 'object_')


def _fields(rows: list[dict[str, Any]]) -> set[str]:
    """Every field name the rows of a page carry.

    Args:
        rows: One page of interactions.

    Returns:
        The union of the row keys.
    """

    return {key for row in rows for key in row}


def _served(name: str, fields: set[str]) -> bool:
    """Whether a requested attribute reached the row under any of its names.

    Args:
        name: The attribute as the dataset declares it.
        fields: The field names the page carries.

    Returns:
        True when the attribute is on the row directly, or on either endpoint
        under a side prefix, or as a further layer named after it.
    """

    return any(
        field == name
        or field.startswith(f'{name}_')
        or any(
            field == f'{prefix}{name}' or field.startswith(f'{prefix}{name}_')
            for prefix in SIDE_PREFIXES
        )
        for field in fields
    )


@pytest.fixture(scope = 'module')
def with_mandatory(registered) -> str:
    """One dataset that declares a mandatory attribute.

    Returns:
        Its name, or a skip when no dataset declares one.
    """

    for name, row in sorted(registered.items()):

        if row['mandatory_attributes']:

            return name

    pytest.skip('no dataset declares a mandatory attribute yet')


def test_a_mandatory_attribute_appears_unrequested(
        client, registered, with_mandatory,
):
    """Asking for nothing still returns what the dataset promises."""

    response = client.get(
        f'/interactions/{with_mandatory}', params = {'limit': PAGE},
    )

    assert response.status_code == 200, response.text[:300]

    rows = response.json()['interactions']

    assert rows, f'{with_mandatory} returns no row to check'

    served = _fields(rows)
    promised = registered[with_mandatory]['mandatory_attributes']

    missing = [name for name in promised if not _served(name, served)]

    assert not missing, (
        f'{with_mandatory} promises {promised} and serves {missing} nowhere'
    )


def test_a_mandatory_attribute_survives_a_narrower_request(
        client, registered, with_mandatory,
):
    """A caller naming other fields does not lose the dataset's own contract.

    This is where mandatory and default part company. Naming an attribute
    replaces the defaults, which is what a default is for. It must not replace
    the fields the dataset guarantees, or a consumer written against the
    contract breaks the moment it asks for one extra column.
    """

    response = client.get(
        f'/interactions/{with_mandatory}',
        params = {'limit': PAGE, 'attributes': 'is_directed'},
    )

    assert response.status_code == 200, response.text[:300]

    rows = response.json()['interactions']

    assert rows, f'{with_mandatory} returns no row to check'

    served = _fields(rows)
    promised = registered[with_mandatory]['mandatory_attributes']

    missing = [name for name in promised if not _served(name, served)]

    assert not missing, (
        f'{with_mandatory} dropped its mandatory {missing} because the caller '
        f'named another attribute; a mandatory attribute that a request can '
        f'displace is a default under the wrong name'
    )
