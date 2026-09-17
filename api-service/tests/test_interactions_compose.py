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

The rule binds inside one **shape** — one key the rows fold on — and the last
section of this file is about what a shape is. A composition holds a grain and
a collapse mode per component, because a union of a binary dataset and a
reaction projection is a union of rows that are not the same kind of thing.
Components that fold on the same key are one fold, and the order rule above is
theirs. Components that fold on different keys fold apart, and a page holding
both says which grain answered each row.

Expected of the engine (`api_service/interactions/compose.py`):

    component(payload: dict) -> Component
    union(components: Sequence[Node], *, grain = None, collapse = None) -> Node
    collapse(node: Node, *, mode = None) -> Node
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

# A second fixture, for the shape. One interaction, both orientations: the
# binary key cuts it into two ordered pairs and the interaction key keeps it
# one row. That is the same difference a reaction shows between the two
# grains, at the only arity this build holds.
#
# Measured on dev3 (866e34f77df3) 2026-09-17. Both endpoints are low-degree —
# 16 and 22 record rows — so the pinned scope is the whole neighbourhood and
# no page bound can hide the key behind rows that sort before it.
PAIR_LEFT = '72a85c76-47c2-6c47-373f-aeabd7b78223'
PAIR_RIGHT = 'ce5bb878-8745-6b03-25ba-6160c1466371'
PAIR_CLASS = 'ligand_receptor'
PAIR_INTERACTION = '0699a6cc-6bba-2308-1181-50c068948d34'

# Both report both orientations of the fixture interaction, one resource each.
PAIR_LEFT_RESOURCES = ['intact']
PAIR_RIGHT_RESOURCES = ['connectomedb2025']
PAIR_RESOURCES = sorted([*PAIR_LEFT_RESOURCES, *PAIR_RIGHT_RESOURCES])

# In the same neighbourhood and not on the fixture interaction, so a component
# scoped to it can be the wider one without contributing a row to the key
# under test.
ELSEWHERE_RESOURCES = ['cellchat']


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


def _pair_component(compose, resources: list[str], **shape):
    """One component over the shape fixture, pinned to its neighbourhood."""

    return _member(compose, 'component', 'compose.component(payload) -> Component')({
        'filters': {
            'resources': resources,
            'entities': [PAIR_LEFT, PAIR_RIGHT],
            'interaction_classes': [PAIR_CLASS],
        },
        # Wide enough to hold the whole neighbourhood, so what a test counts is
        # what the fold produced and never what the page cut off.
        'limit': 400,
        **shape,
    })


def _rows_for_interaction(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The fixture interaction's rows, at whatever grain they were folded at.

    Every folded row carries `interaction_id`, at both grains: at one it is the
    key and at the other it comes off the record with the rest of the summary.
    So this selects the same interaction from a page of either shape.
    """

    return [
        row for row in rows
        if str(row.get('interaction_id')) == PAIR_INTERACTION
    ]


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


# ── a shape per component ───────────────────────────────────────────────────
#
# The grain and the collapse mode together decide what one row *is* — the key
# it is folded on. A composition carries one per component, because a union of
# a binary dataset and a reaction projection is a union of rows that are not
# the same kind of thing, and no single key answers both.
#
# Picking one shape for the whole recipe by comparing the components' page
# limits is what the composition used to do, and a limit says nothing about
# what a row is. The tests below assert the two halves of the replacement:
# components that fold on the same key are one fold, and the order rule above
# still binds there. Components that fold on different keys fold apart, and
# every row says which grain answered it.


def test_a_component_keeps_its_collapse_mode_beside_a_wider_component(db):
    """A wider component's page limit must not decide what another's rows are."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    node = collapse(union([
        _pair_component(compose, PAIR_RESOURCES, collapse='none'),
        # The wider one, and on none of the fixture interaction's rows. Under a
        # single shape chosen by limit, its `endpoints` folded the component
        # above as well.
        _pair_component(compose, ELSEWHERE_RESOURCES, limit=500),
    ]))
    rows = _rows_for_interaction(_run(compose, node, db))

    assert len(rows) == 4, (
        f'the component asked for the uncollapsed record — one row per ordered '
        f'pair and contributing resource, which is two orientations by two '
        f'resources here — and got {len(rows)} rows; a wider component\'s '
        f'`endpoints` was folded over it'
    )
    assert all(row['source_count'] == 1 for row in rows), (
        'a row of the uncollapsed record is one resource\'s; a row carrying '
        'both is the wider component\'s collapse mode applied to this one'
    )
    assert {row['collapse'] for row in rows} == {'none'}, (
        'the rows do not say they were folded at the mode their component '
        'asked for'
    )


def test_the_grain_decides_whether_one_interaction_is_one_row(db):
    """The fixture is real: the two keys give two different row counts."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    components = [
        _pair_component(compose, PAIR_LEFT_RESOURCES),
        _pair_component(compose, PAIR_RIGHT_RESOURCES),
    ]
    binary = _rows_for_interaction(_run(compose, collapse(union(components)), db))

    whole = _rows_for_interaction(_run(compose, collapse(union([
        _pair_component(compose, PAIR_LEFT_RESOURCES, grain='participant'),
        _pair_component(compose, PAIR_RIGHT_RESOURCES, grain='participant'),
    ])), db))

    assert len(binary) == 2, (
        f'the fixture interaction is stated in both orientations, so the '
        f'binary key cuts it into two ordered pairs; got {len(binary)}'
    )
    assert len(whole) == 1, (
        f'the interaction key is one row per interaction whatever its shape, '
        f'so the two orientations are one row; got {len(whole)}'
    )


def test_the_collapse_runs_after_the_union_at_the_other_grain_too(db):
    """The order rule is the fold's, not the binary key's."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    node = collapse(union([
        _pair_component(compose, PAIR_LEFT_RESOURCES, grain='participant'),
        _pair_component(compose, PAIR_RIGHT_RESOURCES, grain='participant'),
    ]))
    rows = _rows_for_interaction(_run(compose, node, db))

    assert len(rows) == 1
    assert sorted(rows[0]['sources']) == PAIR_RESOURCES, (
        'the two components fold on the same key, so they are one fold and '
        'one row over both their resources'
    )
    assert rows[0]['source_count'] == 2, (
        'a component-local fold cannot reach the union\'s source_count, at '
        'this grain as at the other'
    )


def test_a_union_across_two_grains_folds_at_both(db):
    """Neither component is folded at the other's key, whatever the limits."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    node = collapse(union([
        _pair_component(compose, PAIR_LEFT_RESOURCES, grain='participant'),
        # The wider of the two, so a shape chosen by page limit would be this
        # one and the component above would come back cut into ordered pairs.
        _pair_component(compose, PAIR_RIGHT_RESOURCES, limit=500),
    ]))
    rows = _rows_for_interaction(_run(compose, node, db))

    whole = [row for row in rows if row['grain'] == 'participant']
    pairs = [row for row in rows if row['grain'] == 'interaction']

    assert len(whole) == 1, (
        f'the component read at the interaction grain must come back as one '
        f'row for the interaction; got {len(whole)}'
    )
    assert sorted(whole[0]['sources']) == PAIR_LEFT_RESOURCES
    assert len(pairs) == 2, (
        f'the component read at the binary grain must come back as its two '
        f'ordered pairs; got {len(pairs)}'
    )
    assert all(sorted(row['sources']) == PAIR_RIGHT_RESOURCES for row in pairs)
    assert all('subject_entity_id' in row for row in pairs), (
        'a row folded on the binary key carries its endpoints'
    )
    assert 'subject_entity_id' not in whole[0], (
        'a row folded on the interaction has no first and second endpoint to '
        'carry, and inventing one is the cut this grain exists to avoid'
    )


def test_a_row_of_a_two_grain_union_says_which_grain_answered_it(db):
    """One page, two kinds of row, and each one legible on its own."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    node = collapse(union([
        _pair_component(compose, PAIR_LEFT_RESOURCES, grain='participant'),
        _pair_component(compose, PAIR_RIGHT_RESOURCES),
    ]))
    rows = _run(compose, node, db)

    assert rows, 'the fixture neighbourhood returned nothing at all'
    assert {row.get('grain') for row in rows} == {'participant', 'interaction'}, (
        'a page holding rows of two shapes must say which shape each row is, '
        'or a count over it counts two different things under one name'
    )


def test_a_composition_of_one_shape_leaves_its_rows_alone(db):
    """The page names the grain where one name fits every row on it."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    node = collapse(union([
        _pair_component(compose, PAIR_LEFT_RESOURCES),
        _pair_component(compose, PAIR_RIGHT_RESOURCES),
    ]))
    rows = _run(compose, node, db)

    assert rows
    assert not any('grain' in row for row in rows), (
        'every row of this composition was folded at the same grain, which the '
        'answer states once; repeating it per row would make a per-row field '
        'that means nothing look like one that does'
    )


def test_a_recipe_can_state_the_grain_its_union_folds_at(db):
    """Two statements, not one: what a component is read at, what a union folds at."""

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    union = _member(compose, 'union', 'compose.union(components) -> Node')

    node = collapse(union(
        [
            _pair_component(compose, PAIR_LEFT_RESOURCES, grain='participant'),
            _pair_component(compose, PAIR_RIGHT_RESOURCES),
        ],
        grain='participant',
    ))
    rows = _rows_for_interaction(_run(compose, node, db))

    assert len(rows) == 1, (
        f'the recipe stated the grain of the rows it returns, so its '
        f'components fold at that one and the union is a single fold; got '
        f'{len(rows)} rows'
    )
    assert sorted(rows[0]['sources']) == PAIR_RESOURCES, (
        'a union folded at one stated grain is one fold over every component '
        'in it, so the row carries both components\' resources'
    )


def test_a_wide_interaction_stays_one_row_at_the_interaction_grain(db):
    """The arity case, where a build carries one.

    Everything above folds interactions of two endpoints, because that is all
    this build holds. The grain exists for the reaction, whose participants do
    not reduce to an ordered pair, and that case is asserted here rather than
    assumed from the binary one.
    """

    widest = db.execute(
        f'SELECT max(arity) AS arity FROM {SCHEMA}.interaction'
    ).fetchone()

    if (widest['arity'] or 0) < 3:
        pytest.skip(
            'this build holds no interaction wider than two endpoints '
            '(13,998,969 at arity 2, 5,098 at arity 1, none above), so the '
            'reaction this grain exists for is not here to fold. The reaction '
            'load is what supplies one; until it runs, the two orientations of '
            'one binary interaction are what the tests above fold, and they '
            'cover the key rather than the arity.'
        )

    compose = _compose()
    collapse = _member(compose, 'collapse', 'compose.collapse(node) -> Node')
    component = _member(compose, 'component', 'compose.component(payload) -> Component')

    wide = db.execute(
        f"""
        SELECT r.interaction_id,
               array_agg(DISTINCT r.subject_entity_id::text) AS subjects,
               array_agg(DISTINCT r.object_entity_id::text) AS objects
        FROM {SCHEMA}.interaction_fact_resource r
        JOIN {SCHEMA}.interaction i USING (interaction_id)
        WHERE i.arity > 2
        GROUP BY r.interaction_id
        LIMIT 1
        """
    ).fetchone()

    endpoints = sorted({*wide['subjects'], *wide['objects']})
    payload = {'filters': {'entities': endpoints}, 'limit': 400}

    whole = [
        row for row in _run(compose, collapse(component(
            {**payload, 'grain': 'participant'},
        )), db)
        if str(row.get('interaction_id')) == str(wide['interaction_id'])
    ]
    pairs = [
        row for row in _run(compose, collapse(component(payload)), db)
        if str(row.get('interaction_id')) == str(wide['interaction_id'])
    ]

    assert len(whole) == 1, (
        f'a reaction is one interaction whatever its arity, so the interaction '
        f'key gives it one row; got {len(whole)}'
    )
    assert len(pairs) > 1, (
        'the binary key cuts a wide interaction into ordered pairs, which is '
        'the answer the other grain exists to avoid returning'
    )
