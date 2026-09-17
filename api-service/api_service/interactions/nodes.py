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
canonical graph. The endpoint roles of a pair come from the interaction class,
which names them: a `ligand_receptor` interaction runs from a ligand to a
receptor, and a caller should not have to infer that from column order. A class
names the two ends of a pair and nothing else, so where the row is an
interaction rather than a pair the role is the graph's own, per participant.

The lookup is one indexed statement over the page's entities. It deliberately
does **not** go through the full identifier lookup: that table carries about
nineteen identifiers per entity across every namespace, and reading it for a
five-hundred-row page costs more than the fold it decorates. The canonical
identifier and the representative-protein table answer the two views between
them, and a request for a further namespace is an attribute request, priced
like any other.

**A row is not always a pair, and this module is where that stops being an
assumption.** Where the page is keyed on an ordered pair, the two ends are the
row's own columns and the participant array is those columns rearranged. Where
it is keyed on the interaction itself, the ends are read from the graph's
participant table instead — every member the interaction names, with the role
it is filed under, the side it stands on, its place in the interaction's own
ordering, how many copies of it take part and the compartment it is in. That
read is one indexed statement over a page that has already been chosen, which
is the same bargain the per-node lookup makes and is priced the same way.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

from ..graph import SEARCH_SCHEMA

_log = logging.getLogger(__name__)

# The record names the ends of an ordered pair `subject` and `object`. The
# tabular output names them `source` and `target`, which is what graph and
# dataframe consumers expect, so the two spellings are mapped rather than
# argued about.
#
# **That it has two entries is a claim about the interaction, not about this
# mapping.** It holds for an ordered pair and for nothing else. An interaction
# grouped by its own identity may name one participant or five, and has no
# first and second end to be flattened into, so the flat columns are built
# from this mapping only where the row is a pair. Everything wider comes back
# through `participants`, which assumes no arity at all.
BINARY_SIDES: dict[str, str] = {
    'subject': 'source',
    'object': 'target',
}

# What a participant's columns are named for when the row is not a pair. It is
# deliberately not a side: a reactant of a reaction stands on no side that the
# output could name it after, and the name is stripped again before the
# participant reaches the response.
PARTICIPANT_PREFIX = 'participant'

# What the graph stores about one participant beyond which entity it is. None
# of it is a property of the entity — the same protein is a reactant of one
# reaction and a product of the next — so it travels with the participant and
# never with the per-node lookup.
PARTICIPANT_DETAIL: tuple[str, ...] = (
    'side',
    'ordinal',
    'stoichiometry',
    'compartment',
)

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


@dataclass
class Node:
    """
    One end of one interaction, rendered and waiting to be named.

    The flat pair and the participant array are the same columns read two
    ways, so they are built once and arranged twice. Merging first and slicing
    afterwards would mean guessing from a column name which end it belongs to,
    and `source_count` is a per-interaction column whose name begins with a
    side. One wrong guess there puts the resource count inside a participant.

    Attributes:
        prefix: What the columns are named for — the output side where the row
            is an ordered pair, and the neutral participant name where it is
            not. It is also what the annotation layers name their columns for,
            so one node's columns all carry one prefix whatever produced them.
        entity_id: The entity this end stands for, for the annotation index.
        columns: The rendered columns, each carrying the prefix.
        detail: What the graph stores about this participation rather than
            about the entity. Empty for an end of an ordered pair, because a
            folded pair may speak for several interactions and any one of
            their participant rows would be an arbitrary choice among them.
        flat: Whether these columns belong on the row itself. Only an ordered
            pair's do.
    """

    prefix: str
    entity_id: str | None
    columns: dict[str, Any] = field(default_factory = dict)
    detail: dict[str, Any] = field(default_factory = dict)
    flat: bool = False


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


def entity_ids(
        rows: Iterable[dict[str, Any]],
        members: Mapping[str, list[dict[str, Any]]] | None = None,
) -> list[str]:
    """
    The distinct entities one page reaches, by whichever shape keyed it.

    Both shapes are read, not one or the other. A page keyed on an ordered
    pair carries its entities on the row; a page keyed on the interaction
    carries them in the participant read, and the lookup that follows has to
    cover whichever of the two the page used — a missed entity is a node the
    response cannot name.

    Args:
        rows: The folded rows.
        members: `party_detail`'s answer, where the page was read that way.

    Returns:
        The entity ids, as strings, without duplicates.
    """

    seen: dict[str, None] = {}

    for row in rows:

        for side in BINARY_SIDES:

            if (value := row.get(f'{side}_entity_id')) is not None:

                seen.setdefault(str(value), None)

    for participation in (members or {}).values():

        for member in participation:

            seen.setdefault(member['entity_id'], None)

    return list(seen)


def party_detail(
        rows: Sequence[dict[str, Any]],
        *,
        conn,
) -> dict[str, list[dict[str, Any]]]:
    """
    Every participant of the interactions on one page, in one statement.

    The page is already chosen and already bounded — the key selection did
    that — so this is one indexed read over interaction ids that are decided,
    and it costs what the page costs rather than what the scope costs. It is
    the same bargain the per-resource detail strikes, for the same reason.

    The role is a name rather than the number the participant row stores,
    because `reactant` and `product` are what a caller asked for and the
    surrogate key behind them is a build detail that moves with a rebuild.

    Args:
        rows: The folded rows of one page, each naming its interaction.
        conn: An open connection.

    Returns:
        `{interaction_id: [member, …]}`, the members in the order the graph
        holds them: by the interaction's own ordinal first, so a reaction
        comes back reading the way it was curated.
    """

    identifiers = list(dict.fromkeys(
        str(row['interaction_id']) for row in rows
        if row.get('interaction_id') is not None
    ))

    if not identifiers:

        return {}

    found = conn.execute(
        f"""
        SELECT p.interaction_id,
               p.entity_id,
               role.name AS role,
               p.side,
               p.ordinal,
               p.stoichiometry,
               p.compartment
        FROM {SEARCH_SCHEMA}.interaction_party p
        JOIN {SEARCH_SCHEMA}.vocab_relation_role role
          ON role.relation_role_id = p.role_id
        WHERE p.interaction_id = ANY(%s::uuid[])
        ORDER BY p.interaction_id, p.ordinal NULLS LAST, p.side NULLS LAST,
                 p.entity_id
        """,
        (identifiers,),
    ).fetchall()

    out: dict[str, list[dict[str, Any]]] = {}

    for row in found:

        out.setdefault(str(row['interaction_id']), []).append({
            'entity_id': str(row['entity_id']),
            'role': row['role'],
            'side': row['side'],
            'ordinal': row['ordinal'],
            # A count of copies is a measurement, and every measurement on a
            # row already travels as a number. Handing the exact decimal to
            # the response instead would need an encoder of its own for a
            # value that is `2` almost everywhere it is stated at all.
            'stoichiometry': (
                None if row['stoichiometry'] is None
                else float(row['stoichiometry'])
            ),
            'compartment': row['compartment'],
        })

    return out


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
    One node's standard columns, named for whatever it is named for.

    Every key is present whether or not a value was found. A caller reading a
    frame column by column cannot handle a key that appears on some rows and
    not on others, and an absent key is indistinguishable from an entity the
    lookup missed.

    Args:
        record: The entity's row of `lookup`, or None when the page reached an
            entity the lookup did not return.
        side: `source` or `target` for an end of an ordered pair, and the
            neutral participant name for a member of an interaction that is
            not one. It is a prefix here and carries no meaning of its own.
        view: `gene` or `protein`.
        role: The role this node plays — the class's for an end of a pair, the
            graph's own for a participant — or None.

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


def binary_nodes(
        row: dict[str, Any],
        index: dict[str, dict[str, Any]],
        view: str,
        class_slug: str | None,
) -> list[Node]:
    """
    The two ends of a row that is an ordered pair, in the order it names them.

    Args:
        row: One folded row, carrying `subject_entity_id` and
            `object_entity_id`.
        index: The lookup's result for this page.
        view: `gene` or `protein`.
        class_slug: The row's interaction class, which names the roles.

    Returns:
        One node per side, its columns named for the side, and both flat —
        an ordered pair is exactly the shape the `source_*`/`target_*` columns
        were written for.
    """

    roles = dict(zip(BINARY_SIDES, endpoint_roles(class_slug)))
    out: list[Node] = []

    for record_side, output_side in BINARY_SIDES.items():

        entity = row.get(f'{record_side}_entity_id')
        entity = str(entity) if entity is not None else None
        out.append(
            Node(
                prefix = output_side,
                entity_id = entity,
                columns = columns(
                    index.get(entity) if entity is not None else None,
                    output_side,
                    view,
                    roles[record_side],
                ),
                flat = True,
            ),
        )

    return out


def member_nodes(
        members: Sequence[dict[str, Any]],
        index: dict[str, dict[str, Any]],
        view: str,
) -> list[Node]:
    """
    One node per participant of an interaction, as the graph holds them.

    The role comes from the participant row rather than from the interaction's
    class. A class names the ends of a pair and can say that a ligand acts on a
    receptor; it says nothing about which member of a reaction is the cofactor,
    and the graph does. So where both exist the graph's own answer is the one
    that is per participant, which is the grain this array is at.

    None of these nodes is flat. That is the point of them: they are the ends
    of an interaction that has no first and second end.

    Args:
        members: One interaction's participant rows, from `party_detail`.
        index: The lookup's result for this page.
        view: `gene` or `protein`.

    Returns:
        One node per member, in the order the graph holds them.
    """

    return [
        Node(
            prefix = PARTICIPANT_PREFIX,
            entity_id = member['entity_id'],
            columns = columns(
                index.get(member['entity_id']),
                PARTICIPANT_PREFIX,
                view,
                member['role'],
            ),
            detail = {name: member[name] for name in PARTICIPANT_DETAIL},
        )
        for member in members
    ]


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

    for node in binary_nodes(row, index, view, class_slug):

        out.update(node.columns)

    return out


def participants(rendered: Sequence[Node]) -> list[dict[str, Any]]:
    """
    Every end of one interaction, under names that carry no side.

    Binary consumers keep the flat pair; a reaction has no first and second
    endpoint to flatten into, and the array is what it comes back as instead.
    For an ordered pair it is length two and holds the same values the flat
    columns hold — which is the whole of the difference between the two
    shapes. For an interaction read through its participants it is as long as
    the interaction is wide, and each element carries what the graph stores
    about that participation as well: the side, the ordinal, the stoichiometry
    and the compartment.

    Those four appear only on the second shape, and their absence from the
    first is the honest reading rather than an omission. A folded ordered pair
    may speak for several interactions at once, so it has no one participant
    row to report, and a null stoichiometry there would claim the build knows
    of one and found it empty.

    Args:
        rendered: The page's nodes for one row, with any per-node annotation
            columns already merged into each node.

    Returns:
        One element per participant, in the order the nodes were rendered.
    """

    out: list[dict[str, Any]] = []

    for node in rendered:

        participant: dict[str, Any] = {}

        for name, value in node.columns.items():

            key = (
                'entity' if name == node.prefix
                else name.removeprefix(f'{node.prefix}_')
            )
            participant[key] = value

        participant.update(node.detail)
        out.append(participant)

    return out
