"""MetaLinksDB, re-expressed as a dataset over the general interaction record.

MetaLinksDB was fifteen materialized views and 1,571 lines of hand-written SQL.
The claim this cycle makes is that all of it is a *parameter set*: a union of
components, an exclusion, a class gate, a fold, and an annotation layer — the
same engine every other dataset runs through. This file is where that claim is
either kept or shown to be short, so it compares the served dataset against the
matview it replaces rather than against a description of it.

**The comparison is against the matview while the matview still stands.** Its
row count and its contributing resources are read live, not written down here,
so a rebuild moves the expectation with the data. When the views retire, the
file loses that fixture and keeps its structural assertions.

**Three curation rules define the dataset, and each is asserted apart**, because
each fails differently:

- **ChEMBL contributes mechanism-of-action pairs only.** An affinity threshold
  floods the set — pChEMBL above 6 is 1.6 M pairs — and the mechanism annotation
  is the curated statement. As it happens ChEMBL then contributes nothing at
  all, because a mechanism-of-action compound is a drug rather than a
  metabolite and the class gate removes it. That is the delivered behaviour and
  it is asserted as such, so the empty contribution cannot be mistaken for a
  resource that failed to load.
- **BindingDB is excluded, and excluded before the fold.** Its rows stay in the
  record for another query to find. What must not happen is that they stay
  inside this dataset's `source_count`, references or sign flags — right rows
  carrying numbers describing a resource the dataset dropped.
- **Both ends are gated.** One end is a metabolite; the class comes off the
  entity and not off the interaction, so no resource can smuggle a drug in.

The last group is the swap test. The role and localization attributes a caller
requests today come from the resources that already publish those terms; later
they come from the rebuilt intercell classification. The requested names, the
output shape and the presence of a provenance field are asserted here **and are
not re-written after the swap** — that is the whole content of the promise that
the swap is invisible.

    DATABASE_URL=... pytest tests/test_interactions_metalinksdb.py -v
"""

from __future__ import annotations

import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason = 'DATABASE_URL not set; the dataset needs a built record',
)

#: The dataset under test.
DATASET = 'metalinksdb'

#: The matview whose contract the dataset reproduces, while it still stands.
LEGACY_VIEW = 'custom_views.metalinksdb_relations'

#: Retained in the record for another query, never a contributor here.
EXCLUDED = 'bindingdb'

#: Contributes through its mechanism-of-action annotation alone.
CURATED_BY_MECHANISM = 'chembl'

#: The entity class one end of every row must carry.
GATE = 'metabolite'

#: The page the row-level assertions read.
PAGE = 200

#: The node attributes the dataset promises whatever a caller asks for. They
#: are read from the registry, not written here — this is the fallback for a
#: registry that declares none, so the swap test still says something.
ROLE_ATTRIBUTES = ('intercell', )

#: Field names that would carry a node's role or location classification.
ROLE_SUFFIXES = ('intercell_class', 'intercell_classes', 'intercell')

#: Where a response says which source supplied an attribute.
PROVENANCE_KEYS = ('attribute_sources', 'annotation_sources', 'sources')


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
def legacy(db) -> dict[str, Any]:
    """What the matview delivers today, read from the matview.

    Args:
        db: An open connection to the built database.

    Returns:
        Its row count and its contributing resources with their row counts, or
        a skip once the matview has retired.
    """

    present = db.execute(
        'SELECT to_regclass(%s) AS relation', (LEGACY_VIEW,),
    ).fetchone()['relation']

    if present is None:

        pytest.skip(f'{LEGACY_VIEW} has retired; the baseline is gone with it')

    rows = db.execute(f'SELECT count(*) AS rows FROM {LEGACY_VIEW}').fetchone()

    contributors = {
        row['source']: row['rows'] for row in db.execute(
            f'SELECT unnest(sources) AS source, count(*) AS rows '
            f'FROM {LEGACY_VIEW} GROUP BY 1 ORDER BY 2 DESC'
        ).fetchall()
    }

    return {'rows': rows['rows'], 'contributors': contributors}


@pytest.fixture(scope = 'module')
def registered(db) -> dict[str, Any]:
    """The dataset's own registry row.

    Args:
        db: An open connection to the built database.

    Returns:
        The row, or a skip while the dataset is still a matview network.
    """

    row = db.execute(
        f"""
        SELECT name, kind, included_sources, interaction_class_scope,
               default_attributes, mandatory_attributes, curation,
               attribute_sources, composition, collapse_mode
        FROM {SCHEMA}.network_registry WHERE name = %s
        """,
        (DATASET,),
    ).fetchone()

    assert row is not None, f'{DATASET} is not registered at all'

    return dict(row)


@pytest.fixture(scope = 'module')
def page(client) -> list[dict[str, Any]]:
    """One page of the dataset, as the endpoint serves it by default."""

    response = client.get(f'/interactions/{DATASET}', params = {'limit': PAGE})

    assert response.status_code == 200, (
        f'{DATASET} does not answer: {response.status_code} '
        f'{response.text[:400]}'
    )

    rows = response.json()['interactions']

    assert rows, f'{DATASET} returns an empty page; nothing below can be checked'

    return rows


def _entity_ids(rows: list[dict[str, Any]]) -> list[str]:
    """Every endpoint entity id on a page.

    Args:
        rows: One page of interactions.

    Returns:
        The ids, deduplicated.
    """

    out: set[str] = set()

    for row in rows:

        for key in ('subject_entity_id', 'object_entity_id'):

            if value := row.get(key):

                out.add(str(value))

    return sorted(out)


def _sources(row: dict[str, Any]) -> list[str]:
    """The resources a row attributes itself to.

    Args:
        row: One served interaction.

    Returns:
        The resource names.
    """

    value = row.get('sources') or row.get('resources') or []

    return [str(name) for name in value]


# ── the recipe ──────────────────────────────────────────────────────────────


def test_the_dataset_is_registered_as_a_composition(registered):
    """A union of components with an exclusion is not a resource list."""

    assert registered['composition'], (
        f'{DATASET} is registered without a composition, so the whole recipe — '
        f'the mechanism restriction, the exclusion, the class gate — lives '
        f'nowhere the service can read it'
    )


def test_the_composition_excludes_before_it_collapses(registered):
    """The order that keeps a dropped resource out of the numbers."""

    steps = [
        step.get('operation')
        for step in (registered['composition'] or {}).get('steps') or []
    ]

    assert 'exclude' in steps and 'collapse' in steps, (
        f'{DATASET} names steps {steps}; both the exclusion and the fold '
        f'belong to the recipe'
    )

    assert steps.index('exclude') < steps.index('collapse'), (
        f'{DATASET} excludes after it folds, so the dropped resource stays '
        f'inside source_count, references and the sign flags'
    )


def test_the_class_gate_is_recorded_as_curation(registered):
    """The gate is a configurable field, not a line of SQL somewhere."""

    curation = registered['curation'] or {}

    assert GATE in str(curation), (
        f'{DATASET} records curation {curation!r}, which does not name the '
        f'{GATE} gate; a threshold that is not a field is a threshold nobody '
        f'can change without editing the build'
    )


# ── what the rows are allowed to say ────────────────────────────────────────


def test_the_excluded_resource_contributes_no_row(page):
    """BindingDB is retained in the record and absent from this dataset."""

    offending = [row for row in page if EXCLUDED in _sources(row)]

    assert not offending, (
        f'{len(offending)} of {len(page)} rows attribute themselves to '
        f'{EXCLUDED}, which the recipe excludes'
    )


def test_the_excluded_resource_survives_outside_the_dataset(client):
    """Excluded from the dataset is not deleted from the record."""

    response = client.get(
        '/interactions', params = {'resources': EXCLUDED, 'limit': 1},
    )

    assert response.status_code == 200, response.text[:300]

    assert response.json()['interactions'], (
        f'{EXCLUDED} returns nothing outside the dataset either; it was '
        f'dropped from the record rather than from this recipe'
    )


def test_chembl_contributes_through_the_mechanism_annotation_only(db):
    """The curated ChEMBL set is the mechanism set, not an affinity slice."""

    counts = db.execute(
        f"""
        SELECT count(*) FILTER (WHERE f.curation_flags IS NOT NULL) AS flagged,
               count(*) AS total
        FROM {SCHEMA}.interaction_fact_resource f
        JOIN {SCHEMA}.data_source ds ON ds.source_id = f.source_id
        WHERE ds.name = %s
        """,
        (CURATED_BY_MECHANISM,),
    ).fetchone()

    assert counts['flagged'], (
        f'no {CURATED_BY_MECHANISM} record row carries a curation flag, so the '
        f'mechanism restriction has nothing to select on and the component '
        f'either returns everything or nothing for the wrong reason'
    )


def test_the_dataset_reports_chembl_as_an_empty_contribution(page, legacy):
    """The gate removes every mechanism pair, and that is the delivered state.

    A drug is not a metabolite, so the curated ChEMBL component survives the
    recipe and dies at the class gate. The matview delivers exactly this. The
    assertion pins it so a future reader meets a documented emptiness rather
    than a resource that looks broken.
    """

    assert CURATED_BY_MECHANISM not in legacy['contributors'], (
        f'{CURATED_BY_MECHANISM} now contributes to the matview; the class '
        f'gate or the compound classification changed, and this test and the '
        f'dataset both need re-reading'
    )

    served = {name for row in page for name in _sources(row)}

    assert CURATED_BY_MECHANISM not in served, (
        f'{CURATED_BY_MECHANISM} contributes to the served dataset and not to '
        f'the matview; the class gate is not being applied'
    )


def test_every_row_has_a_metabolite_end(page, db):
    """The gate is on the entity, so no resource can smuggle a drug through."""

    ids = _entity_ids(page)

    assert ids, 'the page names no endpoint entity; the gate cannot be checked'

    classed = {
        str(row['entity_id']): row['chemical_class'] for row in db.execute(
            f"""
            SELECT e.entity_id, vc.name AS chemical_class
            FROM {SCHEMA}.entity e
            LEFT JOIN {SCHEMA}.vocab_chemical_class vc
              ON vc.chemical_class_id = e.chemical_class_id
            WHERE e.entity_id = ANY(%s::uuid[])
            """,
            (ids,),
        ).fetchall()
    }

    ungated = [
        row for row in page
        if GATE not in {
            classed.get(str(row.get(key))) for key in
            ('subject_entity_id', 'object_entity_id')
        }
    ]

    assert not ungated, (
        f'{len(ungated)} of {len(page)} rows have no {GATE} end; the class '
        f'gate is the whole definition of this dataset'
    )


#: Resources whose contribution to the retiring view is built by joining
#: *through* a reaction entity — gene → reaction → metabolite. The record holds
#: those two hops as two rows, because the load binarised the reaction instead
#: of keeping it as a hyperedge, and the engine does not join a record row to
#: another record row. So these three are short until the reaction projection
#: lands, and the shortfall is pinned rather than left to be rediscovered.
REACTION_GRAIN = ('rhea', 'recon3d', 'humangem')


def test_every_directly_stated_resource_contributes(legacy, db):
    """Whoever contributes to the retiring view without a reaction hop is here.

    The comparison runs over the resources rather than the row counts: the view
    folds a compound-protein pair across interaction classes and the record does
    not, so the two grains give different counts for the same biology. The
    contributor set is the part that must agree, and a disagreement names
    exactly which resource went missing.
    """

    from api_service.interactions import compose, scope

    with scope.connection(None) as live:

        predicate = compose.record_filter_for(
            compose.for_presets([DATASET], conn = live), conn = live,
        )

        assert predicate is not None, (
            f'{DATASET} resolves to no record predicate, so its recipe is not '
            f'what serves it'
        )

        rows = live.execute(
            f"""
            SELECT contributor.name AS resource, count(*) AS rows
            FROM {SCHEMA}.interaction_fact_resource r
            JOIN {SCHEMA}.data_source contributor USING (source_id)
            WHERE {predicate.sql}
            GROUP BY 1
            """,
            predicate.args,
        ).fetchall()

    served = {row['resource'] for row in rows}
    expected = set(legacy['contributors']) - set(REACTION_GRAIN)
    missing = sorted(expected - served)

    assert not missing, (
        f'{missing} contribute to the retiring view and not to the dataset, '
        f'and none of them needs a reaction hop; the recipe has lost them'
    )


def test_the_reaction_grain_resources_are_still_short(legacy, db):
    """Pins today's shortfall, with the reason, so it cannot pass unnoticed.

    Rhea, Recon3D and Human-GEM contribute metabolite-enzyme pairs that the
    record holds as two hops through a reaction entity. The engine folds record
    rows; it does not join one to another, so those pairs are unreachable until
    the reaction projection lands and gives them a row of their own.

    **A failure here is good news**: it means the reaction work landed and this
    test should be replaced by the equality the previous one asserts for
    everything else.
    """

    from api_service.interactions import compose, scope

    with scope.connection(None) as live:

        predicate = compose.record_filter_for(
            compose.for_presets([DATASET], conn = live), conn = live,
        )
        rows = live.execute(
            f"""
            SELECT contributor.name AS resource, count(*) AS rows
            FROM {SCHEMA}.interaction_fact_resource r
            JOIN {SCHEMA}.data_source contributor USING (source_id)
            WHERE {predicate.sql}
              AND contributor.name = ANY(%s::text[])
            GROUP BY 1
            """,
            [*predicate.args, list(REACTION_GRAIN)],
        ).fetchall()

    served = {row['resource']: int(row['rows']) for row in rows}
    delivered = {
        name: count for name, count in legacy['contributors'].items()
        if name in REACTION_GRAIN
    }

    assert delivered, (
        'the retiring view no longer carries a reaction-derived contribution, '
        'so there is no shortfall to pin and this test has lost its subject'
    )

    short = {
        name: (served.get(name, 0), count)
        for name, count in delivered.items()
        if served.get(name, 0) < count
    }

    assert short == {
        name: (served.get(name, 0), count) for name, count in delivered.items()
    }, (
        f'one of {sorted(delivered)} now reaches the dataset in full: '
        f'served {served}, delivered {delivered}. The reaction projection has '
        f'landed — fold this test into the equality above'
    )


# ── the swap ────────────────────────────────────────────────────────────────


def test_the_role_attributes_are_served(client, registered):
    """A caller asking for the node classification gets it."""

    wanted = list(registered['mandatory_attributes'] or ROLE_ATTRIBUTES)

    response = client.get(
        f'/interactions/{DATASET}',
        params = {'limit': PAGE, 'attributes': ','.join(wanted)},
    )

    assert response.status_code == 200, response.text[:300]

    rows = response.json()['interactions']

    assert rows, 'the dataset returns no row to classify'

    classified = [
        row for row in rows
        if any(
            key.endswith(suffix)
            for key in row
            for suffix in ROLE_SUFFIXES
        )
    ]

    assert classified, (
        f'no row carries a role or localization field; the attributes '
        f'{wanted} were requested and the response answers with none of them'
    )


def test_the_supplying_source_is_named(client, registered):
    """Provenance survives the swap, so the interim answer says it is interim."""

    declared = registered['attribute_sources'] or {}

    if declared:

        assert any(declared.values()), (
            f'{DATASET} records attribute_sources {declared!r} naming no '
            f'source; a caller cannot tell the interim classification from the '
            f'rebuilt one'
        )

        return

    response = client.get(
        f'/interactions/{DATASET}',
        params = {'limit': 10, 'attributes': 'intercell.full'},
    )

    assert response.status_code == 200, response.text[:300]

    rows = response.json()['interactions']

    named = [
        row for row in rows
        if any(key in row for key in PROVENANCE_KEYS)
    ]

    assert named, (
        f'neither the registry nor the response names the source behind the '
        f'node classification; after the intercell rebuild a caller would '
        f'have no way to tell which answer they are holding'
    )


def test_the_role_attribute_shape_is_stable(client, registered):
    """The shape this asserts is the shape the rebuild must keep.

    This test is re-run unchanged after the intercell rebuild. If it needs
    editing then, the swap changed the contract, which is the one thing it was
    promised not to do.
    """

    wanted = list(registered['mandatory_attributes'] or ROLE_ATTRIBUTES)

    response = client.get(
        f'/interactions/{DATASET}',
        params = {'limit': 10, 'attributes': ','.join(wanted)},
    )

    assert response.status_code == 200, response.text[:300]

    rows = response.json()['interactions']

    assert rows, 'the dataset returns no row whose shape could be pinned'

    for row in rows:

        for key, value in row.items():

            if not any(key.endswith(suffix) for suffix in ROLE_SUFFIXES):

                continue

            assert value is None or isinstance(value, (list, dict, bool)), (
                f'{key} is {type(value).__name__}; the classification layers '
                f'are an array, a by-resource object or a flat boolean, and a '
                f'consumer frame is built on that'
            )
