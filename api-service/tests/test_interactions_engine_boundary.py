"""One engine reads the interaction tables, and nothing else does.

The build already forbids per-dataset materialised views. Without the same
rule on the serving side the 1,571 lines of view definitions reappear as route
code, one query function per dataset, and the parameter surface stops being the
thing that has to be general.

So this is a grep-shaped test, deliberately. It asserts a boundary rather than
a behaviour, because the boundary is what erodes: exactly one module names
`interaction_fact_resource`, every route reaches it through `engine.run`, and
no function in the service is named after a dataset.

Expected of the engine (`api_service/interactions/`), as a package:

    __init__.py   the former scaffold module, so main.py's imports do not move
    params.py  scope.py  select.py  fold.py  guard.py  compose.py  engine.py
    engine.run(payload: dict, *, conn = None) -> dict

No database required.

    pytest tests/test_interactions_engine_boundary.py -v
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
_API = _HERE.parents[1] / 'api_service'
_PACKAGE = _API / 'interactions'
_MAIN = _API / 'main.py'

# The record table, and the precomputed all-resources collapse the build no
# longer stores. The removed name must not survive anywhere: a module still
# probing for it would read a fold of a wider scope.
RECORD_TABLE = 'interaction_fact_resource'
REMOVED_TABLE = 'interaction_fact_combined'
OTHER_INTERACTION_TABLES = ('interaction_party', 'interaction_assay', 'interaction_ptm')

ENGINE_MODULES = (
    'params',
    'scope',
    'select',
    'fold',
    'guard',
    'compose',
    'engine',
)

# Every dataset this cycle registers. Each is a parameter set
# or a composition, and none of them may be a function.
DATASETS = (
    'liana',
    'metalinksdb',
    'cosmos',
    'nichenet',
    'lipinet',
    'enz_sub',
    'drug_target',
    'curated_ligand_receptor',
    'reactions',
    'pathwayextra',
    'dorothea',
    'kinaseextra',
    'ligrecextra',
    'tfmirna',
    'mirnatarget',
    'lncrna_mrna',
    'tf_target',
)


def _modules() -> list[Path]:
    return sorted(
        path for path in _API.rglob('*.py')
        if '__pycache__' not in path.parts
    )


def _naming(token: str) -> list[str]:
    return [
        str(path.relative_to(_API))
        for path in _modules()
        if token in path.read_text(encoding = 'utf-8')
    ]


def _require_engine_package() -> None:
    missing = [
        name for name in ENGINE_MODULES
        if not (_PACKAGE / f'{name}.py').is_file()
    ]

    if not _PACKAGE.is_dir() or missing:
        pytest.fail(
            f'the query engine is not a package yet: expected '
            f'api_service/interactions/ with {list(ENGINE_MODULES)}, missing '
            f'{missing or ["the package itself"]}'
        )


def _route_paths_and_bodies() -> list[tuple[str, ast.FunctionDef]]:
    tree = ast.parse(_MAIN.read_text(encoding = 'utf-8'))
    found = []

    for node in ast.walk(tree):

        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        for decorator in node.decorator_list:

            if (
                isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and decorator.args
                and isinstance(decorator.args[0], ast.Constant)
                and isinstance(decorator.args[0].value, str)
            ):
                found.append((decorator.args[0].value, node))

    return found


def test_the_engine_is_a_package_with_the_stages_of_the_contract():
    """Scope, selection, fold, guard, composition, projection."""

    _require_engine_package()


def test_exactly_one_module_names_the_record_table():
    """One reader of the interaction tables, not one per dataset."""

    naming = _naming(RECORD_TABLE)

    assert len(naming) == 1, (
        f'{RECORD_TABLE} is named by {len(naming)} modules ({naming}); exactly '
        f'one may, and it is the engine\'s fold'
    )
    assert naming[0].startswith('interactions/'), (
        f'{naming[0]} names the record table from outside the engine package'
    )


def test_the_removed_table_is_named_nowhere():
    """The build no longer precomputes it; a probe would read a wider fold."""

    naming = _naming(REMOVED_TABLE)

    assert naming == [], (
        f'{REMOVED_TABLE} was removed from the build and its rows are folded at '
        f'query time now; still named by {naming}'
    )


@pytest.mark.parametrize('table', OTHER_INTERACTION_TABLES)
def test_no_route_module_names_an_interaction_table(table):
    """The detail tables are the engine's business too."""

    _require_engine_package()

    outside = [name for name in _naming(table) if not name.startswith('interactions/')]

    assert outside == [], (
        f'{table} is named outside the engine package by {outside}'
    )


def test_main_names_no_interaction_table():
    """A route that writes SQL is the matview boilerplate coming back."""

    _require_engine_package()

    text = _MAIN.read_text(encoding = 'utf-8')
    named = [
        table for table in (RECORD_TABLE, REMOVED_TABLE, *OTHER_INTERACTION_TABLES)
        if table in text
    ]

    assert named == [], f'main.py names {named}'


def test_every_interaction_route_reaches_the_engine():
    """No fast path around `engine.run`, for any endpoint of the group."""

    _require_engine_package()

    routes = [
        (path, node) for path, node in _route_paths_and_bodies()
        if path.startswith('/interactions')
    ]

    assert routes, 'main.py declares no /interactions route'

    package = (_PACKAGE / '__init__.py').read_text(encoding = 'utf-8')
    tree = ast.parse(package)
    bodies = {
        node.name: ast.get_source_segment(package, node) or ''
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }

    for path, node in routes:
        source = ast.unparse(node)
        delegates = set(re.findall(r'interactions\.([A-Za-z_][A-Za-z_0-9]*)', source))

        assert delegates, f'{path} does not delegate to the interactions package'

        for delegate in delegates:

            if delegate not in bodies:
                continue

            assert 'engine.run(' in bodies[delegate], (
                f'{path} reaches the interaction tables through '
                f'interactions.{delegate}, which does not call engine.run'
            )


def test_the_package_entry_points_hold_no_sql():
    """The `__init__` is a seam for `main.py`'s imports, not a query module."""

    _require_engine_package()

    text = (_PACKAGE / '__init__.py').read_text(encoding = 'utf-8')

    assert not re.search(r'\bSELECT\b\s', text), (
        'the package __init__ writes SQL; the engine\'s statements belong in '
        'select.py and fold.py'
    )
    assert 'engine' in text, 'the package __init__ does not reach engine.run'


@pytest.mark.parametrize('dataset', DATASETS)
def test_no_per_dataset_query_function_exists(dataset):
    """A dataset is a parameter set or a composition, never a function."""

    _require_engine_package()

    offenders = []

    for path in _modules():
        tree = ast.parse(path.read_text(encoding = 'utf-8'))

        offenders.extend(
            f'{path.relative_to(_API)}::{node.name}'
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and dataset in node.name.lower()
        )

    assert offenders == [], (
        f'`{dataset}` has query code of its own ({offenders}); it must be a '
        f'named parameter set or composition over the one engine'
    )
