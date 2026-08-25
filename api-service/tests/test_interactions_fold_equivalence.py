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
