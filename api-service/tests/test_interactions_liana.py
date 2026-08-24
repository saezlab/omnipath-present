"""The reduced ligand-receptor drop, and what it is allowed to say.

`GET /interactions/liana` serves one resource — ConnectomeDB2025, loaded in the
build under the release-naming slug `connectomedb2025`. The drop is the
cheapest thing the interaction engine does: one resource, one interaction
class, and a fold in which every group holds a single row. That makes it a poor
performance exercise and an excellent *honesty* exercise, because there is no
second resource to hide behind. Whatever the response says about these rows is
what ConnectomeDB2025 said, or it is invented.

So this file pins what the resource publishes and, just as hard, what it does
not:

- **One resource.** A bare `connectomedb` slug is version-ambiguous — it names
  a resource family while denoting one release — and a later ConnectomeDB2020
  onboarding would collide with it. The drop resolves to `connectomedb2025`
  and to nothing else, and no neighbouring ligand-receptor resource leaks in.
- **Direction by construction.** The class names its two endpoints
  asymmetrically: a ligand acts on a receptor, and the reverse is a different
  statement. Every row is directed.
- **No sign, and no fabricated one.** ConnectomeDB2025 publishes no stimulation
  or inhibition. The two sign columns are therefore `null` — *not* `false`. The
  distinction is the whole point and it is asserted separately: `null` means no
  resource asserts anything, while `false` is a positive claim that the
  interaction is known not to stimulate. Defaulting the first to the second
  would put a claim in the mouth of a resource that never made it.
- **Evidence type.** The resource distinguishes directly observed pairs from
  inferred ones, and that distinction reaches the response.
- **Partner roles.** Which endpoint is the ligand and which the receptor is
  reachable per row, not left for the caller to guess from column order.
- **References.** See `test_the_drop_carries_no_reference_yet` below, which
  pins today's truth rather than the intended one.
- **Every organism the release covers.** The loaded release is the all-species
  drop, and human is a small minority of it. Serving human only would silently
  discard most of the data; organism is a query parameter, not a property of
  the preset.

    DATABASE_URL=... pytest tests/test_interactions_liana.py -v
"""

from __future__ import annotations

import os
from typing import Any, Iterable

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason = 'DATABASE_URL not set; the ligand-receptor drop needs a built DB',
)

#: The one resource behind the drop, named for the release it holds.
RESOURCE = 'connectomedb2025'

#: The family name the release must never be served under: it denotes no
#: particular release, and callers filter on this value.
AMBIGUOUS_SLUG = 'connectomedb'

#: The one interaction class the drop carries.
INTERACTION_CLASS = 'ligand_receptor'

#: What the resource says about how a pair was established.
EVIDENCE_VALUES = frozenset({'Direct', 'Inferred'})

#: NCBI taxon id of human — a minority of this release, not the whole of it.
HUMAN = 9606

#: The page the row-level assertions read. `MAX_LIMIT` in the parameter model.
PAGE = 500

#: Per-side column prefixes the response may use. The contract's own output
#: names the sides `source`/`target`; the record underneath names them
#: `subject`/`object`, and either is a fair answer to "is this reachable".
SIDES: dict[str, tuple[str, ...]] = {
    'ligand': ('source', 'subject'),
    'receptor': ('target', 'object'),
}

#: Field names that would carry a node's partner role.
ROLE_SUFFIXES = (
    'intercell_class',
    'intercell_classes',
    'roles',
    'role',
)

#: Field names that would carry a node's organism.
ORGANISM_SUFFIXES = ('organism', 'taxon', 'ncbi_tax_id')

#: Field names that would carry the resource's evidence type.
EVIDENCE_FIELDS = ('curation_flags', 'evidence', 'evidence_types')


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
def truth(db) -> dict[str, Any]:
    """What the build actually holds for this resource.

    The response is compared against the record rather than against numbers
    written into this file, so a rebuild that changes the drop changes the
    expectation with it.

    Args:
        db: An open connection to the built database.

    Returns:
        The resource's row count, its taxon set and its human subset.
    """

    counts = db.execute(
        f"""
        SELECT count(*) AS rows,
               count(*) FILTER (WHERE f.subject_organism = %s) AS human_rows
        FROM {SCHEMA}.interaction_fact_resource f
        JOIN {SCHEMA}.data_source ds ON ds.source_id = f.source_id
        WHERE ds.name = %s
        """,
        (HUMAN, RESOURCE),
    ).fetchone()

    taxa = [
        row['taxon'] for row in db.execute(
            f"""
            SELECT DISTINCT f.subject_organism AS taxon
            FROM {SCHEMA}.interaction_fact_resource f
            JOIN {SCHEMA}.data_source ds ON ds.source_id = f.source_id
            WHERE ds.name = %s AND f.subject_organism IS NOT NULL
            ORDER BY 1
            """,
            (RESOURCE,),
        ).fetchall()
    ]

    assert counts['rows'] > 0, (
        f'{RESOURCE} contributes no row to the record; the drop has no data '
        f'to serve and every assertion below would pass vacuously'
    )

    return {'rows': counts['rows'], 'human_rows': counts['human_rows'], 'taxa': taxa}


@pytest.fixture(scope = 'module')
def page(client) -> dict[str, Any]:
    """One page of the drop, as the endpoint serves it by default."""

    response = client.get('/interactions/liana', params = {'limit': PAGE})

    assert response.status_code == 200, (
        f'the ligand-receptor drop does not answer: {response.status_code} '
        f'{response.text[:400]}'
    )

    body = response.json()

    assert body.get('interactions'), (
        f'the drop came back empty; response keys were {sorted(body)}'
    )

    return body


def _field(row: dict[str, Any], side: str, suffixes: Iterable[str]) -> tuple[str, Any]:
    """Find one per-node field on a row, whichever side naming is in use.

    Args:
        row: One interaction of the response.
        side: `ligand` or `receptor`, the two ends of the class.
        suffixes: The field names that would carry the value.

    Returns:
        The key that was found and its value, or `(None, None)` when the
        response carries no such field at all.
    """

    for prefix in SIDES[side]:

        for suffix in suffixes:

            key = f'{prefix}_{suffix}'

            if key in row:

                return key, row[key]

    return None, None


def _evidence(row: dict[str, Any]) -> tuple[str, Any]:
    """The row's evidence-type field, under whichever name it carries."""

    for key in EVIDENCE_FIELDS:

        if key in row:

            return key, row[key]

    return None, None


def _values(value: Any) -> list[Any]:
    """Read a scalar or a sequence as a list, and a missing value as empty."""

    if value is None:

        return []

    if isinstance(value, (list, tuple, set, frozenset)):

        return [item for item in value if item is not None]

    return [value]


def test_the_drop_serves_one_resource_and_names_its_release(page):
    """The scope is ConnectomeDB2025 alone, under a slug that names a release.

    A neighbouring ligand-receptor resource in the scope would make every count
    and every provenance string on these rows describe a wider set than the
    caller asked for, and a bare family slug would leave callers filtering on a
    name that does not say which release they got.
    """

    resources = page.get('resources')

    assert resources is not None, (
        f'the response does not report the scope it resolved; keys were '
        f'{sorted(page)}'
    )
    assert list(resources) == [RESOURCE], (
        f'the drop resolved to {list(resources)}; it is one resource, and the '
        f'others here are separate ligand-receptor datasets of their own'
    )
    assert AMBIGUOUS_SLUG not in resources, (
        f'{AMBIGUOUS_SLUG!r} names a resource family, not the release the '
        f'build holds'
    )


def test_every_row_is_attributed_to_that_resource_alone(page):
    """Provenance per row, not only in the scope the response reports."""

    foreign = sorted({
        source
        for row in page['interactions']
        for source in _values(row.get('sources'))
        if source != RESOURCE
    })

    assert foreign == [], (
        f'rows of the drop are attributed to {foreign}; each of those is a '
        f'ligand-receptor resource with its own dataset, and folding them in '
        f'here makes the drop something other than what it is named for'
    )


def test_every_row_is_a_ligand_receptor_interaction(page):
    """The class is the drop's defining filter, so nothing else may appear."""

    classes = sorted({
        row.get('interaction_type') for row in page['interactions']
    })

    assert classes == [INTERACTION_CLASS], (
        f'the drop returned classes {classes}; a row outside '
        f'{INTERACTION_CLASS!r} is not a ligand-receptor pair and the class '
        f'scope did not hold'
    )


def test_every_row_is_directed(page):
    """A ligand acts on a receptor, and the reverse is a different statement.

    The class names its two endpoints asymmetrically, so the order of the pair
    carries meaning however coarse the predicate the ingest layer recorded.
    Direction here is a property of the class, not something a resource has to
    assert row by row.
    """

    undirected = [
        row.get('is_directed') for row in page['interactions']
        if row.get('is_directed') is not True
    ]

    assert undirected == [], (
        f'{len(undirected)} of {len(page["interactions"])} rows are not '
        f'directed (values seen: {sorted(set(map(str, undirected)))}); the '
        f'ordered roles of the class fix the direction'
    )


def test_no_row_carries_a_sign_and_none_is_invented(page):
    """The resource publishes no sign, so the columns are null — never false.

    This is the failure the drop exists to prevent. `null` says no resource in
    scope asserts anything about the sign. `false` says the interaction is
    known not to stimulate, or known not to inhibit, which ConnectomeDB2025
    never claimed about any pair. A column defaulted from the first to the
    second turns silence into a positive negative finding across the whole
    drop, and a consumer cannot tell the two apart after the fact.
    """

    rows = page['interactions']

    negatives = [
        {
            'is_stimulation': row.get('is_stimulation'),
            'is_inhibition': row.get('is_inhibition'),
        }
        for row in rows
        if row.get('is_stimulation') is False or row.get('is_inhibition') is False
    ]

    assert negatives == [], (
        f'{len(negatives)} rows carry an asserted `false` sign, e.g. '
        f'{negatives[:3]}. The resource publishes no sign at all, so `false` '
        f'here is a claim nobody made; the absence of a sign is `null`'
    )

    unsigned = [
        row for row in rows
        if row.get('is_stimulation') is not None
        or row.get('is_inhibition') is not None
    ]

    assert unsigned == [], (
        f'{len(unsigned)} rows carry a sign the resource does not publish'
    )


def test_the_evidence_type_reaches_every_row(page):
    """Direct observation and inference are different claims, and both show.

    ConnectomeDB2025 marks whether a pair was observed directly or inferred
    from another pair, and that distinction is the main quality signal the
    resource offers. A response that dropped it would present an inferred pair
    and a measured one as the same statement.
    """

    rows = page['interactions']
    key, _ = _evidence(rows[0])

    assert key is not None, (
        f'no row carries an evidence-type field (looked for '
        f'{list(EVIDENCE_FIELDS)}); row keys were {sorted(rows[0])}'
    )

    missing = sum(1 for row in rows if not _values(_evidence(row)[1]))

    assert missing == 0, (
        f'{missing} of {len(rows)} rows carry an empty {key}; the resource '
        f'states the evidence type for every pair it publishes'
    )

    seen = {value for row in rows for value in _values(_evidence(row)[1])}
    unexpected = sorted(seen - EVIDENCE_VALUES)

    assert unexpected == [], (
        f'{key} carries {unexpected}, which this resource does not publish; '
        f'its vocabulary is {sorted(EVIDENCE_VALUES)}'
    )


def test_both_evidence_types_are_represented(page):
    """The field is a real distinction here, not a constant under a name."""

    seen = {
        value for row in page['interactions']
        for value in _values(_evidence(row)[1])
    }

    assert seen >= EVIDENCE_VALUES, (
        f'only {sorted(seen)} appears across {len(page["interactions"])} rows; '
        f'the drop holds both directly observed and inferred pairs, so a '
        f'single value means the field is collapsing them'
    )


def test_the_partner_roles_are_reachable(page):
    """Which end is the ligand and which the receptor, said rather than implied.

    Column order is not an answer: a consumer joining these rows to expression
    data has to know which protein it should look for in the sending cell. The
    resource annotates both partners, so the response can carry it.
    """

    rows = page['interactions']

    ligand_key, _ = _field(rows[0], 'ligand', ROLE_SUFFIXES)
    receptor_key, _ = _field(rows[0], 'receptor', ROLE_SUFFIXES)

    assert ligand_key and receptor_key, (
        f'the rows carry no partner-role field (looked for '
        f'{list(ROLE_SUFFIXES)} on both sides); row keys were {sorted(rows[0])}'
    )

    ligands = {
        str(value).lower()
        for row in rows for value in _values(_field(row, 'ligand', ROLE_SUFFIXES)[1])
    }
    receptors = {
        str(value).lower()
        for row in rows
        for value in _values(_field(row, 'receptor', ROLE_SUFFIXES)[1])
    }

    assert any('ligand' in value for value in ligands), (
        f'{ligand_key} never names the ligand role; it carries {sorted(ligands)}'
    )
    assert any('receptor' in value for value in receptors), (
        f'{receptor_key} never names the receptor role; it carries '
        f'{sorted(receptors)}'
    )


def test_the_drop_carries_no_reference_yet(page):
    """Today's truth: this resource reaches the build without its citations.

    ConnectomeDB2025 publishes the PubMed identifiers behind each pair, but not
    in a column the loader reads — they sit in a free-text summary field the
    ingest layer skips, so every row of the drop arrives with an empty
    reference list. Closing that gap needs the source downloaded again and is
    tracked on the ingest side, not here.

    **This test asserts the gap, not the goal.** It is written this way on
    purpose: a test demanding references would fail for a reason nobody in this
    slice can fix, and would read as a bug in the serving path. When the ingest
    gap closes, this test starts failing — and that failure is the signal to
    invert it into the assertion it should have been, that every pair carries
    the citation the resource published for it.
    """

    cited = [
        _values(row.get('reference_pubmed_ids'))
        for row in page['interactions']
        if _values(row.get('reference_pubmed_ids'))
    ]

    assert cited == [], (
        f'{len(cited)} rows now carry references, e.g. {cited[0]}. If the '
        f'ingest gap has closed, this test has done its job: replace it with '
        f'the assertion that the drop carries the citations the resource '
        f'publishes. If it has not, references appeared from somewhere else '
        f'and the drop is serving more than one resource'
    )


def test_the_drop_is_not_narrowed_to_human(page, truth):
    """The loaded release covers many species, and human is a small part of it.

    Serving the human subset by default would quietly discard the majority of
    the pairs the build holds, and a caller would have no way to see that it
    had happened. Organism belongs on the query, not in the definition of the
    dataset.
    """

    rows = page['interactions']

    key, _ = _field(rows[0], 'ligand', ORGANISM_SUFFIXES)

    assert key is not None, (
        f'the rows carry no organism field (looked for '
        f'{list(ORGANISM_SUFFIXES)}), so a caller cannot tell which species a '
        f'pair belongs to; row keys were {sorted(rows[0])}'
    )

    seen = {
        _field(row, 'ligand', ORGANISM_SUFFIXES)[1] for row in rows
    } - {None}

    assert len(seen) > 1, (
        f'every row of the page is organism {sorted(seen)}; the release the '
        f'build holds spans {len(truth["taxa"])} taxa, of which only '
        f'{truth["human_rows"]} of {truth["rows"]} rows are human'
    )


def test_every_taxon_of_the_release_is_served(client, truth):
    """Each species the build holds is reachable, not only the popular ones.

    The rows a taxon returns must be this resource's own. A neighbouring
    ligand-receptor resource answering for a species ConnectomeDB2025 also
    covers would make the drop look complete while the release's own rows for
    that species went unserved.
    """

    empty = []

    for taxon in truth['taxa']:

        response = client.get(
            '/interactions/liana', params = {'organism': taxon, 'limit': 5},
        )

        rows = (
            response.json().get('interactions')
            if response.status_code == 200
            else []
        )
        own = [
            row for row in rows or []
            if _values(row.get('sources')) == [RESOURCE]
        ]

        if not own:

            empty.append(taxon)

    assert empty == [], (
        f'the drop returns no {RESOURCE} row for taxa {empty}, which the '
        f'record does hold rows for; the release is the all-species drop and '
        f'every taxon in it is served natively'
    )


def test_asking_for_human_narrows_the_drop_to_human(client, truth):
    """The organism parameter selects, and it selects on the rows themselves."""

    response = client.get(
        '/interactions/liana', params = {'organism': HUMAN, 'limit': PAGE},
    )

    assert response.status_code == 200, response.text[:400]

    rows = response.json()['interactions']

    assert rows, f'no human rows came back, against {truth["human_rows"]} in the record'

    other = sorted({
        _field(row, 'ligand', ORGANISM_SUFFIXES)[1] for row in rows
    } - {HUMAN})

    assert other == [], (
        f'a human-scoped request returned rows of organisms {other}; the '
        f'parameter selects rows rather than annotating them'
    )
