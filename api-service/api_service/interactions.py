"""
General interactions API over the precomputed interactions fact table.

Scaffold (cycle 008, T019). The routes are wired and the request seams are in
place; the fact-table queries themselves land in a later phase. Every helper
here reuses the psycopg3 seam of the graph module (`DATABASE_URL`,
`OMNIPATH_PG_SCHEMA`, `_connect`) and its `_limit`/`_offset` guardrails, so the
query implementation only has to fill the bodies.

This surface is separate from `relations/*`: that block keeps serving the
normalized canonical graph and is not overloaded here.
"""

from __future__ import annotations

import logging
from typing import Any

from .graph import SEARCH_SCHEMA, _connect, _limit, _offset

_log = logging.getLogger(__name__)

# The fact table under its currently specified names; the build's derive step
# creates one of them. Probed the same way as `graph._relation_term_bitmap_table`.
FACT_TABLE_CANDIDATES = ('interaction_fact', 'interaction')

# The parameters `/interactions/parameter-values` reports reachable values for.
PARAMETERS = (
    'resources',
    'interaction_types',
    'organisms',
    'datasets',
    'attribute_keys',
)

_NOT_IMPLEMENTED = (
    'The interactions fact-table query is not implemented yet; '
    'this endpoint is a wired scaffold.'
)


def fact_table() -> str | None:
    """
    Name of the interactions fact table, or None if the derive step has not run.

    Returns:
        The first present candidate table name in the search schema.
    """

    with _connect() as conn:

        for table_name in FACT_TABLE_CANDIDATES:

            row = conn.execute(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_name = %s
                """,
                (SEARCH_SCHEMA, table_name),
            ).fetchone()

            if row:

                return table_name

    return None


def _strings(value: Any) -> list[str]:
    """
    Normalize a comma-separated string or a sequence into a list of values.

    Args:
        value: A comma-separated string, a sequence, or None.

    Returns:
        The non-empty values, in order, without duplicates.
    """

    if value is None:

        items: list[Any] = []

    elif isinstance(value, str):

        items = value.split(',')

    else:

        items = list(value)

    seen: set[str] = set()
    out: list[str] = []

    for item in items:

        text = str(item).strip()

        if text and text not in seen:

            seen.add(text)
            out.append(text)

    return out


def _scope(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Normalize the filter scope shared by every endpoint of this group.

    Args:
        payload: The request payload, camelCase or snake_case keys.

    Returns:
        The normalized filters, dataset scope and paging window.
    """

    filters = payload.get('filters') or {}

    def _pick(*names: str) -> Any:

        for name in names:

            if name in filters:

                return filters[name]

            if name in payload:

                return payload[name]

        return None

    return {
        'filters': {
            'resources': _strings(_pick('resources')),
            'interaction_types': _strings(
                _pick('interaction_types', 'interactionTypes')
            ),
            'organism': _pick('organism'),
            'datasets': _strings(_pick('datasets')),
        },
        'attributes': _strings(payload.get('attributes')),
        'by_resource': bool(payload.get('by_resource') or payload.get('byResource')),
        'view': str(payload.get('view') or 'gene'),
        'limit': _limit(payload.get('limit')),
        'offset': _offset(payload.get('offset')),
    }


def _scaffold(endpoint: str, **context: Any) -> dict[str, Any]:
    """
    Placeholder answer for an endpoint whose query is not implemented yet.

    Args:
        endpoint: The route this answer stands in for.
        context: The normalized request, echoed back for the caller.

    Returns:
        A payload that states its own incompleteness.
    """

    _log.info('interactions scaffold answered %s', endpoint)

    return {
        'endpoint': endpoint,
        'status': 'not_implemented',
        'detail': _NOT_IMPLEMENTED,
        **context,
    }


def search(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Interactions matching a filter scope, with the selected attributes.

    Args:
        payload: Filters, attribute selection, view and paging window.

    Returns:
        The interactions and the total, once implemented.
    """

    scope = _scope(payload)

    return _scaffold(
        'GET /interactions',
        interactions = [],
        total = 0,
        **scope,
    )


def dataset(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """
    One preset's interactions; sugar for `datasets={name}`.

    Args:
        name: The `network_registry` preset name.
        payload: The same scope as `search`.

    Returns:
        The interactions of the preset, once implemented.
    """

    scope = _scope(payload)
    scope['filters']['datasets'] = [name]

    return _scaffold(
        'GET /interactions/{dataset}',
        dataset = name,
        interactions = [],
        total = 0,
        **scope,
    )


def parameter_values(payload: dict[str, Any]) -> dict[str, Any]:
    """
    The values each parameter can still take under the current scope.

    Args:
        payload: The same filter scope as `search`.

    Returns:
        Per parameter, the reachable values and their scoped counts.
    """

    scope = _scope(payload)

    return _scaffold(
        'GET /interactions/parameter-values',
        parameters = {name: [] for name in PARAMETERS},
        filters = scope['filters'],
    )


def stats(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Summary counts for a scope, without returning any interaction.

    Args:
        payload: The same filter scope as `search`.

    Returns:
        Total, per-resource, per-type and per-dataset counts, once implemented.
    """

    scope = _scope(payload)

    return _scaffold(
        'GET /interactions/stats',
        fact_table = fact_table(),
        total = 0,
        counts_by_resource = {},
        counts_by_interaction_type = {},
        counts_by_dataset = {},
        filters = scope['filters'],
    )
