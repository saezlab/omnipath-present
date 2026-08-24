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

from . import discover, engine
from .guard import GuardrailRefusal
from .select import RECORD_TABLE

_log = logging.getLogger(__name__)


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
    The values each parameter can still take under one filter scope.

    Every parameter of the query surface is reported, not the handful the
    earlier scaffold listed: a discovery endpoint that omits a parameter teaches a caller it
    does not exist. A post-fold parameter reports its distribution instead of a
    value list, because `source_count` is drawn from no vocabulary — it is a
    number the fold produces, and the honest answer is how it is distributed.

    Args:
        payload: The same filter scope as `search`.

    Returns:
        The parameter groups, one entry per parameter, and the scope those
        answers hold under. No interaction row, at any width.
    """

    try:

        return engine.run({
            **(payload or {}), 'discover': discover.PARAMETER_VALUES,
        })

    except GuardrailRefusal as exc:

        _refuse(exc)


def stats(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Summary counts for a scope, without returning any interaction.

    There is no stored collapse to count, so nothing here counts one. The
    per-resource and per-organism blocks come from the roaring bitmaps, the
    per-class and per-dataset blocks from one grouped count of the record's
    stored columns, and the total from the derive's recorded histogram where
    the scope restricts nothing. Anything else is the guardrail's estimate,
    labelled as one, or an exact count the caller asked for and the guardrail
    priced before it ran.

    Args:
        payload: The same filter scope as `search`, plus `exact_total`.

    Returns:
        The scope's total with its provenance, the per-resource, per-type,
        per-dataset and per-organism counts, and the recorded distribution.
    """

    try:

        return engine.run({**(payload or {}), 'discover': discover.STATISTICS})

    except GuardrailRefusal as exc:

        _refuse(exc)
