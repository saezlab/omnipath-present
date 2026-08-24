"""What happens when a caller asks for an organism the build does not hold.

The rule the contract cares about is not "serve every organism". It is **never
mislabel one organism's interactions as another's**. Three answers satisfy it
and one does not:

- the build holds the organism, so its own rows are served, labelled with their
  own taxon;
- the build files the organism under its species, so the species' rows are
  served and the response says out loud that the request was widened;
- the build holds neither, so the request is refused with the reason;
- the build serves *something else* under the requested name, which is the one
  outcome no amount of convenience justifies.

Between the second and the third sits orthology, and its shape is settled: a
map exported by Utils and **joined at query time** — never a live call per
request, never a bulk download on the request path. That map exists here. It is
also, measured, useless for this purpose: it covers exactly one direction, and
both of its taxa are organisms this build already holds rows for, so every
request it could translate is a request the untranslated path answers better.

So this file pins two things at once. The **join primitive is real** and is
exercised against the real export, in the direction it actually covers, which
is what makes "joined at query time" a fact rather than an intention. And the
**refusal is precise**: it names what the map covers, distinguishes a map that
could not be read from one that covers the wrong thing, and does not claim a
missing table.

    DATABASE_URL=... OMNIPATH_BUILD_UTILS_PG_URL=... \\
        pytest tests/test_interactions_organism_orthology.py -v
"""

from __future__ import annotations

import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason = 'DATABASE_URL not set; the organism path needs a built DB',
)

#: Human and mouse: the one direction the exported map covers.
HUMAN = 9606
MOUSE = 10090

#: A taxon no build of this project holds interactions for, and never will:
#: NCBI reserves it for sequences of unknown provenance.
ABSENT = 32644


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
def utils():
    """The Utils export, or a skip when it is out of reach."""

    from api_service.interactions import organism

    entries = organism.coverage()

    if not entries:

        pytest.skip('the Utils orthology export is not reachable from here')

    return entries


def _run(db, payload: dict[str, Any]) -> dict[str, Any]:
    """Answer one request through the engine.

    Args:
        db: An open connection.
        payload: The request.

    Returns:
        The engine's answer.
    """

    from api_service.interactions import engine

    return engine.run(payload, conn = db)


# ── What the exported map actually covers ───────────────────────────────────


def test_the_exported_map_is_read_rather_than_assumed(utils):
    """The coverage is a measurement of the export, not a constant."""

    for entry in utils:

        assert entry['pairs'] > 0
        assert entry['id_type'] and entry['resource']
        assert entry['source_taxon'] != entry['target_taxon']


def test_every_direction_the_map_covers_ends_in_a_native_organism(db, utils):
    """The reason the join can serve nothing: it lands where we already are."""

    from api_service.interactions import organism

    native = organism.native_taxa(db)
    useful = [
        entry for entry in utils
        if entry['target_taxon'] not in native
    ]

    assert not useful, (
        f'the export now reaches {useful}, which this build does not hold '
        f'natively; a request for one of those organisms can be translated and '
        f'the query-time join is now worth writing'
    )


def test_a_plan_is_found_when_the_target_is_not_already_served(db, utils):
    """The decision procedure works. The data is what rules it out.

    Nativeness is the only thing standing between the request and the join, so
    the test removes exactly that and checks the plan appears. Asserting only
    that no plan exists today would pass equally well if the procedure were
    broken.
    """

    from api_service.interactions import organism

    native = organism.native_taxa(db)
    entry = utils[0]

    assert organism.translation_plan(entry['target_taxon'], native) is None, (
        'a plan was found into an organism the build serves natively'
    )

    pretend = frozenset(native - {entry['target_taxon']})
    plan = organism.translation_plan(entry['target_taxon'], pretend)

    assert plan is not None, (
        'no plan was found for the one direction the export covers'
    )
    assert plan.source_taxon == entry['source_taxon']
    assert plan.pairs == entry['pairs']


def test_the_join_reads_the_map_at_query_time(db, utils):
    """The primitive is real: identifiers in, orthologs out, one statement."""

    from api_service.interactions import organism

    plan = organism.translation_plan(
        utils[0]['target_taxon'],
        frozenset(organism.native_taxa(db) - {utils[0]['target_taxon']}),
    )
    sample = _sample_identifiers(plan)
    mapped = organism.orthologs(sample, plan)

    assert mapped, (
        f'the export holds {plan.pairs} pairs and the join returned none of '
        f'them'
    )
    assert set(mapped) <= set(sample), (
        'the join returned identifiers nobody asked about'
    )

    for source, targets in mapped.items():

        assert targets, f'{source!r} mapped to an empty ortholog list'
        assert source not in targets or plan.source_taxon == plan.target_taxon, (
            'an identifier mapped to itself across two organisms'
        )


def test_an_unknown_identifier_is_absent_rather_than_mapped_to_itself(db, utils):
    """A molecule with no ortholog is dropped, never relabelled."""

    from api_service.interactions import organism

    plan = organism.translation_plan(
        utils[0]['target_taxon'],
        frozenset(organism.native_taxa(db) - {utils[0]['target_taxon']}),
    )

    assert organism.orthologs(['not-a-gene-symbol-at-all'], plan) == {}


def _sample_identifiers(plan) -> list[str]:
    """A handful of identifiers the export actually holds.

    Args:
        plan: The translation plan.

    Returns:
        Source-side identifiers, for the join to be asked about.
    """

    from api_service.interactions import organism

    conn = organism._utils_connection()
    rows = conn.execute(
        f"""
        SELECT DISTINCT source_id
        FROM {organism.UTILS_SCHEMA}.orthology
        WHERE source_tax_id = %s AND target_tax_id = %s
          AND id_type = %s AND resource = %s
        LIMIT 25
        """,
        (plan.source_taxon, plan.target_taxon, plan.id_type, plan.resource),
    ).fetchall()

    return [str(row[0]) for row in rows]


# ── The refusal, and what it is allowed to claim ────────────────────────────


def test_a_native_organism_is_served_from_its_own_rows(db):
    """No translation where the build has the organism itself."""

    answer = _run(db, {'filters': {'organism': ['mouse']}, 'limit': 25})

    assert answer['interactions'], 'the build holds mouse rows and served none'
    assert answer['organism']['taxa'] == [MOUSE]
    assert 'served_as_species' not in answer['organism']

    organisms = {
        row[f'{side}_organism']
        for row in answer['interactions']
        for side in ('source', 'target')
    }

    assert MOUSE in organisms, (
        'a request for mouse returned no row with a mouse endpoint'
    )


def test_a_non_native_organism_is_refused_naming_the_map(db, utils):
    """The refusal states the coverage instead of claiming a missing table."""

    from api_service.interactions.guard import GuardrailRefusal

    with pytest.raises(GuardrailRefusal) as refusal:

        _run(db, {'filters': {'organism': [str(ABSENT)]}, 'limit': 1})

    exc = refusal.value

    assert exc.status_code == 501, (
        'a request the build cannot serve is not the caller writing something '
        'wrong'
    )
    assert exc.context['taxon'] == ABSENT
    assert exc.context['orthology_pairs'] == [
        [entry['source_taxon'], entry['target_taxon']] for entry in utils
    ], 'the refusal does not report what the map covers'
    assert 'not exported' not in exc.message and 'nothing to join' not in exc.message, (
        'the map exists; a refusal claiming otherwise sends the reader to fix '
        'the wrong thing'
    )
    assert str(HUMAN) in exc.message and str(MOUSE) in exc.message, (
        'the refusal must name the direction the map does cover'
    )


def test_a_name_that_resolves_to_nothing_is_a_different_refusal(db):
    """An unresolvable organism is the caller's error, and says so with a 400."""

    from api_service.interactions.guard import GuardrailRefusal

    with pytest.raises(GuardrailRefusal) as refusal:

        _run(db, {'filters': {'organism': ['not-an-organism']}, 'limit': 1})

    assert refusal.value.status_code == 400, (
        'an unresolvable name and an unservable organism are different '
        'problems and must not share a status'
    )


def test_nothing_on_the_request_path_downloads_the_map():
    """The engine joins the map where it lives, and fetches it never."""

    from pathlib import Path

    body = Path(
        __file__,
    ).resolve().parents[1].joinpath(
        'api_service/interactions/organism.py',
    ).read_text(encoding = 'utf-8')

    for forbidden in ('requests.', 'urllib', 'httpx', 'urlopen', 'COPY '):

        assert forbidden not in body, (
            f'{forbidden!r} appears on the organism path; the map is read by '
            f'joining it, not by fetching it'
        )
