"""
The cost governor — estimate, then refuse.

`graph._limit` capped a page size. This is the same seam widened to the cost
that moved from the derive to the query when the build stopped precomputing
the collapse: the limit and the attribute count are still capped, and on top
of that the request is **priced before it runs**, from `facet_relation_bitmap`
cardinalities and from the derive's `source_count` histogram, and refused with
an actionable 4xx when the price is unbounded.

The distinction the whole design rests on is between a post-fold **filter** and
a post-fold **sort**, and the two are treated apart here on purpose.

* `HAVING source_count >= 2` streams. With input ordered on the group key,
  `GroupAggregate` emits each group as its key changes and the outer `LIMIT`
  stops the scan, so the cost is page ÷ selectivity — 3,900, 90,000 and 1.7
  million keys folded at `>= 2`, `>= 3` and `>= 5`. Every one of those is
  inside the interactive latency target at present cardinality, so the
  histogram **prices** it and the caller can see the price. It becomes a gate
  when `interaction_assay` multiplies the grain.
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
    KEY_PROBE_CEILING,
    MAX_ATTRIBUTES,
    MAX_LONG_TAIL_ROWS,
    MAX_OFFSET,
    SORTABLE_COLUMNS,
    InteractionQuery,
)
from .project import long_tail
from .scope import ResolvedScope, connection
from .select import (
    RecordFilter,
    key_estimate_sql,
    key_probe_sql,
    record_scan_sql,
)

_log = logging.getLogger(__name__)

# Nine rows: one per observed `source_count` level, with the number of
# collapse keys at that level. The derive writes it; where it is absent the
# same nine rows are computed once and the estimate says so.
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
    # True when `qualifying_keys` is a floor rather than a number: the bounded
    # key scan reached its ceiling and stopped, so the scope holds at least
    # this many keys and the count of them was not paid for.
    at_least: bool = False
    # True when the number was counted rather than guessed. A bounded scan that
    # finishes below its ceiling has counted the scope exactly, and saying so
    # is the difference between an estimate a caller can act on and one they
    # have to distrust on principle.
    exact: bool = False

    def as_dict(self) -> dict[str, Any]:
        """
        The estimate as it is carried on a response.

        Returns:
            The two counts, their source, and whether the first is a floor or
            an exact count rather than a guess.
        """

        return {
            'qualifying_keys': self.qualifying_keys,
            'keys_folded': self.keys_folded,
            'source': self.source,
            'at_least': self.at_least,
            'exact': self.exact,
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
            reaches no index, a page too deep for `offset`, a filter on an
            unindexed long-tail key at scale, or an unbounded long-tail
            projection.
    """

    # The refusals that need no number come first, so a request that is wrong
    # on its face is not planned before it is turned down.
    _refuse_folded_sort(query)
    _refuse_deep_offset(query)
    _refuse_too_many_attributes(query)
    _refuse_widening_the_group_key(query)

    with connection(conn) as live:

        _refuse_unindexed_long_tail_filter(query, resolved, live, record)
        estimate = _price(query, resolved, live, record)
        _refuse_unbounded_projection(query, estimate, live)

        return estimate


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


def _refuse_too_many_attributes(query: InteractionQuery) -> None:
    """
    Refuse a definition list longer than one pass over the document is worth.

    Args:
        query: The parsed request.

    Raises:
        GuardrailRefusal: When too many long-tail keys are asked for.
    """

    # Only the long tail is counted. A hot column is already on the row the
    # fold produces, so asking for it opens no document and adds no scan;
    # counting it here would refuse a request that costs nothing.
    tail = long_tail(query.attributes)

    if len(tail) <= MAX_ATTRIBUTES:

        return

    raise GuardrailRefusal(
        f'{len(tail)} long-tail attributes requested; at most '
        f'{MAX_ATTRIBUTES} are projected in one request. Narrow the '
        f'`attributes` list, or ask for the rest in a second call.',
        status_code = 400,
        parameter = 'attributes',
    )


def _refuse_unbounded_projection(
        query: InteractionQuery,
        estimate: 'Estimate',
        conn,
) -> None:
    """
    Refuse a long-tail projection over a scan the page bound cannot stop.

    Folding the page rather than the scope put the extraction inside the fold,
    whose `FROM` starts from the
    bounded key list, so an ordinary page reaches about a hundred and three
    record rows for a hundred keys and is never in question. Two requests
    escape that bound, and both walk the scope rather than the page: an exact
    count of every key taken alongside the projection, and a post-fold filter
    selective enough that filling a page means folding millions of keys.
    Measured: `source_count >= 5` at a 500-row page walks 2,935 record rows
    through the extraction in 1,420 ms, already outside the one-second budget
    before a single
    document exists to open. The number that sees both is the estimate's own
    `keys_folded`.

    **Pricing it rather than naming a scope is the point of this rewrite.** The
    rule this replaces refused an unscoped request and let every scope but the
    widest through, so a long-tail projection over 54.05% of the record passed
    while the same request over 100% did not. The cost is the same either way,
    and a bound written as a number sees that where a bound written as
    `if unscoped` cannot.

    Args:
        query: The parsed request.
        estimate: What the request has been priced at.
        conn: An open connection, for the mean the histogram carries.

    Raises:
        GuardrailRefusal: When the scan the projection rides on is longer than
            `MAX_LONG_TAIL_ROWS`.
    """

    tail = long_tail(query.attributes)

    if not tail:

        return

    rows = round(estimate.keys_folded * _mean_source_count(conn))

    if rows <= MAX_LONG_TAIL_ROWS:

        return

    named = ', '.join(f'`{name}`' for name in tail)

    raise GuardrailRefusal(
        f'projecting {named} rides on a scan of about {rows:,} record rows '
        f'that the page bound does not stop, past the '
        f'{MAX_LONG_TAIL_ROWS:,} one request may reach the attribute document '
        f'over. Narrow the scope with `resources`, `datasets` or `license`, '
        f'drop `exact_total`, loosen the post-fold filter, or ask for the page '
        f'without `attributes` and read the document keys for the keys you '
        f'keep.',
        status_code = 400,
        parameter = 'attributes',
        attributes = tail,
        estimated_rows_scanned = rows,
        maximum_rows_scanned = MAX_LONG_TAIL_ROWS,
    )


def _refuse_unindexed_long_tail_filter(
        query: InteractionQuery,
        resolved: ResolvedScope,
        conn,
        record: RecordFilter | None,
) -> None:
    """
    Refuse a predicate on the attribute document at scale.

    No index of this build reaches `attributes` — the record carries a btree on
    the collapse key, one on the key plus the assertion columns, and one on
    `source_id` — so the predicate is applied row by row to everything the
    indexed predicates admit. **Measured on dev4 2026-08-24**: unscoped, the
    plan is an index scan over the whole record with the predicate as a filter,
    14,686,404 rows examined, 14,789,117 buffers, **12,637 ms**, and the
    `LIMIT` saves nothing because a scan qualifying no row cannot stop at a
    page. Scoped to one resource the same predicate examines 44,455 rows in
    **94.9 ms**; 410,592 rows cost 384 ms and 902,216 cost 441 ms.

    So the answer to "build the parameter or refuse it" is both, and in that
    order: the filter exists, because a refusal that can never fire protects
    nothing, and it is priced by the rows it would be applied to.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection.
        record: A pre-built record filter, for a composition.

    Raises:
        GuardrailRefusal: When the scan the predicate rides on is too wide.
    """

    keys = sorted(query.filters.attribute_filters)

    if not keys:

        return

    sql, args = record_scan_sql(query, resolved, record = record)
    rows = _planned_rows(conn, sql, args)

    if rows <= MAX_LONG_TAIL_ROWS:

        return

    raise GuardrailRefusal(
        f'no index reaches the attribute document, so filtering on '
        f'{", ".join(f"`{name}`" for name in keys)} tests every row the rest '
        f'of the request admits — about {rows:,} of them here, past the '
        f'{MAX_LONG_TAIL_ROWS:,} one request may scan. Measured unscoped at '
        f'12,637 ms over 14,686,404 rows, against 94.9 ms over 44,455. '
        f'Narrow the scope first with `resources`, `datasets` or `license`, '
        f'or select on a stored column — the endpoints, the class, the '
        f'organism, affinity, pchembl or score — which reaches an index.',
        status_code = 400,
        parameter = 'attribute_filters',
        attribute_keys = keys,
        estimated_rows_scanned = rows,
        maximum_rows_scanned = MAX_LONG_TAIL_ROWS,
    )


def _refuse_widening_the_group_key(query: InteractionQuery) -> None:
    """
    Refuse widening the sign flags when the flags are the group key.

    `collapse=none` and `collapse=assertion` put the sign and direction columns
    into the key, so each row exists *because* of the values it carries there.
    Overwriting them with an assertion from outside the scope would move rows
    off their own key and merge groups the caller asked to keep apart. The
    request is refused rather than half-served, because silently declining half
    of what was asked for is the quiet wrongness this endpoint is built to
    avoid.

    Args:
        query: The parsed request.

    Raises:
        GuardrailRefusal: For the two collapse modes that key on the flags.
    """

    if not query.include_outofscope_signdir or query.collapse == 'endpoints':

        return

    raise GuardrailRefusal(
        f'collapse={query.collapse} groups on the sign and direction columns, '
        f'so widening those flags with an assertion from outside the scope '
        f'would rewrite the key each row was grouped under. Ask for the '
        f'widened flags with collapse=endpoints, or read the per-resource '
        f'assertions with by_resource instead.',
        status_code = 400,
        parameter = 'include_outofscope_signdir',
        collapse = query.collapse,
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

    if _planner_is_blind(resolved, record):

        return _probe(query, resolved, conn, record)

    planned = _planned_keys(query, resolved, conn, record)

    return Estimate(
        qualifying_keys = planned,
        keys_folded = min(planned, query.limit + query.offset),
        source = f'planner estimate; no {HISTOGRAM_TABLE} lookup was needed',
    )


def _planner_is_blind(resolved: ResolvedScope, record: RecordFilter | None) -> bool:
    """
    Whether this request's predicate is one the planner cannot price.

    An entity-set predicate is an `OR` of two large uuid arrays, and the
    planner has no statistic that describes it. **Measured on dev4 2026-08-24**
    against the fold: 8,428,823 keys estimated for a `ligand` annotation filter
    against 729,900 true, and 7,483,451 against 1,273,762 for `receptor` —
    11.5x and 5.9x over. The flat record count is mispriced the same way
    (8,531,569 against 794,518), so it is the predicate rather than the
    `DISTINCT` that defeats it. With a class filter added it undershoots
    instead, 42,656 against 59,328. An error of that size in either direction
    is not an estimate, so this request is counted rather than planned.

    Everything else is planned, because there the planner is good: 14,221,675
    against 14,291,204 unscoped, and 42,096 against 44,455 for one resource.

    Args:
        resolved: The resolved scope.
        record: A pre-built record filter, for a composition.

    Returns:
        Whether to count instead of plan.
    """

    return record is None and resolved.annotated_entity_ids is not None


def _probe(
        query: InteractionQuery,
        resolved: ResolvedScope,
        conn,
        record: RecordFilter | None,
) -> Estimate:
    """
    Count the scope's keys up to a ceiling, and report a floor past it.

    The exact count of an annotated scope costs 1.834 s, outside the
    one-second budget and not
    payable per request. The same count stopped at 100,000 keys costs 0.282 s,
    and it is **exact** wherever the answer fits inside the ceiling — 59,328 in
    0.397 s for the ligand-receptor scope, 44,455 in 0.074 s for a single
    resource. Past the ceiling the honest report is "at least 100,000", which
    the response carries as a floor rather than as a total.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection.
        record: A pre-built record filter, for a composition.

    Returns:
        The estimate, exact or floored.
    """

    sql, args = key_probe_sql(
        query, resolved, KEY_PROBE_CEILING, record = record,
    )

    try:

        counted = int(conn.execute(sql, args).fetchone()['keys'])

    except Exception as exc:  # pragma: no cover - a count is an estimate here

        _log.warning('the bounded key scan failed, falling back to the plan: %s', exc)

        planned = _planned_keys(query, resolved, conn, record)

        return Estimate(
            qualifying_keys = planned,
            keys_folded = min(planned, query.limit + query.offset),
            source = f'planner estimate; no {HISTOGRAM_TABLE} lookup was needed',
        )

    floored = counted >= KEY_PROBE_CEILING

    _log.info(
        'the bounded key scan counted %d keys%s',
        counted, ' and stopped at its ceiling' if floored else '',
    )

    return Estimate(
        qualifying_keys = counted,
        keys_folded = min(counted, query.limit + query.offset),
        source = (
            f'key scan bounded at {KEY_PROBE_CEILING}, because the planner '
            f'cannot price an entity-set predicate'
        ),
        at_least = floored,
        exact = not floored,
    )


def _mean_source_count(conn) -> float:
    """
    Record rows per collapse key, from the derive's recorded histogram.

    Args:
        conn: An open connection.

    Returns:
        The mean, measured at 1.0271 on this build. It is what turns a count of
        keys into a count of documents a projection would open.
    """

    levels, _ = histogram(conn)
    keys = sum(levels.values())

    if not keys:

        return 1.0

    return sum(level * count for level, count in levels.items()) / keys


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
        # `interaction_source_count_histogram` stores per-level values; the
        # predicate is cumulative, so the guard sums the levels the predicate
        # admits. Reading the table's cumulative-looking row as a per-level
        # one is the trap it sets.
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


def _planned_rows(conn, sql: str, args) -> int:
    """
    The planner's own row estimate for one statement, without running it.

    Args:
        conn: An open connection.
        sql: The statement to plan.
        args: Its positional arguments.

    Returns:
        The estimated rows, or zero where the statement could not be planned —
        an estimate is not a result, and failing to make one must not fail the
        request.
    """

    try:

        row = conn.execute(f'EXPLAIN (FORMAT JSON) {sql}', args).fetchone()

    except Exception as exc:  # pragma: no cover - a plan is an estimate

        _log.warning('could not plan the row estimate: %s', exc)

        return 0

    plan = list(row.values())[0][0]['Plan']

    return max(0, int(plan.get('Plan Rows') or 0))


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

    return _planned_rows(conn, sql, args)


def histogram(conn) -> tuple[dict[int, int], str]:
    """
    The `source_count` histogram, from the derive where it exists.

    The derive writes `interaction_source_count_histogram`; until it has run
    the same nine rows are computed by folding the record once, cached for the
    life of the process, and the estimate's `source` says which one answered —
    an estimate that hides where it came from is the same kind of quietly
    wrong number as a summary folded over the wrong resource set.

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
        A statement producing the same nine rows that
        `interaction_source_count_histogram` holds.
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
