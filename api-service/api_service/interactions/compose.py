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

**A shape is per component, and the order rule binds inside one shape.**

The grain and the collapse mode together decide what one row *is* — the key it
is folded on. A component carries its own, because a composition is allowed to
span two of them: a union of a binary dataset and a reaction projection is a
union of rows that are not the same kind of thing, and no single key answers
both. So the components are grouped by the key their rows fold on, each group
is unioned and folded **once**, and the groups are concatenated. Inside a
group the order rule above holds unchanged — that is where two rows can be the
same row, and where collapsing before the union would split one interaction in
two. Across groups there are two rows because there are two questions, and
each row says which grain answered it.

A recipe may also state the shape of the rows it returns, on its `union` or on
its `collapse`. That is a different statement from a component's own: the
component's is the grain it is **read** at, the recipe's is the grain its union
**folds** at, and where the recipe states one it is the shape every component
under it takes. A recipe that states nothing lets its components disagree, and
disagreeing is what spans two grains.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, replace
from typing import Any, Sequence

from ..graph import SEARCH_SCHEMA
from ..resource_catalog import resolve_resource_filters
from . import fold as _fold
from . import params as _params
from . import scope as _scope
from .select import RecordFilter, group_keys, page_keys, record_filter

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
    # The shape the recipe states for the rows under this node, where it states
    # one. It overrides what the components say, because the nearest enclosing
    # statement is the one made about these rows. None leaves each component
    # its own, which is how a recipe spans two grains.
    grain: str | None = None
    collapse_mode: str | None = None


def component(payload: dict[str, Any]) -> Component:
    """
    One component query, from the same payload `POST /interactions` takes.

    Args:
        payload: The component's parameters.

    Returns:
        The component.
    """

    return Component(query = _params.parse(payload), payload = dict(payload or {}))


def union(
        components: Sequence[Any],
        *,
        grain: str | None = None,
        collapse: str | None = None,
) -> Node:
    """
    Combine the row sets of several components or nodes.

    Args:
        components: The components or nodes to combine.
        grain: The grain the union folds at, where the recipe states one. It
            replaces the grain the components were read at, so stating one is
            how a recipe asks for a single shape from components that disagree.
        collapse: The collapse mode the union folds at, on the same terms.

    Returns:
        The union node. It carries no summaries of its own — a `collapse` over
        it recomputes them over the scope the union actually holds.
    """

    return Node(
        operation = 'union',
        children = list(components),
        grain = _shape_word(grain, _params.GRAINS),
        collapse_mode = _shape_word(collapse, _params.COLLAPSE_MODES),
    )


def collapse(node: Any, *, mode: str | None = None) -> Node:
    """
    Fold a node to one row per key, over that node's own resolved scope.

    Args:
        node: The component or node to fold.
        mode: How far to fold, where the recipe says. A mode stated here is the
            recipe's statement about its own rows and replaces the components'.

    Returns:
        The collapse node.
    """

    return Node(
        operation = 'collapse',
        children = [node],
        collapse_mode = _shape_word(mode, _params.COLLAPSE_MODES),
    )


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
        Collapsed rows, one per key of the shape the composition folds at — an
        ordered `(subject, object, class)` at the default grain, so a
        composition and a plain query are comparable row for row. A composition
        that spans two shapes returns the rows of each, and every one of them
        carries the `grain` it was folded at, because the page can no longer
        name one for all of them.
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

        This is the composition's selection and nothing else. A composition
        whose components fold on different keys still resolves to one
        predicate — the rows it may see are one set — but no single fold turns
        that set into its rows, and `run` is the path that folds it once per
        shape.
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


def spans_shapes(node: Any) -> bool:
    """
    Whether a composition's components fold on more than one key.

    Args:
        node: The composition.

    Returns:
        True where no single fold answers it, so its rows have to be obtained
        one shape at a time.
    """

    return len(_shape_groups(node)) > 1


def fold_by_shape(
        node: Any,
        *,
        conn,
        page: _params.InteractionQuery | None = None,
        resolved: _scope.ResolvedScope | None = None,
) -> list[dict[str, Any]]:
    """
    Fold a composition once per shape, under an enclosing request's paging.

    `run` is this same fold for a composition that **is** the request. This is
    the entry for a composition a request merely names: the rows are that
    request's page and carry its projection, while what one row *is* stays the
    recipe's to say. Without it the engine would have to group the components
    itself to serve a two-grain dataset, and the rule that decides when two
    rows are the same kind of thing would be written down twice.

    Args:
        node: The composition.
        conn: An open connection.
        page: The request whose page these rows are.
        resolved: That request's resolved scope, whose own predicates narrow
            the recipe.

    Returns:
        The collapsed rows of every shape, each naming the grain it was folded
        at where more than one shape is present.
    """

    return _fold_scope(node, conn, page = page, resolved = resolved)


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


def _fold_scope(
        node: Any,
        conn,
        *,
        page: _params.InteractionQuery | None = None,
        resolved: _scope.ResolvedScope | None = None,
) -> list[dict[str, Any]]:
    """
    Fold whatever record filter a node resolves to, once per shape it holds.

    Components that fold on the same key are one fold: their filters are ORed
    and the summaries are recomputed over everything the union admits, which is
    the order rule. Components that fold on different keys cannot be: the rows
    of one are not the rows of the other, and folding them together would
    answer one of the two questions under the name of both. Each shape is
    therefore restricted out of the tree — exclusions and all — folded on its
    own, and the results concatenated.

    Args:
        node: The composition.
        conn: An open connection.
        page: The enclosing request, where the composition is being served as
            a named dataset rather than being the request itself. None leaves
            each group paging under its own widest component, which is what a
            composition asked for directly means.
        resolved: The enclosing request's resolved scope, or None where the
            composition's own filters are the whole of the selection.

    Returns:
        The collapsed rows. Where more than one shape is present, each row
        names the grain it was folded at, since no single value describes the
        page any more.
    """

    groups = _shape_groups(node)
    scope = resolved if resolved is not None else _scope.ResolvedScope()

    if len(groups) < 2:

        only = next(iter(groups.values()), [])

        return _fold.fold_rows(
            _paged(only, page),
            scope,
            conn = conn,
            record = _narrowed(_record_filter(node, conn), page, scope),
        )

    rows: list[dict[str, Any]] = []

    for members in groups.values():

        part = _restricted(node, {id(one) for one, _ in members})
        query = _paged(members, page)
        folded = _fold.fold_rows(
            query,
            scope,
            conn = conn,
            record = _narrowed(_record_filter(part, conn), page, scope),
        )

        for row in folded:

            row['grain'] = query.grain

            if query.grain == 'interaction':

                # The collapse mode describes how far an ordered endpoint pair
                # folds. At the other grain nothing reads it, so naming it on
                # the row would be a claim the fold never made.
                row['collapse'] = query.collapse

        rows.extend(folded)

    return rows


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


def _representative(
        queries: Sequence[_params.InteractionQuery],
) -> _params.InteractionQuery:
    """
    The paging **one shape group** folds under.

    Paging only: every query here already folds on the same key, so the widest
    one carries the group's shape as much as any other does. Choosing a
    representative for the shape as well is what used to drop a component's
    own collapse mode whenever another component asked for more rows — a
    comparison of limits deciding what a row is.

    Args:
        queries: The effective queries of one shape group.

    Returns:
        The widest of them, so a composition returns at least as much as its
        largest component asked for.
    """

    if not queries:

        return _params.parse({})

    return max(queries, key = lambda one: one.limit)


def _paged(
        members: Sequence[tuple[Component, _params.InteractionQuery]],
        page: _params.InteractionQuery | None,
) -> _params.InteractionQuery:
    """
    The query one shape group is folded under.

    Two statements meet here, and each is taken from the side that made it. The
    group says what one of its rows **is**: the grain and the collapse mode are
    the key it folds on. An enclosing request says how much of it comes back
    and what is projected onto it. A request that names a dataset is not one of
    that dataset's components, so its `limit` makes no claim about their shape
    — the same separation `_representative` keeps between the components
    themselves.

    Args:
        members: One shape group's components and their effective queries.
        page: The enclosing request, or None where the composition is itself
            the request and each group pages under its widest component.

    Returns:
        The query to fold under.
    """

    shape = _representative([query for _, query in members])

    if page is None:

        return shape

    return replace(page, grain = shape.grain, collapse = shape.collapse)


def _narrowed(
        record: RecordFilter,
        page: _params.InteractionQuery | None,
        scope: _scope.ResolvedScope,
) -> RecordFilter:
    """
    One shape group's filter, intersected with the request that asked for it.

    A recipe narrows the dataset and a caller's filters narrow the request, and
    both hold at once. That is the intersection the engine already makes for a
    recipe of one shape; here it is made once per group, because here there is
    more than one filter to make it against.

    Args:
        record: The group's own record filter.
        page: The enclosing request, or None where there is none to intersect.
        scope: The resolved scope the request's own predicates read against.

    Returns:
        The filter the group folds.
    """

    if page is None:

        return record

    return record.combined(record_filter(page, scope), 'AND')


def _shape_groups(
        node: Any,
) -> dict[Any, list[tuple[Component, _params.InteractionQuery]]]:
    """
    The components under a node, gathered by the key their rows fold on.

    Args:
        node: The composition.

    Returns:
        `{key: [(component, effective query), …]}`, in tree order, where the
        key is the page key and the fold key together — which is the whole of
        what makes two rows the same kind of thing.
    """

    groups: dict[Any, list[tuple[Component, _params.InteractionQuery]]] = {}

    for one, query in _shaped(node):

        groups.setdefault((page_keys(query), group_keys(query)), []).append(
            (one, query),
        )

    return groups


def _shaped(
        node: Any,
        grain: str | None = None,
        collapse: str | None = None,
) -> list[tuple[Component, _params.InteractionQuery]]:
    """
    Every component under a node, with the shape it is actually folded at.

    A component states the grain and the collapse it is read at. A `union` or
    a `collapse` may state the shape the recipe folds its rows at. The nearest
    enclosing statement wins, so a nested union's own grain governs its own
    components and nothing else.

    Args:
        node: The composition.
        grain: The grain stated by an enclosing node, or None.
        collapse: The collapse mode stated by an enclosing node, or None.

    Returns:
        The components and their effective queries, in tree order.
    """

    if isinstance(node, Component):

        return [(
            node,
            replace(
                node.query,
                grain = grain or node.query.grain,
                collapse = collapse or node.query.collapse,
            ),
        )]

    return [
        pair
        for child in node.children
        for pair in _shaped(
            child,
            node.grain or grain,
            node.collapse_mode or collapse,
        )
    ]


def _restricted(node: Any, keep: set[int]) -> Any | None:
    """
    The same composition with only some of its components left in it.

    The tree is rebuilt rather than the components collected, so that an
    `exclude` standing over the union still stands over the part of it that is
    folded here. A branch that keeps no component drops out. A union left with
    one child is that child's filter, which is what a union of one means.

    Args:
        node: The composition.
        keep: The `id()` of every component to keep.

    Returns:
        The restricted composition, or None where it holds nothing.
    """

    if isinstance(node, Component):

        return node if id(node) in keep else None

    children = [
        child for child in
        (_restricted(one, keep) for one in node.children)
        if child is not None
    ]

    return replace(node, children = children) if children else None


def _shape_word(value: Any, vocabulary: Sequence[str]) -> str | None:
    """
    One stated shape word, or None where nothing usable was stated.

    A word outside the vocabulary is dropped rather than refused, the same way
    the parameter surface drops one: a shape says how to present an answer, so
    a typo in it costs the presentation and never the answer.

    Args:
        value: The word as the recipe wrote it.
        vocabulary: The words this dimension admits.

    Returns:
        The word, or None.
    """

    word = str(value or '').strip().lower()

    if value and word not in vocabulary:

        _log.warning('ignoring unknown composition shape %r', value)

    return word if word in vocabulary else None


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

    # A shape written beside the component list is the recipe's own statement
    # about the rows it returns, and it is the same word a request writes for
    # the same purpose. Stating it is how a recipe asks for one shape from
    # components read at several. Leaving it out is how `cosmos` keeps the
    # reaction projection at its own grain.
    stated = {
        'grain': payload.get('grain'),
        'collapse': payload.get('collapse'),
    }
    node: Any = (
        union(components, **stated)
        if len(components) > 1 or any(stated.values())
        else components[0]
    )
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

        return collapse(node, mode = step.get('collapse') or step.get('mode'))

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

        The shape it declares travels with it: a preset used as a component of
        a wider recipe is read at its own grain and its own collapse, which is
        the whole of what lets one recipe hold a binary dataset beside a
        reaction one. The grain is probed rather than named, because a serving
        copy older than the column would otherwise turn every preset into an
        error; a build without it declares no grain, and the component keeps
        the default.
    """

    row = conn.execute(
        f"""
        SELECT name, composition, included_sources, interaction_class_scope,
               collapse_mode,
               {_scope._optional_column(conn, 'network_registry', 'grain', 'text')}
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
        'grain': row['grain'],
    })
