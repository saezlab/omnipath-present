"""
Discovery — what a scope can still be asked for, and how much of it there is.

Two questions about a query, answered without running it. One says which values
each parameter can still take under the current scope. The other says how much
the scope holds. Neither returns an interaction, and that is the whole point of
both: a caller narrowing a filter should not have to page through rows to find
out whether the next narrowing leaves anything.

**Reachable means reachable, not merely known.** A value is reported when the
current scope would return rows for it. So narrowing to one resource leaves one
resource in the `resources` list, not thirty-five with thirty-four zeroes, and
the class list of that resource holds the one class it publishes. Classical
faceted search drops each dimension's own filter so a caller can widen. The
contract asks for "the possible values **given the current filter scope**", and
a list carrying values the scope excludes is not that.

**Three sources answer, and each is named on the response.**

*The roaring bitmaps* (`facet_relation_bitmap`, the `facets.py` pattern) answer
`resources`, `organisms` and `entity_types` by intersection — 35, 9,623 and 20
values over 14,686,403 relation-source pairs, with no scan of the record at
all.

*The record's stored columns* answer `interaction_classes`, `datasets` and
`curation_flags`, and that is a measured decision rather than a preference.
Rolling the `predicate` facet up to the class vocabulary through
`vocab_relation_predicate` reaches **four** of the seven populated classes and
knows nothing of `ligand_receptor`, `orthosteric` or `allosteric` — 103,322
record rows, including every ligand-receptor one — while disagreeing with the
record on the four it does reach (`other` 13,323,701 against 13,623,743). A
per-class count that silently omits a whole class is the quietly wrong number
this cycle keeps refusing to ship, so these come from one grouped count of
stored columns instead: 602 ms unscoped, cached per scope for the life of the
process, and milliseconds once a resource filter has narrowed it.

*The derive's own records* answer the rest. The `source_count` histogram is the
distribution a post-fold parameter has instead of a value list, and its nine
levels sum to the folded key count — which is how `/interactions/stats` answers
the unscoped total exactly without folding fourteen million record rows. The
table that used to answer it with a `count(*)` was removed from the build.

**Nothing here folds a scope.** A statistic that would need the fold is either
read from something the derive recorded, or reported as the guardrail's
estimate and labelled as one, or — for an exact count — asked for explicitly
and priced before it runs. That is the posture these two endpoints take by
definition, in asking for counts *without* returning rows.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import Any

from ..graph import SEARCH_SCHEMA
from . import annotate, fold, params, project, scope as _scope
from .guard import Estimate, histogram
from .params import InteractionQuery
from .scope import LICENSE_LEVELS, ResolvedScope
from .select import RECORD_TABLE, record_filter, record_source

_log = logging.getLogger(__name__)

# The two questions, as `engine.run` dispatches on them.
PARAMETER_VALUES = 'parameter_values'
STATISTICS = 'statistics'
QUESTIONS = (PARAMETER_VALUES, STATISTICS)

# The facets that carry a scope term of this parameter surface. `predicate` is
# deliberately absent: it is the fourth facet of the table and it answers none
# of these parameters — see the module docstring for what it omits.
SOURCE_FACET = 'source'
TAXONOMY_FACET = 'taxonomy_id'
ENTITY_TYPE_FACET = 'participant_type'

# The taxonomy facet carries 9,623 values. A caller reading a parameter list
# does not want them all, and a response carrying them all is not a list of
# reachable values but a copy of the NCBI taxonomy. The commonest are reported
# and the answer says how many were left out.
MAX_REPORTED_VALUES = 50

# How many taxonomy bitmaps the intersection considers at all. Every candidate
# costs one `rb_and` and one `rb_cardinality` against a scope bitmap over 11.2
# million relations, so considering all 9,623 of them costs **5,181 ms** for an
# organism-scoped request — five times the one-second budget, to produce a list
# that is then
# truncated to fifty. The commonest two hundred are considered instead, which
# is four times the reported list and is measured below. The other two facets
# carry 35 and 20 values and are taken whole.
MAX_TAXONOMY_CANDIDATES = 200

# `{schema: {signature: profile}}`. The grouped count over the record's stored
# columns, kept per scope for the life of the process: the grain is the build's
# and changes only when the build does, which is the same reason the class
# vocabulary, the native taxon set and the annotation index are cached.
_PROFILE_CACHE: dict[str, dict[str, Any]] = {}


# ── The reachable values ────────────────────────────────────────────────────


def parameter_values(
        query: InteractionQuery,
        resolved: ResolvedScope,
        conn,
) -> dict[str, Any]:
    """
    Every parameter of the query surface, and what it can still be asked for.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection.

    Returns:
        The parameter groups, one entry per parameter saying what kind of
        answer it gives and giving it, and the scope those answers hold under.
        No interaction row, at any width.
    """

    facets = _facet_counts(resolved, conn)
    profile = _profile(query, resolved, conn)
    entries: dict[str, dict[str, Any]] = {}

    for group, names in params.PARAMETER_GROUPS.items():

        for name in names:

            entries[name] = {
                'group': group,
                **_entry(name, query, resolved, conn, facets, profile),
            }

    return {
        'fact_table': RECORD_TABLE,
        'scope': _scope_block(resolved),
        'parameter_groups': {
            group: list(names) for group, names in params.PARAMETER_GROUPS.items()
        },
        'parameters': entries,
        'folded_columns': sorted(params.FOLDED_COLUMNS),
    }


def _entry(
        name: str,
        query: InteractionQuery,
        resolved: ResolvedScope,
        conn,
        facets: dict[str, dict[str, int]],
        profile: dict[str, Any],
) -> dict[str, Any]:
    """
    One parameter's reachable values, in the form that parameter has.

    Args:
        name: The parameter.
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection.
        facets: The scoped roaring-bitmap counts.
        profile: The grouped count over the record's stored columns.

    Returns:
        The entry, always carrying `kind`.
    """

    if name in params.PARAMETER_GROUPS['post_fold']:

        return _distribution(name, conn)

    builder = _ENTRIES.get(name)

    if builder is None:  # pragma: no cover - every parameter has a builder

        return {'kind': 'free'}

    return builder(query, resolved, conn, facets, profile)


def _counted(counts: dict[str, Any], key: str = 'value') -> dict[str, Any]:
    """
    A value-and-count list, commonest first, truncated where it is very long.

    Args:
        counts: `{value: count}`.
        key: What to call the value in each entry.

    Returns:
        The `values` list, and — where it was truncated — how many were left.
    """

    ordered = sorted(counts.items(), key = lambda pair: (-pair[1], pair[0]))
    kept = ordered[:MAX_REPORTED_VALUES]
    entry: dict[str, Any] = {
        'kind': 'values',
        'values': [{key: value, 'count': int(count)} for value, count in kept],
    }

    if len(ordered) > len(kept):

        entry['reported'] = len(kept)
        entry['reachable'] = len(ordered)

    return entry


def _words(values: Any, note: str | None = None, **extra: Any) -> dict[str, Any]:
    """
    A closed vocabulary — the words a parameter accepts, without counts.

    Args:
        values: The accepted words.
        note: What a caller should know about them.
        extra: Anything else the entry carries.

    Returns:
        The entry.
    """

    entry: dict[str, Any] = {
        'kind': 'values',
        'values': [{'value': str(value)} for value in values],
    }

    if note:

        entry['note'] = note

    return {**entry, **extra}


def _distribution(name: str, conn) -> dict[str, Any]:
    """
    A post-fold parameter's answer: its distribution, never a value list.

    `source_count` is not drawn from a vocabulary. It is a number the fold
    produces, and reporting `[1, 2, 3, …]` as though those were values to pick
    from would invite a caller to pick 9 and meet the fold. The distribution is
    the honest answer, and for `source_count` the derive records it.

    Args:
        name: The post-fold parameter.
        conn: An open connection.

    Returns:
        The entry.
    """

    entry: dict[str, Any] = {
        'kind': 'histogram',
        'note': (
            'a post-fold value does not exist until its group is folded, so it '
            'has a distribution rather than a set of reachable values. It may '
            'be filtered on and may not be sorted on'
        ),
    }

    if name != 'source_count':

        return {
            **entry,
            'histogram': None,
            'source': f'no distribution is recorded for {name}',
        }

    levels, source = histogram(conn)

    return {
        **entry,
        'histogram': [
            {'source_count': level, 'keys': int(count)}
            for level, count in sorted(levels.items())
        ],
        'source': source,
    }


# ── The statistics ──────────────────────────────────────────────────────────


def statistics(
        query: InteractionQuery,
        resolved: ResolvedScope,
        estimate: Estimate,
        conn,
) -> dict[str, Any]:
    """
    Summary counts for a scope, and no interaction.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        estimate: What the cost governor priced this scope at.
        conn: An open connection.

    Returns:
        The scope's total with its provenance, the per-resource, per-type,
        per-dataset and per-organism counts, and the recorded distribution.
    """

    facets = _facet_counts(resolved, conn)
    profile = _profile(query, resolved, conn)
    total, is_estimate, source = _total(query, resolved, estimate, conn)
    levels, histogram_source = histogram(conn)

    answer: dict[str, Any] = {
        'fact_table': RECORD_TABLE,
        'scope': _scope_block(resolved),
        'total': int(total),
        'total_is_estimate': is_estimate,
        'total_source': source,
        'total_unit': 'collapse_keys',
        # Every block below counts record rows, not folded interactions. The
        # two differ by the fold, at mean 1.0271 rows per key, and a count that
        # does not say which it is invites a caller to add the wrong two
        # numbers together.
        'counts_unit': 'record_rows',
        'by_resource': [
            {'resource': value, 'count': int(count)}
            for value, count in sorted(
                facets.get(SOURCE_FACET, {}).items(),
                key = lambda pair: (-pair[1], pair[0]),
            )
        ],
        'by_interaction_type': [
            {
                'interaction_type': slug,
                'interaction_type_label': profile['class_labels'].get(slug),
                'count': int(count),
            }
            for slug, count in sorted(
                profile['classes'].items(), key = lambda pair: (-pair[1], pair[0]),
            )
        ],
        'by_dataset': [
            {'dataset': name, 'count': int(count)}
            for name, count in sorted(
                profile['datasets'].items(), key = lambda pair: (-pair[1], pair[0]),
            )
        ],
        'by_organism': [
            {'organism': value, 'count': int(count)}
            for value, count in sorted(
                facets.get(TAXONOMY_FACET, {}).items(),
                key = lambda pair: (-pair[1], pair[0]),
            )[:MAX_REPORTED_VALUES]
        ],
        'source_count_distribution': [
            {'source_count': level, 'keys': int(count)}
            for level, count in sorted(levels.items())
        ],
        'sources': {
            'by_resource': 'facet_relation_bitmap',
            'by_organism': 'facet_relation_bitmap',
            'by_interaction_type': f'{RECORD_TABLE}, grouped on the stored class',
            'by_dataset': 'network_registry over the same grouped count',
            'source_count_distribution': histogram_source,
        },
        'estimate': estimate.as_dict(),
    }

    if estimate.at_least and not query.exact_total and is_estimate:

        answer['total_is_lower_bound'] = True

    if resolved.organism.asked:

        answer['organism'] = resolved.organism.as_dict()

    return answer


def _total(
        query: InteractionQuery,
        resolved: ResolvedScope,
        estimate: Estimate,
        conn,
) -> tuple[int, bool, str]:
    """
    The interactions in a scope, from a recorded count wherever there is one.

    Three answers, in this order, and none of them a quiet fold.

    * An **exact** count was asked for explicitly. It is the fold of the scope,
      the cost governor has already priced it, and it runs because the caller
      said so.
    * The scope restricts **nothing**. Then the number is the sum of the
      derive's `source_count` histogram — 14,291,204 on this build, the folded
      key count itself — read from nine rows rather than found by folding
      14,686,404.
    * Anything else is the guardrail's estimate, labelled as one.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        estimate: The guardrail's estimate.
        conn: An open connection.

    Returns:
        The total, whether it is an estimate, and where it came from.
    """

    if query.exact_total:

        return (
            fold.count_groups(query, resolved, conn = conn),
            False,
            'the fold of this scope, requested explicitly and priced first',
        )

    predicate = record_filter(query, resolved)

    if predicate.sql == 'true' and not query.filters.post_fold():

        levels, source = histogram(conn)

        return sum(levels.values()), False, source

    if estimate.exact:

        return estimate.qualifying_keys, False, estimate.source

    return estimate.qualifying_keys, True, estimate.source


# ── The two ways of counting ────────────────────────────────────────────────


def _facet_counts(resolved: ResolvedScope, conn) -> dict[str, dict[str, int]]:
    """
    Scoped facet counts by roaring-bitmap intersection (the `facets.py` shape).

    Each scope term the bitmaps can express becomes one `MATERIALIZED` CTE, the
    terms are `AND`ed together, and every facet value is counted against the
    result. Nothing reads the record: the answer comes from 35 + 9,623 + 20
    stored bitmaps over 14,686,403 relation-source pairs.

    Args:
        resolved: The resolved scope.
        conn: An open connection.

    Returns:
        `{facet name: {value: scoped count}}`, zero counts dropped — a value
        the scope cannot reach is not a reachable value.
    """

    args: list[Any] = []
    ctes: list[str] = []
    parts: list[str] = []
    joins: list[str] = []

    def restrict(name: str, facet: str, values: list[str]) -> None:

        ctes.append(f"""
            {name} AS MATERIALIZED (
                SELECT COALESCE(rb_or_agg(relation_bitmap), rb_build(ARRAY[]::integer[]))
                       AS bitmap
                FROM {SEARCH_SCHEMA}.facet_relation_bitmap
                WHERE facet_name = '{facet}' AND facet_value = ANY(%s::text[])
            )
        """)
        args.append(values)
        parts.append(f'{name}.bitmap')
        joins.append(f'CROSS JOIN {name}')

    ctes.append(f"""
        scope_base AS MATERIALIZED (
            SELECT rb_or_agg(relation_bitmap) AS bitmap
            FROM {SEARCH_SCHEMA}.facet_relation_bitmap
            WHERE facet_name = '{SOURCE_FACET}'
        )
    """)
    parts.append('scope_base.bitmap')
    joins.append('CROSS JOIN scope_base')

    if admitted := _admitted_resources(resolved, conn):

        restrict('source_scope', SOURCE_FACET, admitted)

    if taxa := list(resolved.organism.taxa):

        restrict('taxonomy_scope', TAXONOMY_FACET, [str(taxon) for taxon in taxa])

    if names := _entity_type_names(resolved, conn):

        restrict('entity_type_scope', ENTITY_TYPE_FACET, names)

    chained = parts[0]

    for part in parts[1:]:

        chained = f'rb_and({chained}, {part})'

    # The candidate set is bounded before the intersection rather than after
    # it, because the cost is per candidate and the truncation is per answer.
    sql = f"""
        WITH {', '.join(ctes)}
        SELECT f.facet_name, f.facet_value,
               rb_cardinality(rb_and(f.relation_bitmap, {chained})) AS scoped_count
        FROM (
            SELECT facet_name, facet_value, relation_bitmap
            FROM {SEARCH_SCHEMA}.facet_relation_bitmap
            WHERE facet_name = ANY(%s::text[])
            UNION ALL
            (
                SELECT facet_name, facet_value, relation_bitmap
                FROM {SEARCH_SCHEMA}.facet_relation_bitmap
                WHERE facet_name = %s
                ORDER BY relation_count DESC
                LIMIT %s
            )
        ) f
        {' '.join(joins)}
        WHERE rb_cardinality(rb_and(f.relation_bitmap, {chained})) > 0
    """
    args.extend([
        [SOURCE_FACET, ENTITY_TYPE_FACET],
        TAXONOMY_FACET,
        MAX_TAXONOMY_CANDIDATES,
    ])

    counts: dict[str, dict[str, int]] = {}

    for row in conn.execute(sql, args).fetchall():

        counts.setdefault(row['facet_name'], {})[row['facet_value']] = int(
            row['scoped_count'] or 0,
        )

    # An intersection alone would report every resource that co-contributes a
    # relation the scope reaches — scoping to `connectomedb2025` answers with
    # ten names, because nine other resources also publish some of its 44,455
    # relations. Those nine are **not** reachable: the fold recomputes every
    # summary over the resources the scope kept, so no row of that query names
    # one of them. Reporting them would be the same scope leak the fold rules
    # exist to prevent, wearing a facet's clothes. The same holds for an entity-type filter. It does not hold for
    # the taxonomy, where a relation genuinely has two endpoints and the second
    # one's taxon is reachable in the answer.
    if admitted:

        counts[SOURCE_FACET] = {
            value: count for value, count in counts.get(SOURCE_FACET, {}).items()
            if value in set(admitted)
        }

    if names:

        counts[ENTITY_TYPE_FACET] = {
            value: count
            for value, count in counts.get(ENTITY_TYPE_FACET, {}).items()
            if value in set(names)
        }

    return counts


def _admitted_resources(resolved: ResolvedScope, conn) -> list[str]:
    """
    The resource names the scope admits, exclusions applied.

    Args:
        resolved: The resolved scope.
        conn: An open connection.

    Returns:
        The names, or an empty list when the scope restricts nothing — which is
        not the same as admitting nothing, and is why the caller tests it as a
        presence rather than as a set.
    """

    excluded = set(resolved.excluded_resources)

    if resolved.source_ids is None and not excluded:

        return []

    names = (
        set(resolved.resources) if resolved.source_ids is not None
        else set(_scope._source_ids_by_name(conn))
    )

    return sorted(names - excluded)


def _entity_type_names(resolved: ResolvedScope, conn) -> list[str]:
    """
    The vocabulary names of the entity types the scope admits.

    Args:
        resolved: The resolved scope.
        conn: An open connection.

    Returns:
        The names as the facet carries them (`Protein:MI:0326`), or an empty
        list when no entity-type filter was asked for.
    """

    if not resolved.entity_type_ids:

        return []

    rows = conn.execute(
        f"""
        SELECT name FROM {SEARCH_SCHEMA}.vocab_entity_type
        WHERE entity_type_id = ANY(%s::bigint[])
        """,
        (list(resolved.entity_type_ids),),
    ).fetchall()

    return sorted(row['name'] for row in rows)


def _profile(
        query: InteractionQuery,
        resolved: ResolvedScope,
        conn,
) -> dict[str, Any]:
    """
    One grouped count over the record's stored columns, per scope.

    Class, dataset and curation-flag counts come from here rather than from the
    `predicate` facet, because that facet rolls up to four of the seven
    populated classes and omits every ligand-receptor row. **Measured on dev4
    2026-08-24**: the grouped count is 602 ms unscoped and the distinct flag
    scan 434 ms, both once per scope per process. Under a single-resource scope
    they are milliseconds, because the source index bounds them.

    Args:
        query: The parsed request.
        resolved: The resolved scope.
        conn: An open connection.

    Returns:
        Per-class counts by slug, per-dataset counts by preset name, the class
        labels, the reachable curation flags, and the observed bounds of the
        stored range columns.
    """

    # The class filter is left out on purpose. A caller who has narrowed to one
    # class is not helped by being told that class holds what they asked for.
    # The useful answer is which classes the *rest* of the scope reaches, and
    # the reachable list meets the filter afterwards.
    unfiltered = replace(resolved, interaction_class_ids = [])
    predicate = record_filter(query, unfiltered)
    signature = f'{predicate.sql}|{predicate.args!r}'
    cache = _PROFILE_CACHE.setdefault(SEARCH_SCHEMA, {})

    if signature in cache:

        return cache[signature]

    rows = conn.execute(
        f"""
        SELECT r.interaction_class_id, r.source_id, count(*)::bigint AS records,
               min(r.affinity) AS affinity_min, max(r.affinity) AS affinity_max,
               min(r.pchembl) AS pchembl_min, max(r.pchembl) AS pchembl_max,
               min(r.score) AS score_min, max(r.score) AS score_max
        FROM {record_source()} r
        WHERE {predicate.sql}
        GROUP BY 1, 2
        """,
        predicate.args,
    ).fetchall()
    flags = conn.execute(
        f"""
        SELECT DISTINCT unnest(r.curation_flags) AS flag
        FROM {record_source()} r
        WHERE {predicate.sql}
        """,
        predicate.args,
    ).fetchall()

    vocabulary = _classes(conn)
    by_id = {
        identifier: name
        for name, identifier in _scope._source_ids_by_name(conn).items()
    }
    admitted = (
        {int(one) for one in resolved.interaction_class_ids}
        if resolved.interaction_class_ids else None
    )
    classes: dict[str, int] = {}
    datasets: dict[str, int] = {}
    bounds: dict[str, dict[str, Any]] = {}
    registry = _scope.dataset_registry(conn)

    for row in rows:

        identifier = int(row['interaction_class_id'])
        slug = vocabulary.get(identifier, {}).get('name')
        records = int(row['records'])

        if slug and (admitted is None or identifier in admitted):

            classes[slug] = classes.get(slug, 0) + records

        for name in _scope.dataset_tags(
            [by_id.get(int(row['source_id']))], slug, registry,
        ):

            datasets[name] = datasets.get(name, 0) + records

        for column in params.PARAMETER_GROUPS['range']:

            _widen(bounds, column, row)

    profile = {
        'classes': classes,
        'class_labels': {
            entry['name']: entry['label'] for entry in vocabulary.values()
        },
        'datasets': datasets,
        'curation_flags': sorted(row['flag'] for row in flags if row['flag']),
        'bounds': bounds,
    }
    cache[signature] = profile

    _log.info(
        'the scope profile covers %d classes, %d datasets and %d curation flags',
        len(classes), len(datasets), len(profile['curation_flags']),
    )

    return profile


def _widen(bounds: dict[str, dict[str, Any]], column: str, row: dict[str, Any]) -> None:
    """
    Fold one grouped row's range into the running bounds of a stored column.

    Args:
        bounds: The bounds so far, modified in place.
        column: The stored range column.
        row: One grouped row.

    Returns:
        None.
    """

    entry = bounds.setdefault(column, {'min': None, 'max': None})

    for edge, better in (('min', min), ('max', max)):

        value = row.get(f'{column}_{edge}')

        if value is None:

            continue

        entry[edge] = value if entry[edge] is None else better(entry[edge], value)


def _classes(conn) -> dict[int, dict[str, str]]:
    """
    The interaction-class vocabulary, by id.

    Args:
        conn: An open connection.

    Returns:
        `{id: {'name': slug, 'label': display label}}`.
    """

    rows = conn.execute(
        f"""
        SELECT interaction_class_id, name, label
        FROM {SEARCH_SCHEMA}.vocab_interaction_class
        """,
    ).fetchall()

    return {
        int(row['interaction_class_id']): {
            'name': row['name'], 'label': row['label'],
        }
        for row in rows
    }


def _scope_block(resolved: ResolvedScope) -> dict[str, Any]:
    """
    What the filters resolved to, said out loud beside the answer.

    Args:
        resolved: The resolved scope.

    Returns:
        The resources, exclusions, presets and organism the counts hold under.
    """

    block: dict[str, Any] = {
        'resources': list(resolved.resources),
        'excluded_resources': list(resolved.excluded_resources),
        'datasets': list(resolved.preset_names),
        'record_share': round(resolved.record_share, 6),
        'empty': resolved.empty,
    }

    if resolved.organism.asked:

        block['organism'] = resolved.organism.as_dict()

    return block


# ── One builder per parameter ───────────────────────────────────────────────
#
# A mapping rather than a chain of branches, because the thing that must not
# drift is the claim that every parameter of the surface is covered — and a
# mapping can be checked against `PARAMETER_GROUPS` where a chain cannot.


def _resource_values(query, resolved, conn, facets, profile):

    return {
        **_counted(facets.get(SOURCE_FACET, {}), 'value'),
        'source': 'facet_relation_bitmap',
        'unit': 'record_rows',
    }


def _dataset_values(query, resolved, conn, facets, profile):

    return {
        **_counted(profile['datasets'], 'value'),
        'source': 'network_registry',
        'unit': 'record_rows',
    }


def _license_values(query, resolved, conn, facets, profile):

    return _words(
        [
            f'{dimension}:{level}'
            for dimension, levels in LICENSE_LEVELS.items()
            for level in levels
        ],
        note = (
            'a minimum level per dimension, resolved to a resource set before '
            'anything touches the interaction tables; a resource whose license '
            'is unknown is excluded rather than admitted'
        ),
    )


def _class_values(query, resolved, conn, facets, profile):

    return {
        **_counted(profile['classes'], 'value'),
        'source': RECORD_TABLE,
        'unit': 'record_rows',
        'labels': profile['class_labels'],
        'note': (
            'filtering is by slug; the display label is output-side and is '
            'never a query value'
        ),
    }


def _organism_values(query, resolved, conn, facets, profile):

    return {
        **_counted(facets.get(TAXONOMY_FACET, {}), 'value'),
        'source': 'facet_relation_bitmap',
        'unit': 'record_rows',
        'note': (
            'a taxon id, a name or a mnemonic all reach the same taxon; a '
            'non-native one is served by orthology on demand. The build holds '
            f'9,623 taxa and the commonest {MAX_TAXONOMY_CANDIDATES} are '
            'counted under the scope, so a rare one is filterable without '
            'being listed here'
        ),
    }


def _entity_type_values(query, resolved, conn, facets, profile):

    return {
        **_counted(facets.get(ENTITY_TYPE_FACET, {}), 'value'),
        'source': 'facet_relation_bitmap',
        'unit': 'record_rows',
        'note': 'the prefix alone answers too — `protein` reaches `Protein:MI:0326`',
    }


def _annotation_values(query, resolved, conn, facets, profile):

    index = annotate.index(conn)
    counts = {category: 0 for category in annotate.categories()}

    for entry in index.values():

        for category in entry:

            counts[category] = counts.get(category, 0) + 1

    return {
        'kind': 'values',
        'values': [
            {'value': category, 'count': counts.get(category, 0)}
            for category in annotate.categories()
        ],
        'source': 'the per-entity annotation index',
        'unit': 'entities',
        'note': (
            'adding a category reaches the summary array, the by-resource '
            'object and the requestable boolean, and moves no default column'
        ),
    }


def _curation_flag_values(query, resolved, conn, facets, profile):

    return _words(
        profile['curation_flags'],
        note = 'matched as a set: a row qualifies if it carries any flag named',
        source = RECORD_TABLE,
    )


def _entity_values(query, resolved, conn, facets, profile):

    return {
        'kind': 'free',
        'note': (
            'an entity id, matched on either endpoint; the value space is the '
            'entity table and is not enumerated here — reach it through '
            '/entities or /relations/search'
        ),
    }


def _flag_values(note: str):

    def builder(query, resolved, conn, facets, profile):

        return {'kind': 'flag', 'values': [True, False], 'note': note}

    return builder


def _attribute_filter_values(query, resolved, conn, facets, profile):

    return {
        'kind': 'free',
        'note': (
            'a predicate on a key of the record attribute document. No index '
            'reaches it, so it is applied to every row the rest of the request '
            'admits and the cost governor refuses it past the bound below. '
            'Narrow with `resources`, `datasets` or `license` first'
        ),
        'maximum_rows_scanned': params.MAX_LONG_TAIL_ROWS,
    }


def _range_values(column: str):

    def builder(query, resolved, conn, facets, profile):

        bounds = profile['bounds'].get(column) or {'min': None, 'max': None}

        return {
            'kind': 'range',
            'observed': {
                'min': None if bounds['min'] is None else float(bounds['min']),
                'max': None if bounds['max'] is None else float(bounds['max']),
            },
            'source': RECORD_TABLE,
            'note': (
                'a stored column of the record: it reaches an index, and it '
                'may be sorted on as well as filtered on'
            ),
        }

    return builder


def _collapse_values(query, resolved, conn, facets, profile):

    return _words(
        params.COLLAPSE_MODES,
        note = (
            'how far to collapse within this query\'s own scope; a '
            'single-resource scope collapses nothing whatever the value says'
        ),
        default = resolved.collapse_mode or 'endpoints',
    )


def _by_resource_values(query, resolved, conn, facets, profile):

    return {
        'kind': 'flag',
        'values': [True, False],
        'also_accepts': 'resources',
        'note': (
            'true asks for every in-scope resource\'s own attributes; a list '
            'of names asks for the same thing restricted to those names'
        ),
    }


def _attribute_values(query, resolved, conn, facets, profile):

    return _words(
        sorted(project.HOT_COLUMNS) + sorted(annotate.FULL_NAMES),
        note = (
            'these are the names that are already on the row or that name an '
            'annotation layer; any other name is read from the record '
            'attribute document and comes back null where the build carries '
            'nothing under it, never as an error and never dropping the row'
        ),
        open = True,
        maximum = params.MAX_ATTRIBUTES,
    )


def _view_values(query, resolved, conn, facets, profile):

    return _words(
        ('gene', 'protein'),
        note = (
            'a query-time projection off each entity\'s canonical identifier '
            'type, not two materialised copies'
        ),
    )


def _annotation_layer_values(query, resolved, conn, facets, profile):

    return _words(
        sorted(annotate.FULL_NAMES)
        + [
            f'{annotate.LAYER}:{annotate.BOOLEAN_PREFIX}{category}'
            for category in annotate.categories()
        ],
        note = (
            'the default is a compact per-node summary array; these add the '
            'by-resource object or the named booleans'
        ),
    )


def _limit_values(query, resolved, conn, facets, profile):

    return {
        'kind': 'bound',
        'default': params.DEFAULT_LIMIT,
        'maximum': params.MAX_LIMIT,
    }


def _offset_values(query, resolved, conn, facets, profile):

    return {
        'kind': 'bound',
        'default': 0,
        'maximum': params.MAX_OFFSET,
        'note': (
            'an offset walks the keys it skips, so a deeper page is refused '
            'in favour of the cursor each page returns'
        ),
    }


def _cursor_values(query, resolved, conn, facets, profile):

    return {
        'kind': 'free',
        'note': (
            'opaque, and returned with each full page; it resumes after that '
            'page\'s last collapse key in one index descent'
        ),
    }


def _order_by_values(query, resolved, conn, facets, profile):

    return _words(
        sorted(params.SORTABLE_COLUMNS),
        note = (
            'a stored column, optionally prefixed with `-` for descending. A '
            'folded value may be filtered on and not sorted on: choosing which '
            'key sorts first means folding every key in scope'
        ),
        refused = sorted(params.FOLDED_COLUMNS),
    )


_ENTRIES = {
    'resources': _resource_values,
    'exclude_resources': _resource_values,
    'datasets': _dataset_values,
    'license': _license_values,
    'interaction_classes': _class_values,
    'organisms': _organism_values,
    'entities': _entity_values,
    'entity_types': _entity_type_values,
    'entity_annotations': _annotation_values,
    'curation_flags': _curation_flag_values,
    'sign': _flag_values(
        'true keeps the rows some in-scope resource signs, false the rows none '
        'does; null sign is the norm at about 2.6% signed',
    ),
    'direction': _flag_values('whether any in-scope resource asserts direction'),
    'attribute_filters': _attribute_filter_values,
    'affinity': _range_values('affinity'),
    'pchembl': _range_values('pchembl'),
    'score': _range_values('score'),
    'collapse': _collapse_values,
    'by_resource': _by_resource_values,
    'include_outofscope_signdir': _flag_values(
        'surfaces sign and direction from resources outside the queried scope; '
        'refused with a collapse mode that groups on those columns',
    ),
    'attributes': _attribute_values,
    'view': _view_values,
    'annotation_layer': _annotation_layer_values,
    'limit': _limit_values,
    'offset': _offset_values,
    'cursor': _cursor_values,
    'order_by': _order_by_values,
}


def forget() -> None:
    """
    Drop the cached scope profiles so the next read sees a newly built one.

    Returns:
        None.
    """

    _PROFILE_CACHE.clear()
