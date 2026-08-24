"""The post-fold guardrail: filters are served, sorts are refused.

T020e (FR-052, SC-025) and T020f (FR-052), in one file because they are two
halves of one rule and share its fixtures.

R25's distinction is the one the whole design rests on. A `HAVING` on a folded
value **streams**: with input ordered on the group key, `GroupAggregate` emits
each group as its key changes and the outer `LIMIT` stops the scan, so the cost
is page ÷ selectivity. An `ORDER BY` on a folded value **cannot** stop early —
to know which key sorts first the engine folds every key in scope and then
sorts, measured at 5,538 ms unscoped over all 14,291,204 groups, with the
`LIMIT` saving nothing because the top-N heapsort only sees rows the fold has
already produced. So one is priced from the histogram and the other is refused.

Treating the two alike would either forbid a cheap request or promise an
unbounded one, which is why both halves are asserted here.

Expected of the engine (`api_service/interactions/`):

    params.FOLDED_COLUMNS -> frozenset[str]
    params.parse(payload: dict) -> InteractionQuery
    scope.resolve(query, *, conn = None) -> ResolvedScope
    guard.GuardrailRefusal(Exception)   # .message: str, .status_code: int (4xx)
    guard.check(query, resolved, *, conn = None) -> Estimate
    guard.Estimate                      # .qualifying_keys, .keys_folded, .source
    fold.fold_sql(query, resolved) -> tuple[str, Sequence[Any]]

and of the route: `POST /interactions` answers a refused request with a 4xx
whose body names the folded columns and what to narrow, and answers a served
`HAVING` with `estimate` carried on the response.

    DATABASE_URL=... pytest tests/test_interactions_guardrail.py -v
"""

from __future__ import annotations

import importlib
import json
import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason='DATABASE_URL not set; the guardrail test needs a built DB'
)

# contracts §1a Post-fold, plus the summarised sign flags of §6. None of these
# exists before its group is folded, so none of them can be sorted on.
FOLDED_COLUMNS = (
    'source_count',
    'sign_source_count',
    'direction_source_count',
    'reference_count',
    'is_stimulation',
)

# A stored column of the record. Sorting on it reaches an index and is
# unaffected by the refusal, which is what makes the refusal targeted.
STORED_COLUMN = 'affinity'

# Measured on dev4 2026-08-24 over 14,291,204 collapse keys: 366,940 keys at
# `source_count >= 2`, 15,852 at `>= 3`, 858 at `>= 5`. The test reads these
# from the derive's histogram where it exists and only asserts the ordering
# where it does not.
HAVING_LEVELS = (2, 3, 5)
_HISTOGRAM_TABLE = 'interaction_source_count_histogram'


def _engine(name: str):
    """Import one engine module, or fail naming the module that is missing."""

    try:
        return importlib.import_module(f'api_service.interactions.{name}')
    except ModuleNotFoundError as exc:
        pytest.fail(
            f'the interaction query engine has no `{name}` module '
            f'(expected api_service/interactions/{name}.py, T020h-T020j): {exc}'
        )


def _member(module, name: str, signature: str):
    """Fetch a member of an engine module, or fail naming its contract."""

    member = getattr(module, name, None)

    if member is None:
        pytest.fail(
            f'{module.__name__}.{name} is missing; the engine must provide '
            f'`{signature}`'
        )

    return member


@pytest.fixture(scope='module')
def client():
    pytest.importorskip('fastapi')
    pytest.importorskip('psycopg')

    from fastapi.testclient import TestClient

    from api_service.main import app

    return TestClient(app)


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


def _body(response) -> str:
    """The whole response body as one lowercased string, message key aside."""

    try:
        return json.dumps(response.json()).lower()
    except ValueError:
        return response.text.lower()


def _sorted_payload(column: str, direction: str, resources: list[str] | None = None) -> dict:
    payload: dict[str, Any] = {'order_by': column if direction == 'asc' else f'-{column}', 'limit': 10}

    if resources:
        payload['filters'] = {'resources': resources}

    return payload


def _having_payload(minimum: int, resources: list[str] | None = None) -> dict:
    filters: dict[str, Any] = {'source_count': {'min': minimum}}

    if resources:
        filters['resources'] = resources

    return {'filters': filters, 'limit': 100}


def _plan(db, payload: dict[str, Any]) -> dict[str, Any]:
    """The `EXPLAIN (ANALYZE, BUFFERS)` plan of the engine's page statement."""

    params = _engine('params')
    scope = _engine('scope')
    fold = _engine('fold')

    query = _member(params, 'parse', 'params.parse(payload)')(payload)
    resolved = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None)')(query, conn = db)
    sql, args = _member(fold, 'fold_sql', 'fold.fold_sql(query, resolved)')(query, resolved)

    return db.execute(f'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}', args).fetchone()[
        'QUERY PLAN'
    ][0]['Plan']


def _aggregates(plan: dict[str, Any]) -> list[str]:
    strategies = {'Sorted': 'GroupAggregate', 'Hashed': 'HashAggregate', 'Plain': 'Aggregate'}
    nodes = [plan]
    named = []

    while nodes:
        node = nodes.pop()
        nodes.extend(node.get('Plans') or [])

        if node.get('Node Type', '') in ('Aggregate', 'GroupAggregate', 'HashAggregate'):
            named.append(strategies.get(node.get('Strategy', ''), node['Node Type']))

    return named


def _histogram_at_least(db, minimum: int) -> int | None:
    """Keys with `source_count >= minimum`, as the derive recorded them."""

    present = db.execute(
        'SELECT 1 FROM information_schema.tables '
        'WHERE table_schema = %s AND table_name = %s',
        (SCHEMA, _HISTOGRAM_TABLE),
    ).fetchone()

    if not present:
        return None

    row = db.execute(
        f'SELECT sum(keys) AS n FROM {SCHEMA}.{_HISTOGRAM_TABLE} WHERE source_count >= %s',
        (minimum,),
    ).fetchone()

    return int(row['n']) if row and row['n'] else None


# ── T020e — `ORDER BY` on a folded value is refused ──────────────────────────


def test_the_engine_names_the_folded_columns():
    """The refusal has to know what it refuses, and so does the caller."""

    params = _engine('params')
    folded = _member(params, 'FOLDED_COLUMNS', 'params.FOLDED_COLUMNS: frozenset[str]')

    assert set(FOLDED_COLUMNS) <= set(folded), (
        f'params.FOLDED_COLUMNS is {sorted(folded)}; it must cover every value '
        f'that exists only after the fold: {sorted(FOLDED_COLUMNS)}'
    )
    assert STORED_COLUMN not in folded, (
        f'{STORED_COLUMN} is a stored column of the record and must stay sortable'
    )


@pytest.mark.parametrize('column', FOLDED_COLUMNS)
@pytest.mark.parametrize('direction', ['asc', 'desc'])
def test_sorting_on_a_folded_value_is_refused(client, column, direction):
    """SC-025: 100% of the time, not most of the time."""

    response = client.post('/interactions', json = _sorted_payload(column, direction))

    assert 400 <= response.status_code < 500, (
        f'ORDER BY {direction} on the folded value `{column}` folds every key in '
        f'scope before the top-N heapsort sees a row (measured 5,538 ms '
        f'unscoped); it must be refused with a 4xx, got {response.status_code}'
    )


@pytest.mark.parametrize('column', FOLDED_COLUMNS)
def test_the_refusal_names_the_folded_column(client, column):
    """FR-009: the message is actionable, not a bare status."""

    response = client.post('/interactions', json = _sorted_payload(column, 'desc'))

    assert 400 <= response.status_code < 500
    assert column in _body(response), (
        f'the refusal must name `{column}`; body was {_body(response)}'
    )


@pytest.mark.parametrize('column', FOLDED_COLUMNS)
def test_the_refusal_says_what_to_narrow(client, column):
    """A refusal that names no alternative is a dead end (SC-008)."""

    response = client.post('/interactions', json = _sorted_payload(column, 'desc'))
    body = _body(response)

    assert 400 <= response.status_code < 500
    assert any(word in body for word in ('narrow', 'resources', 'dataset', 'filter')), (
        f'the refusal must say what to narrow; body was {body}'
    )


@pytest.mark.parametrize('column', FOLDED_COLUMNS)
def test_a_narrow_scope_does_not_buy_a_folded_sort(client, column):
    """The work is the whole scope every time, so scoping is not the escape."""

    response = client.post(
        '/interactions', json = _sorted_payload(column, 'desc', ['neuronchat'])
    )

    assert 400 <= response.status_code < 500, (
        f'a scoped ORDER BY on `{column}` still folds its whole scope before it '
        f'can sort; got {response.status_code}'
    )


def test_the_guard_refuses_a_folded_sort_before_the_query_runs(db):
    """§4: estimate then refuse, and the refusal is an exception, not a row."""

    params = _engine('params')
    scope = _engine('scope')
    guard = _engine('guard')

    refusal = _member(guard, 'GuardrailRefusal', 'guard.GuardrailRefusal(Exception)')
    check = _member(guard, 'check', 'guard.check(query, resolved, *, conn = None) -> Estimate')

    query = _member(params, 'parse', 'params.parse(payload)')(
        _sorted_payload('source_count', 'desc')
    )
    resolved = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None)')(query, conn = db)

    with pytest.raises(refusal) as raised:
        check(query, resolved, conn = db)

    assert 400 <= getattr(raised.value, 'status_code', 0) < 500
    assert 'source_count' in str(raised.value)


def test_sorting_on_a_stored_column_is_unaffected(client):
    """R25: the endpoints, the class, affinity, pchembl and score still sort."""

    response = client.post(
        '/interactions', json = _sorted_payload(STORED_COLUMN, 'desc')
    )

    assert response.status_code == 200, (
        f'`{STORED_COLUMN}` is a stored column of the record and reaches an '
        f'index; refusing it would make the guardrail a blanket ban '
        f'({response.status_code}: {_body(response)})'
    )
    assert response.json()['interactions'], (
        f'a sort on `{STORED_COLUMN}` must be served, not answered empty'
    )


# ── T020f — `HAVING` on a folded value is served, and streams ────────────────


@pytest.mark.parametrize('minimum', HAVING_LEVELS)
def test_having_on_a_folded_value_is_served(client, minimum):
    """FR-052: the whole tail is inside SC-002 at present cardinality."""

    response = client.post('/interactions', json = _having_payload(minimum))

    assert response.status_code == 200, (
        f'source_count >= {minimum} streams through GroupAggregate and is '
        f'affordable (measured 1.354 ms, 7.781 ms and 379 ms at >= 2, 3 and 5); '
        f'it must be served, not refused ({_body(response)})'
    )

    body = response.json()

    assert body['interactions'], f'source_count >= {minimum} returned an empty page'


@pytest.mark.parametrize('minimum', HAVING_LEVELS)
def test_having_returns_only_qualifying_rows(client, minimum):
    """The filter is applied per group, after the fold and not before it."""

    rows = client.post('/interactions', json = _having_payload(minimum)).json()['interactions']

    assert rows, f'source_count >= {minimum} returned an empty page'
    assert all(row['source_count'] >= minimum for row in rows), (
        f'a row below source_count {minimum} came back from a HAVING that '
        f'asked for it'
    )


@pytest.mark.parametrize('minimum', HAVING_LEVELS)
def test_having_plans_as_group_aggregate(db, minimum):
    """R25: `HashAggregate` is blocking and would fold the whole scope."""

    aggregates = _aggregates(_plan(db, _having_payload(minimum)))

    assert 'GroupAggregate' in aggregates, (
        f'source_count >= {minimum} must stream: the plan aggregates were '
        f'{aggregates}'
    )
    assert 'HashAggregate' not in aggregates, (
        f'source_count >= {minimum} planned a blocking aggregation; the outer '
        f'LIMIT cannot stop it and it folds the whole scope'
    )


@pytest.mark.parametrize('minimum', HAVING_LEVELS)
def test_having_response_carries_the_guardrail_estimate(client, db, minimum):
    """§4(d): the histogram prices the request, and the caller can see it."""

    body = client.post('/interactions', json = _having_payload(minimum)).json()
    estimate = body.get('estimate')

    assert estimate, (
        'a post-fold filter is priced from the source_count histogram before '
        'it runs (data-model §12), and the estimate is reported rather than '
        f'kept internal; response keys were {sorted(body)}'
    )
    assert 'histogram' in json.dumps(estimate).lower(), (
        f'the estimate must say where it came from; got {estimate}'
    )

    recorded = _histogram_at_least(db, minimum)

    if recorded is not None:
        assert estimate['qualifying_keys'] == recorded, (
            f'the estimate for source_count >= {minimum} must come from the '
            f'derive\'s histogram ({recorded} keys), not from a guess'
        )


def test_the_having_estimate_tightens_with_the_predicate(client):
    """Selectivity falls with the level, so the estimate has to follow it."""

    estimates = [
        client.post('/interactions', json = _having_payload(level)).json()['estimate'][
            'qualifying_keys'
        ]
        for level in HAVING_LEVELS
    ]

    assert estimates == sorted(estimates, reverse = True), (
        f'qualifying keys must fall as source_count rises; got {estimates} for '
        f'{HAVING_LEVELS}'
    )


def test_the_having_estimate_prices_the_fold_not_the_page(client):
    """The cost of a `HAVING` is page ÷ selectivity, and that is the number."""

    body = client.post('/interactions', json = _having_payload(5)).json()
    estimate = body['estimate']

    assert estimate['keys_folded'] > estimate['qualifying_keys'], (
        f'filling a 100-row page at source_count >= 5 folds far more keys than '
        f'qualify (about 1.7 million against 858); got {estimate}'
    )


def test_the_guard_prices_a_having_rather_than_refusing_it(db):
    """The histogram is an estimator, not a gate, at present cardinality."""

    params = _engine('params')
    scope = _engine('scope')
    guard = _engine('guard')

    query = _member(params, 'parse', 'params.parse(payload)')(_having_payload(5))
    resolved = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None)')(query, conn = db)
    estimate = _member(guard, 'check', 'guard.check(query, resolved, *, conn = None)')(
        query, resolved, conn = db
    )

    assert estimate.qualifying_keys > 0
    assert estimate.keys_folded > 0
