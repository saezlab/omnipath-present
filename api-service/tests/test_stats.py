"""Integration tests for the statistics API.

Counts from /stats/* must equal direct queries against the same precomputed
tables in the same build. Needs DATABASE_URL pointing at a built DB and
the api-service deps (fastapi, psycopg). Skipped when DATABASE_URL is unset.

    DATABASE_URL=postgresql://omnipath:omnipath@localhost:5404/omnipath \
        uv run --with fastapi --with httpx --with psycopg[binary] --with pytest \
        pytest tests/test_stats.py -v
"""

from __future__ import annotations

import os

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason='DATABASE_URL not set; stats test needs a built DB'
)


@pytest.fixture(scope='module')
def client():
    pytest.importorskip('fastapi')
    pytest.importorskip('psycopg')
    from fastapi.testclient import TestClient

    from api_service.main import app

    return TestClient(app)


@pytest.fixture(scope='module')
def db():
    import psycopg
    from psycopg.rows import dict_row

    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
    finally:
        conn.close()


def _facet_map(db, facet_name):
    rows = db.execute(
        f"SELECT facet_value, entity_count FROM {SCHEMA}.facet_entity_bitmap "
        f"WHERE facet_name = %s AND facet_value <> 'Cv Term:OM:0012'",
        [facet_name],
    ).fetchall()
    return {r['facet_value']: int(r['entity_count']) for r in rows}


def test_entity_types_match_facets(client, db):
    expected = _facet_map(db, 'entity_type')
    got = {r['entityType']: r['count'] for r in client.get('/stats/entity-types').json()}
    assert got == expected


def test_chemical_classes_match_facets(client, db):
    expected = _facet_map(db, 'chemical_class')
    got = {
        r['chemicalClass']: r['count']
        for r in client.get('/stats/chemical-classes').json()
    }
    assert got == expected


def test_metabolic_domains_match_facets(client, db):
    expected = _facet_map(db, 'metabolic_domain')
    got = {
        r['metabolicDomain']: r['count']
        for r in client.get('/stats/metabolic-domains').json()
    }
    assert got == expected


def test_build_manifest_matches(client, db):
    row = db.execute(
        f'SELECT build_id, partial_build FROM {SCHEMA}.build_manifest'
    ).fetchone()
    body = client.get('/stats/build-manifest').json()
    assert body['buildId'] == row['build_id']
    assert body['partialBuild'] == bool(row['partial_build'])
    assert {'omnipath_build', 'omnipath_resources'} <= set(body['packageCommits'])


def test_coverage_profile_matches(client, db):
    expected = {
        int(r['source_count']): int(r['n'])
        for r in db.execute(
            f'SELECT source_count, count(*) AS n FROM {SCHEMA}.entity_source_count '
            f'GROUP BY source_count'
        ).fetchall()
    }
    got = {r['nResources']: r['nEntities'] for r in client.get('/stats/coverage-profile').json()}
    assert got == expected


def test_interaction_types_have_class(client, db):
    rows = client.get('/stats/interaction-types').json()
    assert rows
    # Every predicate facet value appears, total matches the predicate facet rows.
    n_predicates = db.execute(
        f"SELECT count(*) AS n FROM {SCHEMA}.facet_relation_bitmap "
        f"WHERE facet_name = 'predicate'"
    ).fetchone()['n']
    assert len(rows) == n_predicates
    assert all('interactionClass' in r for r in rows)


def test_sources_three_name_model(client, db):
    rows = client.get('/stats/sources').json()
    n = db.execute(f'SELECT count(*) AS n FROM {SCHEMA}.resources').fetchone()['n']
    assert len(rows) == n
    assert all({'slug', 'short', 'full', 'entityCount'} <= set(r) for r in rows)


def test_resource_overlap_shape(client, db):
    rows = client.get('/stats/resource-overlap?contentKind=entity').json()
    assert all({'sourceA', 'sourceB', 'overlap'} <= set(r) for r in rows)
