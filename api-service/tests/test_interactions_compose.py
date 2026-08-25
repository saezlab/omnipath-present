"""The composition order rule, asserted as a failure and as a fix.

The per-resource summaries must describe the scope that produced them, never a
wider one. Serving a narrow scope from a precomputed all-resources collapse
used to break that between tables, and the build no longer stores one. The
composition engine can reintroduce the same defect between **components**.
Collapsing each component and then unioning them emits one row per component
for an interaction that several components report. Each row carries summaries
folded over its own component's resources alone.

The rule — collapse **after** the union, over the union's own resolved scope —
is otherwise held by a comment, so this asserts the wrong order actually
produces the wrong rows before asserting the right order produces the right
one. A test that only checked the fix would pass against an implementation that
had no order at all.

The same rule in its second form: `exclude` runs **before** the collapse, so an
excluded resource contributes no row and no count. Dropping it afterwards
leaves its contribution inside `source_count`, `references` and the sign flags,
which is the same defect under another name ("retained for provenance" means
the rows stay in `interaction_fact_resource` for another query to find, not
that the resource appears in this composition's provenance).

Expected of the engine (`api_service/interactions/compose.py`):

    component(payload: dict) -> Component
    union(components: Sequence[Node]) -> Node
    collapse(node: Node) -> Node
    exclude(node: Node, resources: Sequence[str]) -> Node
    annotate(node: Node, layer: str) -> Node
    run(node: Node, *, conn = None) -> list[dict]

`run` returns the collapsed shape keyed by entity ids, the
same shape `fold.fold_rows` returns, so a composition and a query are
comparable row for row.

    DATABASE_URL=... pytest tests/test_interactions_compose.py -v
"""

from __future__ import annotations

import importlib
import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason='DATABASE_URL not set; the composition test needs a built DB'
)

# A key several resources report, split across two components that both
# report it.
# On dev4 2026-08-24 the key carries chembl, drugcentral, guidetopharma and
# stitch; the two components below take three of the four between them.
FIXTURE_SUBJECT = '70e58f8b-e6bf-eb86-e03f-e58428627c09'
FIXTURE_OBJECT = '18d34c29-41d4-4d67-546a-75b45f5bc336'
FIXTURE_CLASS = 'orthosteric'

LEFT_RESOURCES = ['chembl']
RIGHT_RESOURCES = ['guidetopharma', 'stitch']
UNION_RESOURCES = sorted([*LEFT_RESOURCES, *RIGHT_RESOURCES])

# chembl's own reference, absent from the right component.
LEFT_ONLY_PUBMED = '39240657'


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
            f'{module.__name__}.{name} is missing; the composition algebra must '
            f'provide `{signature}`'
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


def _compose():
    """The composition algebra, or a failure naming what is missing."""

    return _engine('compose')


def _component(compose, resources: list[str]):
    """One component query, pinned to the fixture key so it stays cheap."""

    return _member(compose, 'component', 'compose.component(payload) -> Component')({
        'filters': {
            'resources': resources,
            'entities': [FIXTURE_SUBJECT, FIXTURE_OBJECT],
            'interaction_classes': [FIXTURE_CLASS],
        },
        'limit': 500,
    })


def _rows_for_key(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        row for row in rows
        if str(row.get('subject_entity_id')) == FIXTURE_SUBJECT
        and str(row.get('object_entity_id')) == FIXTURE_OBJECT
    ]


def _run(compose, node, db) -> list[dict[str, Any]]:
    return list(_member(compose, 'run', 'compose.run(node, *, conn = None) -> list[dict]')(
        node, conn = db
    ))


def test_collapsing_before_the_union_emits_one_row_per_component(db):
    """The failure mode, asserted: the wrong order splits the interaction."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    wrong = union([
        collapse(_component(compose, LEFT_RESOURCES)),
        collapse(_component(compose, RIGHT_RESOURCES)),
    ])
    rows = _rows_for_key(_run(compose, wrong, db))

    assert len(rows) == 2, (
        f'collapsing each component before the union must emit one row per '
        f'component for an interaction both components report; got {len(rows)}'
    )


def test_collapsing_before_the_union_folds_each_row_over_its_own_component(db):
    """A split row carries its component's numbers, not the whole scope's."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    wrong = union([
        collapse(_component(compose, LEFT_RESOURCES)),
        collapse(_component(compose, RIGHT_RESOURCES)),
    ])
    rows = _rows_for_key(_run(compose, wrong, db))
    by_sources = {tuple(sorted(row['sources'])): row for row in rows}

    assert set(by_sources) == {tuple(LEFT_RESOURCES), tuple(RIGHT_RESOURCES)}

    left = by_sources[tuple(LEFT_RESOURCES)]
    right = by_sources[tuple(RIGHT_RESOURCES)]

    assert left['source_count'] == 1
    assert right['source_count'] == 2
    assert left['is_stimulation'] is None, (
        'chembl asserts no positive sign, and a per-component fold cannot see '
        'the resources that do'
    )
    assert right['is_stimulation'] is True
    assert LEFT_ONLY_PUBMED in (left['reference_pubmed_ids'] or [])
    assert LEFT_ONLY_PUBMED not in (right['reference_pubmed_ids'] or [])


def test_the_union_is_collapsed_over_its_own_scope(db):
    """The fix: one row, folded over the resources the union actually holds."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    right_order = collapse(union([
        _component(compose, LEFT_RESOURCES),
        _component(compose, RIGHT_RESOURCES),
    ]))
    rows = _rows_for_key(_run(compose, right_order, db))

    assert len(rows) == 1, (
        f'the collapse runs after the union, so an interaction both components '
        f'report is one row; got {len(rows)}'
    )

    row = rows[0]

    assert sorted(row['sources']) == UNION_RESOURCES
    assert row['source_count'] == 3
    assert row['sign_source_count'] == 3
    assert row['is_stimulation'] is True
    assert row['is_inhibition'] is True
    assert row['reference_count'] == 3, (
        'the reference union is recomputed over the union\'s scope, not '
        'carried from either component'
    )


def test_the_two_orders_disagree(db):
    """Stated once, in one place: the order is not stylistic."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    components = [_component(compose, LEFT_RESOURCES), _component(compose, RIGHT_RESOURCES)]

    wrong = _rows_for_key(_run(compose, union([collapse(c) for c in components]), db))
    right = _rows_for_key(_run(compose, collapse(union(components)), db))

    assert len(wrong) != len(right)
    assert max(row['source_count'] for row in wrong) < right[0]['source_count'], (
        'no component-local fold can reach the union\'s source_count, which is '
        'exactly why the collapse must run after the union'
    )


def test_exclude_runs_before_the_collapse(db):
    """An excluded resource contributes no row **and no count**."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')
    exclude = _member(compose, 'exclude', 'compose.exclude(node, resources) -> Node')

    node = collapse(exclude(
        union([_component(compose, LEFT_RESOURCES), _component(compose, RIGHT_RESOURCES)]),
        LEFT_RESOURCES,
    ))
    rows = _rows_for_key(_run(compose, node, db))

    assert len(rows) == 1

    row = rows[0]

    assert sorted(row['sources']) == RIGHT_RESOURCES
    assert row['source_count'] == 2, (
        f"source_count {row['source_count']} still counts the excluded "
        f'resource; the exclusion must happen before the fold, not after it'
    )
    assert row['sign_source_count'] == 2
    assert LEFT_ONLY_PUBMED not in (row['reference_pubmed_ids'] or []), (
        'the excluded resource\'s reference is still in the provenance of a row '
        'the composition returns'
    )
    assert row['reference_count'] == 1
