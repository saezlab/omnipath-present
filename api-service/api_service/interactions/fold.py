"""
The fold — the collapse, computed at query time.

The build no longer precomputes the collapse, so the claim this module has to
make good is that folding the record for a scope reproduces the removed table
exactly. It does, because it is the same aggregation: the body below is
the build's `_COLLAPSE_SQL` reimplemented column by column beside its one
remaining caller, not an approximation of it. Nothing is imported from
`omnipath-build`; the service declares no dependency on it and must not gain
one (Principle I/II).

**Three-valued sign is load-bearing.** `bool_or` ignores NULLs and returns NULL
when every contributor is silent, so a scope in which no resource asserts a
sign yields NULL rather than a defaulted `false` (FR-044a). There is no
`coalesce` anywhere in this file, and that is the reason.

**A reference keeps the name of the resource that published it.** The joined
`references` column of the legacy contract is a list of `resource:reference_id`
pairs, so the pairing has to survive the aggregation rather than be
reconstructed after it: two resources citing the same paper are two entries,
and a caller narrowing to one of them must not inherit the other's citation.
The pair is therefore built inside the aggregate, from the contributor row the
reference came off.

**Every summary is recomputed over the rows the scope kept.** `sources`,
`source_count`, the three flags, both assertion counts, the reference unions
and `reference_count` are aggregates over the filtered record, so a narrowed
scope narrows the numbers by construction. Selecting a wider row and testing
`sources && ARRAY[…]` returns the right interactions carrying numbers that
describe resources the caller excluded. Right rows, wrong numbers — the defect
this module exists to prevent.
"""

from __future__ import annotations

from typing import Any, Sequence

from ..graph import SEARCH_SCHEMA
from .params import InteractionQuery
from .project import aggregate_sql, long_tail
from .scope import ResolvedScope, connection
from .select import (
    COLLAPSE_KEYS,
    GROUP_KEYS,
    REFERENCE_LATERAL,
    RecordFilter,
    decode_cursor,
    encode_cursor,
    key_count_sql,
    key_selection_sql,
    record_filter,
    record_source,
)

__all__ = [
    'fold_sql',
    'fold_rows',
    'count_groups',
    'decode_cursor',
    'encode_cursor',
]

# data-model §3b, in the order the collapsed row carries them. Each entry is an
# aggregate over the record rows the scope kept.
_PROJECTION = """array_agg(DISTINCT contributor.name) AS sources,
      count(DISTINCT r.source_id)::int AS source_count,
      bool_or(r.is_directed) AS is_directed,
      bool_or(r.is_stimulation) AS is_stimulation,
      bool_or(r.is_inhibition) AS is_inhibition,
      (count(DISTINCT r.source_id) FILTER (
         WHERE r.is_stimulation IS NOT NULL OR r.is_inhibition IS NOT NULL
       ))::int AS sign_source_count,
      (count(DISTINCT r.source_id) FILTER (
         WHERE r.is_directed IS NOT NULL
       ))::int AS direction_source_count,
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
        AS reference_count,
      array_agg(DISTINCT contributor.name || ':' || c.value)
        FILTER (WHERE c.kind IN ('pubmed', 'doi')) AS reference_pairs,
      min(r.interaction_id::text)::uuid AS interaction_id"""


def fold_sql(
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        record: RecordFilter | None = None,
) -> tuple[str, Sequence[Any]]:
    """
    The page statement, unexecuted, so a caller can plan it before running it.

    The page-first fold is the two halves of the `FROM`: the subquery selects
    the page's keys in key order with the bound applied, and the join folds
    **only those keys**. At mean `source_count` 1.027 and maximum 9 a
    hundred-key page reads about a hundred and three record rows, so the cost
    tracks the page and not the scope.

    The trailing `ORDER BY` is not decoration. It is what keeps the aggregation
    a streaming `GroupAggregate` over sorted input. A `HashAggregate` here
    blocks: it folds every group before the first row comes back, so the cost
    tracks the scope instead of the page. That is the failure this shape
    avoids.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        record: A pre-built record filter, for a composition whose scope is a
            union of components rather than one query's own.

    Returns:
        The statement and its positional arguments.
    """

    predicate = record if record is not None else record_filter(query, resolved)
    keys_sql, keys_args = key_selection_sql(query, resolved, record = predicate)
    group = COLLAPSE_KEYS.get(query.collapse, GROUP_KEYS)
    join = ' AND '.join(f'r.{name} = k.{name}' for name in GROUP_KEYS)
    # The extra columns of `assertion` and `none` are aliased, so a grouped
    # flag and the `bool_or` of the same flag do not collide in the row.
    selected = ', '.join(
        f'k.{name}' if name in GROUP_KEYS else f'r.{name} AS {name}_group'
        for name in group
    )
    grouped = ', '.join(str(index + 1) for index in range(len(group)))

    # Only the long tail reaches the document: a hot column is already on the
    # row the fold produces, and opening the document to fetch it again would
    # be a detoast bought for nothing.
    attributes, extraction, attribute_args = aggregate_sql(long_tail(query.attributes))

    sql = f"""SELECT
      {selected},
      {_PROJECTION}{attributes}
    FROM (
    {keys_sql}
    ) k
    JOIN {record_source()} r ON {join} AND ({predicate.sql})
    JOIN {SEARCH_SCHEMA}.data_source contributor
      ON contributor.source_id = r.source_id
    {REFERENCE_LATERAL}
    {extraction}
    GROUP BY {grouped}
    ORDER BY 1, 2, 3"""

    return sql, [*attribute_args, *keys_args, *predicate.args]


def fold_rows(
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        conn = None,
        record: RecordFilter | None = None,
) -> list[dict[str, Any]]:
    """
    The collapsed rows of one page, in the shape of data-model §3b.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection, or None to open one.
        record: A pre-built record filter, for a composition.

    Returns:
        One dict per collapse key, keyed by entity ids and carrying every
        recomputed summary.
    """

    sql, args = fold_sql(query, resolved, record = record)

    with connection(conn) as live:

        return [dict(row) for row in live.execute(sql, args).fetchall()]


def count_groups(
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        conn = None,
        record: RecordFilter | None = None,
) -> int:
    """
    The exact number of collapse keys in one scope.

    This is the full fold of that scope, and it is only ever run because a
    caller asked for an exact total explicitly. `guard` prices it as the
    whole fold before it runs.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection, or None to open one.
        record: A pre-built record filter, for a composition.

    Returns:
        The number of keys.
    """

    sql, args = key_count_sql(query, resolved, record = record)

    with connection(conn) as live:

        row = live.execute(sql, args).fetchone()

    return int(row['keys']) if row else 0
