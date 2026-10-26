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

The lookup is one indexed statement over the page's entities, and the
identifier read beside it is a second. The canonical identifier answers one
namespace per endpoint and the caller cannot choose which, so a request may
name further namespaces and get an array per namespace per node. **It is read
per page and never per namespace**: `entity_identifier_lookup` is keyed on
`(entity_id, identifier_id)`, so the page's own endpoints are an index-only
scan, which is what makes a read of the full identifier lookup affordable
here when it is not affordable over a scope. The two view arrays come from
that same read, because the table they used to come from —
`gene_protein_representative` — holds no rows.

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


# ── A second identifier per endpoint ────────────────────────────────────────

# The namespaces a request may ask an endpoint to be named in, by the slug a
# caller writes.
#
# **A slug, and never the stored spelling.** `vocab_identifier_type.name` is a
# mixed-case, colon-bearing CURIE — `Uniprot:MI:1097` — and the colon in it
# collides with the `kind:slug` separator that `attribute_filters` and the
# annotation booleans already spell their terms with. So the stored name stays
# inside this module and the caller writes `uniprot`. The slugs are the
# vocabulary's own `normalization_rule` where it carries one, which is every
# metabolite namespace, and follow the same shape where it does not.
#
# **The two view arrays are in this map rather than beside it.** `uniprot` and
# `entrez` render into `<side>_uniprots` and `<side>_gene_ids`, which the
# contract already declares and `VIEW_ARRAYS` already names, so a request
# naming either namespace and the standard columns cannot come to disagree
# about one column. Those two columns read `gene_protein_representative`
# before this read existed, and that table holds no rows, so they were `[]` on
# every row of every response.
IDENTIFIER_NAMESPACES: dict[str, tuple[str, str]] = {
    'uniprot': (PROTEIN_IDENTIFIER_TYPE, 'uniprots'),
    'entrez': (GENE_IDENTIFIER_TYPE, 'gene_ids'),
    'ensembl': ('Ensembl:MI:0476', 'ensembl_ids'),
    'hgnc': ('Hgnc:MI:1095', 'hgnc_ids'),
    'genesymbol': ('Gene Name Primary:OM:0200', 'genesymbols'),
    'inchikey': ('Standard Inchi Key:MI:1101', 'inchikeys'),
    'pubchem': ('Pubchem Compound:OM:0002', 'pubchem_ids'),
    'chembl': ('Chembl Compound:MI:0967', 'chembl_ids'),
    'chebi': ('Chebi:MI:0474', 'chebis'),
    'hmdb': ('Hmdb:OM:0004', 'hmdbs'),
    'kegg': ('Kegg Compound:MI:2012', 'kegg_ids'),
    'lipidmaps': ('Lipidmaps:OM:0003', 'lipidmaps_ids'),
    'swisslipids': ('Swisslipids:OM:0009', 'swisslipids_ids'),
    'refmet': ('Refmet:OM:0137', 'refmet_ids'),
    'cas': ('Cas:MI:2011', 'cas_numbers'),
    'smiles': ('Smiles:MI:0239', 'smiles'),
}

# The namespaces the two views are named for. They are read for every page
# whether or not a request named them, because they are standard columns of
# the contract and this read is the only thing that fills them.
VIEW_NAMESPACES: tuple[str, ...] = ('uniprot', 'entrez')

# Which entity types a selector key covers. The kind a caller writes says
# which namespaces are worth asking for on which end — ChEBI means something
# on a metabolite and nothing on a kinase — and the discovery answer publishes
# the map so that intent can be read before a request is written.
#
# **The kind narrows what is worth asking for, and never which columns come
# back.** Every namespace the selector names anywhere renders on every node of
# every row, because T098's rule is one spelling for absence and a column that
# appeared on the chemical rows alone is a column a frame consumer cannot
# read. The join is what decides whether a value exists, and it is right that
# it does: the sides leak, and 537 protein-side endpoints carry an InChIKey
# from Guide to Pharmacology's peptide ligands. A namespace asked for on the
# wrong side therefore renders `[]` rather than vanishing.
ENTITY_KINDS: dict[str, frozenset[str]] = {
    'protein': frozenset({
        'protein',
        'gene',
        'polypeptide',
        'protein_family',
        'macromolecular_complex',
    }),
    'chemical': frozenset({'chemical_entity'}),
}

# The selector key a term carrying no kind takes. `identifiers=uniprot` reads
# as "this namespace whatever the endpoint is", which keeps the short spelling
# usable and is the honest one to write for a page whose endpoints are of no
# one kind — `named_thing`, `ontology_class` and the rest.
ANY_KIND = '*'

_IDENTIFIER_TYPES: dict[str, dict[str, int]] = {}


def identifier_types(conn) -> dict[str, int]:
    """
    The identifier-type vocabulary, read once per process.

    Sixteen slugs resolve to sixteen type ids against a 256-row table, and the
    ids are what the page read filters on. Caching them is what makes that
    possible: the vocabulary of namespaces is the only thing here small enough
    to hold, and holding anything per entity is the mistake F14 measured.

    Args:
        conn: An open connection.

    Returns:
        `{vocab_identifier_type.name: identifier_type_id}` for this schema.
    """

    if SEARCH_SCHEMA not in _IDENTIFIER_TYPES:

        rows = conn.execute(
            f"""
            SELECT identifier_type_id, name
            FROM {SEARCH_SCHEMA}.vocab_identifier_type
            """,
        ).fetchall()
        _IDENTIFIER_TYPES[SEARCH_SCHEMA] = {
            row['name']: int(row['identifier_type_id']) for row in rows
        }

    return _IDENTIFIER_TYPES[SEARCH_SCHEMA]


def namespaces(selector: Mapping[str, Sequence[str]] | None) -> list[str]:
    """
    The namespaces one selector names, as one list over every kind in it.

    Args:
        selector: `{kind: [slug, …]}` as the request wrote it, or None.

    Returns:
        The known slugs, in the order the selector names them, without
        duplicates. An unknown slug is dropped here rather than refused:
        FR-045 makes an unknown projection target empty and never a 4xx, and
        this is a projection.
    """

    out: list[str] = []

    for slugs in (selector or {}).values():

        for slug in slugs:

            if slug in IDENTIFIER_NAMESPACES and slug not in out:

                out.append(slug)

    return out


def unknown_namespaces(selector: Mapping[str, Sequence[str]] | None) -> list[str]:
    """
    The slugs of one selector that name no namespace.

    Args:
        selector: `{kind: [slug, …]}` as the request wrote it, or None.

    Returns:
        The unrecognised slugs, for the log line that says a projection asked
        for something this build cannot name.
    """

    return sorted({
        slug
        for slugs in (selector or {}).values()
        for slug in slugs
        if slug not in IDENTIFIER_NAMESPACES
    })


def identifiers(
        entities: Sequence[str],
        selector: Mapping[str, Sequence[str]] | None = None,
        *,
        conn,
) -> dict[str, dict[str, list[str]]]:
    """
    Read the requested namespaces of every entity on one page, in one statement.

    **The page, not the namespace.** `entity_identifier_lookup` is a plain
    table with a primary key on `(entity_id, identifier_id)`, so a read
    filtered on the page's own endpoints is an index-only scan plus one
    primary-key probe into `identifier_evidence` for each identifier an
    endpoint carries. That is the same bargain `lookup` and `shape` already
    strike with a page the key selection has bounded, and it is what separates
    this from F14: the annotation store LIST-partitions on `source_id` and
    walks every partition.

    **The type id is the predicate, and the vocabulary never enters the
    statement.** Filtering on `vocab_identifier_type.name` instead measured
    48.0 ms against 22.7 ms for the same answer on the same page, because the
    name is a column of a table the row does not carry and the type id is a
    column it does. The slug each id belongs to is put back on in Python from
    the cached vocabulary, so the join is not needed for the output either.

    **Measured on dev5, 2026-10-25**, 400 sampled endpoints: 1,290 rows for
    the two view namespaces in **30 ms** steady state and **207 ms** on the
    first call of a fresh process, against 987 ms measured on 2026-10-23 with
    a cold Postgres buffer cache. **The first read is accepted as a
    first-request cost rather than warmed up**, and that is a decision. What
    is slow cold is the buffer cache over `identifier_evidence`'s
    30-million-row primary key, and which of its pages a request needs depends
    on the entity ids the page selected, so a warm-up at startup would have to
    read enough of a 30-million-row index to be worth it — which is the eager
    index this service has just finished removing. The one thing small enough
    to hold is the type vocabulary, and `identifier_types` holds it.

    Args:
        entities: The entity ids the page reaches.
        selector: The namespaces the request asked for, `{kind: [slug, …]}`.
        conn: An open connection.

    Returns:
        `{entity_id: {slug: [value, …]}}`, carrying an entry only where a
        value was found. Rendering the absent case is `columns`' business,
        because the empty value of a column is a rendering decision and not a
        fact about the entity.
    """

    wanted = list(dict.fromkeys(str(value) for value in entities if value))
    slugs = list(dict.fromkeys([*VIEW_NAMESPACES, *namespaces(selector)]))
    vocabulary = identifier_types(conn)
    types: dict[int, str] = {}

    for slug in slugs:

        if (type_id := vocabulary.get(IDENTIFIER_NAMESPACES[slug][0])) is not None:

            types[type_id] = slug

    if not wanted or not types:

        return {}

    rows = conn.execute(
        f"""
        SELECT l.entity_id,
               ie.identifier_type_id,
               ie.value
        FROM {SEARCH_SCHEMA}.entity_identifier_lookup l
        JOIN {SEARCH_SCHEMA}.identifier_evidence ie
          ON ie.identifier_id = l.identifier_id
        WHERE l.entity_id = ANY(%s::uuid[])
          AND ie.identifier_type_id = ANY(%s::bigint[])
        ORDER BY l.entity_id, ie.identifier_type_id, ie.value
        """,
        (wanted, list(types)),
    ).fetchall()
    out: dict[str, dict[str, list[str]]] = {}

    # Sorted in the statement rather than here, because the arrays have to be
    # stable across two reads of the same page or a consumer diffing one
    # response against the next sees churn that no build produced.
    for row in rows:

        found = out.setdefault(str(row['entity_id']), {})
        found.setdefault(types[int(row['identifier_type_id'])], []).append(
            row['value'],
        )

    return out

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


def _proteins(
        record: dict[str, Any],
        found: Mapping[str, Sequence[str]] | None = None,
) -> list[str]:
    """
    Every protein accession known for one entity, its own first.

    **The order is what `view=protein` leads with, so it is a decision.** The
    entity's own canonical identifier comes first where that identifier is an
    accession, because it is the one the build settled on and it does not move
    between pages. The identifier lookup's values follow, sorted, and they are
    an arbitrary pick among equals wherever there is no canonical accession to
    lead — SSTR2 carries seven and one UniProt endpoint carries 275. There is
    no stored consensus to prefer instead: `gene_protein_representative`, the
    only table that ever held one, has no rows.

    Args:
        record: One row of `lookup`.
        found: This entity's answer from `identifiers`, if the page read one.

    Returns:
        The accessions, without duplicates and without empty values.
    """

    candidates = [
        record.get('canonical_identifier')
        if record.get('canonical_type') == PROTEIN_IDENTIFIER_TYPE else None,
        record.get('representative_uniprot'),
        *((found or {}).get('uniprot') or ()),
        *(record.get('uniprot_all') or []),
    ]

    return list(dict.fromkeys(value for value in candidates if value))


def _genes(
        record: dict[str, Any],
        found: Mapping[str, Sequence[str]] | None = None,
) -> list[str]:
    """
    Every gene identifier known for one entity, its own first.

    A protein entity's genes used to be an attribute request rather than a
    standard column, on the reading that the identifier lookup was too wide to
    read per page. The page-scoped read settles that: the lookup answers for
    the page's endpoints in one indexed statement, so a gene-canonical entity
    reports its own identifier and a UniProt-canonical one reports the gene
    ids the build holds for it, which is what the protein view's array
    promises.

    Args:
        record: One row of `lookup`.
        found: This entity's answer from `identifiers`, if the page read one.

    Returns:
        The NCBI Gene ids, without duplicates.
    """

    candidates = [
        record.get('canonical_identifier')
        if record.get('canonical_type') == GENE_IDENTIFIER_TYPE else None,
        *((found or {}).get('entrez') or ()),
    ]

    return list(dict.fromkeys(value for value in candidates if value))


def _identifier(
        record: dict[str, Any],
        view: str,
        found: Mapping[str, Sequence[str]] | None = None,
) -> str | None:
    """
    The one identifier the requested view leads with.

    Args:
        record: One row of `lookup`.
        view: `gene` or `protein`.
        found: This entity's answer from `identifiers`, if the page read one.

    Returns:
        A single best identifier. The fallback in both views is the entity's
        own canonical identifier — which is what it is known by — rather than
        nothing, because a row without an identifier is a row a caller cannot
        use at all.
    """

    if view == 'protein':

        proteins = _proteins(record, found)

        return proteins[0] if proteins else record.get('canonical_identifier')

    genes = _genes(record, found)

    return genes[0] if genes else record.get('canonical_identifier')


def columns(
        record: dict[str, Any] | None,
        side: str,
        view: str,
        role: str | None,
        found: Mapping[str, Sequence[str]] | None = None,
        selector: Mapping[str, Sequence[str]] | None = None,
) -> dict[str, Any]:
    """
    One node's standard columns, named for whatever it is named for.

    Every key is present whether or not a value was found. A caller reading a
    frame column by column cannot handle a key that appears on some rows and
    not on others, and an absent key is indistinguishable from an entity the
    lookup missed. A namespace the selector names therefore reaches every node
    of every row of the page, at T098's spelling for absence: an array of
    identifiers is empty when the build holds none, never null and never gone.

    Args:
        record: The entity's row of `lookup`, or None when the page reached an
            entity the lookup did not return.
        side: `source` or `target` for an end of an ordered pair, and the
            neutral participant name for a member of an interaction that is
            not one. It is a prefix here and carries no meaning of its own.
        view: `gene` or `protein`.
        role: The role this node plays — the class's for an end of a pair, the
            graph's own for a participant — or None.
        found: This entity's answer from `identifiers`, `{slug: [value, …]}`.
        selector: The namespaces the request asked for, which decide the
            further `<side>_*` arrays beside the view's own.

    Returns:
        The `<side>_*` columns of the contract's standard output, and one
        array per namespace the request named.
    """

    record = record or {}
    array = VIEW_ARRAYS.get(view, VIEW_ARRAYS[DEFAULT_VIEW])
    # The two view arrays are built whichever view is leading, and named once
    # each. They are one column apiece — the contract's `<side>_uniprots` and
    # `<side>_gene_ids` — so a caller who names `uniprot` beside `view=gene`
    # has to get the column the view already fills rather than a second
    # answer under the same key. They are also the only two arrays that carry
    # the entity's own canonical identifier as well as the lookup's values,
    # which is what keeps a gene-canonical endpoint reporting its gene id.
    arrays = {
        VIEW_ARRAYS['gene']: _proteins(record, found),
        VIEW_ARRAYS['protein']: _genes(record, found),
    }
    out = {
        side: _identifier(record, view, found) if record else None,
        f'{side}_label': record.get('label'),
        f'{side}_{array}': arrays[array],
        f'{side}_organism': record.get('taxonomy_id'),
        f'{side}_entity_type': record.get('entity_type'),
        f'{side}_role': role,
    }

    # A namespace costs a column only on the request that names it, which is
    # why the whole vocabulary is registered in discovery rather than a tenth
    # of it. The caution T100 argues for registering an annotation category
    # does not carry over by analogy: a category there reaches an
    # unconditional column on every row, and a namespace here reaches none
    # until it is asked for.
    for slug in namespaces(selector):

        suffix = IDENTIFIER_NAMESPACES[slug][1]
        out[f'{side}_{suffix}'] = (
            arrays[suffix] if suffix in arrays
            else list((found or {}).get(slug) or ())
        )

    return out


def binary_nodes(
        row: dict[str, Any],
        index: dict[str, dict[str, Any]],
        view: str,
        class_slug: str | None,
        found: Mapping[str, Mapping[str, Sequence[str]]] | None = None,
        selector: Mapping[str, Sequence[str]] | None = None,
) -> list[Node]:
    """
    The two ends of a row that is an ordered pair, in the order it names them.

    Args:
        row: One folded row, carrying `subject_entity_id` and
            `object_entity_id`.
        index: The lookup's result for this page.
        view: `gene` or `protein`.
        class_slug: The row's interaction class, which names the roles.
        found: `identifiers`' result for this page, keyed by entity id.
        selector: The namespaces the request asked for.

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
                    (found or {}).get(entity) if entity is not None else None,
                    selector,
                ),
                flat = True,
            ),
        )

    return out


def member_nodes(
        members: Sequence[dict[str, Any]],
        index: dict[str, dict[str, Any]],
        view: str,
        found: Mapping[str, Mapping[str, Sequence[str]]] | None = None,
        selector: Mapping[str, Sequence[str]] | None = None,
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
        found: `identifiers`' result for this page, keyed by entity id.
        selector: The namespaces the request asked for.

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
                (found or {}).get(member['entity_id']),
                selector,
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
        found: Mapping[str, Mapping[str, Sequence[str]]] | None = None,
        selector: Mapping[str, Sequence[str]] | None = None,
) -> dict[str, Any]:
    """
    The standard per-node columns of one folded row, for both of its ends.

    Args:
        row: One folded row, carrying `subject_entity_id` and
            `object_entity_id`.
        index: The lookup's result for this page.
        view: `gene` or `protein`.
        class_slug: The row's interaction class, which names the roles.
        found: `identifiers`' result for this page, keyed by entity id.
        selector: The namespaces the request asked for.

    Returns:
        Every `source_*` and `target_*` column of the row.
    """

    out: dict[str, Any] = {}

    for node in binary_nodes(row, index, view, class_slug, found, selector):

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
