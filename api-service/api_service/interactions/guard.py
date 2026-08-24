"""
The cost governor — estimate, then refuse (T020j, contracts §4, FR-009).

`graph._limit` capped a page size. This is the same seam widened to the cost
R24 moved from the derive to the query: the limit and the attribute count are
still capped, and on top of that the request is **priced before it runs**, from
`facet_relation_bitmap` cardinalities and from the derive's `source_count`
histogram, and refused with an actionable 4xx when the price is unbounded.

The distinction the whole design rests on is between a post-fold **filter** and
a post-fold **sort**, and the two are treated apart here on purpose.

* `HAVING source_count >= 2` streams. With input ordered on the group key,
  `GroupAggregate` emits each group as its key changes and the outer `LIMIT`
  stops the scan, so the cost is page ÷ selectivity — 3,900, 90,000 and 1.7
  million keys folded at `>= 2`, `>= 3` and `>= 5`. Every one of those is
  inside SC-002 at present cardinality, so the histogram **prices** it and the
  caller can see the price. It becomes a gate when `interaction_assay`
  multiplies the grain.
* `ORDER BY source_count` cannot stop early. To know which key sorts first the
  engine folds every key in scope and then sorts — measured at 5,538 ms
  unscoped, with the `LIMIT` saving nothing because the top-N heapsort only
  sees rows the fold has already produced. So it is refused, 100% of the time,
  naming the column and what to narrow.

Treating the two alike would either forbid a cheap request or promise an
unbounded one.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Any

from ..graph import SEARCH_SCHEMA
from .params import (
    FOLDED_COLUMNS,
    MAX_ATTRIBUTES,
    MAX_OFFSET,
    SORTABLE_COLUMNS,
    InteractionQuery,
)
from .scope import ResolvedScope, connection
from .select import RecordFilter, key_estimate_sql

_log = logging.getLogger(__name__)

# data-model §12. Nine rows: one per observed `source_count` level, with the
# number of collapse keys at that level. T013m writes it; where it is absent
# the same nine rows are computed once and the estimate says so.
HISTOGRAM_TABLE = 'interaction_source_count_histogram'

# Cached per schema. The computed fallback is a full fold (about four seconds
# over 14.7 million record rows), so it is paid once per process and not once
# per request.
_HISTOGRAM_CACHE: dict[str, tuple[dict[int, int], str]] = {}


class GuardrailRefusal(Exception):
    """A request the cost governor will not run, with the reason a caller can act on."""

    def __init__(self, message: str, *, status_code: int = 400, **context: Any):

        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.context = context

    def as_dict(self) -> dict[str, Any]:
        """
        The refusal as a response body.

        Returns:
            The message and whatever named the offending parameter.
        """

        return {'message': self.message, **self.context}


@dataclass
class Estimate:
    """What a request will cost, priced before it runs."""

    # Keys expected to satisfy every predicate, post-fold ones included.
    qualifying_keys: int
    # Keys the fold has to produce to fill the page — page ÷ selectivity.
    keys_folded: int
    # Where the numbers came from, so an estimate is never mistaken for a count.
    source: str = HISTOGRAM_TABLE

    def as_dict(self) -> dict[str, Any]:
        """
        The estimate as it is carried on a response.

        Returns:
            The two counts and their source.
        """

        return {
            'qualifying_keys': self.qualifying_keys,
            'keys_folded': self.keys_folded,
            'source': self.source,
        }


def check(
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        conn = None,
        record: RecordFilter | None = None,
) -> Estimate:
    """
    Price one request, and refuse it where the price is unbounded.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection, or None to open one.
        record: A pre-built record filter, for a composition — the governor
            prices the composition rather than each component.

    Returns:
        The estimate, which the response carries wherever a post-fold predicate
        was priced.

    Raises:
        GuardrailRefusal: For a sort on a folded value, a sort on a column that
            reaches no index, a page too deep for `offset`, or an unbounded
            long-tail projection.
    """

    _refuse_folded_sort(query)
    _refuse_deep_offset(query)
    _refuse_unbounded_projection(query, resolved)

    with connection(conn) as live:

        return _price(query, resolved, live, record)


def _refuse_folded_sort(query: InteractionQuery) -> None:
    """
    Refuse an `ORDER BY` that no index and no page bound can serve.

    Args:
        query: The parsed request.

    Raises:
        GuardrailRefusal: When the sort column is folded, or is neither folded
            nor a stored column that reaches an index.
    """

    column = query.order_column

    if not column:

        return

    if column in FOLDED_COLUMNS:

        raise GuardrailRefusal(
            f'`{column}` does not exist until its group has been folded, so '
            f'ordering by it folds every key in scope before the first row can '
            f'be chosen — measured at 5,538 ms unscoped, and the LIMIT saves '
            f'nothing. Narrow the scope with `resources` or `datasets` and '
            f'filter on `{column}` instead of sorting on it, or sort on a '
            f'stored column: affinity, pchembl, score, or the collapse key.',
            status_code = 400,
            parameter = 'order_by',
            column = column,
            folded_columns = sorted(FOLDED_COLUMNS),
        )

    if column not in SORTABLE_COLUMNS:

        raise GuardrailRefusal(
            f'`{column}` reaches no index of the interaction record, so sorting '
            f'on it scans the whole scope. Narrow the request with a '
            f'`resources` or `datasets` filter, or sort on a stored column: '
            f'{", ".join(sorted(SORTABLE_COLUMNS))}.',
            status_code = 400,
            parameter = 'order_by',
            column = column,
        )


def _refuse_deep_offset(query: InteractionQuery) -> None:
    """
    Refuse a page too deep to reach by `offset`.

    Args:
        query: The parsed request.

    Raises:
        GuardrailRefusal: When the offset is past the depth bound.
    """

    if query.offset <= MAX_OFFSET:

        return

    raise GuardrailRefusal(
        f'offset {query.offset} walks the {query.offset} keys it skips, so the '
        f'page costs as much as every page before it. The fold key is the '
        f'collapse index\'s leading column set, so page with the `cursor` this '
        f'endpoint returns instead: it resumes after the last key of a page in '
        f'one index descent. Offsets up to {MAX_OFFSET} are served.',
        status_code = 400,
        parameter = 'offset',
        cursor = 'use the cursor returned with each page',
    )


def _refuse_unbounded_projection(
        query: InteractionQuery,
        resolved: ResolvedScope,
) -> None:
    """
    Refuse a long-tail JSONB projection over a scan with no bound on it.

    Args:
        query: The parsed request.
        resolved: The resolved scope.

    Raises:
        GuardrailRefusal: When too many attributes are asked for, or when the
            long tail is projected over a scan that nothing narrows.
    """

    if len(query.attributes) > MAX_ATTRIBUTES:

        raise GuardrailRefusal(
            f'{len(query.attributes)} attributes requested; at most '
            f'{MAX_ATTRIBUTES} are projected in one request. Narrow the '
            f'`attributes` list, or ask for the rest in a second call.',
            status_code = 400,
            parameter = 'attributes',
        )

    if query.attributes and query.exact_total and resolved.unscoped:

        raise GuardrailRefusal(
            'projecting the long-tail attributes while counting every key of '
            'the unscoped fold detoasts the whole record. Narrow the scope '
            'with `resources` or `datasets`, or drop `exact_total`.',
            status_code = 400,
            parameter = 'attributes',
        )


def _price(
        query: InteractionQuery,
        resolved: ResolvedScope,
        conn,
        record: RecordFilter | None,
) -> Estimate:
    """
    Estimate the keys a request qualifies and the keys it has to fold.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection.
        record: A pre-built record filter, or None.

    Returns:
        The estimate.
    """

    post_fold = query.filters.post_fold()

    if post_fold or query.exact_total:

        levels, source = histogram(conn)
        # The histogram describes the whole record; a scope reaches its own
        # share of it, from the source facet rather than from a count.
        keys = max(1, round(sum(levels.values()) * resolved.record_share))
        qualifying = _qualifying(levels, post_fold, resolved.record_share, keys)
        # Page ÷ selectivity: filling a page at `source_count >= 5` folds
        # about 1.7 million keys for the 858 that qualify.
        folded = min(keys, math.ceil(query.limit * keys / max(qualifying, 1)))

        return Estimate(
            qualifying_keys = qualifying,
            keys_folded = keys if query.exact_total else folded,
            source = source,
        )

    planned = _planned_keys(query, resolved, conn, record)

    return Estimate(
        qualifying_keys = planned,
        keys_folded = min(planned, query.limit + query.offset),
        source = f'planner estimate; no {HISTOGRAM_TABLE} lookup was needed',
    )


def _qualifying(
        levels: dict[int, int],
        post_fold: dict[str, dict[str, Any]],
        share: float,
        keys: int,
) -> int:
    """
    The keys a post-fold predicate is expected to keep.

    Args:
        levels: The `source_count` histogram, per level.
        post_fold: The post-fold predicates that were asked for.
        share: The fraction of the record the scope reaches.
        keys: The estimated number of keys in scope.

    Returns:
        The number of qualifying keys, never below one.
    """

    if not post_fold:

        return keys

    qualifying = keys

    if bounds := post_fold.get('source_count'):

        lower = int(bounds.get('min') or 0)
        upper = int(bounds['max']) if bounds.get('max') is not None else None
        # data-model §12 stores per-level values; the predicate is cumulative,
        # so the guard sums the levels the predicate admits. Reading the table's
        # cumulative-looking row as a per-level one is the trap it sets.
        matched = sum(
            count for level, count in levels.items()
            if level >= lower and (upper is None or level <= upper)
        )
        qualifying = min(qualifying, max(1, round(matched * share)))

    # The other post-fold columns have no recorded distribution, so they are
    # priced as a further restriction of unknown strength rather than ignored.
    for name in post_fold:

        if name != 'source_count':

            qualifying = max(1, qualifying // 2)

    return max(1, qualifying)


def _planned_keys(
        query: InteractionQuery,
        resolved: ResolvedScope,
        conn,
        record: RecordFilter | None,
) -> int:
    """
    The planner's own estimate of the collapse keys in a scope.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection.
        record: A pre-built record filter, or None.

    Returns:
        The estimated number of keys, never below zero.
    """

    sql, args = key_estimate_sql(query, resolved, record = record)

    try:

        row = conn.execute(f'EXPLAIN (FORMAT JSON) {sql}', args).fetchone()

    except Exception as exc:  # pragma: no cover - a plan is an estimate, not a result

        _log.warning('could not plan the key estimate: %s', exc)

        return 0

    plan = list(row.values())[0][0]['Plan']

    return max(0, int(plan.get('Plan Rows') or 0))


def histogram(conn) -> tuple[dict[int, int], str]:
    """
    The `source_count` histogram, from the derive where it exists.

    T013m writes `interaction_source_count_histogram`; until it has run the
    same nine rows are computed by folding the record once, cached for the
    life of the process, and the estimate's `source` says which one answered —
    an estimate that hides where it came from is the kind of quietly wrong
    number FR-048 exists to prevent.

    Args:
        conn: An open connection.

    Returns:
        `{source_count: keys}` and the name of where it came from.
    """

    if SEARCH_SCHEMA in _HISTOGRAM_CACHE:

        return _HISTOGRAM_CACHE[SEARCH_SCHEMA]

    present = conn.execute(
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = %s AND table_name = %s
        """,
        (SEARCH_SCHEMA, HISTOGRAM_TABLE),
    ).fetchone()

    if present:

        rows = conn.execute(
            f'SELECT source_count, keys FROM {SEARCH_SCHEMA}.{HISTOGRAM_TABLE}',
        ).fetchall()
        answer = (
            {int(row['source_count']): int(row['keys']) for row in rows},
            HISTOGRAM_TABLE,
        )

    else:

        _log.info(
            '%s.%s is absent; computing the source_count histogram once',
            SEARCH_SCHEMA, HISTOGRAM_TABLE,
        )
        rows = conn.execute(_computed_histogram_sql()).fetchall()
        answer = (
            {int(row['source_count']): int(row['keys']) for row in rows},
            f'computed fold, because {HISTOGRAM_TABLE} is absent from this build',
        )

    _HISTOGRAM_CACHE[SEARCH_SCHEMA] = answer

    return answer


def _computed_histogram_sql() -> str:
    """
    The fallback histogram, folded from the record itself.

    Returns:
        A statement producing the same nine rows data-model §12 records.
    """

    from .select import record_source

    return f"""SELECT source_count, count(*)::bigint AS keys
    FROM (
      SELECT count(DISTINCT r.source_id)::int AS source_count
      FROM {record_source()} r
      GROUP BY r.subject_entity_id, r.object_entity_id, r.interaction_class_id
    ) folded
    GROUP BY 1
    ORDER BY 1"""
