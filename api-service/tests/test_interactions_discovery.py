"""Discovery: what a scope can still be asked for, and how much of it there is.

The two discovery endpoints answer questions *about* a query
without running it. `/interactions/parameter-values` says which values each
parameter can still take under the current scope. `/interactions/stats` says
how much the scope holds. Neither returns an interaction, and that is the point
of both — a caller narrowing a filter should not have to page through the rows
to find out whether the next narrowing leaves anything.

Three properties are asserted here, and each answers a way the pair can go
quietly wrong.

**The reachable-value set covers the whole parameter surface.** A discovery
endpoint that reports five of the twenty-eight parameters teaches a caller that
the other twenty-three do not exist. So every parameter of every group is
present in the answer, and the test derives that list from the engine's own
group mapping rather than from a copy of it.

**A post-fold parameter has no reachable values.** `source_count` is not drawn
from a vocabulary — it is a distribution, and the honest answer is the
distribution. Reporting `[1, 2, 3, …]` as though those were values to pick from
would invite a caller to pick 9 and meet the fold.

**A count is labelled with what it counted.** There is no stored collapse in
the build, so the number of interactions in a scope is either read from
something the derive recorded or it is an estimate. An unlabelled one is the
quietly wrong number this whole surface is built to avoid.

Expected of the service:

    GET /interactions/parameter-values -> {"parameters": {name: {...}}, ...}
    GET /interactions/stats            -> {"total": …, "by_resource": [...], …}
    api_service.interactions.params.PARAMETER_GROUPS
    api_service.interactions.annotate.categories() -> list[str]

    DATABASE_URL=... pytest tests/test_interactions_discovery.py -v
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
    not DATABASE_URL,
    reason = 'DATABASE_URL not set; the discovery test needs a built DB',
)

# A single-resource scope with exactly one interaction class in it, measured on
# dev4: 44,455 record rows, all of class `ligand_receptor`. It is the sharpest
# available test of scoping, because narrowing to it must drop the reachable
# class list from seven values to one.
NARROW_RESOURCE = 'connectomedb2025'
NARROW_CLASS = 'ligand_receptor'

# The classes the record actually carries, measured on dev4 2026-08-24. The
# `predicate` facet of `facet_relation_bitmap` rolls up to four of them and
# knows nothing of the other three, so a per-class count taken from that facet
# would silently omit 103,322 record rows — including every ligand-receptor
# one. That is why this list is asserted rather than assumed.
POPULATED_CLASSES = {
    'other': 13_623_743,
    'signaling': 884_195,
    'ligand_receptor': 76_512,
    'maturation': 53_316,
    'orthosteric': 25_813,
    'transport': 21_828,
    'allosteric': 997,
}

# The nine-level `source_count` histogram the derive records,
# summing to the folded key count. `/interactions/stats` answers the unscoped
# total from it rather than by folding fourteen million record rows.
_HISTOGRAM_TABLE = 'interaction_source_count_histogram'

# A key naming rows. No discovery response may carry one: both endpoints answer
# about a query without running it.
ROW_KEYS = ('interactions', 'rows', 'participants', 'records')


def _engine(name: str):
    """Import one engine module, or fail naming the module that is missing."""

    try:

        return importlib.import_module(f'api_service.interactions.{name}')

    except ModuleNotFoundError as exc:

        pytest.fail(
            f'the interaction query engine has no `{name}` module '
            f'({exc}); discovery is answered by the same engine',
        )


@pytest.fixture(scope = 'module')
def client():

    pytest.importorskip('fastapi')
    pytest.importorskip('psycopg')

    from fastapi.testclient import TestClient

    from api_service.main import app

    return TestClient(app)


@pytest.fixture(scope = 'module')
def db():

    pytest.importorskip('psycopg')

    import psycopg
    from psycopg.rows import dict_row

    conn = psycopg.connect(DATABASE_URL, row_factory = dict_row)

    try:

        yield conn

    finally:

        conn.close()


@pytest.fixture(scope = 'module')
def recorded_keys(db) -> int:
    """The folded key count, as the derive recorded it — never folded here."""

    row = db.execute(
        f'SELECT sum(keys)::bigint AS keys FROM {SCHEMA}.{_HISTOGRAM_TABLE}',
    ).fetchone()

    if not row or not row['keys']:

        pytest.skip(f'{_HISTOGRAM_TABLE} carries no rows in this build')

    return int(row['keys'])


def _values(answer: dict[str, Any], parameter: str) -> dict[str, Any]:
    """One parameter's entry of a parameter-values answer."""

    parameters = answer.get('parameters')

    assert isinstance(parameters, dict), (
        f'the answer carries no `parameters` mapping: {sorted(answer)}'
    )
    assert parameter in parameters, (
        f'`{parameter}` is missing from the reachable-value answer; it carries '
        f'{sorted(parameters)}'
    )

    return parameters[parameter]


def _named(entries: Any, key: str) -> dict[str, int]:
    """A list of `{key: name, count: n}` entries as a mapping."""

    assert isinstance(entries, list), f'expected a list of counts, got {entries!r}'

    return {entry[key]: int(entry['count']) for entry in entries}


# ── Discovery — the reachable values, without any row ────────────────────────


def test_the_parameter_values_endpoint_answers(client):
    """The endpoint exists and answers a bare request."""

    response = client.get('/interactions/parameter-values')

    assert response.status_code == 200, response.text


def test_the_reachable_values_carry_no_interaction(client):
    """The possible values, and no underlying row."""

    answer = client.get('/interactions/parameter-values').json()
    carried = [key for key in ROW_KEYS if key in answer]

    assert carried == [], (
        f'the discovery answer carries {carried}; this endpoint returns the '
        f'reachable values and no underlying row'
    )


def test_every_parameter_of_the_surface_is_reported(client):
    """The whole surface, not the five dimensions the earlier scaffold listed."""

    params = _engine('params')
    answer = client.get('/interactions/parameter-values').json()
    reported = set(answer.get('parameters') or {})
    surface = {
        name for names in params.PARAMETER_GROUPS.values() for name in names
    }
    missing = sorted(surface - reported)

    assert missing == [], (
        f'{len(missing)} parameters of the query surface are absent from the '
        f'reachable-value answer ({missing}); a discovery endpoint that omits '
        f'a parameter teaches a caller it does not exist'
    )


def test_each_parameter_says_what_kind_of_answer_it_gives(client):
    """A value list, a distribution and a range are not the same answer."""

    answer = client.get('/interactions/parameter-values').json()
    kinds = {
        name: entry.get('kind')
        for name, entry in (answer.get('parameters') or {}).items()
    }
    unlabelled = sorted(name for name, kind in kinds.items() if not kind)

    assert unlabelled == [], (
        f'{unlabelled} report values without saying what kind of answer it is'
    )


def test_the_resource_values_carry_scoped_counts(client):
    """Per dimension, the reachable values **and** their scoped counts."""

    entry = _values(client.get('/interactions/parameter-values').json(), 'resources')
    counts = _named(entry.get('values'), 'value')

    assert len(counts) >= 30, (
        f'only {len(counts)} resources are reachable unscoped; the source '
        f'facet carries 35'
    )
    assert NARROW_RESOURCE in counts, (
        f'{NARROW_RESOURCE} is not among the reachable resources'
    )
    assert all(count > 0 for count in counts.values()), (
        'a reachable value with a zero count is not reachable'
    )


def test_the_counts_are_scoped_rather_than_global(client):
    """A count that does not move with the scope is the global count relabelled."""

    unscoped = _named(
        _values(
            client.get('/interactions/parameter-values').json(),
            'interaction_classes',
        ).get('values'),
        'value',
    )
    scoped = _named(
        _values(
            client.get(
                '/interactions/parameter-values',
                params = {'resources': NARROW_RESOURCE},
            ).json(),
            'interaction_classes',
        ).get('values'),
        'value',
    )

    assert set(unscoped) >= set(POPULATED_CLASSES), (
        f'the unscoped class list {sorted(unscoped)} is missing '
        f'{sorted(set(POPULATED_CLASSES) - set(unscoped))}'
    )
    assert list(scoped) == [NARROW_CLASS], (
        f'scoped to {NARROW_RESOURCE} the reachable classes are '
        f'{sorted(scoped)}; that resource carries {NARROW_CLASS} alone'
    )
    assert scoped[NARROW_CLASS] < unscoped[NARROW_CLASS], (
        'the scoped class count equals the unscoped one, so the scope reached '
        'the value list and not the counts'
    )


def test_a_post_fold_parameter_reports_a_distribution(client):
    """`source_count` has no reachable values — it has a histogram."""

    params = _engine('params')
    answer = client.get('/interactions/parameter-values').json()

    for name in params.PARAMETER_GROUPS['post_fold']:

        entry = _values(answer, name)

        assert entry.get('kind') == 'histogram', (
            f'`{name}` reports kind {entry.get("kind")!r}; a post-fold value '
            f'is drawn from no vocabulary and the honest answer is its '
            f'distribution'
        )
        assert 'values' not in entry, (
            f'`{name}` reports a value list, which invites a caller to pick '
            f'one and meet the fold'
        )


def test_the_source_count_histogram_is_the_derives_own(client, recorded_keys):
    """The distribution is read from the recorded histogram, not recomputed."""

    entry = _values(
        client.get('/interactions/parameter-values').json(),
        'source_count',
    )
    histogram = entry.get('histogram')

    assert isinstance(histogram, list) and histogram, (
        f'`source_count` carries no histogram: {entry}'
    )

    levels = {int(row['source_count']): int(row['keys']) for row in histogram}

    assert sum(levels.values()) == recorded_keys, (
        f'the reported histogram sums to {sum(levels.values())} against the '
        f'derive\'s {recorded_keys}'
    )
    assert max(levels) >= 2, 'a one-level histogram describes no distribution'


def test_the_annotation_categories_are_listed(client):
    """The seam is `annotate.categories()`, and the endpoint has to reach it."""

    annotate = _engine('annotate')
    entry = _values(
        client.get('/interactions/parameter-values').json(),
        'entity_annotations',
    )
    reported = {row['value'] for row in (entry.get('values') or [])}

    assert reported == set(annotate.categories()), (
        f'the endpoint lists {sorted(reported)} against the registered '
        f'{annotate.categories()}'
    )


def test_a_closed_vocabulary_parameter_lists_its_words(client):
    """`collapse` takes three words, and a caller should not have to guess."""

    params = _engine('params')
    entry = _values(client.get('/interactions/parameter-values').json(), 'collapse')
    reported = {row['value'] for row in (entry.get('values') or [])}

    assert reported == set(params.COLLAPSE_MODES), (
        f'`collapse` reports {sorted(reported)} against '
        f'{sorted(params.COLLAPSE_MODES)}'
    )


def test_an_unknown_scope_value_is_refused_rather_than_answered_emptily(client):
    """A misspelt resource earns a 4xx here as it does on the query itself."""

    response = client.get(
        '/interactions/parameter-values',
        params = {'resources': 'connectomedb'},
    )

    assert response.status_code == 400, (
        f'a bare-slug resource answered {response.status_code}; an empty '
        f'reachable-value set states that nothing is reachable, which is a '
        f'different and false claim'
    )


# ── Statistics — the counts, without any row ─────────────────────────────────


def test_the_stats_endpoint_answers(client):
    """The endpoint exists and answers a bare request."""

    response = client.get('/interactions/stats')

    assert response.status_code == 200, response.text


def test_the_stats_carry_no_interaction(client):
    """Summary counts for a query. No rows returned."""

    answer = client.get('/interactions/stats').json()
    carried = [key for key in ROW_KEYS if key in answer]

    assert carried == [], (
        f'the statistics answer carries {carried}; this endpoint returns counts '
        f'and no row'
    )


def test_the_unscoped_total_is_the_derives_recorded_count(client, recorded_keys):
    """No stored collapse to count, so the recorded histogram answers it."""

    answer = client.get('/interactions/stats').json()

    assert int(answer['total']) == recorded_keys, (
        f'the unscoped total is {answer["total"]} against the derive\'s '
        f'recorded {recorded_keys}; folding the record to answer this would '
        f'be the blocking aggregation that folding the page avoids'
    )
    assert answer.get('total_is_estimate') is False, (
        'a number read from a recorded count is not an estimate, and saying '
        'it is teaches a caller to distrust the one number that is exact'
    )
    assert 'source' in json.dumps(answer).lower(), (
        'the answer does not say where its numbers came from'
    )


def test_a_scoped_total_is_labelled_as_an_estimate(client):
    """The keys of a resource subset are not a number any facet holds."""

    answer = client.get(
        '/interactions/stats', params = {'resources': NARROW_RESOURCE},
    ).json()

    assert answer.get('total_is_estimate') is True, (
        'a scoped total came back unlabelled; an estimate that does not say '
        'it is one is the quietly wrong number this endpoint exists to avoid'
    )
    assert 0 < int(answer['total']) < 1_000_000


def test_the_per_resource_counts_come_from_the_facet(client):
    """The precomputed-facet pattern of the statistics surface, not a scan."""

    answer = client.get('/interactions/stats').json()
    counts = _named(answer.get('by_resource'), 'resource')

    assert len(counts) >= 30, f'only {len(counts)} resources counted'
    assert counts.get(NARROW_RESOURCE) == 44_455, (
        f'{NARROW_RESOURCE} counts {counts.get(NARROW_RESOURCE)} against the '
        f'44,455 the source facet records'
    )


def test_the_per_type_counts_cover_every_populated_class(client):
    """The `predicate` facet knows four classes. The record carries seven."""

    answer = client.get('/interactions/stats').json()
    counts = _named(answer.get('by_interaction_type'), 'interaction_type')
    missing = sorted(set(POPULATED_CLASSES) - set(counts))

    assert missing == [], (
        f'{missing} are absent from the per-type counts; rolling the '
        f'`predicate` facet up to the class vocabulary omits exactly these, '
        f'and a zero for a populated class is a false statement'
    )

    for slug, expected in POPULATED_CLASSES.items():

        assert counts[slug] == expected, (
            f'{slug} counts {counts[slug]} against the {expected} record rows '
            f'measured on this build'
        )


def test_the_per_dataset_counts_name_the_registered_presets(client):
    """Per-dataset counts, from the registry the scope resolution reads."""

    answer = client.get('/interactions/stats').json()
    counts = _named(answer.get('by_dataset'), 'dataset')

    assert counts, 'no dataset is counted, though the registry carries presets'
    assert all(count > 0 for count in counts.values()), (
        f'a registered preset counts zero: {counts}'
    )


def test_the_statistics_narrow_with_the_scope(client):
    """A statistic that ignores the scope is the global number relabelled."""

    scoped = client.get(
        '/interactions/stats', params = {'resources': NARROW_RESOURCE},
    ).json()
    resources = _named(scoped.get('by_resource'), 'resource')
    classes = _named(scoped.get('by_interaction_type'), 'interaction_type')

    assert list(resources) == [NARROW_RESOURCE], (
        f'scoped to one resource the per-resource block reports '
        f'{sorted(resources)}'
    )
    assert list(classes) == [NARROW_CLASS], (
        f'scoped to {NARROW_RESOURCE} the per-type block reports '
        f'{sorted(classes)}'
    )


def test_an_exact_scoped_total_is_an_explicit_request(client):
    """Never quietly folded — a fold is asked for, priced and labelled."""

    answer = client.get(
        '/interactions/stats',
        params = {'resources': NARROW_RESOURCE, 'exact_total': 'true'},
    ).json()

    assert answer.get('total_is_estimate') is False
    assert int(answer['total']) == 44_455, (
        f'the exact count of the {NARROW_RESOURCE} scope is '
        f'{answer["total"]}; this resource folds nothing, so its key count '
        f'equals its record count'
    )
