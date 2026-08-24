"""
The per-entity annotation layers — what a response says *about* each node.

An interaction says that two molecules meet. Which of them is the ligand, which
sits in the membrane, which is secreted into the space between them — that is
not a property of the interaction at all. It is a property of the entity, it is
the same property in every interaction that entity takes part in, and storing
it per interaction would multiply one fact by the degree of the node. So it is
stored once per entity, and this module projects it.

**Three layers, not a wide boolean matrix.** A fixed matrix of category columns
grows every time the annotation vocabulary does, and every consumer's frame
changes with it. Instead:

* the default is a compact array of the categories a node carries, so a frame
  stays as narrow as the interaction itself;
* `intercell.full` adds a by-resource object per node — `{category:
  [resources]}` — which is the only form that preserves *who said so*;
* `intercell:is_ligand,is_receptor` adds flat booleans for exactly the
  categories named, because that is what a dataframe tool wants and there is no
  reason to materialise the other twenty.

Registering a further category reaches all three and moves no default column.
That is what makes the annotation source replaceable underneath: the interim
population and the full rebuild write the same shape, and a consumer cannot
tell which one answered.

**The index is read whole, once per process, and that is a measurement rather
than a preference.** The annotations live across two partitioned tables — forty
five partitions each — so reading them for the two hundred entities of one page
costs **807 ms** with the planner walking every partition, which is most of the
budget for the whole request. Reading *all* of them costs **1.17 s** for the
73,785 entity-category-resource rows, or **1.9 s** including the 33,091-entity
index built from them, once. Every page after that pays nothing: a
hundred-row ligand-receptor page costs 60.5 ms bare and 60.0 ms with the
by-resource object attached. The grain is per entity and changes only when the
build does, which is the same reason the class vocabulary and the native taxon
set are cached here.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

from ..graph import SEARCH_SCHEMA

_log = logging.getLogger(__name__)

# The annotation terms that carry a node's role or location, and the category
# each becomes. The build states these as value-less flags on an entity, one
# row per contributing resource, which is exactly the grain the three layers
# need. Adding an entry here adds a category to every layer and changes no
# default column — that is the extensibility the contract asks for, and a test
# asserts it by adding one.
CATEGORIES: dict[str, str] = {
    'Ligand:OM:7777': 'ligand',
    'Receptor:OM:7778': 'receptor',
    'Secreted:OM:7781': 'secreted',
    'Membrane:OM:7779': 'plasma_membrane',
    'Transmembrane Region:OM:0609': 'transmembrane',
}

# The name a request writes to reach these layers, and the two ways of asking
# for more than the default.
LAYER = 'intercell'

# The suffixes the three layers take on a side. The first is the default and is
# always present. The second and third appear only when a request names them.
SUMMARY_SUFFIX = 'intercell_class'
OBJECT_SUFFIX = 'intercell'
BOOLEAN_PREFIX = 'is_'

# Spellings of "give me the by-resource object". `intercell` on its own is the
# same request written short.
FULL_NAMES: frozenset[str] = frozenset({
    LAYER,
    f'{LAYER}.full',
    f'{LAYER}.by_resource',
})

# `{schema: {entity_id: {category: (resources, …)}}}`, built once per process.
_INDEX: dict[str, dict[str, dict[str, tuple[str, ...]]]] = {}


@dataclass
class Layers:
    """Which annotation layers one request asked for, beyond the default."""

    # The by-resource object per node.
    full: bool = False
    # The categories to render as flat booleans, in the caller's order.
    booleans: list[str] = field(default_factory = list)

    @property
    def asked(self) -> bool:
        """Whether anything beyond the default summary was requested."""

        return self.full or bool(self.booleans)


def categories() -> list[str]:
    """
    Every category the vocabulary currently registers.

    Returns:
        The category slugs, sorted, without duplicates.
    """

    return sorted(set(CATEGORIES.values()))


def forget() -> None:
    """
    Drop the cached index so the next read rebuilds it.

    The vocabulary is a module constant a deployment may extend, and the index
    is derived from it. Extending one without dropping the other would leave a
    category registered and invisible, which is the confusing half of a
    half-applied change.

    Returns:
        None.
    """

    _INDEX.clear()


def read(names: Sequence[str]) -> tuple[Layers, list[str]]:
    """
    Split an attribute list into annotation requests and everything else.

    Args:
        names: The `attributes=` names as the caller wrote them.

    Returns:
        The layers asked for, and the names this module does not claim — which
        go on to the long-tail projection unchanged. A name claimed here must
        not reach that projection: it names no key of the record's attribute
        document, so it would come back null and read as a build that carries
        no annotation at all.
    """

    layers = Layers()
    rest: list[str] = []
    known = set(categories())

    for name in names:

        text = str(name).strip()
        lowered = text.lower()

        if lowered in FULL_NAMES:

            layers.full = True

        elif lowered.startswith(f'{LAYER}:'):

            for token in text.partition(':')[2].split(','):

                category = _category(token)

                if category and category not in layers.booleans:

                    layers.booleans.append(category)

                elif not category:

                    _log.info(
                        'no annotation category is registered under %r; the '
                        'boolean is rendered false rather than refused', token,
                    )

        else:

            rest.append(name)

    unknown = [name for name in layers.booleans if name not in known]

    if unknown:

        _log.info('annotation categories %s are registered but unpopulated', unknown)

    return layers, rest


def _category(token: str) -> str | None:
    """
    The category one requested boolean names.

    Args:
        token: A name from an `intercell:` list, with or without the `is_`
            prefix a caller reads off the output column.

    Returns:
        The category slug, or None for an empty token.
    """

    text = str(token).strip().lower()

    if text.startswith(BOOLEAN_PREFIX):

        text = text[len(BOOLEAN_PREFIX):]

    return text or None


def index(conn) -> dict[str, dict[str, tuple[str, ...]]]:
    """
    Every annotated entity, its categories, and the resources behind them.

    Args:
        conn: An open connection.

    Returns:
        `{entity_id: {category: (resource, …)}}` for every entity the
        registered vocabulary reaches.
    """

    if SEARCH_SCHEMA in _INDEX:

        return _INDEX[SEARCH_SCHEMA]

    built: dict[str, dict[str, list[str]]] = {}

    if CATEGORIES:

        rows = conn.execute(
            f"""
            SELECT DISTINCT resolution.entity_id,
                            term.term,
                            contributor.name AS resource
            FROM {SEARCH_SCHEMA}.annotation term
            JOIN {SEARCH_SCHEMA}.entity_evidence_annotation link
              ON link.annotation_key = term.annotation_key
            JOIN {SEARCH_SCHEMA}.entity_evidence_resolution resolution
              ON resolution.entity_evidence_id = link.entity_evidence_id
             AND resolution.source_id = link.source_id
            JOIN {SEARCH_SCHEMA}.data_source contributor
              ON contributor.source_id = link.source_id
            WHERE term.term = ANY(%s::text[])
              AND resolution.entity_id IS NOT NULL
            """,
            (list(CATEGORIES),),
        ).fetchall()

        for row in rows:

            category = CATEGORIES.get(row['term'])

            if not category:

                continue

            entry = built.setdefault(str(row['entity_id']), {})
            entry.setdefault(category, []).append(row['resource'])

    _INDEX[SEARCH_SCHEMA] = {
        entity: {
            category: tuple(sorted(set(resources)))
            for category, resources in sorted(entry.items())
        }
        for entity, entry in built.items()
    }

    _log.info(
        'the per-entity annotation index covers %d entities across %d '
        'categories', len(_INDEX[SEARCH_SCHEMA]), len(categories()),
    )

    return _INDEX[SEARCH_SCHEMA]


def entities_with(values: Iterable[str], *, conn) -> list[str]:
    """
    The entities carrying any of the named categories.

    This is the selection side of the same index: an `entity_annotations`
    filter asks for the interactions whose endpoints are annotated, and the
    entity set is what a record predicate can be written against. Resolving it
    once, before anything touches the interaction tables, is the same shape
    every other scope term takes.

    Args:
        values: The requested category names, with or without the `is_` prefix.
        conn: An open connection.

    Returns:
        The entity ids, sorted. An empty list means the categories name no
        entity, which is an empty answer rather than an unrestricted one.
    """

    wanted = {name for name in (_category(value) for value in values) if name}

    if not wanted:

        return []

    return sorted(
        entity for entity, entry in index(conn).items()
        if wanted & set(entry)
    )


def unknown_categories(values: Iterable[str]) -> list[str]:
    """
    The requested category names the vocabulary does not register.

    Args:
        values: The requested names.

    Returns:
        The ones nothing is registered under, as the caller wrote them.
    """

    known = set(categories())

    return [
        str(value) for value in values
        if (_category(value) or '') not in known
    ]


def columns(
        entity: Any,
        side: str,
        layers: Layers,
        annotations: dict[str, dict[str, tuple[str, ...]]],
) -> dict[str, Any]:
    """
    One node's annotation columns, named for the side it is on.

    Args:
        entity: The entity id the node stands for, or None.
        side: `source` or `target`.
        layers: The layers this request asked for.
        annotations: The index.

    Returns:
        The default summary array, plus the by-resource object and the named
        booleans where they were asked for. Every key is present on every row,
        because a key that appears only sometimes is a column a frame consumer
        cannot read.
    """

    entry = annotations.get(str(entity)) if entity is not None else None
    entry = entry or {}
    out: dict[str, Any] = {f'{side}_{SUMMARY_SUFFIX}': sorted(entry)}

    if layers.full:

        out[f'{side}_{OBJECT_SUFFIX}'] = {
            category: list(resources) for category, resources in entry.items()
        }

    for category in layers.booleans:

        out[f'{side}_{BOOLEAN_PREFIX}{category}'] = category in entry

    return out
