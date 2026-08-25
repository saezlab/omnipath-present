"""
The one query engine.

Every `/interactions*` route reaches the interaction tables through `run`, and
nothing else reaches them at all. That is the serving-side reading of a rule
the build already holds: per-dataset materialised views are forbidden, and
without the same rule here the 1,571 lines of view definitions reappear as
route code, one query function per dataset, and the parameter surface stops
being the thing that has to be general.

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
from . import annotate as _annotate
from . import compose as _compose
from . import discover as _discover
from . import fold as _fold
from . import guard as _guard
from . import nodes as _nodes
from . import params as _params
from . import project as _projection
from . import scope as _scope
from . import select as _select
from . import shape as _shape

_log = logging.getLogger(__name__)

# The collapsed-row keys that carry an entity id or a uuid; rendered as text
# so a response is JSON without a custom encoder.
_UUID_KEYS = ('subject_entity_id', 'object_entity_id', 'interaction_id')

_CLASS_NAMES: dict[str, dict[int, dict[str, Any]]] = {}

# Which folded column holds the entity behind each output side.
_NODE_ENTITY: dict[str, str] = {
    output: f'{record}_entity_id' for record, output in _nodes.SIDES.items()
}

# The delimiter the legacy columns join with. One character, one meaning: a
# resource name and a reference id never contain it.
DELIMITER = ';'


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
        # entered with a component list instead of one parameter set.
        return _composition(payload, conn = conn)

    if payload.get('discover') in _discover.QUESTIONS:

        # Discovery is not a fast path around the engine either. It is the
        # engine entered with a question about the scope instead of a request
        # for rows: the same parameters, the same resolution, the same
        # guardrail, and no fold.
        return _discovery(payload, conn = conn)

    query = _params.parse(payload)

    with _scope.connection(conn) as live:

        resolved = _scope.resolve(query, conn = live)
        # A named dataset may store a recipe rather than a resource list, and
        # then the recipe is what the dataset *is*. Resolving it to the union
        # of its resources would drop the restrictions that define it — here,
        # several times the rows under the dataset's own name.
        recipe = _compose.for_presets(resolved.preset_names, conn = live)

        if recipe is not None:

            resolved.mandatory_attributes = list(dict.fromkeys(
                [*resolved.mandatory_attributes, *_compose.layers(recipe)]
            ))

        _apply_preset(query, resolved)
        record = _recipe_filter(recipe, query, resolved, live)
        # The guardrail is priced without the long-tail predicates, because
        # what it needs to know is how many rows one of them would be applied
        # to. Handing it the predicate it is measuring would answer with the
        # rows that survive it.
        priced = _recipe_filter(recipe, query, resolved, live, long_tail = False)
        estimate = _guard.check(query, resolved, conn = live, record = priced)
        rows = _fold.fold_rows(query, resolved, conn = live, record = record)
        interactions = _project_page(rows, query, live, resolved)

        if query.exact_total:

            # An exact count is the full fold of the scope and is only run
            # because the caller asked; the guardrail has already priced it.
            total = _fold.count_groups(
                query, resolved, conn = live, record = record,
            )

        else:

            total = estimate.qualifying_keys

    answer: dict[str, Any] = {
        'interactions': interactions,
        'total': int(total),
        # Nothing stores the collapse any more, so the unscoped total is an
        # estimate like every other. An unlabelled estimate is the same kind of
        # quietly wrong number as a summary folded over resources the caller
        # excluded, so the label is a required field.
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

    if estimate.at_least and not query.exact_total:

        # The bounded key scan stopped at its ceiling, so `total` is a floor
        # and not a count of anything. A floor reported as a total is the
        # quietly wrong number under a third name, and the label costs one key.
        answer['total_is_lower_bound'] = True

    if len(rows) >= query.limit and rows:

        answer['cursor'] = _fold.encode_cursor([
            rows[-1]['subject_entity_id'],
            rows[-1]['object_entity_id'],
            rows[-1]['interaction_class_id'],
        ])

    if query.filters.post_fold() or query.exact_total or estimate.at_least:

        answer['estimate'] = estimate.as_dict()

    return answer


def _recipe_filter(recipe, query, resolved, conn, *, long_tail = True):
    """
    The record predicate for a request whose dataset stores a recipe.

    The caller's own filters are intersected with the recipe rather than
    replacing it: a recipe narrows the dataset and a filter narrows the
    request, and both hold at once. The intersection is safe in the other
    direction too, because the recipe's components are drawn from the
    dataset's own resource scope — so the scope contributes nothing the recipe
    has not already said, and contradicts nothing it has.

    Args:
        recipe: The composition, or None for a dataset that is one query.
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection.
        long_tail: Whether the caller's own predicates on the attribute
            document belong in the expression. `guard` wants them out.

    Returns:
        The combined predicate, or None where the request has no recipe.
    """

    if recipe is None:

        return None

    predicate = _compose.record_filter_for(recipe, conn = conn)

    if predicate is None:

        return None

    return predicate.combined(
        _select.record_filter(query, resolved, long_tail = long_tail), 'AND',
    )


def _discovery(payload: dict[str, Any], *, conn = None) -> dict[str, Any]:
    """
    Answer one question about a scope, without returning any interaction.

    Args:
        payload: The same filters a query takes, plus `discover` naming the
            question — the reachable parameter values, or the counts.
        conn: An open connection, or None to open one.

    Returns:
        The answer `discover` shapes, carrying counts and never rows.

    Raises:
        guard.GuardrailRefusal: For a scope the cost governor will not resolve
            or will not price.
    """

    query = _params.parse(payload)

    with _scope.connection(conn) as live:

        resolved = _scope.resolve(query, conn = live)
        _apply_preset(query, resolved)
        estimate = _guard.check(query, resolved, conn = live)

        if payload['discover'] == _discover.PARAMETER_VALUES:

            return _discover.parameter_values(query, resolved, live)

        return _discover.statistics(query, resolved, estimate, live)


def _composition(payload: dict[str, Any], *, conn = None) -> dict[str, Any]:
    """
    Answer one composition request.

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
        interactions = _project_page(rows, query, live, resolved)

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
    and report null for a field the fold has already filled in. A hot column
    is the exception — it is on the row either way, so naming it selects it
    rather than losing it.

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

    # The annotation layers leave the list here rather than at parse time,
    # because a preset may declare one and the split has to see the final list.
    # A layer name left in would reach the long-tail projection, name no key of
    # the record's attribute document, and come back null — reading as a build
    # that carries no annotation at all.
    query.annotation_layers, attributes = _annotate.read(attributes)
    query.attributes = [
        name for name in attributes
        if name in _projection.HOT_COLUMNS or name not in _nodes.STANDARD_BLOCKS
    ]


def _project_page(
        rows: list[dict[str, Any]],
        query: _params.InteractionQuery,
        conn,
        resolved: _scope.ResolvedScope,
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
        resolved: The resolved scope, for the Shape group's reads.

    Returns:
        The page, ready to serialise.
    """

    index = _nodes.lookup(_nodes.entity_ids(rows), conn = conn)
    annotations = _annotate.index(conn) if rows else {}
    registry = _scope.dataset_registry(conn) if rows else []
    projected = [
        _project(row, query, conn, index, annotations, registry, resolved)
        for row in rows
    ]

    return _shape.apply(projected, rows, query, resolved, conn = conn)


def _project(
        row: dict[str, Any],
        query: _params.InteractionQuery,
        conn,
        index: dict[str, dict[str, Any]] | None = None,
        annotations: dict[str, dict[str, tuple[str, ...]]] | None = None,
        registry: list[dict[str, Any]] | None = None,
        resolved: _scope.ResolvedScope | None = None,
) -> dict[str, Any]:
    """
    Render one collapsed row for the response.

    Args:
        row: The folded row: one `(subject, object, class)` key with the
            summaries recomputed over the resources the scope kept.
        query: The parsed request, for the projection parameters.
        conn: An open connection, for the class vocabulary.
        index: The page's per-node lookup, keyed by entity id.

    Returns:
        The row as JSON-ready values, with the class slug and label added, both
        endpoints projected into the standard per-node columns, and the
        requested long-tail keys gathered under `attributes`.
    """

    out: dict[str, Any] = {}

    for name, value in row.items():

        if name.startswith(_projection.ALIAS):

            continue

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

    blocks = _nodes.blocks(row, index or {}, query.view, class_slug)

    for side, block in blocks.items():

        block.update(
            _annotate.columns(
                row.get(_NODE_ENTITY[side]),
                side,
                query.annotation_layers,
                annotations or {},
            ),
        )
        out.update(block)

    # The binary pair, seen whole. A reaction has no first and second endpoint
    # to flatten into, so the array is the shape that generalises; here it is
    # the same values the flat columns carry, arranged the way they will be.
    out['participants'] = _nodes.participants(blocks)
    out.update(_standard_columns(row, class_slug, registry or [], resolved))

    if query.attributes:

        # A name that is neither a hot column nor a present key comes back null
        # rather than as a 4xx, and never drops the interaction.
        out['attributes'] = _projection.render(row, out, query.attributes)

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


def _standard_columns(
        row: dict[str, Any],
        class_slug: str | None,
        registry: list[dict[str, Any]],
        resolved: _scope.ResolvedScope | None,
) -> dict[str, Any]:
    """
    The legacy per-interaction columns, projected from what the fold produced.

    Three of them are joined strings because the legacy contract's consumers
    read them that way, and each keeps its structured form beside it rather
    than instead of it: `sources` is the array behind `resources`,
    `interaction_datasets` the array behind `interaction_dataset`. Nothing here
    recomputes a summary — the sign flags and both assertion counts are the
    fold's own, over the scope the query stated.

    Args:
        row: The folded row.
        class_slug: The row's class, which decides which presets can claim it.
        registry: The preset registry, for the dataset tags.
        resolved: The resolved scope, which knows whether one preset was asked
            for.

    Returns:
        The joined provenance, the dataset scalar and the array behind it.
    """

    sources = sorted(row.get('sources') or ())
    tags = _scope.dataset_tags(sources, class_slug, registry)
    presets = list(resolved.preset_names) if resolved else []

    # The legacy scalar was scalar because legacy queries were always
    # single-dataset. Asking for one preset therefore means "the dataset you
    # asked for"; asking for none means every tag the row carries, joined, so
    # the column stays a string and loses nothing.
    scalar = presets[0] if len(presets) == 1 else (DELIMITER.join(tags) or None)

    return {
        'resources': DELIMITER.join(sources),
        'references': DELIMITER.join(sorted(row.get('reference_pairs') or ())),
        'interaction_dataset': scalar,
        'interaction_datasets': tags,
    }
