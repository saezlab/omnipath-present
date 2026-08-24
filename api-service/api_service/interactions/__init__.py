"""
General interactions API over the interaction record (cycle 008).

The scaffold this module used to be is retired (T020o). It probed for a
precomputed `combined` fact table and answered every route with a
not-implemented placeholder; R24 removed that table from the build, so there is
nothing to probe for and the fold happens here, per request, for the scope the
request states.

What is left is a seam: `main.py`'s imports do not move, and every route body
below reaches the one engine and nothing else. That boundary is FR-054, and it
is asserted rather than intended — exactly one module of this service names the
interaction record, every `/interactions*` route reaches it through
`engine.run`, and no function anywhere in the service is named after a dataset.
A dataset is a parameter set or a composition.

This surface is separate from `relations/*`: that block keeps serving the
normalized canonical graph and is not overloaded here.
"""

from __future__ import annotations

import logging
from typing import Any

from . import engine, params
from .guard import GuardrailRefusal
from .select import RECORD_TABLE

_log = logging.getLogger(__name__)

# One record table, named once, in `select`. The scaffold's candidate list
# probed the removed combined table first and would have folded a wider scope
# than the caller asked for, which is the FR-048 defect with a table name on it.
FACT_TABLE_CANDIDATES = (RECORD_TABLE,)

# The parameters `/interactions/parameter-values` reports reachable values for.
PARAMETERS = (
    'resources',
    'interaction_classes',
    'organisms',
    'datasets',
    'attributes',
)


def fact_table() -> str:
    """
    Name of the interaction record table.

    Returns:
        The table every query of this group folds.
    """

    return RECORD_TABLE


def _refuse(exc: GuardrailRefusal):
    """
    Turn a guardrail refusal into the 4xx a caller can act on.

    Args:
        exc: The refusal the cost governor raised.

    Returns:
        Never; always raises.

    Raises:
        HTTPException: Carrying the refusal's own message and context.
    """

    from fastapi import HTTPException

    _log.info('interactions guardrail refused a request: %s', exc.message)

    raise HTTPException(status_code = exc.status_code, detail = exc.as_dict())


def search(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Interactions matching a filter scope, folded for that scope.

    Args:
        payload: Filters, attribute selection, view, shape and paging window.

    Returns:
        The page, its labelled total, the cursor that resumes it, and the
        guardrail's estimate wherever a post-fold predicate was priced.
    """

    try:

        return engine.run(payload)

    except GuardrailRefusal as exc:

        _refuse(exc)


def dataset(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """
    One preset's interactions; sugar for `datasets={name}`.

    Args:
        name: The `network_registry` preset name.
        payload: The same scope as `search`.

    Returns:
        The preset's page, in the shape `search` returns.
    """

    scoped = dict(payload or {})
    filters = dict(scoped.get('filters') or {})
    filters['datasets'] = [name]
    scoped['filters'] = filters

    try:

        return engine.run(scoped)

    except GuardrailRefusal as exc:

        _refuse(exc)


def compose_query(payload: dict[str, Any]) -> dict[str, Any]:
    """
    A dataset assembled from components, as `metalinksdb` is assembled (T020m).

    A component is a parameter set or a saved preset, and the operations are
    `union`, `collapse`, `exclude` and `annotate`. The collapse runs after the
    union and the exclusion runs before the collapse; both orders carry FR-048,
    and `compose` holds them.

    Args:
        payload: The component list, the operation, and the paging window.

    Returns:
        The composed page, in the shape `search` returns.
    """

    try:

        return engine.run({'operation': 'union', **(payload or {})})

    except GuardrailRefusal as exc:

        _refuse(exc)


def parameter_values(payload: dict[str, Any]) -> dict[str, Any]:
    """
    The parameter surface, and the resources the current scope resolves to.

    Args:
        payload: The same filter scope as `search`.

    Returns:
        The seven parameter groups of contracts §1a, the parameters this
        endpoint reports values for, and the scope's own resource set. The
        per-value scoped counts are a facet question and are not answered from
        the record.
    """

    try:

        answer = engine.run({**(payload or {}), 'limit': 1})

    except GuardrailRefusal as exc:

        _refuse(exc)

    return {
        'parameter_groups': {
            group: list(names) for group, names in params.PARAMETER_GROUPS.items()
        },
        'parameters': list(PARAMETERS),
        'folded_columns': sorted(params.FOLDED_COLUMNS),
        'resources': answer['resources'],
    }


def stats(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Summary counts for a scope, without returning any interaction.

    Args:
        payload: The same filter scope as `search`, plus `exact_total`.

    Returns:
        The scope's total, whether that total is an estimate, and the estimate
        the guardrail made of it.
    """

    try:

        answer = engine.run({**(payload or {}), 'limit': 1})

    except GuardrailRefusal as exc:

        _refuse(exc)

    return {
        'fact_table': fact_table(),
        'total': answer['total'],
        'total_is_estimate': answer['total_is_estimate'],
        'estimate': answer.get('estimate'),
        'resources': answer['resources'],
    }
