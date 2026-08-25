"""The post-fold guardrail: filters are served, sorts are refused.

Both halves are here, in one file, because they are two halves of one rule and
share its fixtures.

The distinction between them is the one the whole design rests on. A `HAVING`
on a folded value **streams**: with input ordered on the group key,
`GroupAggregate` emits each group as its key changes and the outer `LIMIT`
stops the scan, so the cost is page ÷ selectivity. An `ORDER BY` on a folded
value **cannot** stop early — to know which key sorts first the engine folds
every key in scope and then sorts, measured at 5,538 ms unscoped over all
14,291,204 groups, with the `LIMIT` saving nothing because the top-N heapsort
only sees rows the fold has already produced. So one is priced from the
histogram and the other is refused.

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

# The post-fold parameters, plus the summarised sign flags. None of these
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
            f'(expected api_service/interactions/{name}.py): {exc}'
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


# ── `ORDER BY` on a folded value is refused ──────────────────────────────────


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
    """Refused 100% of the time, not most of the time."""

    response = client.post('/interactions', json = _sorted_payload(column, direction))

    assert 400 <= response.status_code < 500, (
        f'ORDER BY {direction} on the folded value `{column}` folds every key in '
        f'scope before the top-N heapsort sees a row (measured 5,538 ms '
        f'unscoped); it must be refused with a 4xx, got {response.status_code}'
    )


@pytest.mark.parametrize('column', FOLDED_COLUMNS)
def test_the_refusal_names_the_folded_column(client, column):
    """The message is actionable, not a bare status."""

    response = client.post('/interactions', json = _sorted_payload(column, 'desc'))

    assert 400 <= response.status_code < 500
    assert column in _body(response), (
        f'the refusal must name `{column}`; body was {_body(response)}'
    )


@pytest.mark.parametrize('column', FOLDED_COLUMNS)
def test_the_refusal_says_what_to_narrow(client, column):
    """A refusal that names no alternative is a dead end."""

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
    """The endpoints, the class, affinity, pchembl and score still sort."""

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


# ── `HAVING` on a folded value is served, and streams ────────────────────────


@pytest.mark.parametrize('minimum', HAVING_LEVELS)
def test_having_on_a_folded_value_is_served(client, minimum):
    """The whole tail stays inside the latency target at this cardinality."""

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
    """`HashAggregate` is blocking, and would fold the whole scope."""

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
        'it runs, and the estimate is reported rather than '
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


# ── The long tail: an unbounded projection and an unindexed filter ───────────
#
# The other half of the cost governor. The folded-value
# rules above are about a column the fold produces. These two are about the
# record's `attributes` document, which no index of this build reaches.
#
# **Measured on dev4 2026-08-24, and the numbers are what decide the bound.** A
# predicate on one long-tail key, unscoped, is an index scan over the whole
# record with the predicate applied as a filter: 14,686,404 rows examined,
# 14,789,117 buffers touched, **12,637 ms**, and the `LIMIT` saves nothing
# because a page bound cannot stop a scan that qualifies no row. The same
# predicate scoped to one resource examines 44,455 rows in **94.9 ms**. In
# between: 410,592 rows in 384 ms and 902,216 rows in 441 ms. So the cost
# tracks the rows the indexed predicates admit, one million of them sits at
# about half a second, and the unscoped scan is twelve times outside the
# one-second budget.
#
# **The timing cannot price the detoast, and this build cannot make it.** The
# `attributes` column is null on all 14,686,404 rows, so a projection of one
# long-tail key costs 1,421 ms against 1,419 ms bare and sixteen keys cost
# 1,420 ms — the extraction measures nothing because there is no document to
# open. The bound is therefore structural rather than timed: it counts the
# record rows the request would open, and the count is right whether or not
# today's rows carry anything.

# A key nothing in this build stores. It has to be a name rather than a real
# column, because the point is that the guardrail prices the *reach* into the
# document and not the value found there.
TAIL_KEY = 'evidence_type'

# A resource whose whole contribution — 44,455 record rows — is small enough
# that an unindexed predicate over it is affordable, measured at 94.9 ms.
NARROW_RESOURCE = 'connectomedb2025'

# A license term that resolves to 30 of the 35 resources and 54.05% of the
# record. It is here because the resolution has to happen **before** the
# estimate: a license filter is a resource filter, and an estimate taken
# before it resolves prices a scope the query will not run.
LICENSE_TERM = 'purpose:commercial'


def _tail_filter_payload(resources: list[str] | None = None) -> dict:
    """A filter on a long-tail key, optionally scoped."""

    filters: dict[str, Any] = {'attribute_filters': {TAIL_KEY: 'binding'}}

    if resources:
        filters['resources'] = resources

    return {'filters': filters, 'limit': 10}


def _tail_projection_payload(**extra: Any) -> dict:
    """A request projecting a long-tail key."""

    payload: dict[str, Any] = {'attributes': [TAIL_KEY], 'limit': 10}
    payload.update(extra)

    return payload


def test_the_long_tail_filter_parameter_exists(client):
    """The governor prices a filter on an unindexed key, so such a filter must exist."""

    params = _engine('params')
    parsed = _member(params, 'parse', 'params.parse(payload)')(
        _tail_filter_payload([NARROW_RESOURCE]),
    )

    assert getattr(parsed.filters, 'attribute_filters', None), (
        'the parameter surface carries no long-tail filter, so the refusal '
        'the cost governor owes for one could never fire; a guardrail that '
        'cannot fire is not a guardrail'
    )


def test_an_unindexed_long_tail_filter_is_refused_unscoped(client):
    """12,637 ms over 14,686,404 rows, twelve times the one-second budget."""

    response = client.post('/interactions', json = _tail_filter_payload())

    assert 400 <= response.status_code < 500, (
        f'an unscoped filter on `{TAIL_KEY}` answered {response.status_code}; '
        f'no index of this build reaches the attribute document, so the '
        f'predicate is applied to every row the scope admits'
    )


def test_the_long_tail_refusal_names_the_key_and_what_to_narrow(client):
    """Actionable, so a caller can act rather than guess."""

    body = _body(client.post('/interactions', json = _tail_filter_payload()))

    assert TAIL_KEY in body, f'the refusal does not name `{TAIL_KEY}`: {body}'
    assert 'resources' in body or 'datasets' in body, (
        f'the refusal does not say what to narrow: {body}'
    )


def test_a_narrow_scope_buys_the_long_tail_filter(client):
    """The refusal is targeted: 44,455 rows is 94.9 ms and is served."""

    response = client.post(
        '/interactions', json = _tail_filter_payload([NARROW_RESOURCE]),
    )

    assert response.status_code == 200, (
        f'a long-tail filter over {NARROW_RESOURCE} answered '
        f'{response.status_code}; refusing an affordable request makes the '
        f'guardrail a blanket ban rather than a price'
    )
    assert 'interactions' in response.json()


def test_the_long_tail_filter_reaches_the_record_predicate(db):
    """A parameter the record filter ignores is a filter in name only."""

    params = _engine('params')
    scope = _engine('scope')
    select = _engine('select')

    query = _member(params, 'parse', 'params.parse(payload)')(
        _tail_filter_payload([NARROW_RESOURCE]),
    )
    resolved = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None)')(
        query, conn = db,
    )
    predicate = _member(
        select, 'record_filter', 'select.record_filter(query, resolved)',
    )(query, resolved)

    # The name binds as an argument rather than as an interpolated identifier.
    # It names a value the document is looked up by, not a column, so it
    # belongs in the parameter list where a caller's string cannot become SQL.
    assert 'attributes' in predicate.sql, (
        f'the record predicate never reaches the attribute document, so the '
        f'filter would return every row of the scope while claiming to have '
        f'narrowed it: {predicate.sql}'
    )
    assert TAIL_KEY in predicate.args, (
        f'`{TAIL_KEY}` is not among the predicate\'s arguments: {predicate.args}'
    )


def test_the_guard_refuses_the_long_tail_filter_before_the_query_runs(db):
    """Estimate, then refuse — never run it and find out."""

    params = _engine('params')
    scope = _engine('scope')
    guard = _engine('guard')

    refusal = _member(guard, 'GuardrailRefusal', 'guard.GuardrailRefusal(Exception)')
    check = _member(guard, 'check', 'guard.check(query, resolved, *, conn = None)')
    query = _member(params, 'parse', 'params.parse(payload)')(_tail_filter_payload())
    resolved = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None)')(
        query, conn = db,
    )

    with pytest.raises(refusal) as raised:
        check(query, resolved, conn = db)

    assert 400 <= raised.value.status_code < 500
    assert TAIL_KEY in str(raised.value.context) or TAIL_KEY in raised.value.message


def test_a_license_filter_resolves_before_the_estimate(db):
    """A license filter **is** a resource filter, and prices as one."""

    params = _engine('params')
    scope = _engine('scope')
    guard = _engine('guard')

    parse = _member(params, 'parse', 'params.parse(payload)')
    resolve = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None)')
    check = _member(guard, 'check', 'guard.check(query, resolved, *, conn = None)')

    licensed = parse({'filters': {'license': LICENSE_TERM}, 'limit': 10})
    resolved = resolve(licensed, conn = db)

    assert resolved.resources, (
        f'{LICENSE_TERM} resolved to no resource set, so the guard would price '
        f'the unscoped record'
    )
    assert resolved.record_share < 1.0, (
        'the license filter left the record share at 1.0; the estimate would '
        'then describe a scope the query does not run'
    )

    open_query = parse({'limit': 10})
    unscoped = check(open_query, resolve(open_query, conn = db), conn = db)

    assert check(licensed, resolved, conn = db).qualifying_keys < unscoped.qualifying_keys


def test_a_license_filter_prices_the_long_tail_filter_it_scopes(client):
    """The estimate reflects the scope actually queried, license included."""

    response = client.post(
        '/interactions',
        json = {
            'filters': {
                'attribute_filters': {TAIL_KEY: 'binding'},
                'license': LICENSE_TERM,
            },
            'limit': 10,
        },
    )

    assert 400 <= response.status_code < 500, (
        f'{LICENSE_TERM} admits 54.05% of the record — about 7.9 million rows '
        f'for the unindexed predicate to be applied to — and answered '
        f'{response.status_code}'
    )


def test_a_stored_range_filter_is_unaffected(client):
    """`affinity` is a stored column, reaches an index, and is not refused."""

    response = client.post(
        '/interactions', json = {'filters': {'affinity': {'min': 0}}, 'limit': 10},
    )

    assert response.status_code == 200, (
        f'a range on a stored column answered {response.status_code}; the '
        f'refusal is about the document, not about ranges'
    )


def test_a_page_bounded_long_tail_projection_is_served(client):
    """Folding the page bounds the projection: about 103 rows per 100 keys."""

    response = client.post('/interactions', json = _tail_projection_payload())

    assert response.status_code == 200, (
        f'an ordinary page projecting `{TAIL_KEY}` answered '
        f'{response.status_code}; the extraction is written into the fold, '
        f'whose FROM starts from the bounded key list'
    )

    rows = response.json()['interactions']

    assert rows and all(TAIL_KEY in (row.get('attributes') or row) for row in rows), (
        'a requested name must be a key of every row, present either way'
    )


def test_an_unbounded_long_tail_projection_is_refused(client):
    """Refused 100% of the time. An exact count walks every key in scope."""

    response = client.post(
        '/interactions', json = _tail_projection_payload(exact_total = True),
    )

    assert 400 <= response.status_code < 500, (
        f'projecting `{TAIL_KEY}` while counting every key of the unscoped '
        f'fold answered {response.status_code}; that is 14,291,204 keys and '
        f'the whole record detoasted'
    )


def test_the_projection_refusal_prices_the_scope_rather_than_naming_it(client):
    """A scoped-but-huge request escapes a rule written as `if unscoped`."""

    wide = client.post(
        '/interactions',
        json = _tail_projection_payload(
            exact_total = True, filters = {'license': LICENSE_TERM},
        ),
    )
    narrow = client.post(
        '/interactions',
        json = _tail_projection_payload(
            exact_total = True, filters = {'resources': [NARROW_RESOURCE]},
        ),
    )

    assert 400 <= wide.status_code < 500, (
        f'a long-tail projection over an exact count of 54.05% of the record '
        f'answered {wide.status_code}; naming the scope instead of pricing it '
        f'lets every large scope but the widest through'
    )
    assert narrow.status_code == 200, (
        f'the same request over {NARROW_RESOURCE} — 44,455 rows — answered '
        f'{narrow.status_code}'
    )


def test_a_hot_column_projection_opens_no_document(client):
    """A hot column is on the row the fold produces, so asking costs nothing."""

    response = client.post(
        '/interactions',
        json = {'attributes': ['source_count'], 'limit': 10, 'exact_total': True,
                'filters': {'resources': [NARROW_RESOURCE]}},
    )

    assert response.status_code == 200, (
        f'projecting a hot column answered {response.status_code}; pricing it '
        f'as a long-tail key would refuse a request that costs nothing'
    )


# ── The estimate itself: a bound the caller can rely on ─────────────────────
#
# **Measured on dev4 2026-08-24.** With an `entity_annotations` filter the
# planner prices an `OR` of two fifteen-thousand-element uuid arrays and gets
# it badly wrong: 8,428,823 estimated keys against 729,900 true for `ligand`,
# and 7,483,451 against 1,273,762 for `receptor` — 11.5x and 5.9x over. The
# flat record count is mispriced the same way (8,531,569 against 794,518), so
# it is the predicate and not the `DISTINCT` that the planner cannot price.
# With the class filter added it undershoots instead: 42,656 against 59,328.
#
# An exact count of the annotated scope costs 1.834 s, which is outside the
# one-second budget and cannot be paid on every request. A key scan bounded at 100,000 keys costs
# 0.282 s and gives the exact answer wherever the answer is smaller than the
# bound — 59,328 in 0.397 s for the ligand-receptor scope, 44,455 in 0.074 s
# for a single resource. So the claim is bounded rather than the planner fixed.

ANNOTATION_CATEGORY = 'ligand'
ANNOTATION_CLASS = 'ligand_receptor'
# Measured by folding the scope: the true key counts the estimate is judged
# against. The test reads them from the database rather than trusting these,
# and they are recorded here so a drift is visible in the diff.
ANNOTATED_TRUE_KEYS = 729_900
ANNOTATED_CLASS_TRUE_KEYS = 59_328


def _annotation_payload(with_class: bool = False, **extra: Any) -> dict:
    filters: dict[str, Any] = {'entity_annotations': [ANNOTATION_CATEGORY]}

    if with_class:
        filters['interaction_classes'] = [ANNOTATION_CLASS]

    return {'filters': filters, 'limit': 10, **extra}


def test_an_annotation_filtered_total_is_exact_where_it_is_small(client):
    """The bounded scan answers exactly whenever the answer fits inside it."""

    body = client.post('/interactions', json = _annotation_payload(True)).json()

    assert int(body['total']) == ANNOTATED_CLASS_TRUE_KEYS, (
        f'the reported total is {body["total"]} against the {ANNOTATED_CLASS_TRUE_KEYS} '
        f'keys the scope actually folds; the planner said 42,656'
    )


def test_an_annotation_filtered_total_does_not_overshoot(client):
    """8,428,823 against 729,900 is not an estimate, it is a wrong number."""

    body = client.post('/interactions', json = _annotation_payload()).json()

    assert int(body['total']) <= ANNOTATED_TRUE_KEYS, (
        f'the reported total is {body["total"]} against {ANNOTATED_TRUE_KEYS} '
        f'true keys; an estimate that overshoots by an order of magnitude '
        f'sends a caller looking for rows that are not there'
    )
    assert body.get('total_is_estimate') is True


def test_a_bounded_total_says_it_is_a_floor(client):
    """A number that is only a lower bound has to say so, or it is a claim."""

    body = client.post('/interactions', json = _annotation_payload()).json()
    estimate = body.get('estimate') or {}

    assert body.get('total_is_lower_bound') is True or estimate.get('at_least') is True, (
        f'the total was bounded at a scan ceiling and the response does not '
        f'say so: {json.dumps(body)[:400]}'
    )


def test_an_unscoped_estimate_is_not_bounded_by_the_scan(client):
    """The bound is for the case the planner cannot price, not for every case."""

    body = client.post('/interactions', json = {'limit': 10}).json()

    assert int(body['total']) > 10_000_000, (
        f'the unscoped total came back as {body["total"]}; the planner prices '
        f'the whole record within half a percent and there is nothing to bound'
    )
