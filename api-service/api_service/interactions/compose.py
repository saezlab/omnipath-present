"""
The composition algebra.

A dataset is a named composition of calls to the one engine, never a query
function of its own. `metalinksdb` is a `union` of three components, an
`exclude`, a `collapse` and an `annotate`; `nichenet` is a `union` of three
presets; a caller's own dataset is the same object, assembled through
`POST /interactions/compose`.

**Two orders are binding, and both keep the fold counting only the resources
the caller kept.**

The `collapse` runs **after** the `union` and over the union's own resolved
scope. Collapsing each component first and then unioning them emits one row per
component for an interaction several components report, each carrying summaries
folded over its own component's resources — the defect that keeping one
per-resource record removed between tables, reintroduced between components.

The `exclude` runs **before** the `collapse`, so an excluded resource
contributes no row **and no count**. Dropping it afterwards leaves its
contribution inside `source_count`, `references` and the sign flags. "Retained
for provenance" means the resource keeps its rows in the record for another
query to find, not that it stays in the provenance of a row this composition
returns.

Both orders fall out of one representation rather than being enforced by a
check: a component, a union and an exclusion are all **record filters**, and a
collapse is the fold of whatever filter reaches it. So the collapse cannot see
rows an exclusion removed, and a union that has not been collapsed has no
summaries to be wrong.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Sequence

from ..graph import SEARCH_SCHEMA
from ..resource_catalog import resolve_resource_filters
from . import fold as _fold
from . import params as _params
from . import scope as _scope
from .select import RecordFilter, record_filter

_log = logging.getLogger(__name__)

OPERATIONS = ('union', 'collapse', 'exclude', 'annotate')


@dataclass
class Component:
    """One generic query, the leaf of every composition."""

    query: _params.InteractionQuery
    payload: dict[str, Any] = field(default_factory = dict)
    operation: str = 'component'


@dataclass
class Node:
    """One composition operation over components or over other nodes."""

    operation: str
    children: list[Any] = field(default_factory = list)
    resources: list[str] = field(default_factory = list)
    layer: str | None = None


def component(payload: dict[str, Any]) -> Component:
    """
    One component query, from the same payload `POST /interactions` takes.

    Args:
        payload: The component's parameters.

    Returns:
        The component.
    """

    return Component(query = _params.parse(payload), payload = dict(payload or {}))


def union(components: Sequence[Any]) -> Node:
    """
    Combine the row sets of several components or nodes.

    Args:
        components: The components or nodes to combine.

    Returns:
        The union node. It carries no summaries of its own — a `collapse` over
        it recomputes them over the scope the union actually holds.
    """

    return Node(operation = 'union', children = list(components))


def collapse(node: Any) -> Node:
    """
    Fold a node to one row per key, over that node's own resolved scope.

    Args:
        node: The component or node to fold.

    Returns:
        The collapse node.
    """

    return Node(operation = 'collapse', children = [node])


def exclude(node: Any, resources: Sequence[str]) -> Node:
    """
    Remove a resource **before** the fold, so it contributes no row and no count.

    Args:
        node: The component or node to narrow.
        resources: The resource slugs to drop.

    Returns:
        The exclusion node.
    """

    return Node(
        operation = 'exclude',
        children = [node],
        resources = list(resources or []),
    )


def annotate(node: Any, layer: str) -> Node:
    """
    Attach the per-entity annotation layer to a node's rows.

    Args:
        node: The component or node to annotate.
        layer: The annotation layer name.

    Returns:
        The annotation node.
    """

    return Node(operation = 'annotate', children = [node], layer = layer)


def run(node: Any, *, conn = None) -> list[dict[str, Any]]:
    """
    Evaluate one composition into collapsed rows.

    Args:
        node: The composition.
        conn: An open connection, or None to open one.

    Returns:
        Collapsed rows, one per ordered `(subject, object, class)`, so a
        composition and a plain query are comparable row for row.
    """

    with _scope.connection(conn) as live:

        return _rows(node, live)


def resolve_payload(payload: dict[str, Any], *, conn = None) -> Node:
    """
    Read the stored or requested composition shape into a node tree.

    The shape is the one `network_registry.composition` stores:
    `{"operation": …, "components": [{"preset": name} | {"parameters": {…}}],
    "steps": [{"operation": "exclude", "resources": […]}, …]}`.

    Args:
        payload: The composition description.
        conn: An open connection, or None to open one.

    Returns:
        The composition.
    """

    with _scope.connection(conn) as live:

        return _node_from(payload or {}, live)


def for_presets(names: Sequence[str], *, conn) -> Any | None:
    """
    The composition behind the datasets a request named, or None.

    A dataset that stores a recipe must be *served* by it, or the recipe is
    decoration: `/interactions/metalinksdb` would resolve the union of the
    dataset's resources and keep neither the mechanism restriction nor the
    exclusion, returning several times the rows under the dataset's name. So
    this is the lookup the engine does before it treats a named dataset as a
    plain resource scope.

    Args:
        names: The preset names the request resolved to.
        conn: An open connection.

    Returns:
        The composition — a union where several named datasets carry one — or
        None when none of them stores a recipe, which is the common case.
    """

    nodes = []

    for name in names:

        node = _preset(name, conn)

        if isinstance(node, Node):

            nodes.append(node)

    if not nodes:

        return None

    return nodes[0] if len(nodes) == 1 else union(nodes)


def layers(node: Any) -> list[str]:
    """
    The annotation layers a composition's `annotate` steps ask for.

    Args:
        node: The composition.

    Returns:
        The layer names, in tree order, without duplicates.
    """

    if isinstance(node, Component):

        return []

    found = [name for child in node.children for name in layers(child)]

    if node.operation == 'annotate' and node.layer:

        found.append(node.layer)

    return list(dict.fromkeys(found))


def record_filter_for(node: Any, *, conn) -> RecordFilter | None:
    """
    The record predicate a composition resolves to, or None where it has one.

    Args:
        node: The composition.
        conn: An open connection.

    Returns:
        One boolean expression over the record alias `r`, or None when the
        composition holds a component that has already been folded and so is a
        row set rather than a filter.
    """

    inner = node

    # A trailing `collapse` or `annotate` is not part of the selection: the
    # first is the fold the engine performs anyway and the second decorates the
    # rows it produces. Both are unwrapped here rather than admitted by
    # `_scopable`, which is what stops a *union of collapsed components* being
    # treated as one filter — the wrong order, silently repaired.
    while isinstance(inner, Node) and inner.operation in ('collapse', 'annotate'):

        inner = inner.children[0]

    if not _scopable(inner):

        return None

    return _record_filter(inner, conn)


def preset(name: str, *, conn = None) -> Any:
    """
    One named preset as a composition.

    Args:
        name: The `network_registry` preset name.
        conn: An open connection, or None to open one.

    Returns:
        The preset's stored composition, or — where it stores none — the
        component that scopes the engine to the preset's own resources.
    """

    with _scope.connection(conn) as live:

        return _preset(name, live)


# ── evaluation ──────────────────────────────────────────────────────────────


def _rows(node: Any, conn) -> list[dict[str, Any]]:
    """
    Evaluate a node into rows.

    Args:
        node: The composition.
        conn: An open connection.

    Returns:
        The collapsed rows.
    """

    if isinstance(node, Component):

        return _fold_scope(node, conn)

    if node.operation in ('collapse', 'exclude'):

        return _fold_scope(node, conn)

    if node.operation == 'annotate':

        rows = _rows(node.children[0], conn)

        for row in rows:

            row['annotation_layer'] = node.layer

        return rows

    if node.operation == 'union':

        if all(_scopable(child) for child in node.children):

            # Every child is a record filter, so the union is one too and one
            # fold answers it over the union's own scope.
            return _fold_scope(node, conn)

        # A child that has already been collapsed carries summaries of its own
        # component's scope. Concatenating them is the wrong order, and it is
        # the caller's to ask for — the engine does not silently repair it.
        return [row for child in node.children for row in _rows(child, conn)]

    raise ValueError(f'unknown composition operation {node.operation!r}')


def _fold_scope(node: Any, conn) -> list[dict[str, Any]]:
    """
    Fold whatever record filter a node resolves to.

    Args:
        node: The composition.
        conn: An open connection.

    Returns:
        The collapsed rows.
    """

    predicate = _record_filter(node, conn)
    query = _representative(node)

    return _fold.fold_rows(
        query,
        _scope.ResolvedScope(),
        conn = conn,
        record = predicate,
    )


def _scopable(node: Any) -> bool:
    """
    Whether a node is a record filter rather than a set of folded rows.

    Args:
        node: The composition.

    Returns:
        True for a component, a union of components, or an exclusion over one.
    """

    if isinstance(node, Component):

        return True

    if node.operation == 'union':

        return all(_scopable(child) for child in node.children)

    if node.operation == 'exclude':

        return _scopable(node.children[0])

    return False


def _record_filter(node: Any, conn) -> RecordFilter:
    """
    The record filter a node resolves to, with its exclusions already applied.

    Args:
        node: The composition.
        conn: An open connection.

    Returns:
        One boolean expression over the record alias `r`.
    """

    if isinstance(node, Component):

        return record_filter(node.query, _scope.resolve(node.query, conn = conn))

    if node.operation == 'collapse':

        return _record_filter(node.children[0], conn)

    if node.operation == 'annotate':

        return _record_filter(node.children[0], conn)

    if node.operation == 'exclude':

        inner = _record_filter(node.children[0], conn)
        ids = _source_ids(node.resources, conn)

        if not ids:

            return inner

        return RecordFilter(
            sql = f'({inner.sql}) AND r.source_id <> ALL(%s::bigint[])',
            args = [*inner.args, ids],
        )

    if node.operation == 'union':

        parts = [_record_filter(child, conn) for child in node.children]
        combined = parts[0]

        for part in parts[1:]:

            combined = combined.combined(part, 'OR')

        return combined

    raise ValueError(f'unknown composition operation {node.operation!r}')


def _representative(node: Any) -> _params.InteractionQuery:
    """
    The paging and shape a composition folds under.

    Args:
        node: The composition.

    Returns:
        The widest of the components' own queries, so a composition returns at
        least as much as its largest component asked for.
    """

    queries = _queries(node)

    if not queries:

        return _params.parse({})

    widest = max(queries, key = lambda one: one.limit)

    return widest


def _queries(node: Any) -> list[_params.InteractionQuery]:
    """
    Every component query under a node.

    Args:
        node: The composition.

    Returns:
        The queries, in tree order.
    """

    if isinstance(node, Component):

        return [node.query]

    return [query for child in node.children for query in _queries(child)]


def _source_ids(resources: Sequence[str], conn) -> list[int]:
    """
    Resolve resource slugs to `source_id` values.

    Args:
        resources: The resource slugs, short names or synonyms.
        conn: An open connection.

    Returns:
        The ids, sorted.
    """

    names = resolve_resource_filters(list(resources))

    if not names:

        return []

    rows = conn.execute(
        f'SELECT source_id FROM {SEARCH_SCHEMA}.data_source WHERE name = ANY(%s::text[])',
        (names,),
    ).fetchall()

    return sorted(int(row['source_id']) for row in rows)


# ── the stored shape ────────────────────────────────────────────────────────


def _node_from(payload: dict[str, Any], conn) -> Any:
    """
    Build a composition from `network_registry.composition`'s shape.

    The steps are applied with the binding order rather than the listed one:
    every `exclude` runs before any `collapse`, because an exclusion after the
    fold leaves the excluded resource inside the numbers.

    Args:
        payload: The composition description.
        conn: An open connection.

    Returns:
        The composition.
    """

    components = [
        _component_from(entry, conn)
        for entry in (payload.get('components') or [])
    ]

    if not components and payload.get('parameters') is not None:

        components = [component(payload['parameters'])]

    if not components:

        components = [component(payload)]

    node: Any = union(components) if len(components) > 1 else components[0]
    steps = list(payload.get('steps') or [])

    if (operation := payload.get('operation')) in OPERATIONS and operation != 'union':

        steps.insert(0, {**payload, 'operation': operation})

    for step in sorted(steps, key = lambda one: _STEP_ORDER.get(one.get('operation'), 9)):

        node = _apply(node, step, conn)

    return node


_STEP_ORDER = {'exclude': 0, 'collapse': 1, 'annotate': 2}


def _apply(node: Any, step: dict[str, Any], conn) -> Any:
    """
    Apply one composition step.

    Args:
        node: The composition so far.
        step: The step description.
        conn: An open connection.

    Returns:
        The composition with the step applied.
    """

    operation = step.get('operation')

    if operation == 'exclude':

        return exclude(node, step.get('resources') or [])

    if operation == 'collapse':

        return collapse(node)

    if operation == 'annotate':

        return annotate(node, step.get('layer') or step.get('annotation_layer'))

    _log.warning('ignoring unknown composition step %r', operation)

    return node


def _component_from(entry: dict[str, Any], conn) -> Any:
    """
    One component of a stored composition — a preset or a parameter set.

    Args:
        entry: The component description.
        conn: An open connection.

    Returns:
        The component, or the preset's own composition.
    """

    if isinstance(entry, str):

        return _preset(entry, conn)

    if name := entry.get('preset'):

        return _preset(name, conn)

    return component(entry.get('parameters') or entry)


def _preset(name: str, conn) -> Any:
    """
    One named preset, as its stored composition or as a scoped component.

    Args:
        name: The preset name.
        conn: An open connection.

    Returns:
        The composition. A per-component override — `nichenet`'s, say —
        works because a preset is a component like any other: replacing one
        component leaves the rest standing.
    """

    row = conn.execute(
        f"""
        SELECT name, composition, included_sources, interaction_class_scope,
               collapse_mode
        FROM {SEARCH_SCHEMA}.network_registry
        WHERE name = %s
        """,
        (str(name).lower(),),
    ).fetchone()

    if not row:

        _log.warning('unknown preset %r; scoping the component to its name', name)

        return component({'filters': {'datasets': [name]}})

    if row['composition']:

        return _node_from(row['composition'], conn)

    return component({
        'filters': {
            'resources': list(row['included_sources'] or []),
            'interaction_classes': list(row['interaction_class_scope'] or []),
        },
        'collapse': row['collapse_mode'],
    })
