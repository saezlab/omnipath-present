"""
The Projection group: which columns a caller gets back.

A request names columns in `attributes=`, and a name is one of two things. A
**hot column** is stored on the record or produced by the fold, so it is
already on the row and costs nothing to hand back. A **long-tail key** lives
inside the record's attribute document, and reaching it means opening that
document.

Three rules hold here, and each answers a way the projection can go wrong.

**Open the document once.** Extracting five keys with five `->>` operators
walks — and, for a toasted value, decompresses — the whole document five times.
One `jsonb_to_record` with five columns in its definition list does it once.
The saving is per row of the page, so it grows with the page rather than with
the request.

**Project after the page bound, never before.** The extraction is written into
the fold, whose `FROM` already starts from the bounded key list, so it touches
the record rows of one page and no others. Written into the key selection
instead it would open a document for every key in scope, which is the same
mistake the fold itself was rewritten to stop making.

**A name nobody stores is null, not an error.** A caller assembling one frame
across resources that publish different columns asks for the union of what they
publish, and a sparse frame is the useful answer. Refusing would make the caller
discover the union first, and dropping the row would silently shorten the frame.
An unknown *filter* target is refused, because an empty page for a misspelt name
states something false. An unknown *projection* target is simply empty.
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

# The function that opens the attribute document. Named once so a test can
# assert the statement calls it exactly as often as the rule allows.
EXTRACTION = 'jsonb_to_record'

# Every column the folded row already carries: the collapse key, the record's
# stored columns as the fold summarises them, and the summaries themselves.
# Naming one of these in `attributes` costs nothing — the value is on the row
# and the projection copies it rather than reading the document.
HOT_COLUMNS: frozenset[str] = frozenset({
    'subject_entity_id',
    'object_entity_id',
    'interaction_class_id',
    'interaction_id',
    'sources',
    'source_count',
    'is_directed',
    'is_stimulation',
    'is_inhibition',
    'sign_source_count',
    'direction_source_count',
    'affinity',
    'pchembl',
    'score',
    'reference_pubmed_ids',
    'reference_dois',
    'curation_flags',
    'reference_count',
    'interaction_type',
    'interaction_type_label',
    'reference_pairs',
    # The legacy projections of the columns above: joined strings and the
    # dataset scalar. Naming one of them in `attributes` selects the rendered
    # value rather than looking for a document key nobody stores.
    'resources',
    'references',
    'interaction_dataset',
    'interaction_datasets',
    'participants',
})

# The prefix the fold aliases an extracted key under, so a long-tail key called
# `score` cannot collide with the folded column of that name in the row dict.
ALIAS = 'attribute:'

# Postgres truncates an identifier past this many bytes, and `jsonb_to_record`
# matches a document key by the column name it was given. A longer name would
# therefore be matched against its own truncation, which is a silently wrong
# answer. Such a name goes unextracted instead, and comes back null like any
# other name the build does not carry.
MAX_KEY_BYTES = 63


def classify(names: Sequence[str]) -> tuple[list[str], list[str]]:
    """
    Split requested names into the ones on the row and the ones in the document.

    Args:
        names: The `attributes=` names, as the caller wrote them.

    Returns:
        The hot columns and the long-tail keys, each in the caller's order.
    """

    hot = [name for name in names if name in HOT_COLUMNS]
    tail = [name for name in names if name not in HOT_COLUMNS]

    return hot, tail


def long_tail(names: Sequence[str]) -> list[str]:
    """
    The requested names that can only be answered by opening the document.

    The cost governor prices these and not the hot columns: a hot column is
    already in the row the fold produces, so asking for it adds no scan, no
    detoast and no reason to refuse.

    Args:
        names: The `attributes=` names.

    Returns:
        The long-tail keys.
    """

    return classify(names)[1]


def _identifier(name: str) -> str | None:
    """
    One document key as a quoted column name for the definition list.

    Args:
        name: The key the caller asked for.

    Returns:
        The quoted identifier, or None for a name Postgres cannot carry as one.
    """

    text = str(name)

    if not text or len(text.encode('utf-8')) > MAX_KEY_BYTES:

        return None

    return '"' + text.replace('"', '""') + '"'


def _extractable(names: Sequence[str]) -> list[tuple[str, str]]:
    """
    The long-tail keys the definition list can carry, deduplicated.

    Args:
        names: The requested long-tail keys.

    Returns:
        `(name, quoted identifier)` pairs, in the caller's order.
    """

    out: list[tuple[str, str]] = []
    seen: set[str] = set()

    for name in names:

        identifier = _identifier(name)

        if identifier is None or identifier in seen:

            continue

        seen.add(identifier)
        out.append((name, identifier))

    return out


def _lateral(columns: Iterable[str], alias: str = 'x') -> str:
    """
    The one-pass extraction, as a lateral over the record alias `r`.

    `LEFT JOIN ... ON true` rather than a plain join: a record row that stores
    no attribute document must still reach the fold, or the group loses a
    contributor and every summary on it becomes wrong. The `CASE` guards the
    same edge from the other side — a document that is not an object cannot be
    expanded into one, and asking for its keys is an empty answer, not an error.

    Args:
        columns: The quoted column names of the definition list.
        alias: The alias the extracted columns take.

    Returns:
        The lateral join, or an empty string when nothing is extractable.
    """

    definition = ', '.join(f'{column} text' for column in columns)

    if not definition:

        return ''

    return (
        f'LEFT JOIN LATERAL {EXTRACTION}(\n'
        f"      CASE WHEN jsonb_typeof(r.attributes) = 'object'\n"
        f"           THEN r.attributes ELSE '{{}}'::jsonb END\n"
        f'    ) AS {alias}({definition}) ON true'
    )


def extraction_sql(names: Sequence[str]) -> tuple[str, str, list[Any]]:
    """
    Read the named keys out of one record row's attribute document.

    The per-row form, without the fold's aggregation around it. Its value is
    that it can be run against a document directly, which is the only way to
    check the extraction while the build stores none.

    Args:
        names: The long-tail keys to read.

    Returns:
        The select fragment, the lateral join it needs, and the positional
        arguments (none — a column definition list is part of the statement,
        not a parameter, which is why `_identifier` quotes rather than binds).
    """

    pairs = _extractable(names)
    fragment = ', '.join(
        f'x.{identifier} AS "{ALIAS}{name}"' for name, identifier in pairs
    )

    return fragment, _lateral(identifier for _, identifier in pairs), []


def aggregate_sql(names: Sequence[str]) -> tuple[str, str, list[Any]]:
    """
    The same extraction, folded to one value per collapse key.

    A group spans the resources that report the interaction, and they need not
    agree, so each key comes back as the distinct values its contributors
    published rather than as whichever one the fold happened to see last. A key
    no contributor published collects nothing and is null.

    Args:
        names: The long-tail keys to read.

    Returns:
        The select fragment — with its leading comma, or empty — the lateral it
        needs, and its positional arguments.
    """

    pairs = _extractable(names)
    fragments = [
        f'array_agg(DISTINCT x.{identifier}) '
        f'FILTER (WHERE x.{identifier} IS NOT NULL) AS "{ALIAS}{name}"'
        for name, identifier in pairs
    ]
    lateral = _lateral(identifier for _, identifier in pairs)
    fragment = (',\n      ' + ',\n      '.join(fragments)) if fragments else ''

    return fragment, lateral, []


def render(
        row: dict[str, Any],
        projected: dict[str, Any],
        names: Sequence[str],
) -> dict[str, Any]:
    """
    The attribute block of one row: every requested name, present either way.

    Every name the caller asked for is a key of the answer, whether the build
    carries it or not. A key that appears on some rows and not others is the
    shape a frame consumer cannot use, so absent is expressed as null rather
    than as a missing key.

    Args:
        row: The folded row, carrying the hot columns and the extracted keys.
        projected: The rendered row, carrying the names the fold does not —
            the class slug and its label.
        names: The requested names, in the caller's order.

    Returns:
        `{name: value}`, one entry per requested name.
    """

    out: dict[str, Any] = {}

    for name in names:

        if name in HOT_COLUMNS:

            out[name] = projected.get(name, row.get(name))

        else:

            out[name] = row.get(f'{ALIAS}{name}')

    return out
