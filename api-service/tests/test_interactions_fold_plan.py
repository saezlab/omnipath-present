"""The page-first fold plan shape (T020c, FR-051, SC-024, research R25).

R24 removed `interaction_fact_combined`, so every interaction query folds
`interaction_fact_resource` for its own scope — including the unscoped one.
R25 binds the shape that makes it affordable: select the page's group keys
`(subject_entity_id, object_entity_id, interaction_class_id)` in key order from
`interaction_fact_resource_collapse_idx`, then fold **only those keys**.

This asserts the **plan shape**, never the latency. A blocking `HashAggregate`
over the whole scope is fast enough to pass a timing test on an idle machine
and is exactly the failure mode R25 identifies, so the number alone would pass
where the design fails.

Expected of the engine (`api_service/interactions/`):

    params.parse(payload: dict) -> InteractionQuery
    scope.resolve(query, *, conn = None) -> ResolvedScope
    fold.fold_sql(query, resolved) -> tuple[str, Sequence[Any]]

`fold_sql` returns the page statement the engine would run, unexecuted, so the
plan can be asserted without going through the route.

    DATABASE_URL=... pytest tests/test_interactions_fold_plan.py -v
"""

from __future__ import annotations

import importlib
import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason='DATABASE_URL not set; the fold-plan test needs a built DB'
)

RECORD_TABLE = 'interaction_fact_resource'
COLLAPSE_INDEX = 'interaction_fact_resource_collapse_idx'

# data-model §3b, measured on dev4: mean source_count 1.0271, maximum 9. A page
# of N keys therefore folds at most 9N record rows and about 1.03N in practice.
MAX_SOURCE_COUNT = 9


def _engine(name: str):
    """Import one engine module, or fail naming the module that is missing."""

    try:
        return importlib.import_module(f'api_service.interactions.{name}')
    except ModuleNotFoundError as exc:
        pytest.fail(
            f'the interaction query engine has no `{name}` module '
            f'(expected api_service/interactions/{name}.py, T020h-T020i): {exc}'
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


@pytest.fixture(scope='module')
def record_rows(db) -> int:
    return db.execute(f'SELECT count(*) AS n FROM {SCHEMA}.{RECORD_TABLE}').fetchone()['n']


def _page_plan(db, payload: dict[str, Any]) -> dict[str, Any]:
    """The `EXPLAIN (ANALYZE, BUFFERS)` plan of the engine's page statement."""

    params = _engine('params')
    scope = _engine('scope')
    fold = _engine('fold')

    parse = _member(params, 'parse', 'params.parse(payload) -> InteractionQuery')
    resolve = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None) -> ResolvedScope')
    fold_sql = _member(fold, 'fold_sql', 'fold.fold_sql(query, resolved) -> (sql, args)')

    query = parse(payload)
    resolved = resolve(query, conn = db)
    sql, args = fold_sql(query, resolved)

    row = db.execute(
        f'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}',
        args,
    ).fetchone()

    return row['QUERY PLAN'][0]['Plan']


def _nodes(plan: dict[str, Any]) -> list[dict[str, Any]]:
    out = [plan]

    for child in plan.get('Plans') or []:
        out.extend(_nodes(child))

    return out


def _aggregates(plan: dict[str, Any]) -> list[str]:
    """Every aggregation node, named as `EXPLAIN`'s text form names it."""

    strategies = {'Sorted': 'GroupAggregate', 'Hashed': 'HashAggregate', 'Plain': 'Aggregate'}
    named = []

    for node in _nodes(plan):
        node_type = node.get('Node Type', '')

        if node_type in ('Aggregate', 'GroupAggregate', 'HashAggregate'):
            named.append(strategies.get(node.get('Strategy', ''), node_type))

    return named


def _index_reads(plan: dict[str, Any], index_name: str) -> list[float]:
    return [
        node.get('Actual Rows', 0)
        for node in _nodes(plan)
        if node.get('Index Name') == index_name
    ]


def _widest_read(plan: dict[str, Any]) -> float:
    return max(node.get('Actual Rows', 0) for node in _nodes(plan))


def test_unscoped_first_page_folds_through_group_aggregate(db):
    """FR-051: the fold streams, so the outer LIMIT can stop it."""

    plan = _page_plan(db, {'limit': 100})

    assert 'GroupAggregate' in _aggregates(plan), (
        f'the unscoped first page must fold through GroupAggregate over sorted '
        f'input; the plan aggregates were {_aggregates(plan)}'
    )


def test_unscoped_first_page_never_reaches_hash_aggregate(db):
    """SC-024: a hash aggregation is blocking and folds the whole scope."""

    aggregates = _aggregates(plan := _page_plan(db, {'limit': 100}))

    assert 'HashAggregate' not in aggregates, (
        f'HashAggregate is blocking: it folds every group in scope before the '
        f'first row is returned, which is the failure R25 names. Plan '
        f'aggregates: {aggregates}'
    )
    assert plan.get('Node Type') != 'HashAggregate'


def test_unscoped_first_page_reads_the_collapse_index_in_key_order(db):
    """R25 step 1: key selection is an ordered read of the collapse index."""

    plan = _page_plan(db, {'limit': 100})
    reads = _index_reads(plan, COLLAPSE_INDEX)

    assert reads, (
        f'the page statement must select its group keys from {COLLAPSE_INDEX}, '
        f'which leads on exactly the collapse key columns; the plan used '
        f'{sorted({n.get("Index Name") for n in _nodes(plan) if n.get("Index Name")})}'
    )


def test_index_entries_read_are_on_the_order_of_the_page(db, record_rows):
    """R25 step 2: the fold costs the page, not the scope."""

    limit = 100
    plan = _page_plan(db, {'limit': limit})
    reads = _index_reads(plan, COLLAPSE_INDEX)

    assert max(reads) <= limit * MAX_SOURCE_COUNT, (
        f'{max(reads)} index entries read for a {limit}-key page; at maximum '
        f'source_count {MAX_SOURCE_COUNT} the bound is {limit * MAX_SOURCE_COUNT} '
        f'(measured on dev4: 111 entries for 100 keys)'
    )
    assert _widest_read(plan) <= limit * MAX_SOURCE_COUNT * 2, (
        f'the widest node of the plan read {_widest_read(plan)} rows over a '
        f'{record_rows}-row record; the fold must be bounded by the page'
    )


def test_the_page_bound_scales_with_the_page_and_not_with_the_scope(db, record_rows):
    """A quarter of the page reads about a quarter of the index entries."""

    small = max(_index_reads(_page_plan(db, {'limit': 25}), COLLAPSE_INDEX))
    large = max(_index_reads(_page_plan(db, {'limit': 100}), COLLAPSE_INDEX))

    assert small < large, (
        f'a 25-key page read {small} index entries and a 100-key page {large}; '
        f'the cost must track the page'
    )
    assert small <= 25 * MAX_SOURCE_COUNT
    assert large < record_rows / 1000


def test_a_narrow_scope_folds_through_group_aggregate_too(db):
    """SC-024 binds every scope; `neuronchat` is the narrowest on dev4."""

    aggregates = _aggregates(_page_plan(db, {'filters': {'resources': ['neuronchat']}, 'limit': 100}))

    assert 'GroupAggregate' in aggregates
    assert 'HashAggregate' not in aggregates, (
        f'a narrow scope must stream like a wide one; plan aggregates: {aggregates}'
    )
