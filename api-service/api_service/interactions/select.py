"""
Key selection over the interaction record.

This is the only module in the service that names the interaction tables.
Everything else reaches them through the statements built here, which is what
keeps a dataset a parameter set rather than a query function of its own.

**The shape is binding, not stylistic.** Select the page's group keys —
`(subject_entity_id, object_entity_id, interaction_class_id)` — in key order
with the page bound applied, then fold only those keys. For a wide or empty
scope that is an ordered read of `interaction_fact_resource_collapse_idx`,
which leads on exactly those columns, so the scan stops at the page instead of
tracking the scope. Fold the scope instead and an unqualified page costs
seconds; fold the page and it costs a millisecond.

A post-fold predicate changes the first step rather than adding a second one:
the key selection groups and applies its own `HAVING`, streaming through
`GroupAggregate` over `interaction_fact_resource_key_idx` — which carries
`source_id` and the three assertion flags, so `source_count`,
`sign_source_count` and `direction_source_count` are answered index-only — and
the outer `LIMIT` stops the scan at the hundredth qualifying key.
"""

from __future__ import annotations

import base64
import json
import uuid as _uuid
from dataclasses import dataclass, field
from typing import Any, Sequence

from ..graph import SEARCH_SCHEMA
from .params import InteractionQuery
from .scope import ResolvedScope

# One row per ordered `(subject, object, class)` **and contributing
# resource** — the record the fold collapses, and the only interaction table
# this cycle's query engine reads.
RECORD_TABLE = 'interaction_fact_resource'

# Leads on exactly the collapse key columns, so an ordered read of it is the
# page's key list.
COLLAPSE_INDEX = 'interaction_fact_resource_collapse_idx'

# `(subject, object, class, source_id, is_directed, is_stimulation,
# is_inhibition)`, unique. A post-fold predicate over the source counts is
# answered from it without a heap fetch.
KEY_INDEX = 'interaction_fact_resource_key_idx'

# Below this share of the record a scope is **narrow**: the collapse index
# does not lead on `source_id`, so its keys are cheaper to find through the
# source index and sort than to sweep for. The share comes from the `source`
# facet of `facet_relation_bitmap`, not from a count over the record.
NARROW_SHARE = 0.01

GROUP_KEYS: tuple[str, ...] = (
    'subject_entity_id',
    'object_entity_id',
    'interaction_class_id',
)

# One group is one interaction, whatever its arity. A reaction has no first
# and second endpoint to be cut into, so grouping it on an ordered pair is not
# a coarser answer but a wrong one; this key gives it back as the single row
# it is.
PARTICIPANT_KEYS: tuple[str, ...] = ('interaction_id',)

# What the fold groups on, by grain. Every statement of this module reads its
# key list from here rather than naming the three binary columns, because the
# arity of the key is the one thing the grain changes.
GRAIN_KEYS: dict[str, tuple[str, ...]] = {
    'interaction': GROUP_KEYS,
    'participant': PARTICIPANT_KEYS,
}

# The SQL type of every column a key may be built from. A cursor tuple, an
# `unnest` of a page's keys and the coercion of a decoded cursor all need it,
# and they must agree: a key column cast one way in the comparison and another
# in the array would compare two different values under one name.
KEY_CASTS: dict[str, str] = {
    'subject_entity_id': 'uuid',
    'object_entity_id': 'uuid',
    'interaction_class_id': 'smallint',
    'interaction_id': 'uuid',
}

# How a key value is read back into the type its column compares at. A uuid
# travels as text and a class id as a number, and the same value has to land on
# the same Python object whether it came off the record, off a rendered row or
# out of a cursor — otherwise a lookup that should match silently misses.
_KEY_READERS = {'uuid': str, 'smallint': int}

# `collapse` is a flag on one builder rather than three statements: `none`
# extends the key to the record's own grain and `assertion` to the resources
# that agree on sign and direction, and both are the same fold with a longer
# key.
COLLAPSE_KEYS: dict[str, tuple[str, ...]] = {
    'endpoints': GROUP_KEYS,
    'assertion': GROUP_KEYS + ('is_directed', 'is_stimulation', 'is_inhibition'),
    'none': GROUP_KEYS + (
        'source_id', 'is_directed', 'is_stimulation', 'is_inhibition',
    ),
}


def page_keys(query: InteractionQuery) -> tuple[str, ...]:
    """
    The columns one page is selected and paged by, for one request.

    This is the key the page bound applies to and the cursor resumes on, so it
    is also what one row of the page stands for: an ordered endpoint pair and
    class, or one interaction whatever its arity.

    Args:
        query: The parsed request.

    Returns:
        The key column names, in key order.
    """

    return GRAIN_KEYS.get(query.grain, GROUP_KEYS)


def group_keys(query: InteractionQuery) -> tuple[str, ...]:
    """
    The columns the fold groups on, for one request.

    At `interaction` grain that is the collapse mode's key: `none` and
    `assertion` lengthen the binary key rather than replacing it, which is
    what lets one builder serve all three. At `participant` grain it is the
    page key itself — each collapse mode describes a fold over an ordered
    endpoint pair, a reaction is not one, and so nothing there reads
    `collapse` and its value makes no claim.

    Args:
        query: The parsed request.

    Returns:
        The key column names, leading with `page_keys`.
    """

    if query.grain != 'interaction':

        return page_keys(query)

    return COLLAPSE_KEYS.get(query.collapse, GROUP_KEYS)


def positions(keys: Sequence[str], suffix: str = '') -> str:
    """
    A positional `GROUP BY` or `ORDER BY` list over a key of any arity.

    The positions are written out rather than the column names repeated,
    because a key column may be selected under an alias and a name that no
    longer matches the select list is a runtime error rather than a wrong
    answer.

    Args:
        keys: The key columns, in key order.
        suffix: `ASC`, `DESC`, or nothing.

    Returns:
        `1, 2, 3` — or `1 DESC, 2 DESC, 3 DESC`.
    """

    tail = f' {suffix}' if suffix else ''

    return ', '.join(f'{index + 1}{tail}' for index in range(len(keys)))


def key_tuple_sql(keys: Sequence[str]) -> str:
    """
    A parameter tuple typed to match one key, for the keyset comparison.

    Args:
        keys: The key columns, in key order.

    Returns:
        `(%s::uuid, %s::uuid, %s::smallint)`, or whatever the key is.
    """

    return '(' + ', '.join(f'%s::{KEY_CASTS[name]}' for name in keys) + ')'


def key_value(name: str, value: Any) -> Any:
    """
    One key column's value, read at the type that column compares at.

    Args:
        name: The key column.
        value: The value, however it arrived.

    Returns:
        The value as the key compares it.
    """

    return _KEY_READERS[KEY_CASTS[name]](value)


# The folded values, as SQL over the record alias `r` and the reference lateral
# alias `c`. One definition, used by the fold's projection and by the key
# selection's `HAVING`, so the two cannot drift.
FOLDED_EXPRESSIONS: dict[str, str] = {
    'source_count': 'count(DISTINCT r.source_id)',
    'sign_source_count': (
        'count(DISTINCT r.source_id) FILTER '
        '(WHERE r.is_stimulation IS NOT NULL OR r.is_inhibition IS NOT NULL)'
    ),
    'direction_source_count': (
        'count(DISTINCT r.source_id) FILTER (WHERE r.is_directed IS NOT NULL)'
    ),
    'reference_count': (
        "count(DISTINCT c.value) FILTER (WHERE c.kind IN ('pubmed', 'doi'))"
    ),
}

# Every reference and curation flag of one record row, one per row, tagged by
# kind. `LEFT JOIN LATERAL` rather than `CROSS JOIN` on purpose: a record row
# citing nothing must still reach the fold, or the group loses a contributor.
REFERENCE_LATERAL = """LEFT JOIN LATERAL (
      SELECT 'pubmed'::text AS kind, pubmed.value
        FROM unnest(r.reference_pubmed_ids) AS pubmed(value)
      UNION ALL
      SELECT 'doi'::text, doi.value
        FROM unnest(r.reference_dois) AS doi(value)
      UNION ALL
      SELECT 'curation'::text, flag.value
        FROM unnest(r.curation_flags) AS flag(value)
    ) c ON true"""


def record_source() -> str:
    """
    The qualified name of the interaction record table.

    Returns:
        `schema.table`, for a statement built as text.
    """

    return f'{SEARCH_SCHEMA}.{RECORD_TABLE}'


@dataclass
class RecordFilter:
    """One boolean expression over the record alias `r`, with its arguments."""

    sql: str = 'true'
    args: list[Any] = field(default_factory = list)

    def combined(self, other: 'RecordFilter', operator: str) -> 'RecordFilter':
        """
        Join two record filters with `AND` or `OR`, preserving argument order.

        Args:
            other: The filter to combine with.
            operator: `AND` or `OR`.

        Returns:
            The combined filter.
        """

        return RecordFilter(
            sql = f'(({self.sql}) {operator} ({other.sql}))',
            args = [*self.args, *other.args],
        )


def record_filter(
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        long_tail: bool = True,
) -> RecordFilter:
    """
    Every pre-fold predicate of one request, as one expression over `r`.

    Scope, selection and range all land here, because all three restrict the
    **record rows** the fold may see. That is what makes the recomputation
    rule hold without a second mechanism: the summaries are aggregates over
    exactly these rows, so a narrowed scope narrows the numbers by
    construction.

    Args:
        query: The parsed request.
        resolved: The scope, already collapsed to `source_id` values.
        long_tail: Whether to include the predicates that reach into the
            attribute document. `guard` builds the expression **without** them
            to find how many rows they would be applied to, which is the one
            number that decides whether the request is affordable.

    Returns:
        The predicate and its positional arguments.
    """

    filters = query.filters
    clauses: list[str] = []
    args: list[Any] = []

    if resolved.empty:

        # A named resource that resolves to nothing is an empty scope, which is
        # a different answer from no restriction at all.
        return RecordFilter(sql = 'false', args = [])

    if resolved.source_ids is not None:

        clauses.append('r.source_id = ANY(%s::bigint[])')
        args.append(list(resolved.source_ids))

    if resolved.excluded_source_ids:

        clauses.append('r.source_id <> ALL(%s::bigint[])')
        args.append(list(resolved.excluded_source_ids))

    if resolved.interaction_class_ids:

        clauses.append('r.interaction_class_id = ANY(%s::smallint[])')
        args.append(list(resolved.interaction_class_ids))

    if entities := _uuids(filters.entities):

        # Either endpoint: an entity filter asks for the interactions an entity
        # takes part in, not for the ones it initiates.
        clauses.append(
            '(r.subject_entity_id = ANY(%s::uuid[]) '
            'OR r.object_entity_id = ANY(%s::uuid[]))',
        )
        args.extend([entities, entities])

    if taxa := resolved.organism.taxa:

        # The taxa, not the names the caller wrote: `scope.resolve` has already
        # turned `human`, `9606` and `hsapiens` into one number and has refused
        # anything the record cannot match, so nothing here can quietly become
        # no filter at all.
        clauses.append(
            '(r.subject_organism = ANY(%s::bigint[]) '
            'OR r.object_organism = ANY(%s::bigint[]))',
        )
        args.extend([list(taxa), list(taxa)])

    if resolved.annotated_entity_ids is not None:

        # Resolved to ids before the query ran, so the annotation tables are
        # never joined per candidate row: they are partitioned forty-five ways
        # and a join there would price the filter by the scope rather than by
        # the page.
        clauses.append(
            '(r.subject_entity_id = ANY(%s::uuid[]) '
            'OR r.object_entity_id = ANY(%s::uuid[]))',
        )
        args.extend([
            list(resolved.annotated_entity_ids),
            list(resolved.annotated_entity_ids),
        ])

    if resolved.entity_type_ids:

        clauses.append(
            f"""EXISTS (
              SELECT 1 FROM {SEARCH_SCHEMA}.entity e
              WHERE e.entity_id IN (r.subject_entity_id, r.object_entity_id)
                AND e.entity_type_id = ANY(%s::bigint[])
            )""",
        )
        args.append(list(resolved.entity_type_ids))

    if resolved.chemical_class_ids:

        # The same semi-join shape as the entity type above, and for the same
        # reason: the classification is a column of the entity, so it cannot be
        # asserted by a resource. A protein carries no chemical class at all,
        # so gating on either end gates the small-molecule end of a
        # compound-protein pair without having to say which end that is.
        clauses.append(
            f"""EXISTS (
              SELECT 1 FROM {SEARCH_SCHEMA}.entity e
              WHERE e.entity_id IN (r.subject_entity_id, r.object_entity_id)
                AND e.chemical_class_id = ANY(%s::smallint[])
            )""",
        )
        args.append(list(resolved.chemical_class_ids))

    if filters.curation_flags:

        clauses.append('r.curation_flags && %s::text[]')
        args.append(list(filters.curation_flags))

    if filters.sign is not None:

        clauses.append(
            '(r.is_stimulation IS NOT NULL OR r.is_inhibition IS NOT NULL)'
            if filters.sign else
            '(r.is_stimulation IS NULL AND r.is_inhibition IS NULL)',
        )

    if filters.direction is not None:

        clauses.append('r.is_directed IS TRUE' if filters.direction else 'r.is_directed IS NOT TRUE')

    for name, bounds in filters.ranges().items():

        if (lower := bounds.get('min')) is not None:

            clauses.append(f'r.{name} >= %s')
            args.append(float(lower))

        if (upper := bounds.get('max')) is not None:

            clauses.append(f'r.{name} <= %s')
            args.append(float(upper))

    if long_tail:

        # Last, and that is not arbitrary. `AND` is commutative but the cost is
        # not: the indexed clauses above decide how many rows this one is
        # evaluated against, and `guard` refuses the request unless that number
        # is small. The name binds as a value rather than as an identifier,
        # because it is what the document is looked up by.
        for name, wanted in filters.attribute_filters.items():

            if isinstance(wanted, dict):

                if (lower := wanted.get('min')) is not None:

                    clauses.append('(r.attributes ->> %s) >= %s')
                    args.extend([str(name), str(lower)])

                if (upper := wanted.get('max')) is not None:

                    clauses.append('(r.attributes ->> %s) <= %s')
                    args.extend([str(name), str(upper)])

            else:

                clauses.append('(r.attributes ->> %s) = %s')
                args.extend([str(name), str(wanted)])

    return RecordFilter(sql = ' AND '.join(clauses) or 'true', args = args)


def record_scan_sql(
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        record: RecordFilter | None = None,
) -> tuple[str, Sequence[Any]]:
    """
    The record rows the **indexed** predicates admit, built to be planned.

    This is what an unindexed long-tail predicate would be applied to, row by
    row, and therefore the number `guard` prices it from. The long-tail
    predicates are left out on purpose: including them would ask the planner
    how selective a key of the attribute document is, which is exactly the
    question it has no statistics to answer.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        record: A pre-built record filter, for a composition. Such a filter is
            used as it stands, since a composition's scope is not one query's.

    Returns:
        The statement and its positional arguments.
    """

    predicate = (
        record if record is not None
        else record_filter(query, resolved, long_tail = False)
    )

    return f'SELECT 1 FROM {record_source()} r WHERE {predicate.sql}', list(predicate.args)


def key_probe_sql(
        query: InteractionQuery,
        resolved: ResolvedScope,
        ceiling: int,
        *,
        record: RecordFilter | None = None,
) -> tuple[str, Sequence[Any]]:
    """
    Count the collapse keys of a scope, stopping at a ceiling.

    An exact count is the full fold of the scope (`key_count_sql`) and costs
    what the fold costs. This is the same count with a bound on it: the keys
    come off the collapse index in key order, the scan stops at the ceiling,
    and the answer is exact whenever it is below it. Above it the answer is the
    ceiling, and the caller of this function is expected to say so rather than
    report a floor as a total.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        ceiling: The most keys to count before stopping.
        record: A pre-built record filter, for a composition.

    Returns:
        The statement and its positional arguments.
    """

    predicate = record if record is not None else record_filter(query, resolved)
    keys = page_keys(query)
    distinct_on = ', '.join(f'r.{name}' for name in keys)
    ordering = positions(keys)
    having, having_args = having_sql(query)
    lateral = REFERENCE_LATERAL if 'c.value' in having else ''

    if having:

        inner = f"""SELECT {distinct_on}
      FROM {record_source()} r
      {lateral}
      WHERE {predicate.sql}
      GROUP BY {ordering}
      HAVING {having}
      ORDER BY {ordering}
      LIMIT %s"""

    else:

        inner = f"""SELECT DISTINCT ON ({distinct_on}) {distinct_on}
      FROM {record_source()} r
      WHERE {predicate.sql}
      ORDER BY {ordering}
      LIMIT %s"""

    sql = f'SELECT count(*)::bigint AS keys FROM (\n    {inner}\n    ) probe'

    return sql, [*predicate.args, *having_args, int(ceiling)]


def having_sql(query: InteractionQuery) -> tuple[str, list[Any]]:
    """
    The post-fold predicate of one request, as a `HAVING` expression.

    Args:
        query: The parsed request.

    Returns:
        The expression — `''` when nothing post-fold was asked for — and its
        positional arguments.
    """

    clauses: list[str] = []
    args: list[Any] = []

    for name, bounds in query.filters.post_fold().items():

        expression = FOLDED_EXPRESSIONS[name]

        if (lower := bounds.get('min')) is not None:

            clauses.append(f'{expression} >= %s')
            args.append(int(lower))

        if (upper := bounds.get('max')) is not None:

            clauses.append(f'{expression} <= %s')
            args.append(int(upper))

    return ' AND '.join(clauses), args


def key_selection_sql(
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        record: RecordFilter | None = None,
) -> tuple[str, Sequence[Any]]:
    """
    The page's group keys, in key order, with the page bound applied.

    Four shapes, chosen by what the request asks for and not by which dataset
    it is:

    * a post-fold predicate — `GROUP BY … HAVING`, streaming through
      `GroupAggregate` over the key index, so the outer `LIMIT` stops the scan
      at the last qualifying key rather than after the whole scope is folded;
    * an `ORDER BY` on a stored column — the record ordered by that column and
      the surviving keys deduplicated. Folded columns never reach here: `guard`
      refuses them before the statement is built;
    * a narrow scope — the keys found through the source index behind an
      `OFFSET 0` fence and sorted afterwards, over the scope rather than the
      record;
    * anything else — `DISTINCT ON` over the collapse index, `LIMIT`ed, so the
      scan stops at the page.

    Which columns the key is built from comes from the request's grain and is
    never assumed here, so a key of one column pages exactly as a key of three
    does.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        record: A pre-built record filter, for a composition whose scope is a
            union of components rather than one query's own.

    Returns:
        The statement and its positional arguments.
    """

    predicate = record if record is not None else record_filter(query, resolved)
    where = [predicate.sql]
    args: list[Any] = list(predicate.args)
    key_names = page_keys(query)

    if cursor := _cursor_key(query.cursor, key_names):

        # Keyset paging. The fold key is the collapse index's leading column
        # set, so resuming after the last key returned is one index descent.
        where.append(
            f'({", ".join(f"r.{name}" for name in key_names)}) '
            f'> {key_tuple_sql(key_names)}',
        )
        args.extend(cursor)

    where_sql = ' AND '.join(where)
    keys = ', '.join(f'r.{name}' for name in key_names)
    having, having_args = having_sql(query)
    order = 'DESC' if query.order_descending else 'ASC'
    ordering = positions(key_names, order)
    grouping = positions(key_names)
    distinct_on = ', '.join(f'r.{name}' for name in key_names)
    column = query.order_column

    if having:

        lateral = REFERENCE_LATERAL if 'c.value' in having else ''
        sql = f"""SELECT {keys}
    FROM {record_source()} r
    {lateral}
    WHERE {where_sql}
    GROUP BY {grouping}
    HAVING {having}
    ORDER BY {ordering}
    LIMIT %s OFFSET %s"""
        args.extend([*having_args, query.limit, query.offset])

    elif column and column not in key_names:

        # A sort on a stored column cannot come from the collapse index, so the
        # record is ordered first and the surviving keys deduplicated after.
        sql = f"""SELECT k.{', k.'.join(key_names)}
    FROM (
      SELECT {keys}
      FROM {record_source()} r
      WHERE {where_sql}
      ORDER BY r.{column} {order} NULLS LAST
      LIMIT %s OFFSET %s
    ) k
    GROUP BY {grouping}
    ORDER BY {grouping}"""
        args.extend([query.limit, query.offset])

    elif resolved.record_share < NARROW_SHARE:

        # The narrow branch of the key selection. The collapse index does
        # not lead on `source_id`, so an ordered read of it finds a rare
        # resource by sweeping: `neuronchat` contributes 373 rows out of 14.7
        # million, and filling a hundred-key page means walking a quarter of
        # the index. The `OFFSET 0` fence stops the page bound from being
        # pushed into that scan, so the rows are found through the source
        # index — the same cardinality the `source` facet of
        # `facet_relation_bitmap` reports — and sorted afterwards, over the
        # narrow scope rather than the record.
        sql = f"""SELECT DISTINCT ON ({distinct_on}) {distinct_on}
    FROM (
      SELECT {keys}
      FROM {record_source()} r
      WHERE {where_sql}
      OFFSET 0
    ) r
    ORDER BY {ordering}
    LIMIT %s OFFSET %s"""
        args.extend([query.limit, query.offset])

    else:

        # `DISTINCT ON` rather than `DISTINCT`, because it has no hashed
        # implementation: the keys come back through `Unique` over sorted
        # input, which for a wide scope is an ordered read of the collapse
        # index with no sort at all. A `HashAggregate` here would be blocking
        # and would find every key in scope before returning the first.
        sql = f"""SELECT DISTINCT ON ({distinct_on}) {distinct_on}
    FROM {record_source()} r
    WHERE {where_sql}
    ORDER BY {ordering}
    LIMIT %s OFFSET %s"""
        args.extend([query.limit, query.offset])

    return sql, args


def key_estimate_sql(
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        record: RecordFilter | None = None,
) -> tuple[str, Sequence[Any]]:
    """
    The unbounded key statement, built to be **planned** and never run.

    `guard` reads the planner's row estimate off it, which is the cheap
    scope-aware cardinality the cost governor needs — an exact count of the
    keys in a scope is the full fold under another name.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        record: A pre-built record filter, for a composition.

    Returns:
        The statement and its positional arguments.
    """

    predicate = record if record is not None else record_filter(query, resolved)
    keys = ', '.join(f'r.{name}' for name in page_keys(query))

    sql = f"""SELECT DISTINCT {keys}
    FROM {record_source()} r
    WHERE {predicate.sql}"""

    return sql, list(predicate.args)


def key_count_sql(
        query: InteractionQuery,
        resolved: ResolvedScope,
        *,
        record: RecordFilter | None = None,
) -> tuple[str, Sequence[Any]]:
    """
    An exact count of the collapse keys in one scope — the reported `total`.

    This is the full fold under another name and is priced as one by `guard`
    before it runs — it is an explicit request, never a default.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        record: A pre-built record filter, for a composition.

    Returns:
        The statement and its positional arguments.
    """

    predicate = record if record is not None else record_filter(query, resolved)
    having, having_args = having_sql(query)
    lateral = REFERENCE_LATERAL if 'c.value' in having else ''
    key_names = page_keys(query)
    keys = ', '.join(f'r.{name}' for name in key_names)

    sql = f"""SELECT count(*)::bigint AS keys
    FROM (
      SELECT {keys}
      FROM {record_source()} r
      {lateral}
      WHERE {predicate.sql}
      GROUP BY {positions(key_names)}
      {f'HAVING {having}' if having else ''}
    ) folded"""

    return sql, [*predicate.args, *having_args]


def _uuids(values: Sequence[str]) -> list[str]:
    """
    Keep the values that are entity ids, dropping anything that is not one.

    Args:
        values: Candidate entity identifiers.

    Returns:
        The well-formed uuids, in order.
    """

    out: list[str] = []

    for value in values:

        try:

            out.append(str(_uuid.UUID(str(value))))

        except (ValueError, AttributeError, TypeError):

            continue

    return out


def encode_cursor(key: Sequence[Any]) -> str:
    """
    Encode one page key as the cursor that resumes after it.

    Args:
        key: The key columns of the last row of a page, in key order.

    Returns:
        An opaque cursor string.
    """

    payload = json.dumps([str(part) for part in key], separators = (',', ':'))

    return base64.urlsafe_b64encode(payload.encode('utf-8')).decode('ascii').rstrip('=')


def decode_cursor(
        cursor: str | None,
        keys: Sequence[str] = GROUP_KEYS,
) -> list[Any] | None:
    """
    Decode a page cursor into the page key it resumes after.

    The key list is passed in rather than assumed, because the arity and the
    column types of the key are the grain's to decide. A cursor minted at one
    grain therefore fails its arity check at the other and is dropped, which is
    the honest outcome: it names a key the new grain does not have.

    Args:
        cursor: The opaque cursor a previous page returned, or None.
        keys: The key columns the cursor is read against, in key order.

    Returns:
        The key parts, coerced to the types their columns compare at, or None
        when there is no usable cursor. A cursor that does not decode is
        ignored rather than refused: it can only cost a caller the first page,
        and refusing turns a stale bookmark into an error.
    """

    if not cursor:

        return None

    try:

        padded = cursor + '=' * (-len(cursor) % 4)
        parts = json.loads(base64.urlsafe_b64decode(padded.encode('ascii')))

    except (ValueError, TypeError):

        return None

    if not isinstance(parts, list) or len(parts) != len(keys):

        return None

    try:

        return [key_value(name, part) for name, part in zip(keys, parts)]

    except (KeyError, ValueError, TypeError):

        return None


_cursor_key = decode_cursor
