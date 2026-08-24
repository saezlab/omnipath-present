"""
The one query engine (T020h-T020o, FR-054, R26).

Every `/interactions*` route reaches the interaction tables through `run`, and
nothing else reaches them at all. That is the serving-side reading of FR-011
and FR-015: the build forbids per-dataset materialised views, and without the
same rule here the 1,571 lines of view definitions reappear as route code, one
query function per dataset, and the parameter surface stops being the thing
that has to be general.

The stages are the contract's own, in order, and each is one module: parse
(`params`), resolve the scope once (`scope`), price and refuse (`guard`),
select the page's keys and fold only those (`select`, `fold`), project. A
composition (`compose`) enters at the same place and is priced as one request
rather than as each of its components.
"""

from __future__ import annotations

import logging
from typing import Any

from ..graph import SEARCH_SCHEMA
from . import compose as _compose
from . import fold as _fold
from . import guard as _guard
from . import nodes as _nodes
from . import params as _params
from . import scope as _scope

_log = logging.getLogger(__name__)

# The row keys of data-model §3b that carry an entity id or a uuid; rendered as
# text so a response is JSON without a custom encoder.
_UUID_KEYS = ('subject_entity_id', 'object_entity_id', 'interaction_id')

_CLASS_NAMES: dict[str, dict[int, dict[str, Any]]] = {}


def run(payload: dict[str, Any], *, conn = None) -> dict[str, Any]:
    """
    Answer one interactions request, end to end.

    Args:
        payload: The request body — filters, shape, projection and paging.
        conn: An open connection, or None to open one.

    Returns:
        The page, its total, whether that total is an estimate, the paging
        window, the cursor that resumes after the last key, and — where a
        post-fold predicate was priced — the estimate the guardrail made.

    Raises:
        guard.GuardrailRefusal: For a request the cost governor will not run.
    """

    payload = payload or {}

    if payload.get('components') or payload.get('operation') in _compose.OPERATIONS:

        # A composition is not a fast path around the engine — it is the engine
        # entered with a component list instead of one parameter set (FR-054).
        return _composition(payload, conn = conn)

    query = _params.parse(payload)

    with _scope.connection(conn) as live:

        resolved = _scope.resolve(query, conn = live)
        _apply_preset(query, resolved)
        estimate = _guard.check(query, resolved, conn = live)
        rows = _fold.fold_rows(query, resolved, conn = live)
        interactions = _project_page(rows, query, live)

        if query.exact_total:

            # An exact count is the full fold of the scope and is only run
            # because the caller asked; the guardrail has already priced it.
            total = _fold.count_groups(query, resolved, conn = live)

        else:

            total = estimate.qualifying_keys

    answer: dict[str, Any] = {
        'interactions': interactions,
        'total': int(total),
        # R24 removed the stored collapse, so the unscoped total is an estimate
        # like every other. An unlabelled estimate is the quietly wrong number
        # FR-048 exists to prevent, so the label is a required field.
        'total_is_estimate': not query.exact_total,
        'limit': query.limit,
        'offset': query.offset,
        'view': query.view,
        'collapse': query.collapse,
        'resources': resolved.resources,
    }

    if resolved.organism.asked:

        # What the organism parameter resolved to, said out loud. A caller who
        # wrote a subspecies the build files under its species gets the
        # species' rows, and this is where they can see that it happened.
        answer['organism'] = resolved.organism.as_dict()

    if len(rows) >= query.limit and rows:

        answer['cursor'] = _fold.encode_cursor([
            rows[-1]['subject_entity_id'],
            rows[-1]['object_entity_id'],
            rows[-1]['interaction_class_id'],
        ])

    if query.filters.post_fold() or query.exact_total:

        answer['estimate'] = estimate.as_dict()

    return answer


def _composition(payload: dict[str, Any], *, conn = None) -> dict[str, Any]:
    """
    Answer one composition request (T020m, contracts §1a).

    A caller assembles a dataset from generic queries exactly as `metalinksdb`
    does, and may pass a saved preset as one component. The cost governor
    prices **the composition** rather than each component, because the
    composition is what runs.

    Args:
        payload: `{"operation": …, "components": [...], "steps": [...]}`, plus
            the paging and projection parameters of a plain request.
        conn: An open connection, or None to open one.

    Returns:
        The same answer shape `run` returns.

    Raises:
        guard.GuardrailRefusal: For a composition the cost governor will not run.
    """

    query = _params.parse(payload)

    with _scope.connection(conn) as live:

        node = _compose.resolve_payload(payload, conn = live)
        record = _compose._record_filter(node, live) if _compose._scopable(node) else None
        resolved = _scope.resolve(query, conn = live)
        _apply_preset(query, resolved)
        estimate = _guard.check(query, resolved, conn = live, record = record)
        rows = _compose.run(node, conn = live)
        interactions = _project_page(rows, query, live)

    return {
        'interactions': interactions,
        'total': len(interactions) if record is None else int(estimate.qualifying_keys),
        'total_is_estimate': record is not None,
        'limit': query.limit,
        'offset': query.offset,
        'operation': payload.get('operation') or 'union',
        'estimate': estimate.as_dict(),
    }


def _apply_preset(query: _params.InteractionQuery, resolved: _scope.ResolvedScope) -> None:
    """
    Let a named preset supply the defaults the request did not state.

    A preset is a parameter set, and this is where the rest of that set — the
    ones the scope resolution could not apply on its own — reaches the query.
    Its collapse mode is the default for its own rows, and its declared
    attributes are the ones its consumers expect to find. Both give way to a
    caller who stated something else, which is what makes them defaults.

    The names a preset declares that the standard output already carries are
    dropped rather than passed on: sending `references` to the long-tail
    attribute projection would look for a JSONB key of that name, find none,
    and report null for a field the fold has already filled in.

    Args:
        query: The parsed request, modified in place.
        resolved: The scope, carrying whatever the named presets declare.

    Returns:
        None.
    """

    if resolved.collapse_mode and not query.collapse_requested:

        query.collapse = resolved.collapse_mode

    attributes = list(query.attributes) or list(resolved.default_attributes)

    for name in resolved.mandatory_attributes:

        if name not in attributes:

            attributes.append(name)

    query.attributes = [
        name for name in attributes if name not in _nodes.STANDARD_BLOCKS
    ]


def _project_page(
        rows: list[dict[str, Any]],
        query: _params.InteractionQuery,
        conn,
) -> list[dict[str, Any]]:
    """
    Render one page of folded rows, with both ends of every interaction named.

    The per-node lookup runs once for the page rather than once per row: a
    five-hundred-row page reaches at most a thousand entities and reads them in
    one indexed statement, so the projection costs the same whether the page is
    one dataset's or another's.

    Args:
        rows: The folded rows of one page.
        query: The parsed request, for the projection parameters.
        conn: An open connection.

    Returns:
        The page, ready to serialise.
    """

    index = _nodes.lookup(_nodes.entity_ids(rows), conn = conn)

    return [_project(row, query, conn, index) for row in rows]


def _project(
        row: dict[str, Any],
        query: _params.InteractionQuery,
        conn,
        index: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Render one collapsed row for the response.

    Args:
        row: The folded row, in the shape of data-model §3b.
        query: The parsed request, for the projection parameters.
        conn: An open connection, for the class vocabulary.
        index: The page's per-node lookup, keyed by entity id.

    Returns:
        The row as JSON-ready values, with the class slug and label added, both
        endpoints projected into the standard per-node columns, and the
        requested long-tail keys gathered under `attributes`.
    """

    out: dict[str, Any] = {}
    attributes: dict[str, Any] = {}

    for name, value in row.items():

        if name.startswith('attribute:'):

            attributes[name.split(':', 1)[1]] = value

        elif name in _UUID_KEYS:

            out[name] = str(value) if value is not None else None

        else:

            out[name] = value

    class_slug = None

    if (class_id := row.get('interaction_class_id')) is not None:

        vocabulary = _class_vocabulary(conn).get(int(class_id), {})
        class_slug = vocabulary.get('name')
        out['interaction_type'] = class_slug
        out['interaction_type_label'] = vocabulary.get('label')

    out.update(_nodes.project(row, index or {}, query.view, class_slug))

    if query.attributes:

        # FR-045: a name that is neither a hot column nor a present key comes
        # back null rather than as a 4xx, and never drops the interaction.
        out['attributes'] = {name: attributes.get(name) for name in query.attributes}

    return out


def _class_vocabulary(conn) -> dict[int, dict[str, Any]]:
    """
    The interaction-class vocabulary, read once per process.

    Args:
        conn: An open connection.

    Returns:
        `{interaction_class_id: {'name': slug, 'label': display}}`. Filtering is
        by slug; the label is output-side and is never a query value.
    """

    if SEARCH_SCHEMA not in _CLASS_NAMES:

        rows = conn.execute(
            f"""
            SELECT interaction_class_id, name, label
            FROM {SEARCH_SCHEMA}.vocab_interaction_class
            """,
        ).fetchall()
        _CLASS_NAMES[SEARCH_SCHEMA] = {
            int(row['interaction_class_id']): {
                'name': row['name'],
                'label': row['label'],
            }
            for row in rows
        }

    return _CLASS_NAMES[SEARCH_SCHEMA]
