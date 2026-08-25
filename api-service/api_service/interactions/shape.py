"""
The Shape group: how much of the record a row speaks for.

`collapse` — how far the record folds — is a flag on the fold's own builder,
because it changes the group key. The other two parameters of the group do not
change the key, and so they live here, as one extra indexed read over the keys
of a page that has already been chosen and bounded.

**Integrated is the default.** A row summarises every resource the queried
scope kept: that is what `sources`, `source_count` and the two assertion counts
are, and they are recomputed for that scope rather than read from a wider fold.

**`by_resource` adds detail rather than removing resources.** Asked for, each row
gains a block per contributing resource carrying that resource's own sign,
direction, measurements and references, and naming a resource restricts the
blocks to it. The integrated summaries beside them do not move. A projection
choice that quietly narrowed the scope would report a resource subset's numbers
under a query that asked for more, which is precisely the defect the scope rule
exists to prevent.

**`include_outofscope_signdir` widens the flags and nothing else, and that is
the load-bearing sentence of this module.** A caller scoped to one resource may
still want to know that another resource calls the interaction inhibitory. So
the three flags are recomputed over every resource, in scope or not — and every
count keeps describing the queried scope. An interaction whose sign only an
excluded resource asserts therefore comes back with the flag set and
`sign_source_count` still zero. Letting the count follow the flag would put the
excluded resource back into the numbers, which is the same wrong answer the
scope rule forbids, reintroduced by the escape hatch meant to sit beside it.

A widened flag beside a zero count is confusing unless the row says why, so it
does: `outofscope_signdir` names the flags that came from outside and the
resources they came from, and those resources are deliberately **not** added to
`sources`.
"""

from __future__ import annotations

import logging
from typing import Any, Sequence

from ..graph import SEARCH_SCHEMA
from .params import InteractionQuery
from .project import ALIAS, aggregate_sql, long_tail, render
from .scope import ResolvedScope
from .select import GROUP_KEYS, REFERENCE_LATERAL, record_filter, record_source

_log = logging.getLogger(__name__)

# The flags the escape hatch may widen. The counts are not here, and the
# omission is the rule rather than an oversight.
SIGN_FLAGS: tuple[str, ...] = ('is_directed', 'is_stimulation', 'is_inhibition')

# What one resource, on its own, says about one interaction.
_PER_RESOURCE = """bool_or(r.is_directed) AS is_directed,
      bool_or(r.is_stimulation) AS is_stimulation,
      bool_or(r.is_inhibition) AS is_inhibition,
      min(r.affinity) AS affinity,
      max(r.pchembl) AS pchembl,
      max(r.score) AS score,
      array_agg(DISTINCT c.value) FILTER (WHERE c.kind = 'pubmed')
        AS reference_pubmed_ids,
      array_agg(DISTINCT c.value) FILTER (WHERE c.kind = 'doi')
        AS reference_dois,
      array_agg(DISTINCT c.value) FILTER (WHERE c.kind = 'curation')
        AS curation_flags,
      (count(DISTINCT c.value) FILTER (WHERE c.kind IN ('pubmed', 'doi')))::int
        AS reference_count"""


def key_of(row: dict[str, Any]) -> tuple[str, str, int]:
    """
    The collapse key of one row, in the form both sides of a merge can compare.

    Args:
        row: A folded or projected row.

    Returns:
        `(subject, object, class)`, with the entity ids as text.
    """

    return (
        str(row['subject_entity_id']),
        str(row['object_entity_id']),
        int(row['interaction_class_id']),
    )


def _key_arrays(rows: Sequence[dict[str, Any]]) -> list[list[Any]]:
    """
    One page's keys, as the three arrays a single indexed read takes.

    Args:
        rows: The folded rows of one page.

    Returns:
        `[subjects, objects, classes]`, deduplicated and aligned.
    """

    keys = list(dict.fromkeys(key_of(row) for row in rows))

    return [
        [key[0] for key in keys],
        [key[1] for key in keys],
        [key[2] for key in keys],
    ]


def _page_keys_sql() -> str:
    """
    The predicate that restricts a read to the keys of one page.

    Returns:
        A `WHERE` fragment taking three array parameters. It is written as a
        join against the page's own keys so the read is a hundred index
        descents rather than a scan: everything here runs **after** the page
        has been chosen, and must cost what a page costs.
    """

    keys = ', '.join(f'r.{name}' for name in GROUP_KEYS)

    return (
        f'({keys}) IN (SELECT * FROM unnest('
        '%s::uuid[], %s::uuid[], %s::smallint[]))'
    )


def _outside_sql(resolved: ResolvedScope) -> tuple[str, list[Any]]:
    """
    The predicate matching the resources the queried scope left out.

    Only the resource terms of the scope are complemented. A range or curation
    filter narrows which record rows the fold summarised. It does not make a
    resource out of scope, and complementing it would report a resource as
    "outside" for a reason that has nothing to do with the resource.

    Args:
        resolved: The resolved scope.

    Returns:
        The predicate and its arguments, or `('', [])` when the scope admits
        every resource — an unscoped query has no outside to read from.
    """

    clauses: list[str] = []
    args: list[Any] = []

    if resolved.source_ids is not None:

        clauses.append('r.source_id <> ALL(%s::bigint[])')
        args.append(list(resolved.source_ids))

    if resolved.excluded_source_ids:

        clauses.append('r.source_id = ANY(%s::bigint[])')
        args.append(list(resolved.excluded_source_ids))

    if not clauses:

        return '', []

    return '(' + ' OR '.join(clauses) + ')', args


def by_resource_detail(
        rows: Sequence[dict[str, Any]],
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        conn,
) -> dict[tuple[str, str, int], dict[str, dict[str, Any]]]:
    """
    Each in-scope resource's own attributes, for the keys of one page.

    One statement for the page, not one per row: the same shape `nodes` uses,
    for the same reason — a per-row query would make the projection cost track
    the page size in round trips rather than in rows.

    Args:
        rows: The folded rows of one page.
        query: The parsed request, for the requested attributes.
        resolved: The resolved scope.
        conn: An open connection.

    Returns:
        `{key: {resource: detail}}`.
    """

    if not rows:

        return {}

    predicate = record_filter(query, resolved)
    attributes, extraction, attribute_args = aggregate_sql(
        long_tail(query.attributes),
    )
    named, name_args = '', []

    if query.by_resource_names:

        named = ' AND contributor.name = ANY(%s::text[])'
        name_args = [list(query.by_resource_names)]

    keys = ', '.join(f'r.{name}' for name in GROUP_KEYS)
    sql = f"""SELECT {keys}, contributor.name AS resource,
      {_PER_RESOURCE}{attributes}
    FROM {record_source()} r
    JOIN {SEARCH_SCHEMA}.data_source contributor
      ON contributor.source_id = r.source_id
    {REFERENCE_LATERAL}
    {extraction}
    WHERE {_page_keys_sql()} AND ({predicate.sql}){named}
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4"""

    args = [*attribute_args, *_key_arrays(rows), *predicate.args, *name_args]
    out: dict[tuple[str, str, int], dict[str, dict[str, Any]]] = {}

    for row in conn.execute(sql, args).fetchall():

        detail = {
            name: value for name, value in row.items()
            if name not in GROUP_KEYS and name != 'resource'
            and not name.startswith(ALIAS)
        }
        # Within one resource's block the contributor set is that resource, so
        # a hot column naming the provenance answers about it rather than about
        # the integrated row it sits on.
        detail['sources'] = [row['resource']]
        detail['source_count'] = 1

        if query.attributes:

            detail['attributes'] = render(dict(row), detail, query.attributes)

        out.setdefault(key_of(row), {})[row['resource']] = detail

    return out


def outofscope_signdir(
        rows: Sequence[dict[str, Any]],
        resolved: ResolvedScope,
        *,
        conn,
) -> dict[tuple[str, str, int], dict[str, Any]]:
    """
    What resources outside the queried scope assert about sign and direction.

    Args:
        rows: The folded rows of one page.
        resolved: The resolved scope.
        conn: An open connection.

    Returns:
        `{key: {flag: value, …, 'resources': [names]}}`, holding only the keys
        some out-of-scope resource says something about. Empty for an unscoped
        query, which has no outside.
    """

    outside, outside_args = _outside_sql(resolved)

    if not rows or not outside:

        return {}

    keys = ', '.join(f'r.{name}' for name in GROUP_KEYS)
    flags = ',\n      '.join(
        f'bool_or(r.{flag}) AS {flag}' for flag in SIGN_FLAGS
    )
    asserted = ' OR '.join(f'r.{flag} IS NOT NULL' for flag in SIGN_FLAGS)

    sql = f"""SELECT {keys},
      {flags},
      array_agg(DISTINCT contributor.name) AS resources
    FROM {record_source()} r
    JOIN {SEARCH_SCHEMA}.data_source contributor
      ON contributor.source_id = r.source_id
    WHERE {_page_keys_sql()} AND {outside} AND ({asserted})
    GROUP BY 1, 2, 3"""

    args = [*_key_arrays(rows), *outside_args]

    return {
        key_of(row): {
            **{flag: row[flag] for flag in SIGN_FLAGS},
            'resources': list(row['resources']),
        }
        for row in conn.execute(sql, args).fetchall()
    }


def _widen(in_scope: bool | None, outside: bool | None) -> bool | None:
    """
    Summarise one flag across the scope and one assertion from outside it.

    The same three-valued rule the fold uses: an absent assertion is ignored,
    never read as `false`, so silence on both sides stays silence.

    Args:
        in_scope: What the queried scope asserts.
        outside: What a resource outside it asserts.

    Returns:
        The widened flag.
    """

    stated = [value for value in (in_scope, outside) if value is not None]

    return any(stated) if stated else None


def apply(
        projected: list[dict[str, Any]],
        rows: Sequence[dict[str, Any]],
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        conn,
) -> list[dict[str, Any]]:
    """
    Attach the Shape group's answers to one rendered page.

    Args:
        projected: The rendered rows, in the order of `rows`.
        rows: The folded rows they came from.
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection.

    Returns:
        The rendered rows, with the per-resource blocks and the widened flags
        attached where they were asked for. Every count is left exactly as the
        fold computed it for the queried scope.
    """

    detail = (
        by_resource_detail(rows, query, resolved, conn = conn)
        if query.by_resource else {}
    )
    widened = (
        outofscope_signdir(rows, resolved, conn = conn)
        if query.include_outofscope_signdir else {}
    )

    if query.include_outofscope_signdir and not widened:

        _log.info(
            'no resource outside the queried scope asserts sign or direction '
            'for the keys of this page',
        )

    for row in projected:

        key = key_of(row)

        if query.by_resource:

            # Restricted to the resources this row itself speaks for. Under the
            # default collapse that is every in-scope contributor and the
            # restriction does nothing. Under `collapse=none` the row is
            # one resource's record, and handing it its neighbours' assertions
            # would contradict the grain the caller asked for.
            own = set(row.get('sources') or ())
            row['by_resource'] = {
                name: block for name, block in detail.get(key, {}).items()
                if name in own
            }

        if (outside := widened.get(key)) is None:

            continue

        marker: dict[str, Any] = {}

        for flag in SIGN_FLAGS:

            merged = _widen(row.get(flag), outside[flag])

            if merged != row.get(flag):

                row[flag] = merged
                marker[flag] = merged

        if marker:

            # Named, because a flag standing beside a count of zero is only
            # honest if the row says where it came from. These resources are
            # deliberately absent from `sources`: they contributed an
            # assertion to the answer, not a row to the scope.
            row['outofscope_signdir'] = {**marker, 'resources': outside['resources']}

    return projected
