"""`total` is an estimate, and it says so.

An exact count of collapsed rows in a scope is a full fold over that scope
under another name, and `facet_relation_bitmap` cannot answer it either — the
bitmaps carry relation ids per source, at a different grain from the collapse
key. So every response labels its `total` as estimated.

**The unscoped response is not an exception.** The build no longer stores the
precomputed collapse that used to answer it with a `count(*)`, so its `total`
is an estimate like every other. An unlabelled estimate is a quietly wrong
number, which is why the label is asserted and not the number.

An exact count stays available as an **explicit** request that passes through
the cost governor, and a deep `offset` is refused in favour of the `cursor`
rather than served slowly — `OFFSET` on an index-ordered key scan walks the
keys it skips, so page 500 costs 500 pages.

Expected of the engine (`api_service/interactions/`):

    params.parse(payload: dict) -> InteractionQuery      # reads `exact_total`
    scope.resolve(query, *, conn = None) -> ResolvedScope
    guard.check(query, resolved, *, conn = None) -> Estimate
    guard.GuardrailRefusal(Exception)                    # .message, .status_code

and of the route: every `POST /interactions` response carries `total`,
`total_is_estimate` and, where a next page exists, `cursor`.

    DATABASE_URL=... pytest tests/test_interactions_total.py -v
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
    not DATABASE_URL, reason='DATABASE_URL not set; the total-labelling test needs a built DB'
)

# The narrowest resource on dev4 — 373 record rows, 373 collapse keys — so an
# exact count of its scope is cheap enough to assert against the truth.
NARROW_RESOURCE = 'neuronchat'

# `OFFSET` walks the keys it skips. This one is unambiguously deep.
DEEP_OFFSET = 1_000_000
SHALLOW_OFFSET = 100

SCOPES: dict[str, dict[str, Any]] = {
    'unscoped': {'limit': 10},
    'one_resource': {'filters': {'resources': [NARROW_RESOURCE]}, 'limit': 10},
    'twelve_resources': {
        'filters': {
            'resources': [
                'chembl', 'drugcentral', 'guidetopharma', 'stitch', 'hmdb',
                'recon3d', 'signor', 'reactome', 'intact', 'cellphonedb',
                'cellchat', 'nichenet',
            ],
        },
        'limit': 10,
    },
    'one_class': {'filters': {'interaction_classes': ['ligand_receptor']}, 'limit': 10},
}


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


@pytest.fixture(scope='module')
def narrow_scope_keys(db) -> int:
    """The exact number of collapse keys the narrow resource contributes."""

    return db.execute(
        f"""
        SELECT count(*) AS n
        FROM (
          SELECT 1
          FROM {SCHEMA}.interaction_fact_resource f
          JOIN {SCHEMA}.data_source ds ON ds.source_id = f.source_id
          WHERE ds.name = %s
          GROUP BY f.subject_entity_id, f.object_entity_id, f.interaction_class_id
        ) k
        """,
        (NARROW_RESOURCE,),
    ).fetchone()['n']


def _body(response) -> str:
    try:
        return json.dumps(response.json()).lower()
    except ValueError:
        return response.text.lower()


@pytest.mark.parametrize('name', sorted(SCOPES))
def test_every_response_labels_its_total(client, name):
    """The label is a required field, not an optional annotation."""

    body = client.post('/interactions', json = SCOPES[name]).json()

    assert 'total' in body, f'{name}: response carries no total ({sorted(body)})'
    assert 'total_is_estimate' in body, (
        f'{name}: `total` is unlabelled. An estimate that does not say it is '
        f'one is quietly wrong'
    )
    assert isinstance(body['total_is_estimate'], bool)


@pytest.mark.parametrize('name', sorted(SCOPES))
def test_an_unrequested_total_is_an_estimate(client, name):
    """No response counts the fold unless the caller asked it to."""

    body = client.post('/interactions', json = SCOPES[name]).json()

    assert body['total_is_estimate'] is True, (
        f'{name}: an exact total is a full fold over the scope and is an '
        f'explicit request; a default response must estimate'
    )


def test_the_unscoped_total_is_an_estimate_too(client):
    """No stored table answers this one with a `count(*)` any more."""

    body = client.post('/interactions', json = {'limit': 10}).json()

    assert body['total_is_estimate'] is True, (
        'the unscoped scope is the scope containing every resource, not an '
        'exception to the rule; there is no stored collapse left to count'
    )
    assert body['total'] > 0


def test_an_exact_total_is_exact_for_a_narrow_scope(client, narrow_scope_keys):
    """The capability is not withdrawn, only moved behind an explicit ask."""

    body = client.post(
        '/interactions',
        json = {'filters': {'resources': [NARROW_RESOURCE]}, 'limit': 10, 'exact_total': True},
    ).json()

    assert body['total_is_estimate'] is False, (
        'an explicitly requested exact count must not come back labelled as an '
        'estimate'
    )
    assert body['total'] == narrow_scope_keys, (
        f"exact total {body['total']} against {narrow_scope_keys} collapse keys "
        f'in the {NARROW_RESOURCE} scope'
    )


def test_an_exact_total_passes_through_the_guardrail(db):
    """§4: an exact count is priced as the full fold it is, before it runs."""

    params = _engine('params')
    scope = _engine('scope')
    guard = _engine('guard')

    refusal = _member(guard, 'GuardrailRefusal', 'guard.GuardrailRefusal(Exception)')
    check = _member(guard, 'check', 'guard.check(query, resolved, *, conn = None) -> Estimate')

    query = _member(params, 'parse', 'params.parse(payload)')({'exact_total': True, 'limit': 10})
    resolved = _member(scope, 'resolve', 'scope.resolve(query, *, conn = None)')(query, conn = db)

    record_rows = db.execute(
        f'SELECT count(*) AS n FROM {SCHEMA}.interaction_fact_resource'
    ).fetchone()['n']

    try:
        estimate = check(query, resolved, conn = db)
    except refusal as exc:
        assert 400 <= getattr(exc, 'status_code', 0) < 500
        assert 'total' in str(exc).lower()
        return

    assert estimate.keys_folded >= record_rows / 10, (
        f'an unscoped exact total folds every group in the record; the guard '
        f'priced it at {estimate.keys_folded} keys against {record_rows} '
        f'record rows, which is not the whole fold'
    )


def test_a_deep_offset_is_refused(client):
    """`OFFSET` walks the keys it skips, so page 10,000 costs 10,000 pages."""

    response = client.post('/interactions', json = {'limit': 100, 'offset': DEEP_OFFSET})

    assert 400 <= response.status_code < 500, (
        f'offset {DEEP_OFFSET} must be refused rather than served slowly; got '
        f'{response.status_code}'
    )


def test_the_deep_offset_refusal_names_the_cursor(client):
    """The refusal names the alternative that is cheap."""

    body = _body(client.post('/interactions', json = {'limit': 100, 'offset': DEEP_OFFSET}))

    assert 'cursor' in body, (
        f'the fold key is the collapse index\'s leading column set, so keyset '
        f'paging is available and the refusal must name it; body was {body}'
    )


def test_a_shallow_offset_is_still_served(client):
    """The refusal is a depth bound, not a ban on `offset`."""

    response = client.post('/interactions', json = {'limit': 100, 'offset': SHALLOW_OFFSET})

    assert response.status_code == 200, (
        f'offset {SHALLOW_OFFSET} is one page in; refusing it would make the '
        f'guardrail a ban ({_body(response)})'
    )

    body = response.json()

    assert body['interactions'], f'offset {SHALLOW_OFFSET} came back empty'
    assert body['total_is_estimate'] is True


def test_a_page_carries_the_cursor_that_resumes_it(client):
    """The response has to hand back what the refusal tells callers to use."""

    body = client.post('/interactions', json = {'limit': 100}).json()

    assert body.get('cursor'), (
        f'a full page must carry the cursor that resumes after its last key; '
        f'response keys were {sorted(body)}'
    )


def test_the_cursor_resumes_after_the_last_key_returned(client):
    """Keyset paging, and the pages do not overlap."""

    first = client.post('/interactions', json = {'limit': 100}).json()
    second = client.post(
        '/interactions', json = {'limit': 100, 'cursor': first['cursor']}
    ).json()

    assert second['interactions'], 'the cursor returned an empty second page'

    seen = {json.dumps(row, sort_keys = True) for row in first['interactions']}
    following = {json.dumps(row, sort_keys = True) for row in second['interactions']}

    assert not (seen & following), (
        'the cursor must resume after the last key of the first page, not '
        'repeat it'
    )
