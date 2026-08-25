"""
Scope resolution — one `source_id` set, resolved once.

`resources`, `exclude_resources`, `datasets` and `license` are four spellings
of one question: which resources may contribute a row. They are collapsed here,
**before anything touches the interaction tables**, so one rule holds in one
place: the fold counts only the resources the caller kept. Everything
downstream sees the resolved scope, and nothing downstream sees the names it
came from.

A license filter *is* a resource filter. The ordinal levels of
`data_source_license` make "usable commercially" a `purpose_level >= 15`
comparison over a 44-row table, and a resource whose license is unknown is
excluded rather than admitted by a permissive default.

The class slugs, entity types and organisms are resolved here too, for a
duller reason: `select` builds SQL without a connection, so every name-to-id
lookup has to have happened by the time it runs.
"""

from __future__ import annotations

import contextlib
import functools
import logging
from dataclasses import dataclass, field
from typing import Any, Iterator

from ..graph import SEARCH_SCHEMA, _connect
from ..resource_catalog import resolve_resource_filter, resolve_resource_filters
from . import annotate
from .organism import OrganismScope
from .organism import resolve as resolve_organisms
from .params import InteractionQuery

_log = logging.getLogger(__name__)

# data-model §8a. The ordinal levels `pypath/internals/license.py` models, so a
# license question is a range predicate rather than a name match.
LICENSE_LEVELS: dict[str, dict[str, int]] = {
    'purpose': {
        'ignore': 0, 'academic': 5, 'nonprofit': 10,
        'commercial': 15, 'free': 20, 'composite': 25,
    },
    'sharing': {
        'ignore': 0, 'noshare': 5, 'noderiv': 10,
        'alike': 15, 'share': 20, 'free': 25,
    },
    'attrib': {'ignore': 0, 'attrib': 5, 'free': 10},
}

# The facet that carries per-resource record cardinality (35 values,
# 14,686,403 relation-source pairs). The guardrail prices a scope from it
# rather than counting rows.
_SOURCE_FACET = 'source'

# The preset registry, cached per schema: it changes only when the build does.
_REGISTRY_CACHE: dict[str, list[dict[str, Any]]] = {}


@dataclass
class ResolvedScope:
    """The resource set a query may read, plus the ids `select` needs."""

    # None means "every resource" — the widest scope, and not an exception to
    # the fold rule: it is the scope containing all of them.
    source_ids: list[int] | None = None
    excluded_source_ids: list[int] = field(default_factory = list)
    resources: list[str] = field(default_factory = list)
    excluded_resources: list[str] = field(default_factory = list)
    # The registered presets the request named, in the order it named them.
    # One of them makes the query preset-scoped, which is what lets the legacy
    # `interaction_dataset` scalar mean "the dataset you asked for".
    preset_names: list[str] = field(default_factory = list)
    # The entities an `entity_annotations` filter admits, or None for no such
    # filter. Resolved here with the rest of the scope, so the record predicate
    # is written against ids rather than against a join into the annotation
    # tables for every candidate row.
    annotated_entity_ids: list[str] | None = None
    interaction_class_ids: list[int] = field(default_factory = list)
    entity_type_ids: list[int] = field(default_factory = list)
    # The organism request, resolved to taxa the record can actually match.
    organism: OrganismScope = field(default_factory = OrganismScope)
    # What the named presets declare beyond their resource list: how far to
    # collapse by default, and which attributes their rows are expected to
    # carry. The engine reads these; nothing in the fold depends on them.
    collapse_mode: str | None = None
    default_attributes: list[str] = field(default_factory = list)
    mandatory_attributes: list[str] = field(default_factory = list)
    # Fraction of the record the scope can reach, from the source facet. The
    # guardrail scales its estimates by it; nothing in the fold depends on it.
    record_share: float = 1.0
    # True when the named resources resolve to nothing at all. That is a real
    # answer — an empty scope — and not the same as no restriction.
    empty: bool = False

    @property
    def unscoped(self) -> bool:
        """Whether the scope admits every resource and excludes none."""

        return self.source_ids is None and not self.excluded_source_ids


@contextlib.contextmanager
def connection(conn = None) -> Iterator[Any]:
    """
    Yield a connection, opening one only when the caller supplied none.

    Args:
        conn: An open psycopg3 connection, or None.

    Yields:
        A connection usable for the duration of the block.
    """

    if conn is not None:

        yield conn

        return

    with _connect() as opened:

        yield opened


def resolve(query: InteractionQuery, *, conn = None) -> ResolvedScope:
    """
    Collapse every scope parameter into one `source_id` set.

    Args:
        query: The parsed request.
        conn: An open connection, or None to open one.

    Returns:
        The resolved scope, ready for `select` to build SQL from without any
        further database access.
    """

    filters = query.filters

    with connection(conn) as live:

        by_name = _source_ids_by_name(live)
        # Every name the caller wrote is checked before any of them is used, so
        # a typo is a refusal rather than an empty page.
        _refuse_unknown(
            'resources',
            [
                value for value in filters.resources
                if resolve_resource_filter(value) not in by_name
            ],
            list(by_name),
        )
        _refuse_unknown(
            'exclude_resources',
            [
                value for value in filters.exclude_resources
                if resolve_resource_filter(value) not in by_name
            ],
            list(by_name),
        )
        _refuse_unknown(
            'by_resource',
            [
                value for value in query.by_resource_names
                if resolve_resource_filter(value) not in by_name
            ],
            list(by_name),
        )
        # Written as the caller wrote them, resolved to the names the record
        # carries, so a synonym or a capitalisation reaches the same block the
        # resource filter would have reached.
        query.by_resource_names = resolve_resource_filters(query.by_resource_names)
        vocabulary = _class_vocabulary(live)
        _refuse_unknown(
            'interaction_classes',
            [
                value for value in filters.interaction_classes
                if value.lower() not in vocabulary
            ],
            [name for key, name in vocabulary.items() if not key.isdigit()],
        )
        presets = _presets(live, filters.datasets)
        registered = {preset['name'] for preset in presets}
        _refuse_unknown(
            'datasets',
            [
                value for value in filters.datasets
                if value.lower() not in registered
            ],
            _preset_names(live),
        )
        sets: list[set[str]] = []

        if filters.resources:

            sets.append(set(resolve_resource_filters(filters.resources)))

        if filters.datasets:

            sets.append({
                source for preset in presets
                for source in (preset['included_sources'] or [])
            })

        if filters.license:

            sets.append(_license_resources(live, filters.license, by_name))

        # Several scope terms intersect: each is a restriction, so a resource
        # has to survive all of them. Naming none of them leaves the scope open.
        admitted: set[str] | None = None

        for one in sets:

            admitted = one if admitted is None else admitted & one

        excluded = set(resolve_resource_filters(filters.exclude_resources))
        classes = _class_scope(filters.interaction_classes, presets)

        scope = ResolvedScope(
            source_ids = (
                None if admitted is None
                else sorted(by_name[name] for name in admitted if name in by_name)
            ),
            excluded_source_ids = sorted(
                by_name[name] for name in excluded if name in by_name
            ),
            resources = sorted(admitted) if admitted is not None else [],
            excluded_resources = sorted(excluded),
            preset_names = [
                name for name in
                dict.fromkeys(value.lower() for value in filters.datasets)
                if name in registered
            ],
            annotated_entity_ids = _annotated_entities(
                filters.entity_annotations, live,
            ),
            interaction_class_ids = _class_ids(live, classes),
            entity_type_ids = _entity_type_ids(live, filters.entity_types),
            organism = resolve_organisms(filters.organisms, conn = live),
            collapse_mode = _preset_collapse(presets),
            default_attributes = _preset_attributes(presets, 'default_attributes'),
            mandatory_attributes = _preset_attributes(presets, 'mandatory_attributes'),
        )
        scope.empty = (
            (scope.source_ids is not None and not scope.source_ids)
            or (
                scope.annotated_entity_ids is not None
                and not scope.annotated_entity_ids
            )
            or (bool(classes) and not scope.interaction_class_ids)
            # A preset whose class scope and the caller's own do not overlap
            # asks for the interactions of no class at all, which is an empty
            # answer rather than an unrestricted one.
            or (
                bool(filters.interaction_classes or _preset_classes(presets))
                and not classes
            )
        )
        scope.record_share = _record_share(live, scope, by_name)

    return scope


def _source_ids_by_name(conn) -> dict[str, int]:
    """
    The `data_source` name-to-id map, read once per call.

    Args:
        conn: An open connection.

    Returns:
        Every resource slug mapped to its `source_id`.
    """

    rows = conn.execute(
        f'SELECT source_id, name FROM {SEARCH_SCHEMA}.data_source',
    ).fetchall()

    return {row['name']: int(row['source_id']) for row in rows}


def _presets(conn, names: list[str]) -> list[dict[str, Any]]:
    """
    The `network_registry` rows a request names, whole.

    A preset is more than a resource list: it also states which interaction
    classes it covers, how far its rows collapse, and which attributes they are
    expected to carry. Reading only the resource list is how a dataset ends up
    serving classes it does not contain, so everything the registry declares is
    read here and applied downstream.

    Args:
        conn: An open connection.
        names: The preset names.

    Returns:
        One row per preset that exists. An unknown preset contributes nothing,
        which leaves the scope empty rather than open.
    """

    if not names:

        return []

    rows = conn.execute(
        f"""
        SELECT name,
               included_sources,
               interaction_class_scope,
               collapse_mode,
               default_attributes,
               mandatory_attributes
        FROM {SEARCH_SCHEMA}.network_registry
        WHERE name = ANY(%s::text[])
        """,
        ([name.lower() for name in names],),
    ).fetchall()

    found = {row['name'] for row in rows}
    unknown = [name for name in names if name.lower() not in found]

    if unknown:

        _log.info('no preset is registered under %s; scope left empty', unknown)

    return [dict(row) for row in rows]


def _preset_classes(presets: list[dict[str, Any]]) -> set[str]:
    """
    The interaction classes the named presets cover, together.

    Args:
        presets: The registry rows.

    Returns:
        The union of the declared class scopes, lowercased. A preset that
        declares none covers every class, and so contributes nothing here.
    """

    return {
        str(slug).lower()
        for preset in presets
        for slug in (preset.get('interaction_class_scope') or [])
    }


def _class_scope(requested: list[str], presets: list[dict[str, Any]]) -> list[str]:
    """
    The interaction classes a request may see, from the caller and the presets.

    Both are restrictions, so a class has to survive both. A caller asking a
    preset for a class it does not carry gets nothing, which is the truthful
    answer — the preset does not hold those interactions.

    Args:
        requested: The class slugs the caller named.
        presets: The registry rows the request names.

    Returns:
        The class slugs to resolve, or an empty list when neither side
        restricts anything.
    """

    declared = _preset_classes(presets)
    asked = {slug.lower() for slug in requested}

    if not declared:

        return sorted(asked)

    if not asked:

        return sorted(declared)

    return sorted(asked & declared)


def _preset_collapse(presets: list[dict[str, Any]]) -> str | None:
    """
    The collapse mode the named presets agree on.

    Args:
        presets: The registry rows.

    Returns:
        The mode, or None when no preset was named or two of them disagree —
        in which case the request's own default stands rather than one preset's
        mode being applied to the other's rows.
    """

    modes = {preset['collapse_mode'] for preset in presets if preset['collapse_mode']}

    return modes.pop() if len(modes) == 1 else None


def _preset_attributes(presets: list[dict[str, Any]], column: str) -> list[str]:
    """
    The attribute names the named presets declare, in one list.

    Args:
        presets: The registry rows.
        column: `default_attributes` or `mandatory_attributes`.

    Returns:
        The declared names, without duplicates and in registry order.
    """

    out: list[str] = []

    for preset in presets:

        for name in preset.get(column) or []:

            if name not in out:

                out.append(name)

    return out


def _license_resources(conn, terms: list[str], by_name: dict[str, int]) -> set[str]:
    """
    The resources whose license meets every requested minimum level.

    Args:
        conn: An open connection.
        terms: Terms of the form `purpose:commercial`, or a bare level name
            read against `purpose`.
        by_name: The `data_source` name-to-id map.

    Returns:
        The admitted resource slugs. `is_known = false` is excluded, and it is
        the exclusion — never a NULL level, which a comparison would let
        through.
    """

    floors: dict[str, int] = {}

    for term in terms:

        dimension, _, level = term.partition(':')

        if not level:

            dimension, level = 'purpose', dimension

        dimension = dimension.strip().lower()
        level = level.strip().lower()

        if dimension not in LICENSE_LEVELS:

            _refuse_unknown('license', [term], sorted(LICENSE_LEVELS))

        ordinal = LICENSE_LEVELS[dimension].get(level)

        if ordinal is None:

            try:

                ordinal = int(level)

            except ValueError:

                _refuse_unknown(
                    'license',
                    [term],
                    sorted(LICENSE_LEVELS[dimension]),
                )

        floors[dimension] = max(floors.get(dimension, 0), ordinal)

    conditions = ' AND '.join(
        f'{dimension}_level >= {ordinal}' for dimension, ordinal in floors.items()
    ) or 'true'

    rows = conn.execute(
        f"""
        SELECT ds.name
        FROM {SEARCH_SCHEMA}.data_source_license lic
        JOIN {SEARCH_SCHEMA}.data_source ds ON ds.source_id = lic.source_id
        WHERE lic.is_known AND {conditions}
        """,
    ).fetchall()

    admitted = {row['name'] for row in rows}

    _log.info(
        'license scope %s admits %d of %d resources',
        terms, len(admitted), len(by_name),
    )

    return admitted


def _class_ids(conn, slugs: list[str]) -> list[int]:
    """
    Resolve interaction-class slugs to ids against `vocab_interaction_class`.

    Args:
        conn: An open connection.
        slugs: The snake_case class slugs, or ids as strings.

    Returns:
        The class ids, sorted. Filtering is by slug; the capitalised label is
        output-side and is never a query value.
    """

    if not slugs:

        return []

    rows = conn.execute(
        f"""
        SELECT interaction_class_id
        FROM {SEARCH_SCHEMA}.vocab_interaction_class
        WHERE lower(name) = ANY(%s::text[])
           OR interaction_class_id::text = ANY(%s::text[])
        """,
        ([slug.lower() for slug in slugs], list(slugs)),
    ).fetchall()

    return sorted(int(row['interaction_class_id']) for row in rows)


def _entity_type_ids(conn, names: list[str]) -> list[int]:
    """
    Resolve entity-type names to ids for the selection filter.

    Args:
        conn: An open connection.
        names: Entity-type names, matched case-insensitively on the prefix
            before the vocabulary suffix (`Protein:MI:0326` answers to
            `protein`).

    Returns:
        The entity-type ids, sorted.
    """

    if not names:

        return []

    rows = conn.execute(
        f"""
        SELECT entity_type_id
        FROM {SEARCH_SCHEMA}.vocab_entity_type
        WHERE lower(name) = ANY(%s::text[])
           OR lower(split_part(name, ':', 1)) = ANY(%s::text[])
        """,
        ([name.lower() for name in names], [name.lower() for name in names]),
    ).fetchall()

    return sorted(int(row['entity_type_id']) for row in rows)


def _refuse_unknown(parameter: str, unknown: list[str], carried: list[str]) -> None:
    """
    Refuse a filter value the build carries nothing under.

    The asymmetry with the projection is deliberate and is the whole rule. A
    projection name nobody stores is null, because a caller assembling one
    frame across resources that publish different columns is asking for the
    union of them. A **filter** name nobody stores cannot be answered the same
    way: an empty page says "no interaction matches this", when the truth is
    "nothing in this build is called that". One of those is a finding and the
    other is a typo, and a caller who cannot tell them apart will publish the
    first.

    Args:
        parameter: The parameter the caller wrote the value in.
        unknown: The values that match nothing.
        carried: What the build does carry, for the message.

    Returns:
        None, when every value is known.

    Raises:
        GuardrailRefusal: 400 naming the values and what is available.
    """

    if not unknown:

        return

    from .guard import GuardrailRefusal

    shown = sorted(carried)
    listed = ', '.join(shown[:12]) + (', …' if len(shown) > 12 else '')

    raise GuardrailRefusal(
        f'{parameter}={", ".join(unknown)} matches nothing in this build. An '
        f'empty page would read as "no interaction has this", which is a '
        f'different statement from "this build knows no such name". '
        f'Available: {listed}.',
        status_code = 400,
        parameter = parameter,
        unknown = unknown,
        available = shown,
    )


def _class_vocabulary(conn) -> dict[str, str]:
    """
    Every interaction-class slug, and every id, as strings.

    Args:
        conn: An open connection.

    Returns:
        A lookup of everything `interaction_classes` may be written as. The
        capitalised label is deliberately absent: it is output-side, and a
        caller who writes it is writing something that never selected rows.
    """

    rows = conn.execute(
        f"""
        SELECT interaction_class_id, name
        FROM {SEARCH_SCHEMA}.vocab_interaction_class
        """,
    ).fetchall()

    known = {row['name'].lower(): row['name'] for row in rows}
    known.update({str(row['interaction_class_id']): row['name'] for row in rows})

    return known


def _preset_names(conn) -> list[str]:
    """
    Every preset the registry carries, for a refusal message.

    Args:
        conn: An open connection.

    Returns:
        The registered dataset names.
    """

    rows = conn.execute(
        f'SELECT name FROM {SEARCH_SCHEMA}.network_registry',
    ).fetchall()

    return [row['name'] for row in rows]


def _record_share(conn, scope: ResolvedScope, by_name: dict[str, int]) -> float:
    """
    The fraction of the record the scope can reach, from the source facet.

    Args:
        conn: An open connection.
        scope: The scope resolved so far.
        by_name: The `data_source` name-to-id map.

    Returns:
        A number in (0, 1]. This is the cardinality estimate the cost
        governor takes from `facet_relation_bitmap` rather than from a count
        over the record.
    """

    if scope.unscoped:

        return 1.0

    rows = conn.execute(
        f"""
        SELECT facet_value, relation_count
        FROM {SEARCH_SCHEMA}.facet_relation_bitmap
        WHERE facet_name = %s
        """,
        (_SOURCE_FACET,),
    ).fetchall()

    counts = {row['facet_value']: int(row['relation_count']) for row in rows}
    whole = sum(counts.values())

    if not whole:

        return 1.0

    admitted = set(counts) if scope.source_ids is None else set(scope.resources)
    admitted -= set(scope.excluded_resources)
    share = sum(counts.get(name, 0) for name in admitted) / whole

    # A resource the facet does not know about still contributes rows, so a
    # zero share would price the request at nothing. Floor it at one row.
    return max(share, 1.0 / whole)


def _annotated_entities(values: list[str], conn) -> list[str] | None:
    """
    The entities an annotation filter admits, resolved before the query runs.

    Args:
        values: The requested category names.
        conn: An open connection.

    Returns:
        The entity ids, or None when no annotation filter was asked for.

    Raises:
        GuardrailRefusal: For a category nothing is registered under. An
            unknown *filter* target is refused rather than answered emptily —
            an empty page for a misspelt category says "nothing is annotated
            this way", which is a different and false statement.
    """

    if not values:

        return None

    from .guard import GuardrailRefusal

    if unknown := annotate.unknown_categories(values):

        raise GuardrailRefusal(
            f'no node annotation category is registered under {unknown}. '
            f'Known categories: {annotate.categories()}.',
            status_code = 400,
            parameter = 'entity_annotations',
            value = unknown,
            known = annotate.categories(),
        )

    entities = annotate.entities_with(values, conn = conn)

    _log.info(
        'the annotation filter %s admits %d entities', values, len(entities),
    )

    return entities


def dataset_registry(conn) -> list[dict[str, Any]]:
    """
    What every registered preset would claim, read once per process.

    A dataset tag is not stored on the record: it is the statement that a row
    falls inside a preset's scope, and the preset is where that scope is
    written down. Deriving the tag from the registry keeps one definition of
    what a dataset is — the same one the scope resolution filters by — instead
    of a column that can drift away from it.

    Args:
        conn: An open connection.

    Returns:
        One entry per preset: its name, the resources it admits and the classes
        it covers.
    """

    if SEARCH_SCHEMA not in _REGISTRY_CACHE:

        rows = conn.execute(
            f"""
            SELECT name, included_sources, interaction_class_scope
            FROM {SEARCH_SCHEMA}.network_registry
            """,
        ).fetchall()
        _REGISTRY_CACHE[SEARCH_SCHEMA] = [
            {
                'name': row['name'],
                'sources': frozenset(row['included_sources'] or ()),
                'classes': frozenset(
                    str(slug).lower()
                    for slug in (row['interaction_class_scope'] or ())
                ),
            }
            for row in rows
        ]

        _log.info(
            '%d presets are registered and can tag a row',
            len(_REGISTRY_CACHE[SEARCH_SCHEMA]),
        )

    return _REGISTRY_CACHE[SEARCH_SCHEMA]


def forget_registry() -> None:
    """
    Drop the cached registry so the next read sees a newly built one.

    Returns:
        None.
    """

    _REGISTRY_CACHE.clear()


def dataset_tags(
        sources: list[str] | None,
        class_slug: str | None,
        entries: list[dict[str, Any]],
) -> list[str]:
    """
    The presets one folded row falls inside.

    Args:
        sources: The resources the row's fold kept.
        class_slug: The row's interaction class.
        entries: `dataset_registry`'s answer.

    Returns:
        The preset names, sorted. A preset that declares no class scope covers
        every class, so only its resource list decides.
    """

    contributors = set(sources or ())

    return sorted(
        entry['name'] for entry in entries
        if contributors & entry['sources']
        and (not entry['classes'] or (class_slug or '') in entry['classes'])
    )
