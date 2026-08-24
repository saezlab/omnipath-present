"""
The parameter model of the general interactions query (T020h, contracts §1a).

Every parameter is optional and they combine freely; each contributes one SQL
fragment downstream, so the parameter count grows without the statement count
following it. The groups below are the contract's own seven, and they are data
rather than prose because the guardrail, the engine and the parameter-values
endpoint all have to agree on which group a name belongs to.

**Post-fold is a group of its own, and that is not cosmetic.** A range on
`affinity` is a stored column of the record and reaches an index; a range on
`source_count` does not exist until its group is folded, so it is a `HAVING`
and it is priced from the `source_count` histogram. The two look alike in a
query string and are not alike underneath, which is exactly why the contract
names them apart and `guard` treats them apart.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# contracts §1a, the seven groups. Kept as one mapping so nothing downstream
# has to re-derive which stage owns a parameter.
PARAMETER_GROUPS: dict[str, tuple[str, ...]] = {
    'scope': ('resources', 'exclude_resources', 'datasets', 'license'),
    'selection': (
        'interaction_classes',
        'organisms',
        'entities',
        'entity_types',
        'entity_annotations',
        'curation_flags',
        'sign',
        'direction',
    ),
    'range': ('affinity', 'pchembl', 'score'),
    'post_fold': (
        'source_count',
        'reference_count',
        'sign_source_count',
        'direction_source_count',
    ),
    'shape': ('collapse', 'by_resource', 'include_outofscope_signdir'),
    'projection': ('attributes', 'view', 'annotation_layer'),
    'paging': ('limit', 'offset', 'cursor', 'order_by'),
}

# The values that do not exist before the fold produces them. Sorting on one of
# these means folding every key in scope and then sorting — no page bound, no
# index, no tail to degrade into — so `guard` refuses it (contracts §1b).
# `affinity`, `pchembl` and `score` are deliberately absent: they are stored
# columns of the record and must stay sortable, or the guardrail becomes a
# blanket ban rather than a targeted one.
FOLDED_COLUMNS: frozenset[str] = frozenset({
    'sources',
    'source_count',
    'sign_source_count',
    'direction_source_count',
    'reference_count',
    'references',
    'is_directed',
    'is_stimulation',
    'is_inhibition',
})

# Stored columns of the record an `ORDER BY` may name. The collapse key columns
# are here because the collapse index already provides that order.
SORTABLE_COLUMNS: frozenset[str] = frozenset({
    'subject_entity_id',
    'object_entity_id',
    'interaction_class_id',
    'affinity',
    'pchembl',
    'score',
})

COLLAPSE_MODES = ('none', 'assertion', 'endpoints')

# The paging bounds. `MAX_LIMIT` matches `graph._limit`'s existing cap so the
# two surfaces do not disagree; `MAX_OFFSET` is the depth past which keyset
# paging is the only affordable answer (`OFFSET` walks the keys it skips).
DEFAULT_LIMIT = 50
MAX_LIMIT = 500
MAX_OFFSET = 10_000
MAX_ATTRIBUTES = 32


def _strings(value: Any) -> list[str]:
    """
    Normalize a comma-separated string or a sequence into a list of values.

    Args:
        value: A comma-separated string, a sequence, or None.

    Returns:
        The non-empty values, in order, without duplicates.
    """

    if value is None:

        items: list[Any] = []

    elif isinstance(value, str):

        items = value.split(',')

    elif isinstance(value, (list, tuple, set, frozenset)):

        items = list(value)

    else:

        items = [value]

    seen: set[str] = set()
    out: list[str] = []

    for item in items:

        text = str(item).strip()

        if text and text not in seen:

            seen.add(text)
            out.append(text)

    return out


def _bounds(value: Any) -> dict[str, Any] | None:
    """
    Normalize a range or post-fold parameter into `{'min': …, 'max': …}`.

    Args:
        value: A mapping with `min`/`max` (or `gte`/`lte`), or a bare scalar
            read as a minimum.

    Returns:
        The bounds that were given, or None when the parameter is absent.
    """

    if value is None:

        return None

    if isinstance(value, dict):

        pairs = {
            'min': value.get('min', value.get('gte', value.get('minimum'))),
            'max': value.get('max', value.get('lte', value.get('maximum'))),
        }

    else:

        pairs = {'min': value, 'max': None}

    out = {name: bound for name, bound in pairs.items() if bound is not None}

    return out or None


def _flag(value: Any) -> bool | None:
    """
    Normalize a tri-state flag: True, False, or None for "not asked".

    Args:
        value: A boolean, a boolean-ish string, or None.

    Returns:
        The flag, or None when the parameter is absent.
    """

    if value is None:

        return None

    if isinstance(value, str):

        lowered = value.strip().lower()

        if lowered in ('', 'null', 'none', 'any'):

            return None

        return lowered in ('1', 'true', 'yes', 'on')

    return bool(value)


@dataclass
class Filters:
    """Every filter of contracts §1a, grouped as the contract groups them."""

    # Scope — collapsed to one `source_id` set by `scope.resolve`, before
    # anything touches the interaction tables (R20).
    resources: list[str] = field(default_factory = list)
    exclude_resources: list[str] = field(default_factory = list)
    datasets: list[str] = field(default_factory = list)
    license: list[str] = field(default_factory = list)

    # Selection — stored columns of the record, applied before the fold.
    interaction_classes: list[str] = field(default_factory = list)
    entities: list[str] = field(default_factory = list)
    # Written as the caller wrote them: `9606`, `human` and `hsapiens` all name
    # one taxon, and the name-to-taxon step needs a connection, so it belongs
    # to `scope.resolve` with the rest of the name resolution. Parsing this to
    # integers here would silently drop every name a caller could write.
    organisms: list[str] = field(default_factory = list)
    entity_types: list[str] = field(default_factory = list)
    entity_annotations: list[str] = field(default_factory = list)
    curation_flags: list[str] = field(default_factory = list)
    sign: bool | None = None
    direction: bool | None = None

    # Range — stored columns too, and named apart from the post-fold group
    # only because they reach an index where the post-fold group reaches the
    # histogram.
    affinity: dict[str, Any] | None = None
    pchembl: dict[str, Any] | None = None
    score: dict[str, Any] | None = None

    # Post-fold — a `HAVING` over the fold, never a sort (contracts §1b).
    source_count: dict[str, Any] | None = None
    reference_count: dict[str, Any] | None = None
    sign_source_count: dict[str, Any] | None = None
    direction_source_count: dict[str, Any] | None = None

    def post_fold(self) -> dict[str, dict[str, Any]]:
        """
        The post-fold predicates that were asked for, by folded column name.

        Returns:
            Each named post-fold parameter that carries bounds.
        """

        return {
            name: bounds
            for name in PARAMETER_GROUPS['post_fold']
            if (bounds := getattr(self, name))
        }

    def ranges(self) -> dict[str, dict[str, Any]]:
        """
        The stored-column range predicates that were asked for.

        Returns:
            Each named range parameter that carries bounds.
        """

        return {
            name: bounds
            for name in PARAMETER_GROUPS['range']
            if (bounds := getattr(self, name))
        }


@dataclass
class InteractionQuery:
    """One parsed request: filters, shape, projection and paging window."""

    filters: Filters = field(default_factory = Filters)

    # Shape.
    collapse: str = 'endpoints'
    # Whether the caller named a collapse of their own. A preset carries a
    # collapse mode and it is the default for its own dataset, so the engine
    # has to tell "the caller asked for endpoints" from "nobody asked".
    collapse_requested: bool = False
    by_resource: bool = False
    include_outofscope_signdir: bool = False

    # Projection.
    attributes: list[str] = field(default_factory = list)
    view: str = 'gene'
    annotation_layer: str | None = None

    # Paging.
    limit: int = DEFAULT_LIMIT
    offset: int = 0
    cursor: str | None = None
    order_by: str | None = None
    exact_total: bool = False

    @property
    def order_column(self) -> str | None:
        """The column an `order_by` names, with its direction marker removed."""

        if not self.order_by:

            return None

        return self.order_by.lstrip('-+').strip() or None

    @property
    def order_descending(self) -> bool:
        """Whether the `order_by` asked for descending order (`-name`)."""

        return bool(self.order_by) and self.order_by.strip().startswith('-')


def parse(payload: dict[str, Any]) -> InteractionQuery:
    """
    Read one request payload into the parameter model of contracts §1a.

    Filters are read from `payload['filters']` or from the payload's own top
    level, so the POST body and the query-string routes reach the same object.
    Nothing here touches the database: name resolution — resources, datasets,
    licenses, class slugs — belongs to `scope.resolve`, which runs once and
    before anything reads the interaction tables.

    Args:
        payload: The request body, camelCase or snake_case keys.

    Returns:
        The parsed query.
    """

    payload = payload or {}
    filters = payload.get('filters') or {}

    def pick(*names: str) -> Any:

        for name in names:

            if name in filters:

                return filters[name]

            if name in payload:

                return payload[name]

        return None

    parsed = Filters(
        resources = _strings(pick('resources')),
        exclude_resources = _strings(
            pick('exclude_resources', 'excludeResources', 'exclude'),
        ),
        datasets = _strings(pick('datasets', 'dataset')),
        license = _strings(pick('license', 'licenses')),
        interaction_classes = _strings(
            pick('interaction_classes', 'interactionClasses', 'interaction_types'),
        ),
        entities = _strings(pick('entities', 'entity')),
        organisms = _strings(pick('organisms', 'organism')),
        entity_types = _strings(pick('entity_types', 'entityTypes')),
        entity_annotations = _strings(
            pick('entity_annotations', 'entityAnnotations'),
        ),
        curation_flags = _strings(pick('curation_flags', 'curationFlags')),
        sign = _flag(pick('sign')),
        direction = _flag(pick('direction')),
        affinity = _bounds(pick('affinity')),
        pchembl = _bounds(pick('pchembl')),
        score = _bounds(pick('score')),
        source_count = _bounds(pick('source_count', 'sourceCount')),
        reference_count = _bounds(pick('reference_count', 'referenceCount')),
        sign_source_count = _bounds(pick('sign_source_count', 'signSourceCount')),
        direction_source_count = _bounds(
            pick('direction_source_count', 'directionSourceCount'),
        ),
    )

    requested_collapse = payload.get('collapse')
    collapse = str(requested_collapse or 'endpoints').strip().lower()
    order_by = payload.get('order_by') or payload.get('orderBy')
    cursor = payload.get('cursor')

    return InteractionQuery(
        filters = parsed,
        collapse = collapse if collapse in COLLAPSE_MODES else 'endpoints',
        collapse_requested = collapse in COLLAPSE_MODES and bool(requested_collapse),
        by_resource = bool(payload.get('by_resource') or payload.get('byResource')),
        include_outofscope_signdir = bool(
            payload.get('include_outofscope_signdir')
            or payload.get('includeOutofscopeSigndir'),
        ),
        attributes = _strings(payload.get('attributes')),
        view = str(payload.get('view') or 'gene').strip().lower(),
        annotation_layer = payload.get('annotation_layer') or payload.get('annotationLayer'),
        # The bound is applied here rather than clamped later, because the
        # guardrail prices the request from the limit it will actually run.
        limit = _limit(payload.get('limit')),
        offset = _offset(payload.get('offset')),
        cursor = str(cursor).strip() if cursor else None,
        order_by = str(order_by).strip() if order_by else None,
        exact_total = bool(payload.get('exact_total') or payload.get('exactTotal')),
    )


def _limit(value: Any) -> int:
    """
    Clamp a requested page size into the served range.

    Args:
        value: The requested limit, or None.

    Returns:
        A page size between 1 and `MAX_LIMIT`.
    """

    try:

        parsed = int(value)

    except (TypeError, ValueError):

        parsed = DEFAULT_LIMIT

    return max(1, min(parsed, MAX_LIMIT))


def _offset(value: Any) -> int:
    """
    Normalize a requested offset; the depth bound itself belongs to `guard`.

    Args:
        value: The requested offset, or None.

    Returns:
        A non-negative offset, unclamped — a deep one is refused, not silently
        moved, because silently moving it would answer a different question.
    """

    try:

        parsed = int(value)

    except (TypeError, ValueError):

        parsed = 0

    return max(0, parsed)
