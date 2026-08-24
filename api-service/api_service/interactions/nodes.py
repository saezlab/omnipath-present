"""
The per-node projection — what a response says about each end of an interaction.

The fold produces entity ids. On its own that is a graph nobody can read: a
caller joining interactions to expression data needs a symbol, an accession,
the species the protein belongs to, and which end of the pair is which. This
module turns the page's entity ids into those columns, once per page.

**It is driven by the view and by the class, never by the dataset.** The `view`
parameter chooses which identifier leads and which array follows — one NCBI
Gene id with a UniProt array, or one UniProt with a gene-id array — and the
choice is the same branch `gene_output` makes in the build, reached through the
same two tables, so an entity is labelled here exactly as it is labelled in the
canonical graph. The endpoint roles come from the interaction class, which
names them: a `ligand_receptor` interaction runs from a ligand to a receptor,
and a caller should not have to infer that from column order.

The lookup is one indexed statement over the page's entities. It deliberately
does **not** go through the full identifier lookup: that table carries about
nineteen identifiers per entity across every namespace, and reading it for a
five-hundred-row page costs more than the fold it decorates. The canonical
identifier and the representative-protein table answer the two views between
them, and a request for a further namespace is an attribute request, priced
like any other.
"""

from __future__ import annotations

import logging
from typing import Any, Iterable, Sequence

from ..graph import SEARCH_SCHEMA

_log = logging.getLogger(__name__)

# The record names the ends of an ordered pair `subject` and `object`. The
# tabular output names them `source` and `target`, which is what graph and
# dataframe consumers expect, so the two spellings are mapped rather than
# argued about.
SIDES: dict[str, str] = {
    'subject': 'source',
    'object': 'target',
}

# The identifier-type rows of `vocab_identifier_type` the two views lead with.
GENE_IDENTIFIER_TYPE = 'Entrez:MI:0477'
PROTEIN_IDENTIFIER_TYPE = 'Uniprot:MI:1097'

# `view=gene` leads with a gene id and carries the proteins alongside;
# `view=protein` leads with a protein and carries the genes. The array's name
# changes with the view because its meaning does, and a caller reading a frame
# should not have to check a flag to know which column holds what.
VIEW_ARRAYS: dict[str, str] = {
    'gene': 'uniprots',
    'protein': 'gene_ids',
}

DEFAULT_VIEW = 'gene'

# Names a preset may declare among its attributes that the standard output
# already carries — the per-node block above, the class, the provenance and the
# curation the fold recomputes. They are recognised rather than passed on to
# the long-tail attribute projection, where every one of them would come back
# null and read as a resource that publishes nothing.
STANDARD_BLOCKS: frozenset[str] = frozenset({
    'endpoints',
    'entity_type',
    'entity_types',
    'evidence',
    'interaction_type',
    'label',
    'labels',
    'organism',
    'organisms',
    'references',
    'roles',
    'sources',
})


def endpoint_roles(class_slug: str | None) -> tuple[str | None, str | None]:
    """
    The role each end of an interaction plays, read off its class.

    Several interaction classes name their two ends asymmetrically, and the
    name is the statement: a ligand acts on a receptor, a transcription factor
    acts on a target. Where the class names them, the response says so, and a
    consumer no longer has to know that the first column is the acting one.

    A class whose name does not split into two roles — `signaling`, `other` —
    describes both ends alike and gets no role rather than an invented one.

    Args:
        class_slug: The snake_case class name, or None.

    Returns:
        The subject's role and the object's role, either of which may be None.
    """

    if not class_slug or '_' not in class_slug:

        return None, None

    subject, _, obj = class_slug.partition('_')

    return subject or None, obj or None


def entity_ids(rows: Iterable[dict[str, Any]]) -> list[str]:
    """
    The distinct entities one page of folded rows reaches.

    Args:
        rows: The folded rows.

    Returns:
        The entity ids, as strings, without duplicates.
    """

    seen: dict[str, None] = {}

    for row in rows:

        for side in SIDES:

            if (value := row.get(f'{side}_entity_id')) is not None:

                seen.setdefault(str(value), None)

    return list(seen)


def lookup(entities: Sequence[str], *, conn) -> dict[str, dict[str, Any]]:
    """
    Read the identity of every entity on one page, in one statement.

    Args:
        entities: The entity ids the page reaches.
        conn: An open connection.

    Returns:
        `{entity_id: record}`, where the record carries the canonical
        identifier and its namespace, the display label, the organism, the
        entity type and the representative protein set. Rendering that record
        into columns is `columns`' business, because it depends on the view and
        the lookup does not.
    """

    if not entities:

        return {}

    rows = conn.execute(
        f"""
        SELECT e.entity_id,
               e.canonical_identifier,
               COALESCE(e.label, e.canonical_identifier) AS label,
               e.taxonomy_id,
               it.name AS canonical_type,
               lower(split_part(et.name, ':', 1)) AS entity_type,
               gpr.representative_uniprot,
               gpr.uniprot_all
        FROM {SEARCH_SCHEMA}.entity e
        JOIN {SEARCH_SCHEMA}.vocab_entity_type et
          ON et.entity_type_id = e.entity_type_id
        LEFT JOIN {SEARCH_SCHEMA}.vocab_identifier_type it
          ON it.identifier_type_id = e.canonical_identifier_type_id
        LEFT JOIN {SEARCH_SCHEMA}.gene_protein_representative gpr
          ON gpr.entity_id = e.entity_id
        WHERE e.entity_id = ANY(%s::uuid[])
        """,
        (list(entities),),
    ).fetchall()

    return {str(row['entity_id']): dict(row) for row in rows}


def _proteins(record: dict[str, Any]) -> list[str]:
    """
    Every protein accession known for one entity, widest first.

    Args:
        record: One row of `lookup`.

    Returns:
        The accessions, without duplicates and without empty values.
    """

    candidates = [
        *(record.get('uniprot_all') or []),
        record.get('representative_uniprot'),
    ]

    if record.get('canonical_type') == PROTEIN_IDENTIFIER_TYPE:

        candidates.append(record.get('canonical_identifier'))

    return list(dict.fromkeys(value for value in candidates if value))


def _genes(record: dict[str, Any]) -> list[str]:
    """
    Every gene identifier known for one entity.

    Args:
        record: One row of `lookup`.

    Returns:
        The NCBI Gene ids, which for a gene-canonical entity is its own
        identifier and for anything else is empty. A protein entity's genes
        live in the identifier lookup and are an attribute request, not a
        standard column.
    """

    if record.get('canonical_type') == GENE_IDENTIFIER_TYPE:

        return [record['canonical_identifier']]

    return []


def _identifier(record: dict[str, Any], view: str) -> str | None:
    """
    The one identifier the requested view leads with.

    Args:
        record: One row of `lookup`.
        view: `gene` or `protein`.

    Returns:
        A single best identifier. The fallback in both views is the entity's
        own canonical identifier — which is what it is known by — rather than
        nothing, because a row without an identifier is a row a caller cannot
        use at all.
    """

    if view == 'protein':

        proteins = _proteins(record)

        return proteins[0] if proteins else record.get('canonical_identifier')

    genes = _genes(record)

    return genes[0] if genes else record.get('canonical_identifier')


def columns(
        record: dict[str, Any] | None,
        side: str,
        view: str,
        role: str | None,
) -> dict[str, Any]:
    """
    One node's standard columns, named for the side it is on.

    Every key is present whether or not a value was found. A caller reading a
    frame column by column cannot handle a key that appears on some rows and
    not on others, and an absent key is indistinguishable from an entity the
    lookup missed.

    Args:
        record: The entity's row of `lookup`, or None when the page reached an
            entity the lookup did not return.
        side: `source` or `target`.
        view: `gene` or `protein`.
        role: The role this end plays in the interaction's class, or None.

    Returns:
        The `<side>_*` columns of the contract's standard output.
    """

    record = record or {}
    array = VIEW_ARRAYS.get(view, VIEW_ARRAYS[DEFAULT_VIEW])
    values = _genes(record) if array == 'gene_ids' else _proteins(record)

    return {
        side: _identifier(record, view) if record else None,
        f'{side}_label': record.get('label'),
        f'{side}_{array}': values,
        f'{side}_organism': record.get('taxonomy_id'),
        f'{side}_entity_type': record.get('entity_type'),
        f'{side}_role': role,
    }


def blocks(
        row: dict[str, Any],
        index: dict[str, dict[str, Any]],
        view: str,
        class_slug: str | None,
) -> dict[str, dict[str, Any]]:
    """
    The standard per-node columns of one folded row, kept per end.

    The flat projection and the participant array are the same columns read two
    ways, so they are built once and arranged twice. Merging first and slicing
    afterwards would mean guessing from a column name which end it belongs to,
    and `source_count` is a per-interaction column whose name begins with a
    side. One wrong guess there puts the resource count inside a participant.

    Args:
        row: One folded row, carrying `subject_entity_id` and
            `object_entity_id`.
        index: The lookup's result for this page.
        view: `gene` or `protein`.
        class_slug: The row's interaction class, which names the roles.

    Returns:
        `{output side: columns}`, in the order the sides are named.
    """

    roles = dict(zip(SIDES, endpoint_roles(class_slug)))

    return {
        output_side: columns(
            index.get(str(row.get(f'{record_side}_entity_id')))
            if row.get(f'{record_side}_entity_id') is not None else None,
            output_side,
            view,
            roles[record_side],
        )
        for record_side, output_side in SIDES.items()
    }


def project(
        row: dict[str, Any],
        index: dict[str, dict[str, Any]],
        view: str,
        class_slug: str | None,
) -> dict[str, Any]:
    """
    The standard per-node columns of one folded row, for both of its ends.

    Args:
        row: One folded row, carrying `subject_entity_id` and
            `object_entity_id`.
        index: The lookup's result for this page.
        view: `gene` or `protein`.
        class_slug: The row's interaction class, which names the roles.

    Returns:
        Every `source_*` and `target_*` column of the row.
    """

    out: dict[str, Any] = {}

    for block in blocks(row, index, view, class_slug).values():

        out.update(block)

    return out


def participants(rendered: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """
    The same two nodes as the hyperedge form the contract nests per participant.

    Binary consumers keep the flat pair; a reaction has no first and second
    endpoint to flatten into, and the array is what it will come back as. It is
    length two here, and it is the same values under names that do not carry a
    side — which is the whole of the difference between the two shapes.

    Args:
        rendered: `blocks`' answer, with any per-node annotation columns
            already merged into each side.

    Returns:
        One element per participant, in side order.
    """

    out: list[dict[str, Any]] = []

    for side, block in rendered.items():

        participant = {'entity': block.get(side)}

        for name, value in block.items():

            if name != side:

                participant[name.removeprefix(f'{side}_')] = value

        out.append(participant)

    return out
