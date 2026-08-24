"""
Scope resolution — one `source_id` set, resolved once (T020h, R20, FR-048).

`resources`, `exclude_resources`, `datasets` and `license` are four spellings
of one question: which resources may contribute a row. They are collapsed here,
**before anything touches the interaction tables**, so the FR-048 recomputation
rule has exactly one place to hold: everything downstream sees the resolved
scope and nothing downstream sees the names it came from.

A license filter *is* a resource filter (R20). The ordinal levels of
`data_source_license` make "usable commercially" a `purpose_level >= 15`
comparison over a 44-row table, and a resource whose license is unknown is
excluded rather than admitted by a permissive default (FR-049).

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
from ..resource_catalog import resolve_resource_filters
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


@dataclass
class ResolvedScope:
    """The resource set a query may read, plus the ids `select` needs."""

    # None means "every resource" — the widest scope, and not an exception to
    # the fold rule: it is the scope containing all of them (R24).
    source_ids: list[int] | None = None
    excluded_source_ids: list[int] = field(default_factory = list)
    resources: list[str] = field(default_factory = list)
    excluded_resources: list[str] = field(default_factory = list)
    interaction_class_ids: list[int] = field(default_factory = list)
    entity_type_ids: list[int] = field(default_factory = list)
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
    Collapse every scope parameter into one `source_id` set (contracts §1a).

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
        sets: list[set[str]] = []

        if filters.resources:

            sets.append(set(resolve_resource_filters(filters.resources)))

        if filters.datasets:

            sets.append(_dataset_resources(live, filters.datasets))

        if filters.license:

            sets.append(_license_resources(live, filters.license, by_name))

        # Several scope terms intersect: each is a restriction, so a resource
        # has to survive all of them. Naming none of them leaves the scope open.
        admitted: set[str] | None = None

        for one in sets:

            admitted = one if admitted is None else admitted & one

        excluded = set(resolve_resource_filters(filters.exclude_resources))

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
            interaction_class_ids = _class_ids(live, filters.interaction_classes),
            entity_type_ids = _entity_type_ids(live, filters.entity_types),
        )
        scope.empty = (
            (scope.source_ids is not None and not scope.source_ids)
            or (bool(filters.interaction_classes) and not scope.interaction_class_ids)
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


def _dataset_resources(conn, names: list[str]) -> set[str]:
    """
    The resources a set of presets admits, from `network_registry`.

    Args:
        conn: An open connection.
        names: The preset names.

    Returns:
        The union of the presets' included sources. An unknown preset
        contributes nothing, which leaves the scope empty rather than open.
    """

    rows = conn.execute(
        f"""
        SELECT included_sources
        FROM {SEARCH_SCHEMA}.network_registry
        WHERE name = ANY(%s::text[])
        """,
        ([name.lower() for name in names],),
    ).fetchall()

    return {source for row in rows for source in (row['included_sources'] or [])}


def _license_resources(conn, terms: list[str], by_name: dict[str, int]) -> set[str]:
    """
    The resources whose license meets every requested minimum level (R20).

    Args:
        conn: An open connection.
        terms: Terms of the form `purpose:commercial`, or a bare level name
            read against `purpose`.
        by_name: The `data_source` name-to-id map.

    Returns:
        The admitted resource slugs. `is_known = false` is excluded, and it is
        the exclusion — never a NULL level, which a comparison would let
        through (FR-049).
    """

    floors: dict[str, int] = {}

    for term in terms:

        dimension, _, level = term.partition(':')

        if not level:

            dimension, level = 'purpose', dimension

        dimension = dimension.strip().lower()
        level = level.strip().lower()

        if dimension not in LICENSE_LEVELS:

            _log.warning('unknown license dimension %r; scope left empty', dimension)

            return set()

        ordinal = LICENSE_LEVELS[dimension].get(level)

        if ordinal is None:

            try:

                ordinal = int(level)

            except ValueError:

                _log.warning('unknown license level %r; scope left empty', term)

                return set()

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
    Resolve interaction-class slugs to ids (contracts §1, `vocab_interaction_class`).

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


def _record_share(conn, scope: ResolvedScope, by_name: dict[str, int]) -> float:
    """
    The fraction of the record the scope can reach, from the source facet.

    Args:
        conn: An open connection.
        scope: The scope resolved so far.
        by_name: The `data_source` name-to-id map.

    Returns:
        A number in (0, 1]. This is the cardinality estimate contracts §4 asks
        the cost governor to take from `facet_relation_bitmap` rather than from
        a count over the record.
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
