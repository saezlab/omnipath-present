"""What `/interactions` promises a caller who filters it and picks columns.

The engine folds the record for whatever scope a request states, so this file
is about the two halves of that sentence: **which rows come back** when the
caller combines resource, class, organism, dataset, license and collapse
filters, and **which columns** come back when the caller names them.

Four claims are worth stating plainly, because each has a quiet failure mode
that returns a plausible answer:

- **A restricted scope restricts the numbers, not only the rows.** A
  nine-resource ligand-receptor pair, queried through one of those resources,
  must come back saying one resource and not nine. Selecting the wide row and
  testing that its resource array intersects the filter returns the right
  interactions carrying numbers that describe resources the caller excluded.
  That failure mode is asserted here as a failure, not only its fix.
- **A license filter is a resource filter.** It resolves to a resource set
  before anything reads the record, and a resource whose license nobody
  recorded is excluded rather than admitted by default.
- **A projection name the build does not carry is null, never an error.** A
  caller assembling one frame across resources that publish different columns
  asks for the union of them, and the answer is a sparse frame — not a refusal,
  and never a silently shorter row set.
- **A filter name the build does not carry is refused.** The asymmetry is the
  point: an empty page for a misspelt resource says "there are no interactions
  from this resource", which is a different and false statement.

    DATABASE_URL=... pytest tests/test_interactions_query.py -v
"""

from __future__ import annotations

import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason = 'DATABASE_URL not set; the query surface needs a built DB',
)

#: A resource that publishes references and sign, and is small enough to page.
CURATED_RESOURCE = 'signor'

#: A resource that publishes binding measurements, so the hot numeric columns
#: are non-null somewhere and the selection test cannot pass on nulls alone.
AFFINITY_RESOURCE = 'drugcentral'

#: A class slug, and the display label that is output-side only. The label is
#: never a query value: filtering is by slug.
CLASS_SLUG = 'ligand_receptor'
CLASS_LABEL = 'Ligand-receptor'

#: Human, the organism most rows of this build carry.
HUMAN = 9606

#: A preset whose own scope is one resource and one class.
PRESET = 'liana'
PRESET_RESOURCE = 'connectomedb2025'

#: A resource whose recorded purpose level is below `commercial`, and one whose
#: license nobody recorded. Both must fall outside `license=purpose:commercial`,
#: the second because unknown is excluded rather than admitted.
NON_COMMERCIAL_RESOURCE = 'cellinker'
UNKNOWN_LICENSE_RESOURCE = 'recon3d'

#: Names no resource, class or dataset carries — a filter target that has to be
#: refused, and a projection target that has to be null.
ABSENT_NAME = 'no_such_thing_xyz'

#: A JSONB key of the long tail. Whether this build stores any is a separate
#: assertion below. The projection has to behave either way.
LONG_TAIL_KEY = 'mechanism_of_action'


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


def _record(db, sql: str, args: tuple = ()) -> list[dict[str, Any]]:
    """Read the record table, for expectations taken from the build itself.

    Args:
        db: An open connection.
        sql: A statement with `{schema}` and `{record}` placeholders.
        args: Positional arguments.

    Returns:
        The rows, as dicts.
    """

    from api_service.interactions.select import RECORD_TABLE

    return db.execute(
        sql.format(schema = SCHEMA, record = f'{SCHEMA}.{RECORD_TABLE}'),
        args,
    ).fetchall()


@pytest.fixture(scope = 'module')
def shared_key(db) -> dict[str, Any]:
    """One interaction several resources report, with its full contributor set.

    Discovered rather than written down, so a rebuild that reshuffles the
    endpoints changes the expectation with it.

    Args:
        db: An open connection.

    Returns:
        The collapse key, the resources that report it, and their number.
    """

    rows = _record(
        db,
        """
        SELECT r.subject_entity_id, r.object_entity_id, r.interaction_class_id,
               count(DISTINCT r.source_id) AS source_count,
               array_agg(DISTINCT ds.name) AS sources
        FROM {record} r
        JOIN {schema}.data_source ds ON ds.source_id = r.source_id
        WHERE r.interaction_class_id = (
          SELECT interaction_class_id FROM {schema}.vocab_interaction_class
          WHERE name = %s
        )
        GROUP BY 1, 2, 3
        HAVING count(DISTINCT r.source_id) >= 3
        ORDER BY 4 DESC
        LIMIT 1
        """,
        (CLASS_SLUG,),
    )

    if not rows:

        pytest.skip('no interaction in this build has three contributors')

    return dict(rows[0])


@pytest.fixture(scope = 'module')
def split_sign_key(db) -> dict[str, Any]:
    """An interaction one resource signs and another reports without a sign.

    This is the fixture the out-of-scope escape hatch stands or falls on: query
    it through the silent resource and the sign is null. Ask for the widened
    flags and the sign appears, while every count still describes the resource
    the caller queried.

    Args:
        db: An open connection.

    Returns:
        The collapse key, the resource asserting a sign, and one that does not.
    """

    keys = _record(
        db,
        """
        SELECT r.subject_entity_id, r.object_entity_id, r.interaction_class_id
        FROM {record} r
        GROUP BY 1, 2, 3
        HAVING count(DISTINCT r.source_id) > count(DISTINCT r.source_id) FILTER (
                 WHERE r.is_stimulation IS NOT NULL OR r.is_inhibition IS NOT NULL
               )
           AND count(DISTINCT r.source_id) FILTER (
                 WHERE r.is_stimulation IS NOT NULL OR r.is_inhibition IS NOT NULL
               ) >= 1
        LIMIT 1
        """,
    )

    if not keys:

        pytest.skip(
            'no interaction in this build is signed by one resource and '
            'reported without a sign by another',
        )

    key = dict(keys[0])
    rows = _record(
        db,
        """
        SELECT ds.name,
               bool_or(r.is_directed) AS is_directed,
               bool_or(r.is_stimulation) AS is_stimulation,
               bool_or(r.is_inhibition) AS is_inhibition
        FROM {record} r
        JOIN {schema}.data_source ds ON ds.source_id = r.source_id
        WHERE r.subject_entity_id = %s AND r.object_entity_id = %s
          AND r.interaction_class_id = %s
        GROUP BY 1
        """,
        (
            key['subject_entity_id'],
            key['object_entity_id'],
            key['interaction_class_id'],
        ),
    )

    signing = [
        row for row in rows
        if row['is_stimulation'] is not None or row['is_inhibition'] is not None
    ]
    silent = [
        row for row in rows
        if row['is_stimulation'] is None and row['is_inhibition'] is None
    ]

    return {**key, 'signing': signing[0], 'silent': silent[0]}


def _search(client, **params) -> dict[str, Any]:
    """One page from the query endpoint, asserting it answered at all.

    Args:
        client: The test client.
        **params: Query-string parameters.

    Returns:
        The response body.
    """

    response = client.get('/interactions', params = params)

    assert response.status_code == 200, (
        f'/interactions {params} answered {response.status_code}: '
        f'{response.text[:400]}'
    )

    return response.json()


def _page(client, **params) -> list[dict[str, Any]]:
    """One non-empty page, so nothing below can pass on an empty result.

    Args:
        client: The test client.
        **params: Query-string parameters.

    Returns:
        The interactions of the page.
    """

    rows = _search(client, **params)['interactions']

    assert rows, f'/interactions {params} came back empty; nothing to assert on'

    return rows


def _key_params(key: dict[str, Any]) -> dict[str, Any]:
    """The query parameters that reach one collapse key and little else.

    Args:
        key: A collapse key read from the record.

    Returns:
        Query-string parameters naming both endpoints.
    """

    return {
        'entities': f'{key["subject_entity_id"]},{key["object_entity_id"]}',
        'limit': 50,
    }


def _matching(rows: list[dict[str, Any]], key: dict[str, Any]) -> dict[str, Any]:
    """The row of a page that carries one collapse key.

    Args:
        rows: A page.
        key: The collapse key to find.

    Returns:
        The row.
    """

    found = [
        row for row in rows
        if str(row.get('subject_entity_id')) == str(key['subject_entity_id'])
        and str(row.get('object_entity_id')) == str(key['object_entity_id'])
        and int(row.get('interaction_class_id')) == int(key['interaction_class_id'])
    ]

    assert found, (
        f'the page does not carry the key under test; it holds {len(rows)} rows'
    )

    return found[0]


# ── Filtering: the four dimensions, alone and combined ──────────────────────


def test_a_resource_filter_admits_that_resource_and_no_other(client):
    """`resources=` is the scope, and the scope is what the row reports."""

    for row in _page(client, resources = CURATED_RESOURCE, limit = 25):

        assert row['sources'] == [CURATED_RESOURCE], (
            f'a page scoped to {CURATED_RESOURCE} carries a row sourced from '
            f'{row["sources"]}'
        )


def test_an_interaction_class_filter_admits_that_class_and_no_other(client):
    """Filtering is by class slug, and the row says which slug it matched."""

    for row in _page(client, interaction_classes = CLASS_SLUG, limit = 25):

        assert row['interaction_type'] == CLASS_SLUG, (
            f'a page scoped to {CLASS_SLUG} carries a '
            f'{row["interaction_type"]} interaction'
        )


def test_the_class_label_is_output_side_and_never_a_query_value(client):
    """The display label rides on the response and does not select rows."""

    row = _page(client, interaction_classes = CLASS_SLUG, limit = 1)[0]

    assert row['interaction_type_label'] == CLASS_LABEL, (
        f'the class label is missing from the response: {row.get("interaction_type_label")!r}'
    )

    response = client.get(
        '/interactions',
        params = {'interaction_classes': CLASS_LABEL, 'limit': 1},
    )

    assert response.status_code == 400, (
        f'{CLASS_LABEL!r} is a display label and names no class slug, so it '
        f'must be refused rather than served as an empty page; got '
        f'{response.status_code}'
    )


def test_an_organism_filter_admits_that_organism(client):
    """An organism restriction reaches at least one end of every row."""

    for row in _page(client, organism = HUMAN, limit = 25):

        organisms = {row.get('source_organism'), row.get('target_organism')}

        assert HUMAN in organisms, (
            f'a page scoped to taxon {HUMAN} carries a row whose ends are '
            f'{organisms}'
        )


def test_a_dataset_filter_is_the_presets_own_scope(client):
    """`datasets=` carries the preset's resource set *and* its class scope."""

    for row in _page(client, datasets = PRESET, limit = 25):

        assert row['sources'] == [PRESET_RESOURCE], (
            f'the {PRESET} preset served a row sourced from {row["sources"]}'
        )
        assert row['interaction_type'] == CLASS_SLUG, (
            f'the {PRESET} preset served a {row["interaction_type"]} interaction'
        )


def test_the_filters_intersect_rather_than_accumulate(client):
    """Each filter is a restriction, so combining them can only narrow."""

    wide = _search(client, resources = PRESET_RESOURCE, limit = 1)['total']
    narrow = _search(
        client,
        resources = PRESET_RESOURCE,
        interaction_classes = CLASS_SLUG,
        organism = HUMAN,
        limit = 1,
    )['total']

    assert 0 < narrow <= wide, (
        f'combining a class and an organism filter with a resource filter '
        f'reported {narrow} keys against {wide} for the resource alone; a '
        f'restriction that widens the answer is not a restriction'
    )


def test_a_license_filter_resolves_to_a_resource_set(client):
    """A license question is answered as a resource set, before the fold."""

    resources = _search(client, license = 'purpose:commercial', limit = 1)['resources']

    assert resources, 'a license filter admitted no resource at all'
    assert NON_COMMERCIAL_RESOURCE not in resources, (
        f'{NON_COMMERCIAL_RESOURCE} is recorded below the commercial purpose '
        f'level and was still admitted'
    )
    assert UNKNOWN_LICENSE_RESOURCE not in resources, (
        f'{UNKNOWN_LICENSE_RESOURCE} has no recorded license and was admitted '
        f'anyway; unknown is excluded, never permissive by default'
    )


def test_a_license_filter_and_a_resource_filter_intersect(client):
    """Two scope terms are two restrictions, and a row survives both."""

    body = _search(
        client,
        resources = NON_COMMERCIAL_RESOURCE,
        license = 'purpose:commercial',
        limit = 5,
    )

    assert body['interactions'] == [], (
        f'{NON_COMMERCIAL_RESOURCE} does not meet the commercial purpose '
        f'level, so the intersection is empty; {len(body["interactions"])} '
        f'rows came back'
    )


def test_a_license_filtered_page_reports_only_admitted_resources(client):
    """The rows of a license-filtered page carry admitted resources only."""

    body = _search(client, license = 'purpose:commercial', limit = 25)
    admitted = set(body['resources'])

    for row in body['interactions']:

        assert set(row['sources']) <= admitted, (
            f'a license-filtered row cites {row["sources"]}, which is not '
            f'inside the admitted set'
        )


# ── The scope rule: a restricted scope restricts the numbers ────────────────


def test_a_restricted_scope_recomputes_every_summary(client, shared_key):
    """Scope one resource of many, and the row must describe that one."""

    one = sorted(shared_key['sources'])[0]
    row = _matching(
        _page(client, resources = one, **_key_params(shared_key)),
        shared_key,
    )

    assert row['sources'] == [one], (
        f'a page scoped to {one} reports {row["sources"]} as the contributors '
        f'of an interaction {shared_key["source_count"]} resources report'
    )
    assert row['source_count'] == 1, (
        f'source_count is {row["source_count"]} on a single-resource scope'
    )
    assert row['sign_source_count'] <= 1 and row['direction_source_count'] <= 1, (
        f'the assertion counts ({row["sign_source_count"]}, '
        f'{row["direction_source_count"]}) exceed the one resource in scope'
    )


def test_summaries_folded_over_a_wider_scope_are_a_defect(client, shared_key):
    """The failure mode, asserted as a failure and not only as its fix.

    Selecting the widely folded row and testing that its resource array
    intersects the filter returns the right interactions carrying the wrong
    numbers. The scoped answer therefore has to *differ* from the unscoped one
    for the same key — if the two agree, the fold is being reused rather than
    recomputed.
    """

    one = sorted(shared_key['sources'])[0]
    wide = _matching(_page(client, **_key_params(shared_key)), shared_key)
    scoped = _matching(
        _page(client, resources = one, **_key_params(shared_key)),
        shared_key,
    )

    assert wide['source_count'] == shared_key['source_count'], (
        f'the unscoped fold reports {wide["source_count"]} contributors where '
        f'the record holds {shared_key["source_count"]}'
    )
    assert scoped['source_count'] != wide['source_count'], (
        f'the scoped and the unscoped answer both report '
        f'{scoped["source_count"]} contributors for the same interaction, so '
        f'the scoped page is serving numbers folded over resources the caller '
        f'excluded'
    )
    assert set(scoped['sources']) < set(wide['sources']), (
        f'the scoped row cites {scoped["sources"]} where the wide row cites '
        f'{wide["sources"]}; a narrowed scope must narrow the provenance'
    )


# ── Collapse: how far the record is folded, within the query's own scope ────


def test_collapse_none_returns_one_row_per_contributing_resource(client, shared_key):
    """`collapse=none` stops folding, and each row is one resource's record."""

    rows = [
        row for row in _page(client, collapse = 'none', **_key_params(shared_key))
        if str(row['subject_entity_id']) == str(shared_key['subject_entity_id'])
        and str(row['object_entity_id']) == str(shared_key['object_entity_id'])
    ]

    assert len(rows) >= shared_key['source_count'], (
        f'{len(rows)} unfolded rows for an interaction '
        f'{shared_key["source_count"]} resources report'
    )

    for row in rows:

        assert row['source_count'] == 1, (
            f'an unfolded row reports {row["source_count"]} contributors'
        )


def test_collapse_endpoints_folds_the_resources_into_one_row(client, shared_key):
    """The default collapse is one row per ordered endpoints and class."""

    rows = [
        row for row in _page(client, collapse = 'endpoints', **_key_params(shared_key))
        if str(row['subject_entity_id']) == str(shared_key['subject_entity_id'])
        and str(row['object_entity_id']) == str(shared_key['object_entity_id'])
        and int(row['interaction_class_id']) == int(shared_key['interaction_class_id'])
    ]

    assert len(rows) == 1, (
        f'the default collapse returned {len(rows)} rows for one endpoint pair '
        f'and class'
    )
    assert sorted(rows[0]['sources']) == sorted(shared_key['sources']), (
        f'the folded row cites {rows[0]["sources"]} where the record holds '
        f'{shared_key["sources"]}'
    )


# ── Selectable attributes: hot columns and named long-tail keys ─────────────


def test_a_hot_column_is_selectable_by_name(client):
    """A stored column named in `attributes` comes back as its own value."""

    rows = _page(
        client,
        resources = AFFINITY_RESOURCE,
        attributes = 'affinity,pchembl,source_count',
        limit = 200,
    )

    for row in rows:

        selected = row['attributes']

        assert set(selected) == {'affinity', 'pchembl', 'source_count'}, (
            f'the attribute block holds {sorted(selected)}'
        )
        assert selected['affinity'] == row['affinity'], (
            f'the selected affinity {selected["affinity"]!r} disagrees with '
            f'the row\'s own {row["affinity"]!r}'
        )
        assert selected['source_count'] == row['source_count'], (
            f'the selected source_count {selected["source_count"]!r} disagrees '
            f'with the row\'s own {row["source_count"]!r}'
        )

    assert any(row['attributes']['affinity'] is not None for row in rows), (
        f'no row of a {AFFINITY_RESOURCE} page carries an affinity, so this '
        f'test would pass on nulls alone'
    )


def test_a_long_tail_key_is_selectable_by_name(client):
    """A named JSONB key is a column of the answer, present on every row."""

    for row in _page(
        client,
        resources = CURATED_RESOURCE,
        attributes = LONG_TAIL_KEY,
        limit = 25,
    ):

        assert LONG_TAIL_KEY in row['attributes'], (
            f'{LONG_TAIL_KEY} was requested and is missing from the row; a key '
            f'that is present on some rows only breaks a frame consumer'
        )


def test_the_record_carries_no_long_tail_attributes_yet(db):
    """Today's truth, pinned, so the null above is explained rather than assumed.

    Every long-tail projection in this build returns null because the record
    stores no JSONB attributes at all. When a loader starts writing them this
    test fails, which is the signal to assert values rather than shape.
    """

    rows = _record(
        db,
        "SELECT count(*) AS stored FROM {record} WHERE attributes IS NOT NULL",
    )

    assert rows[0]['stored'] == 0, (
        f'{rows[0]["stored"]} record rows now carry long-tail attributes; the '
        f'projection tests can and should assert values now'
    )


def test_the_long_tail_is_extracted_in_one_pass(client):
    """Detoast once: several keys are one pass over the document, not one each."""

    from api_service.interactions import fold, params, project, scope

    query = params.parse({
        'filters': {'resources': [CURATED_RESOURCE]},
        'attributes': 'alpha,beta,gamma',
        'limit': 10,
    })

    with scope.connection() as conn:

        sql, _ = fold.fold_sql(query, scope.resolve(query, conn = conn))

    assert sql.count(project.EXTRACTION) == 1, (
        f'three long-tail keys produced {sql.count(project.EXTRACTION)} '
        f'{project.EXTRACTION} calls; each one detoasts the document again'
    )
    assert '->>' not in sql, (
        'the long tail is still extracted key by key with `->>`, which walks '
        'the document once per requested name'
    )


def test_the_long_tail_is_projected_after_the_page_bound(client):
    """The projection touches a page, not a scope."""

    from api_service.interactions import fold, params, project, scope

    query = params.parse({
        'attributes': 'alpha',
        'limit': 10,
    })

    with scope.connection() as conn:

        sql, _ = fold.fold_sql(query, scope.resolve(query, conn = conn))

    assert sql.index('LIMIT') < sql.index(project.EXTRACTION), (
        'the long-tail extraction is written before the page bound, so it runs '
        'over every key in scope rather than over the page'
    )


def test_the_long_tail_extraction_reads_the_keys_it_is_given(db):
    """The extraction itself, against a document, since the build stores none.

    The record carries no JSONB attributes yet, so every end-to-end projection
    above is null whatever the SQL does. This exercises the fragment directly
    on a document, which is the only place today where a wrong extraction can
    be caught.
    """

    from api_service.interactions import project

    fragment, lateral, args = project.extraction_sql(['alpha', 'beta', 'absent'])

    rows = db.execute(
        f"""
        SELECT {fragment}
        FROM (VALUES ('{{"alpha": "one", "beta": 2}}'::jsonb), (NULL)) AS r(attributes)
        {lateral}
        """.replace('r.attributes', 'r.attributes'),
        args,
    ).fetchall()

    values = [
        {name.split(':', 1)[-1]: value for name, value in row.items()}
        for row in rows
    ]

    assert values[0] == {'alpha': 'one', 'beta': '2', 'absent': None}, (
        f'the extraction read {values[0]} from a document holding alpha and beta'
    )
    assert values[1] == {'alpha': None, 'beta': None, 'absent': None}, (
        f'a row with no attribute document read {values[1]} rather than nulls'
    )


# ── A name the build does not carry: null to project, refused to filter ─────


def test_an_unknown_projection_name_is_null_rather_than_an_error(client):
    """A frame across resources asks for the union of their columns."""

    body = _search(
        client,
        resources = CURATED_RESOURCE,
        attributes = f'{ABSENT_NAME},affinity',
        limit = 10,
    )

    assert body['interactions'], 'the page came back empty'

    for row in body['interactions']:

        assert ABSENT_NAME in row['attributes'], (
            f'{ABSENT_NAME} was requested and the row does not carry the key; '
            f'absent-for-this-row and absent-from-the-schema must look alike '
            f'to a frame consumer'
        )
        assert row['attributes'][ABSENT_NAME] is None, (
            f'{ABSENT_NAME} came back as '
            f'{row["attributes"][ABSENT_NAME]!r} from a build that stores no '
            f'such key'
        )


def test_an_unknown_projection_name_drops_no_interaction(client):
    """Asking for a column nobody stores must not shorten the answer."""

    without = _search(client, resources = CURATED_RESOURCE, limit = 25)
    with_it = _search(
        client,
        resources = CURATED_RESOURCE,
        attributes = ABSENT_NAME,
        limit = 25,
    )

    def keys(body):

        return [
            (
                str(row['subject_entity_id']),
                str(row['object_entity_id']),
                int(row['interaction_class_id']),
            )
            for row in body['interactions']
        ]

    assert keys(with_it) == keys(without), (
        f'requesting an unknown attribute changed the answer from '
        f'{len(keys(without))} interactions to {len(keys(with_it))}'
    )


@pytest.mark.parametrize(
    'parameter',
    ['resources', 'datasets', 'interaction_classes'],
)
def test_an_unknown_filter_target_is_refused(client, parameter):
    """An empty page for a misspelt filter states something false."""

    response = client.get(
        '/interactions',
        params = {parameter: ABSENT_NAME, 'limit': 1},
    )

    assert response.status_code == 400, (
        f'{parameter}={ABSENT_NAME} answered {response.status_code}; an empty '
        f'page says "no interactions match", which is a different claim from '
        f'"this name matches nothing in the build"'
    )
    assert ABSENT_NAME in response.text, (
        f'the refusal does not name {ABSENT_NAME}, so the caller cannot see '
        f'which of their values was the problem: {response.text[:300]}'
    )


def test_a_filter_and_a_projection_of_the_same_unknown_name_differ(client):
    """The asymmetry is the rule, stated in one request."""

    projected = client.get(
        '/interactions',
        params = {
            'resources': CURATED_RESOURCE,
            'attributes': ABSENT_NAME,
            'limit': 1,
        },
    )
    filtered = client.get(
        '/interactions',
        params = {'resources': ABSENT_NAME, 'limit': 1},
    )

    assert projected.status_code == 200, (
        f'projecting {ABSENT_NAME} answered {projected.status_code}'
    )
    assert filtered.status_code == 400, (
        f'filtering on {ABSENT_NAME} answered {filtered.status_code}'
    )


def test_an_empty_intersection_is_not_an_unknown_name(client):
    """A known name that admits nothing is an empty answer, not a refusal."""

    body = _search(
        client,
        datasets = PRESET,
        interaction_classes = 'signaling',
        limit = 5,
    )

    assert body['interactions'] == [], (
        f'the {PRESET} preset carries only {CLASS_SLUG}, so a signaling '
        f'request is empty; {len(body["interactions"])} rows came back'
    )


# ── Shape: integrated by default, by resource on request ────────────────────


def test_attributes_are_integrated_across_the_scope_by_default(client, shared_key):
    """Default output collects the provenance of every in-scope resource."""

    row = _matching(_page(client, **_key_params(shared_key)), shared_key)

    assert 'by_resource' not in row, (
        'the default answer carries a per-resource breakdown nobody asked for'
    )
    assert row['source_count'] == shared_key['source_count'], (
        f'the integrated row reports {row["source_count"]} contributors where '
        f'the record holds {shared_key["source_count"]}'
    )


def test_by_resource_breaks_the_attributes_out_per_contributor(client, shared_key):
    """Each in-scope resource's own assertions, reachable beside the summary."""

    row = _matching(
        _page(client, by_resource = 'true', **_key_params(shared_key)),
        shared_key,
    )

    assert sorted(row['by_resource']) == sorted(shared_key['sources']), (
        f'the breakdown covers {sorted(row["by_resource"])} where the record '
        f'holds {sorted(shared_key["sources"])}'
    )

    for name, detail in row['by_resource'].items():

        assert set(detail) >= {'is_directed', 'is_stimulation', 'is_inhibition'}, (
            f'{name} carries {sorted(detail)}; the per-resource sign and '
            f'direction detail is what makes the summary a convenience rather '
            f'than a replacement'
        )


def test_by_resource_restricts_the_breakdown_to_the_resource_named(client, shared_key):
    """Naming a resource restricts the attributes to that one."""

    one = sorted(shared_key['sources'])[0]
    row = _matching(
        _page(client, by_resource = one, **_key_params(shared_key)),
        shared_key,
    )

    assert list(row['by_resource']) == [one], (
        f'by_resource={one} broke out {list(row["by_resource"])}'
    )


def test_by_resource_leaves_the_integrated_summaries_alone(client, shared_key):
    """A projection choice is not a scope change in disguise."""

    integrated = _matching(_page(client, **_key_params(shared_key)), shared_key)
    one = sorted(shared_key['sources'])[0]
    broken_out = _matching(
        _page(client, by_resource = one, **_key_params(shared_key)),
        shared_key,
    )

    for column in ('sources', 'source_count', 'sign_source_count',
                   'direction_source_count', 'reference_count'):

        assert broken_out[column] == integrated[column], (
            f'asking for a per-resource breakdown changed {column} from '
            f'{integrated[column]!r} to {broken_out[column]!r}; restricting '
            f'the attributes is not restricting the scope'
        )


# ── Sign and direction from outside the queried scope ───────────────────────


def test_the_scoped_answer_carries_no_sign_the_scope_does_not_assert(
        client, split_sign_key,
):
    """The baseline the escape hatch exists for: silence stays silence."""

    silent = split_sign_key['silent']['name']
    row = _matching(
        _page(client, resources = silent, **_key_params(split_sign_key)),
        split_sign_key,
    )

    assert row['is_stimulation'] is None and row['is_inhibition'] is None, (
        f'scoped to {silent}, which asserts no sign, the row reports '
        f'stimulation {row["is_stimulation"]!r} and inhibition '
        f'{row["is_inhibition"]!r}'
    )
    assert row['sign_source_count'] == 0, (
        f'sign_source_count is {row["sign_source_count"]} in a scope where no '
        f'resource asserts a sign'
    )


def test_out_of_scope_sign_widens_the_flags(client, split_sign_key):
    """The escape hatch surfaces what a resource outside the scope asserts."""

    silent = split_sign_key['silent']['name']
    signing = split_sign_key['signing']
    row = _matching(
        _page(
            client,
            resources = silent,
            include_outofscope_signdir = 'true',
            **_key_params(split_sign_key),
        ),
        split_sign_key,
    )

    for flag in ('is_stimulation', 'is_inhibition', 'is_directed'):

        if signing[flag] is not None:

            assert row[flag] == signing[flag], (
                f'{signing["name"]} asserts {flag}={signing[flag]!r} outside '
                f'the queried scope and the widened row reports {row[flag]!r}'
            )


def test_out_of_scope_sign_never_widens_the_counts(client, split_sign_key):
    """The one constraint the escape hatch must not break.

    A widened flag says another resource asserts something. The counts say how
    many resources *in the queried scope* assert it. Letting the second follow
    the first puts the excluded resource back into the numbers, which is the
    defect the scope rule exists to prevent — reintroduced by the parameter
    that was meant to sit beside it.
    """

    silent = split_sign_key['silent']['name']
    plain = _matching(
        _page(client, resources = silent, **_key_params(split_sign_key)),
        split_sign_key,
    )
    widened = _matching(
        _page(
            client,
            resources = silent,
            include_outofscope_signdir = 'true',
            **_key_params(split_sign_key),
        ),
        split_sign_key,
    )

    for column in ('sources', 'source_count', 'sign_source_count',
                   'direction_source_count', 'reference_count',
                   'reference_pubmed_ids'):

        assert widened[column] == plain[column], (
            f'include_outofscope_signdir changed {column} from '
            f'{plain[column]!r} to {widened[column]!r}; it widens the flags '
            f'and nothing else'
        )

    assert widened['sign_source_count'] == 0, (
        f'sign_source_count is {widened["sign_source_count"]} while the only '
        f'resource in scope asserts no sign'
    )


def test_a_widened_flag_says_it_came_from_outside_the_scope(client, split_sign_key):
    """A widened flag beside a zero count is confusing unless it is labelled."""

    silent = split_sign_key['silent']['name']
    row = _matching(
        _page(
            client,
            resources = silent,
            include_outofscope_signdir = 'true',
            **_key_params(split_sign_key),
        ),
        split_sign_key,
    )

    marker = row.get('outofscope_signdir')

    assert marker, (
        'a flag that no in-scope resource asserts came back set, with nothing '
        'on the row saying so'
    )
    assert set(marker) & {'is_directed', 'is_stimulation', 'is_inhibition'}, (
        f'the marker names {sorted(marker)} rather than the flags it widened'
    )
    assert marker.get('resources'), (
        'the marker does not name the resources the widened flags came from'
    )
    assert silent not in marker['resources'], (
        f'{silent} is inside the queried scope and is named as an out-of-scope '
        f'contributor'
    )


def test_the_flags_are_not_widened_when_nobody_was_excluded(client, shared_key):
    """An unscoped query has no outside, so the parameter changes nothing."""

    plain = _matching(_page(client, **_key_params(shared_key)), shared_key)
    widened = _matching(
        _page(client, include_outofscope_signdir = 'true', **_key_params(shared_key)),
        shared_key,
    )

    assert 'outofscope_signdir' not in widened, (
        'an unscoped query reported out-of-scope assertions; every resource is '
        'in scope, so there is no outside to read from'
    )
    assert widened == plain, (
        'the widening parameter changed an unscoped answer'
    )


def test_the_breakdown_follows_the_grain_the_collapse_asked_for(client, shared_key):
    """Unfolded, a row is one resource's record and speaks only for it."""

    rows = [
        row for row in _page(
            client, collapse = 'none', by_resource = 'true',
            **_key_params(shared_key),
        )
        if str(row['subject_entity_id']) == str(shared_key['subject_entity_id'])
        and str(row['object_entity_id']) == str(shared_key['object_entity_id'])
    ]

    assert rows, 'the unfolded page does not carry the key under test'

    for row in rows:

        assert list(row['by_resource']) == list(row['sources']), (
            f'an unfolded row sourced from {row["sources"]} carries a '
            f'breakdown of {list(row["by_resource"])}; the row speaks for one '
            f'resource and the breakdown must say the same'
        )


@pytest.mark.parametrize('collapse', ['none', 'assertion'])
def test_widening_a_flag_that_is_the_group_key_is_refused(client, collapse):
    """A collapse keyed on the flags cannot have those flags rewritten."""

    response = client.get(
        '/interactions',
        params = {
            'resources': CURATED_RESOURCE,
            'collapse': collapse,
            'include_outofscope_signdir': 'true',
            'limit': 5,
        },
    )

    assert response.status_code == 400, (
        f'collapse={collapse} groups on the sign columns, so widening them '
        f'moves rows off their own key; the request answered '
        f'{response.status_code}'
    )
    assert collapse in response.text, (
        f'the refusal does not name the collapse mode that caused it: '
        f'{response.text[:300]}'
    )


def test_a_resource_named_for_the_breakdown_answers_to_its_synonyms(
        client, shared_key,
):
    """One resource has one name here, whichever spelling reached the query."""

    one = sorted(shared_key['sources'])[0]
    row = _matching(
        _page(client, by_resource = one.upper(), **_key_params(shared_key)),
        shared_key,
    )

    assert list(row['by_resource']) == [one], (
        f'by_resource={one.upper()} broke out {list(row["by_resource"])}; the '
        f'resource filter resolves the same spelling and the two must agree'
    )


def test_an_unknown_resource_named_for_the_breakdown_is_refused(client):
    """A misspelt name in the breakdown is a typo, not an empty block."""

    response = client.get(
        '/interactions',
        params = {'by_resource': ABSENT_NAME, 'limit': 1},
    )

    assert response.status_code == 400, (
        f'by_resource={ABSENT_NAME} answered {response.status_code}; an empty '
        f'breakdown reads as "this resource says nothing about these '
        f'interactions", which is a different claim'
    )
