"""The live fold is the collapse.

The build no longer stores `interaction_fact_combined`. The claim that replaces
it is that folding `interaction_fact_resource` at query time reproduces the
removed table exactly, so the collapse was a cache and not a computation. That
claim is a row count, and it is read from **the derive's own record** rather
than pinned here, because the number moves with the build.

The second half is the summary-recomputation fixture, verified against the
deleted routine before it moved here with the fold: a four-resource drug-target
row reads all four resources unscoped, and scoped to one resource reports
**that resource's numbers** — not the wider fold's, selected by
`sources && ARRAY[...]`.

Expected of the engine (`api_service/interactions/`):

    params.parse(payload: dict) -> InteractionQuery
    scope.resolve(query, *, conn = None) -> ResolvedScope
    fold.fold_rows(query, resolved, *, conn = None) -> list[dict]
    fold.count_groups(query, resolved, *, conn = None) -> int

`fold_rows` returns the collapsed shape keyed by entity ids —
`subject_entity_id`, `object_entity_id`, `interaction_class_id`, `sources`,
`source_count`, `is_directed`, `is_stimulation`, `is_inhibition`,
`sign_source_count`, `direction_source_count`, `reference_pubmed_ids`,
`reference_dois`, `reference_count` — before any output projection.

    DATABASE_URL=... pytest tests/test_interactions_fold_equivalence.py -v
"""

from __future__ import annotations

import importlib
import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason='DATABASE_URL not set; the fold-equivalence test needs a built DB'
)

# The summary-recomputation fixture, pinned by entity id so it survives a
# rebuild of the surrogate keys. Found on dev4 2026-08-24: a chemical (InChIKey
# VKHAHZOOUSRJNA-GCNJZUOMSA-N) acting on NCBI Gene 5241, class `orthosteric`.
FIXTURE_SUBJECT = '70e58f8b-e6bf-eb86-e03f-e58428627c09'
FIXTURE_OBJECT = '18d34c29-41d4-4d67-546a-75b45f5bc336'
FIXTURE_CLASS = 'orthosteric'

# The derive's recorded count of collapse keys, in the order it is looked for.
_HISTOGRAM_TABLE = 'interaction_source_count_histogram'
_MANIFEST_COUNT_KEYS = (
    'collapse_keys',
    'collapsed_rows',
    'collapse_group_count',
    'fold_groups',
)


def _engine(name: str):
    """Import one engine module, or fail naming the module that is missing."""

    try:
        return importlib.import_module(f'api_service.interactions.{name}')
    except ModuleNotFoundError as exc:
        pytest.fail(
            f'the interaction query engine has no `{name}` module '
            f'(expected api_service/interactions/{name}.py): {exc}'
        )


def _member(module, name: str, signature: str):
    """Fetch a callable from an engine module, or fail naming its contract."""

    member = getattr(module, name, None)

    if not callable(member):
        pytest.fail(
            f'{module.__name__}.{name} is missing; the engine must provide '
            f'`{signature}`'
        )

    return member


@pytest.fixture(scope='module')
def db():
    pytest.importorskip('psycopg')

    import psycopg
    from psycopg.rows import dict_row

    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)

    try:
        yield conn
    finally:
        conn.close()


def _folded(db, payload: dict[str, Any]) -> list[dict[str, Any]]:
    """The collapsed rows the engine produces for one payload."""

    params = _engine('params')
    scope = _engine('scope')
    fold = _engine('fold')

    parse = _member(params, 'parse', 'params.parse(payload) -> InteractionQuery')
    resolve = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None) -> ResolvedScope')
    fold_rows = _member(
        fold, 'fold_rows', 'fold.fold_rows(query, resolved, *, conn = None) -> list[dict]'
    )

    query = parse(payload)

    return list(fold_rows(query, resolve(query, conn = db), conn = db))


def _fixture_row(db, resources: list[str] | None) -> dict[str, Any]:
    """The pinned fixture row, folded over the given resource scope."""

    payload: dict[str, Any] = {
        'filters': {
            'entities': [FIXTURE_SUBJECT, FIXTURE_OBJECT],
            'interaction_classes': [FIXTURE_CLASS],
        },
        'limit': 500,
    }

    if resources is not None:
        payload['filters']['resources'] = resources

    matching = [
        row for row in _folded(db, payload)
        if str(row.get('subject_entity_id')) == FIXTURE_SUBJECT
        and str(row.get('object_entity_id')) == FIXTURE_OBJECT
    ]

    assert len(matching) == 1, (
        f'the pinned fixture key must fold to exactly one row for scope '
        f'{resources!r}; got {len(matching)}'
    )

    return matching[0]


def _recorded_group_count(db) -> int:
    """The number of collapse keys as the derive recorded it."""

    present = db.execute(
        'SELECT 1 FROM information_schema.tables '
        'WHERE table_schema = %s AND table_name = %s',
        (SCHEMA, _HISTOGRAM_TABLE),
    ).fetchone()

    if present:
        row = db.execute(f'SELECT sum(keys) AS n FROM {SCHEMA}.{_HISTOGRAM_TABLE}').fetchone()

        if row and row['n']:
            return int(row['n'])

    manifest = db.execute(
        f'SELECT interactions_derive_cost AS cost FROM {SCHEMA}.build_manifest'
    ).fetchone()
    cost = (manifest or {}).get('cost') or {}

    for key in _MANIFEST_COUNT_KEYS:
        if cost.get(key):
            return int(cost[key])

    pytest.fail(
        f'the derive records no collapse-key count: neither {SCHEMA}.{_HISTOGRAM_TABLE} '
        f'nor build_manifest.interactions_derive_cost carries one of '
        f'{_MANIFEST_COUNT_KEYS}. The claim that the live fold reproduces the '
        f'removed collapse has nothing to be checked against.'
    )


def test_full_fold_reproduces_the_recorded_collapse_count(db):
    """The fold *is* the removed table, not an approximation of it."""

    params = _engine('params')
    scope = _engine('scope')
    fold = _engine('fold')

    parse = _member(params, 'parse', 'params.parse(payload) -> InteractionQuery')
    resolve = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None) -> ResolvedScope')
    count_groups = _member(
        fold, 'count_groups', 'fold.count_groups(query, resolved, *, conn = None) -> int'
    )

    query = parse({})
    folded = count_groups(query, resolve(query, conn = db), conn = db)

    assert folded == _recorded_group_count(db), (
        f'folding every group produced {folded} rows against the derive\'s '
        f'recorded {_recorded_group_count(db)}'
    )


def test_full_fold_is_smaller_than_the_record_it_folds(db):
    """The record is per contributing resource; the collapse is per key."""

    params = _engine('params')
    scope = _engine('scope')
    fold = _engine('fold')

    query = _member(params, 'parse', 'params.parse(payload)')({})
    resolved = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None)')(query, conn = db)
    folded = _member(fold, 'count_groups', 'fold.count_groups(query, resolved, *, conn = None)')(
        query, resolved, conn = db
    )

    record = db.execute(
        f'SELECT count(*) AS n FROM {SCHEMA}.interaction_fact_resource'
    ).fetchone()['n']

    assert 0 < folded < record


def test_the_pinned_fixture_unscoped_reads_every_contributing_resource(db):
    """Unscoped, the pinned row carries all four resources and both signs."""

    row = _fixture_row(db, None)

    assert sorted(row['sources']) == ['chembl', 'drugcentral', 'guidetopharma', 'stitch']
    assert row['source_count'] == 4
    assert row['is_directed'] is True
    assert row['is_stimulation'] is True
    assert row['is_inhibition'] is True
    assert row['sign_source_count'] == 4
    assert row['reference_count'] == 3


def test_the_pinned_fixture_scoped_to_one_resource_reports_that_resource(db):
    """The summaries are recomputed over the surviving scope."""

    row = _fixture_row(db, ['chembl'])

    assert sorted(row['sources']) == ['chembl'], (
        'a scoped fold must list only the resources in scope; listing four '
        'resources here is the `sources && ARRAY[...]` defect'
    )
    assert row['source_count'] == 1, (
        f"source_count {row['source_count']} describes a wider resource set "
        f'than the query asked for'
    )
    assert row['reference_count'] == 2, (
        "chembl's own references are one PubMed id and one DOI; the unscoped "
        'fold has three'
    )
    assert row['sign_source_count'] == 1


def test_the_pinned_fixture_scoped_sign_returns_to_null(db):
    """A sign no in-scope resource asserts is NULL, never a defaulted false."""

    row = _fixture_row(db, ['chembl'])

    assert row['is_stimulation'] is None, (
        f"chembl asserts no positive sign for this interaction, so "
        f"is_stimulation must be NULL, not {row['is_stimulation']!r}"
    )
    assert row['is_inhibition'] is True
    assert row['is_directed'] is True


def test_the_pinned_fixture_scope_partitions_the_wider_fold(db):
    """Two disjoint scopes account for the whole unscoped fold, and no more."""

    whole = _fixture_row(db, None)
    left = _fixture_row(db, ['chembl'])
    right = _fixture_row(db, ['drugcentral', 'guidetopharma', 'stitch'])

    assert left['source_count'] + right['source_count'] == whole['source_count']
    assert sorted([*left['sources'], *right['sources']]) == sorted(whole['sources'])
    assert set(left['reference_pubmed_ids'] or []) <= set(whole['reference_pubmed_ids'] or [])
    assert set(right['reference_pubmed_ids'] or []) <= set(whole['reference_pubmed_ids'] or [])


# ── Grain: what one folded row stands for ───────────────────────────────────
#
# The fold itself does not move when the grain does. `sources`, `source_count`,
# the three flags, both assertion counts and the reference unions keep folding
# over `source_id`; only the key they are grouped under changes. So the pair of
# claims below is the whole of it: an interaction the binary key cuts in two
# comes back once at participant grain, and an interaction the binary key
# already holds whole comes back with the same numbers at either grain.
#
# This build carries no interaction with more than two distinct participants —
# every row of the record is an ordered pair, and no derive has run since the
# wider shape landed — so the reaction case is skipped rather than asserted
# against data that is not there. What is here instead is the real thing the
# two grains disagree about on this build: an interaction reported under two
# ordered pairs, which the binary key splits and the participant key does not.


def _members_sql() -> str:
    """Every entity one interaction names, counted per interaction."""

    return f"""
    SELECT interaction_id, count(DISTINCT member) AS members
    FROM {SCHEMA}.interaction_fact_resource f,
         LATERAL (VALUES (f.subject_entity_id), (f.object_entity_id)) v(member)
    WHERE interaction_id IS NOT NULL
    GROUP BY 1
    """


@pytest.fixture(scope='module')
def split_interaction(db) -> dict[str, Any]:
    """An interaction the binary key reports under more than one ordered pair.

    Discovered rather than pinned, so a rebuild that reshuffles the surrogate
    keys changes the fixture with it.
    """

    row = db.execute(
        f"""
        SELECT interaction_id,
               count(DISTINCT (subject_entity_id, object_entity_id)) AS pairs,
               count(DISTINCT source_id) AS sources,
               array_agg(DISTINCT subject_entity_id::text) AS subjects,
               array_agg(DISTINCT
                 subject_entity_id::text || ' ' || object_entity_id::text
                 || ' ' || interaction_class_id::text
               ) AS keys_seen
        FROM {SCHEMA}.interaction_fact_resource
        WHERE interaction_id IS NOT NULL
        GROUP BY 1
        HAVING count(DISTINCT (subject_entity_id, object_entity_id)) > 1
        ORDER BY count(DISTINCT source_id) DESC
        LIMIT 1
        """,
    ).fetchone()

    if row is None:
        pytest.skip(
            'no interaction of this build is reported under more than one '
            'ordered endpoint pair, so the two grains cannot disagree here'
        )

    return dict(row)


@pytest.fixture(scope='module')
def whole_interaction(db) -> dict[str, Any]:
    """One ordered pair and one interaction that are the same set of rows.

    Both halves matter. The pair must name one interaction, or the binary key
    would fold record rows the interaction does not own; and the interaction
    must name one pair, or the participant key would fold rows the pair does
    not. Where the two coincide, the grains group exactly the same rows and any
    difference in the summaries is the fold having moved.
    """

    row = db.execute(
        f"""
        WITH pair AS (
          SELECT subject_entity_id, object_entity_id, interaction_class_id,
                 min(interaction_id::text)::uuid AS interaction_id
          FROM {SCHEMA}.interaction_fact_resource
          WHERE interaction_id IS NOT NULL
          GROUP BY 1, 2, 3
          HAVING count(DISTINCT interaction_id) = 1
             AND count(DISTINCT source_id) > 2
          LIMIT 200
        )
        SELECT p.subject_entity_id::text AS subject,
               p.object_entity_id::text AS object,
               p.interaction_class_id,
               p.interaction_id
        FROM pair p
        WHERE (
          SELECT count(DISTINCT (r.subject_entity_id, r.object_entity_id))
          FROM {SCHEMA}.interaction_fact_resource r
          WHERE r.interaction_id = p.interaction_id
        ) = 1
        LIMIT 1
        """,
    ).fetchone()

    assert row is not None, (
        'this build holds no ordered pair and interaction that name the same '
        'record rows and more than two resources; there is nothing to compare '
        'across grains'
    )

    return dict(row)


def _participant_rows(db, interaction_id, entities: list[str]) -> list[dict[str, Any]]:
    """The participant-grain rows one interaction folds to.

    Keys come back in interaction order, so the page holding the one wanted is
    reached by resuming just before it rather than by paging from the start. A
    drug takes part in more interactions than one page holds, and what is under
    test here is the fold rather than the paging.
    """

    fold = _engine('fold')

    before = db.execute(
        f"""
        SELECT interaction_id
        FROM {SCHEMA}.interaction_fact_resource
        WHERE (subject_entity_id = ANY(%s::uuid[])
               OR object_entity_id = ANY(%s::uuid[]))
          AND interaction_id < %s::uuid
        ORDER BY interaction_id DESC
        LIMIT 1
        """,
        (entities, entities, str(interaction_id)),
    ).fetchone()

    payload: dict[str, Any] = {
        'filters': {'entities': entities},
        'grain': 'participant',
        'limit': 50,
    }

    if before is not None:
        payload['cursor'] = fold.encode_cursor([before['interaction_id']])

    return [
        row for row in _folded(db, payload)
        if str(row['interaction_id']) == str(interaction_id)
    ]


def _binary_rows(db, entities: list[str], keys: set[tuple[str, str, int]]) -> list[dict[str, Any]]:
    """The interaction-grain rows sitting on one set of binary keys."""

    return [
        row for row in _folded(db, {
            'filters': {'entities': entities},
            'limit': 500,
        })
        if (
            str(row['subject_entity_id']),
            str(row['object_entity_id']),
            int(row['interaction_class_id']),
        ) in keys
    ]


def _binary_keys(interaction: dict[str, Any]) -> set[tuple[str, str, int]]:
    """The binary keys one interaction is reported under."""

    return {
        (subject, obj, int(class_id))
        for subject, obj, class_id in (
            entry.split(' ') for entry in interaction['keys_seen']
        )
    }


def _summary(row: dict[str, Any]) -> dict[str, Any]:
    """The recomputed summaries of one folded row, without its key."""

    return {
        'sources': sorted(row['sources'] or []),
        'source_count': row['source_count'],
        'is_directed': row['is_directed'],
        'is_stimulation': row['is_stimulation'],
        'is_inhibition': row['is_inhibition'],
        'sign_source_count': row['sign_source_count'],
        'direction_source_count': row['direction_source_count'],
        'reference_count': row['reference_count'],
        'reference_pubmed_ids': sorted(row['reference_pubmed_ids'] or []),
        'reference_dois': sorted(row['reference_dois'] or []),
    }


def test_the_participant_grain_returns_one_row_per_interaction(db, split_interaction):
    """One group is one interaction, whatever the binary key does with it."""

    entities = list(split_interaction['subjects'])
    keys = _binary_keys(split_interaction)
    binary = _binary_rows(db, entities, keys)
    whole = _participant_rows(db, split_interaction['interaction_id'], entities)

    assert len(keys) > 1, (
        'the fixture names one binary key, so the two grains cannot disagree '
        'about it'
    )
    assert len(binary) == len(keys), (
        f'the record reports this interaction under {len(keys)} binary keys '
        f'and interaction grain returned {len(binary)} rows for them'
    )
    assert len(whole) == 1, (
        f'participant grain returned {len(whole)} rows for one interaction; '
        f'the key is the interaction, so one group is one row'
    )


def test_the_participant_row_summarises_every_contributor_of_its_interaction(
        db, split_interaction,
):
    """Folding a wider key folds more record rows, and says so in the numbers.

    Read off the record rather than off the binary page, and deliberately. A
    binary key may carry rows of more than one interaction, so the other
    grain's page is not the right yardstick here: the claim is that the
    participant row summarises **its own interaction**, whole.
    """

    entities = list(split_interaction['subjects'])
    whole = _participant_rows(db, split_interaction['interaction_id'], entities)[0]
    contributors = sorted(
        row['name'] for row in db.execute(
            f"""
            SELECT DISTINCT s.name
            FROM {SCHEMA}.interaction_fact_resource r
            JOIN {SCHEMA}.data_source s ON s.source_id = r.source_id
            WHERE r.interaction_id = %s::uuid
            """,
            (str(split_interaction['interaction_id']),),
        ).fetchall()
    )

    assert sorted(whole['sources'] or []) == contributors, (
        f'the participant row cites {sorted(whole["sources"] or [])} where the '
        f'record holds {contributors} for this interaction'
    )
    assert whole['source_count'] == len(contributors), (
        f'source_count {whole["source_count"]} against {len(contributors)} '
        f'distinct contributors; the summaries fold over source_id at either '
        f'grain'
    )


def test_the_summaries_are_the_same_at_both_grains_for_a_binary_interaction(
        db, whole_interaction,
):
    """The proof that only the key moved: same rows folded, same numbers."""

    entities = [whole_interaction['subject'], whole_interaction['object']]
    binary = [
        row for row in _folded(db, {
            'filters': {'entities': entities}, 'limit': 500,
        })
        if str(row['subject_entity_id']) == whole_interaction['subject']
        and str(row['object_entity_id']) == whole_interaction['object']
        and int(row['interaction_class_id']) == int(whole_interaction['interaction_class_id'])
    ]
    whole = _participant_rows(db, whole_interaction['interaction_id'], entities)

    assert len(binary) == 1 and len(whole) == 1, (
        f'this pair and this interaction are the same rows, so both grains '
        f'must return one row; they returned {len(binary)} and {len(whole)}'
    )
    assert str(binary[0]['interaction_id']) == str(whole_interaction['interaction_id']), (
        f'the ordered pair folded to interaction {binary[0]["interaction_id"]} '
        f'where the fixture names {whole_interaction["interaction_id"]}; the '
        f'two grains are not folding the same rows and the comparison below '
        f'would prove nothing'
    )
    assert _summary(whole[0]) == _summary(binary[0]), (
        'the summaries differ across grains for an interaction both grains key '
        'the same rows under; the fold must not move when the key does'
    )


def test_a_reaction_of_more_than_two_participants_folds_to_one_row(db):
    """The case the participant key exists for, when a build carries one."""

    wide = db.execute(
        f'SELECT interaction_id FROM ({_members_sql()}) m '
        f'WHERE members > 2 LIMIT 1',
    ).fetchone()

    if wide is None:
        pytest.skip(
            'every interaction of this build names exactly two entities: the '
            'record stores ordered pairs and no derive has run since the wider '
            'shape landed, so there is no reaction here to fold'
        )

    rows = [
        row for row in _folded(db, {'grain': 'participant', 'limit': 500})
        if str(row['interaction_id']) == str(wide['interaction_id'])
    ]

    assert len(rows) <= 1, (
        f'a reaction came back as {len(rows)} rows at participant grain'
    )


def test_a_participant_cursor_carries_exactly_one_column(db):
    """The cursor follows the grain: one key column, one part."""

    select = _engine('select')
    params = _engine('params')
    scope = _engine('scope')
    fold = _engine('fold')

    query = params.parse({'grain': 'participant', 'limit': 5})
    keys = select.page_keys(query)

    assert list(keys) == ['interaction_id'], (
        f'participant grain pages on {list(keys)}; the key is the interaction'
    )

    rows = fold.fold_rows(query, scope.resolve(query, conn = db), conn = db)
    cursor = fold.encode_cursor([rows[-1][name] for name in keys])
    decoded = select.decode_cursor(cursor, keys)

    assert decoded == [str(rows[-1]['interaction_id'])], (
        f'the cursor decoded to {decoded} against the page it was minted from'
    )

    resumed = params.parse({'grain': 'participant', 'limit': 5, 'cursor': cursor})
    after = fold.fold_rows(resumed, scope.resolve(resumed, conn = db), conn = db)

    assert after, 'the resumed page came back empty; there are more keys to read'
    assert min(str(row['interaction_id']) for row in after) > decoded[0], (
        'the resumed page repeats a key the first page already returned'
    )


def test_a_cursor_minted_at_one_grain_is_dropped_at_the_other(db):
    """It names a key the other grain does not have, so it buys the first page."""

    select = _engine('select')

    three = select.encode_cursor(
        ['00000000-0000-0000-0000-000000000000',
         '00000000-0000-0000-0000-000000000001', 4],
    )

    assert select.decode_cursor(three, ('interaction_id',)) is None, (
        'a three-column cursor was read as a participant key; a stale bookmark '
        'must cost the first page rather than resume at a key that is not one'
    )
    assert select.decode_cursor(three) is not None, (
        'the same cursor no longer decodes at the grain that minted it'
    )
