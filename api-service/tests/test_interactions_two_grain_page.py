"""A page that holds two grains at once.

A dataset can be a composition, and a composition may read its components at
different grains: one component's row is an ordered endpoint pair, another's is
one interaction of whatever arity whose members come back as a participant
list. The fold already answers such a recipe once per shape and tags every row
it returns with the grain that answered it. What this file holds is the other
half — that the page reaching a caller renders each row at the grain the row
itself names, and that a page of one grain is rendered exactly as it always
was.

**Getting it wrong is silent rather than loud.** A page rendered once for all
its rows comes back either with the interactions stripped of their members or
with the ordered pairs asked for members they have none of. Both times every
row is present and every count is right, and only the shape of half the page is
a lie. So each half is asserted for what only that half can carry: the member
list with the graph's own per-participation detail on it, and the flat
`source_*`/`target_*` pair.

**Both ways in are held to it.** A composition a caller assembles reaches the
projection one way and a dataset that stores a recipe reaches it another, and
before this the second could not span two grains at all — it reduced its recipe
to one predicate and folded it once, at the one grain the request named. A
preset specified as a union across grains is unservable until it can, so the
dataset path is asserted here beside the inline one. The recipe a preset would
store is built in the test rather than registered, because registering one is a
decision this file does not get to make.

    DATABASE_URL=... pytest tests/test_interactions_two_grain_page.py -v
"""

from __future__ import annotations

import importlib
import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason = 'DATABASE_URL not set; a two-grain page needs a built DB',
)

#: One interaction stated in both orientations, so the binary key cuts it into
#: two ordered pairs and the interaction key keeps it one row. Measured on dev3
#: (866e34f77df3) 2026-09-17; both endpoints are low-degree, so the pinned
#: neighbourhood is small enough that no page bound can hide the key.
PAIR_LEFT = '72a85c76-47c2-6c47-373f-aeabd7b78223'
PAIR_RIGHT = 'ce5bb878-8745-6b03-25ba-6160c1466371'
PAIR_CLASS = 'ligand_receptor'
PAIR_INTERACTION = '0699a6cc-6bba-2308-1181-50c068948d34'

#: Two resources that both report both orientations of the fixture
#: interaction, one component each.
LEFT_RESOURCES = ['intact']
RIGHT_RESOURCES = ['connectomedb2025']

#: The registered dataset whose scope the fixture interaction falls in, for the
#: path that serves a named dataset from a stored recipe.
PRESET = 'liana'
PRESET_RESOURCES = ['connectomedb2025']

#: A dataset that stores a recipe of one shape. It is the common path, and the
#: common path must stay one fold.
SINGLE_SHAPE_PRESET = 'metalinksdb'

#: Wide enough to hold the whole pinned neighbourhood at both grains, so what a
#: test counts is what the fold produced and never what the page cut off.
PAGE = 200

#: What the graph stores about one participation rather than about the entity.
#: Only a member of an interaction read whole carries them.
PARTICIPATION_DETAIL = ('side', 'ordinal', 'stoichiometry', 'compartment')

#: The flat column that names the first end of an ordered pair. Only a row
#: keyed on one has it.
BINARY_KEY = 'subject_entity_id'


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


def _module(name: str):
    """One engine module, or a failure naming the module that is missing.

    Args:
        name: The module's name under `api_service.interactions`.

    Returns:
        The module.
    """

    try:

        return importlib.import_module(f'api_service.interactions.{name}')

    except ModuleNotFoundError as exc:

        pytest.fail(
            f'the interaction query engine has no `{name}` module '
            f'(expected api_service/interactions/{name}.py): {exc}'
        )


def _run(db, payload: dict[str, Any]) -> dict[str, Any]:
    """Answer one request through the engine, on the test's own connection.

    Args:
        db: An open connection.
        payload: The request.

    Returns:
        The engine's answer.
    """

    return _module('engine').run(payload, conn = db)


def _component_payload(resources: list[str], **shape: Any) -> dict[str, Any]:
    """One component over the fixture neighbourhood, at the shape it states.

    Args:
        resources: The resources the component reads.
        shape: The grain, and anything else the component states.

    Returns:
        The component's parameter set.
    """

    return {
        'filters': {
            'resources': resources,
            'entities': [PAIR_LEFT, PAIR_RIGHT],
            'interaction_classes': [PAIR_CLASS],
        },
        'limit': PAGE,
        **shape,
    }


def _inline(components: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    """The request body that assembles one composition inline.

    Args:
        components: The component parameter sets.
        extra: Further request terms — the paging, and the grain where the
            caller states one for the whole page.

    Returns:
        The request.
    """

    return {
        'operation': 'union',
        'components': [{'parameters': one} for one in components],
        'steps': [{'operation': 'collapse'}],
        'limit': PAGE,
        **extra,
    }


def _by_grain(rows: list[dict[str, Any]], grain: str) -> list[dict[str, Any]]:
    """The rows one grain answered.

    Args:
        rows: The rendered page.
        grain: The grain to select.

    Returns:
        The rows carrying that grain.
    """

    return [row for row in rows if row.get('grain') == grain]


def _assert_read_whole(rows: list[dict[str, Any]]) -> None:
    """Hold one row to what a row keyed on the interaction must look like.

    Args:
        rows: The rows folded at the participant grain.

    Returns:
        None.
    """

    for row in rows:

        assert BINARY_KEY not in row, (
            'a row keyed on the interaction has no first and second endpoint '
            'to carry, and inventing one is the cut this grain exists to avoid'
        )
        assert row['participants'], (
            'a row keyed on the interaction came back naming none of its '
            'members: the participant read was decided for the page rather '
            'than for the row, and this row was on the wrong side of it'
        )

        for member in row['participants']:

            assert member.get('role'), (
                'a member of an interaction carries the role the graph files '
                'it under'
            )

            missing = [
                name for name in PARTICIPATION_DETAIL if name not in member
            ]

            assert not missing, f'{missing} absent from a member'


def _assert_read_as_a_pair(rows: list[dict[str, Any]]) -> None:
    """Hold one row to what a row keyed on an ordered pair must look like.

    Args:
        rows: The rows folded at the interaction grain.

    Returns:
        None.
    """

    for row in rows:

        assert BINARY_KEY in row, (
            'a row folded on the binary key carries its endpoints'
        )
        assert 'source' in row and 'target' in row, (
            'the flat pair is the shape this grain was asked for, and it is '
            'absent from the row'
        )
        assert len(row['participants']) == 2, (
            f"an ordered pair has two ends and came back with "
            f"{len(row['participants'])}"
        )

        for member in row['participants']:

            assert not [
                name for name in PARTICIPATION_DETAIL if name in member
            ], (
                'a folded ordered pair may speak for several interactions at '
                'once, so it has no one participant row to report and must '
                'not claim one'
            )


# ── a composition a caller assembles ────────────────────────────────────────


def test_a_page_of_two_grains_renders_each_row_at_its_own_grain(db):
    """Neither half of the page is rendered at the other half's grain."""

    rows = _run(db, _inline([
        _component_payload(LEFT_RESOURCES, grain = 'participant'),
        _component_payload(RIGHT_RESOURCES),
    ]))['interactions']

    whole = _by_grain(rows, 'participant')
    pairs = _by_grain(rows, 'interaction')

    assert whole, 'the component read at the participant grain returned nothing'
    assert pairs, 'the component read at the interaction grain returned nothing'

    _assert_read_whole(whole)
    _assert_read_as_a_pair(pairs)


def test_one_interaction_is_on_the_page_twice_and_reads_as_both(db):
    """The two shapes are two answers about the same thing, not two scopes."""

    rows = [
        row for row in _run(db, _inline([
            _component_payload(LEFT_RESOURCES, grain = 'participant'),
            _component_payload(RIGHT_RESOURCES),
        ]))['interactions']
        if str(row.get('interaction_id')) == PAIR_INTERACTION
    ]

    whole = _by_grain(rows, 'participant')
    pairs = _by_grain(rows, 'interaction')

    assert len(whole) == 1, (
        f'the interaction key is one row per interaction whatever its shape; '
        f'got {len(whole)}'
    )
    assert len(pairs) == 2, (
        f'the fixture interaction is stated in both orientations, so the '
        f'binary key cuts it into two ordered pairs; got {len(pairs)}'
    )
    assert {
        member['entity'] for member in whole[0]['participants']
    } == {pairs[0]['source'], pairs[0]['target']}, (
        'the members of the interaction and the ends of its ordered pair name '
        'the same two entities, so a page rendering both is one answer read '
        'two ways rather than two answers'
    )


# ── a page of one grain, which is every page served today ───────────────────


def test_a_page_of_one_grain_is_rendered_at_the_grain_it_was_asked_at(db):
    """A composition of one shape states its grain once, for the whole page."""

    for grain, check in (
            ('participant', _assert_read_whole),
            ('interaction', _assert_read_as_a_pair),
    ):

        rows = _run(db, _inline(
            [
                _component_payload(LEFT_RESOURCES, grain = grain),
                _component_payload(RIGHT_RESOURCES, grain = grain),
            ],
            grain = grain,
        ))['interactions']

        assert rows, f'the composition at {grain} grain returned nothing'
        assert not [row for row in rows if 'grain' in row], (
            'every row of this composition was folded at the same grain, '
            'which the request stated once; repeating it per row would make a '
            'per-row field that means nothing look like one that does'
        )

        check(rows)


def test_a_plain_request_is_unchanged_by_the_grain_a_row_may_carry(db):
    """No composition, no tag, and the request's own grain decides."""

    for grain, check in (
            ('participant', _assert_read_whole),
            ('interaction', _assert_read_as_a_pair),
    ):

        answer = _run(db, _component_payload(
            [*LEFT_RESOURCES, *RIGHT_RESOURCES], grain = grain,
        ))
        rows = answer['interactions']

        assert rows, f'a plain request at {grain} grain returned nothing'
        assert answer['grain'] == grain
        assert 'grains' not in answer, (
            'a page of one grain names it once and says nothing about a set '
            'of them'
        )

        check(rows)


# ── a dataset that stores a recipe ──────────────────────────────────────────


def _spanning_recipe(compose):
    """The recipe a two-grain preset would store, built rather than registered.

    Both components read the same records; only the grain they are read at
    differs, so the union spans two shape groups and every interaction in it
    has an answer at each.

    Args:
        compose: The composition algebra.

    Returns:
        The composition.
    """

    return compose.collapse(compose.union([
        compose.component({
            'filters': {'resources': PRESET_RESOURCES},
            'grain': 'participant',
        }),
        compose.component({'filters': {'resources': PRESET_RESOURCES}}),
    ]))


def test_a_named_dataset_whose_recipe_spans_two_grains_is_served_at_both(
        db,
        monkeypatch,
):
    """The path a preset is served through, holding a page of two shapes."""

    compose = _module('compose')
    monkeypatch.setattr(
        compose, 'for_presets', lambda names, *, conn: _spanning_recipe(compose),
    )

    answer = _run(db, {
        'filters': {
            'datasets': [PRESET],
            'entities': [PAIR_LEFT, PAIR_RIGHT],
        },
        'limit': PAGE,
    })
    rows = answer['interactions']

    whole = _by_grain(rows, 'participant')
    pairs = _by_grain(rows, 'interaction')

    assert whole, (
        'the named dataset returned no row at the participant grain: its '
        'recipe was reduced to one predicate and folded at the request\'s '
        'single grain, which is the reduction a two-grain dataset cannot '
        'survive'
    )
    assert pairs, 'the named dataset returned no row at the interaction grain'
    assert answer.get('grains') == ['interaction', 'participant'], (
        f'a page answered in rows of two kinds named '
        f'{answer.get("grains")!r}; a page that states one grain for rows of '
        f'two is the quietly wrong number under a third name'
    )

    _assert_read_whole(whole)
    _assert_read_as_a_pair(pairs)


def test_a_two_grain_page_mints_no_cursor(db, monkeypatch):
    """A cursor names one grain's key, and this page has two."""

    compose = _module('compose')
    monkeypatch.setattr(
        compose, 'for_presets', lambda names, *, conn: _spanning_recipe(compose),
    )

    answer = _run(db, {
        'filters': {
            'datasets': [PRESET],
            'entities': [PAIR_LEFT, PAIR_RIGHT],
        },
        # Small enough that each shape group fills its own page, which is when
        # a cursor would be minted.
        'limit': 1,
    })

    assert len(answer['interactions']) >= answer['limit']
    assert 'cursor' not in answer, (
        'a cursor minted at one grain decodes against a key list of the wrong '
        'arity at the other, is dropped as stale, and resumes that half of '
        'the page from its first row — the same interactions returned twice '
        'under a bookmark that looked sound'
    )


def test_a_dataset_whose_recipe_is_one_shape_is_still_one_fold(db, monkeypatch):
    """The common path, and it must cost what it has always cost."""

    compose = _module('compose')
    fold = _module('fold')
    folded, spanned = [], []
    original = fold.fold_rows

    def counted(*args, **kwargs):

        folded.append(1)

        return original(*args, **kwargs)

    monkeypatch.setattr(fold, 'fold_rows', counted)
    monkeypatch.setattr(
        compose, 'fold_by_shape', lambda *args, **kwargs: spanned.append(1),
    )

    answer = _run(db, {
        'filters': {'datasets': [SINGLE_SHAPE_PRESET]},
        'limit': 5,
    })

    assert answer['interactions'], (
        f'{SINGLE_SHAPE_PRESET} returned nothing at all'
    )
    assert not spanned, (
        'a recipe whose components all fold on one key has one fold, and '
        'reaching for the per-shape path buys a page of one shape a second '
        'statement for nothing'
    )
    assert len(folded) == 1, (
        f'the page took {len(folded)} folds where one answers it'
    )
    assert 'grains' not in answer
