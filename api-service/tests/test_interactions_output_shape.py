"""The shape of an interactions row: identifiers, standard columns, annotations.

An interaction is a statement about two molecules, and a response has to say
which two, in a namespace the caller works in, without making them look them
up. That is three separate promises, and this file holds each of them to a
different standard.

**The two views are one projection, not two datasets.** Whether a node comes
back as an NCBI Gene id with a UniProt array beside it, or as a UniProt with a
gene-id array beside it, is decided per request off the entity's own canonical
identifier type. Both views name the same entity and differ only in which
identifier leads, so a caller switching `view` must not see the row set change.

**The standard columns are the legacy contract, kept honest.** The three sign
flags stay nullable, `interaction_type` is the queryable slug while
`interaction_type_label` is the display form nobody filters on,
`interaction_dataset` is a scalar that means "the dataset you asked for" when
you asked for one and loses no tag when you did not, and the joined provenance
strings name every contributor.

**Four of them are rebuildable, so they are selected rather than given.**
`interaction_type_label` is one vocabulary lookup off the slug, `resources` and
`references` are a `join` over the `sources` and `reference_pairs` arrays the
row carries anyway, and `participants` over an ordered pair is the flat columns
rearranged. All four are hot columns, so naming one costs nothing — the value
is already on the folded row — and carrying one unasked widens every response
of every dataset for the callers that never read it. The tests below hold both
halves: absent from a default row, present when named, and `participants` still
mandatory where the row is not a pair and the array is the only ends it has.

**Node annotations are layered, and the layers are the extensibility.** The
default is a compact per-node array of the categories a node carries, so a
frame stays narrow, beside the coarse metabolic domain as its own scalar.
Asking for the full form gets a by-resource object per node, which is where the
provenance lives. Asking for named categories gets flat booleans, which is what
a dataframe tool wants. Registering a further category must reach all three
without moving a single default column, because that is what makes the annotation
source replaceable underneath.

**The protein-function layer is the counter-example, deliberately.** It holds
41,399 terms against the other layers' 4,173, so it reaches no default column,
costs nothing for a request that does not name it, never enters the summary
array, and is reported by vocabulary name and term count rather than by term.
The tests below hold each of those four separately, because a large vocabulary
served by default is the failure the layering exists to prevent.

Alongside the flat pair, every row also carries a `participants` array — length
two for a binary interaction — so the hyperedge form is the same object seen
whole rather than a second shape bolted on later.

**At participant grain the array is the only shape there is.** A row keyed on
the interaction itself speaks for one interaction of whatever arity, so it has
no first and second end, the flat pair is absent from it rather than empty, and
the members come back from the graph's own participant table carrying the role
each is filed under and the side, ordinal, stoichiometry and compartment of
that participation.

    DATABASE_URL=... pytest tests/test_interactions_output_shape.py -v
"""

from __future__ import annotations

import json
import os
from typing import Any

import pytest

DATABASE_URL = os.environ.get('DATABASE_URL')
SCHEMA = os.environ.get('OMNIPATH_PG_SCHEMA', 'public')

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason = 'DATABASE_URL not set; the output shape needs a built DB',
)

#: The ligand-receptor preset: one resource, one class, gene-canonical
#: endpoints, and the annotation source with the widest per-entity coverage.
PRESET = 'liana'

#: The preset registered at participant grain, where the flat pair is absent
#: and the participant array is the only ends a row has.
REACTION_PRESET = 'reactions'

#: The class the preset carries, and the display form of it.
CLASS_SLUG = 'ligand_receptor'
CLASS_LABEL = 'Ligand-receptor'

#: The delimiter every joined output column uses.
DELIMITER = ';'

#: Per-interaction columns every row carries, whatever was asked for.
STANDARD_COLUMNS = (
    'is_directed',
    'is_stimulation',
    'is_inhibition',
    'sign_source_count',
    'direction_source_count',
    'interaction_type',
    'interaction_dataset',
    'interaction_datasets',
)

#: The columns that are rebuildable from what the row already carries, so they
#: leave the default row and come back when the request names them.
SELECTED_COLUMNS = (
    'interaction_type_label',
    'resources',
    'references',
    'participants',
)

#: Per-node columns every row carries, for each side. `_metabolic_domain` is
#: among them and is a scalar rather than an array: it is a column of `entity`
#: rather than an asserted fact, it is single-valued, and it is null on a
#: protein, which is T098's spelling for the absence of a value whose type has
#: no empty form.
NODE_COLUMNS = (
    '', '_label', '_organism', '_entity_type', '_annotation_class',
    '_metabolic_domain',
)

#: Categories the ligand-receptor preset's endpoints actually carry. Measured
#: on dev5, 2026-10-23, over the first 200 rows: `extracellular_region` on 36
#: source endpoints and 35 target ones, `plasma_membrane` on 29 and 33,
#: `secreted` on 18 and 8, `transmembrane_helix` on 15 target endpoints. They
#: are GO cellular components and UniProt cellular-component keywords, which is
#: what the layer serves; `ligand` and `receptor` are not among them and are
#: not meant to be — see the Phase 9 note below.
SOURCE_CATEGORY = 'extracellular_region'
TARGET_CATEGORY = 'plasma_membrane'

#: A category no request below names, so an unasked boolean can be looked for.
UNASKED_CATEGORY = 'lysosome'

#: The two sides, as the tabular output names them.
SIDES = ('source', 'target')

#: Every column the flat pair puts on a row, named in full. `source_count` is
#: deliberately not among them: it begins with a side and is a per-interaction
#: count, so a test that swept the prefix would demand the fold's own resource
#: count be dropped along with the endpoints.
FLAT_NODE_COLUMNS = tuple(
    f'{side}{suffix}'
    for side in SIDES
    for suffix in (*NODE_COLUMNS, '_uniprots', '_gene_ids', '_role')
)

#: What the graph stores about one participation rather than about the entity.
PARTICIPATION_DETAIL = ('side', 'ordinal', 'stoichiometry', 'compartment')

#: A page wide enough that the annotation layers meet more than one resource.
PAGE = 200


@pytest.fixture(scope = 'module')
def db():
    """An open read-only connection to the built database."""

    pytest.importorskip('psycopg')

    import psycopg
    from psycopg.rows import dict_row

    conn = psycopg.connect(DATABASE_URL, row_factory = dict_row)

    try:

        yield conn

    finally:

        conn.close()


def _run(db, payload: dict[str, Any]) -> dict[str, Any]:
    """Answer one request through the engine, on the test's own connection.

    Args:
        db: An open connection.
        payload: The request.

    Returns:
        The engine's answer.
    """

    from api_service.interactions import engine

    return engine.run(payload, conn = db)


def _preset_page(db, **extra: Any) -> list[dict[str, Any]]:
    """One page of the ligand-receptor preset.

    Args:
        db: An open connection.
        extra: Further request terms.

    Returns:
        The rows.
    """

    return _run(
        db,
        {'filters': {'datasets': [PRESET]}, 'limit': PAGE, **extra},
    )['interactions']


@pytest.fixture(scope = 'module')
def gene_rows(db) -> list[dict[str, Any]]:
    """The preset's first page in the gene-centric view."""

    rows = _preset_page(db, view = 'gene')

    if not rows:

        pytest.skip('the ligand-receptor preset returned no rows')

    return rows


@pytest.fixture(scope = 'module')
def protein_rows(db) -> list[dict[str, Any]]:
    """The same page in the protein-centric view."""

    return _preset_page(db, view = 'protein')


@pytest.fixture(scope = 'module')
def selected_rows(db) -> list[dict[str, Any]]:
    """The same page with the four rebuildable columns named."""

    return _preset_page(db, view = 'gene', attributes = list(SELECTED_COLUMNS))


def _declared_attributes(db, preset: str) -> list[str]:
    """What the registry says one preset's consumers expect to find.

    A preset declares the attributes its own consumers read, and the engine
    adds them to a request that names none of its own. So a column that has
    left the default row is still on a preset page while the registry declares
    it, and that is a pending registry write rather than a property of the
    code — the test below reads the registry instead of hard-coding either
    answer.

    Args:
        db: An open connection.
        preset: The preset name.

    Returns:
        The declared default attributes.
    """

    rows = db.execute(
        f"""
        SELECT default_attributes
        FROM {SCHEMA}.network_registry
        WHERE name = %s
        """,
        (preset,),
    ).fetchall()

    return list(rows[0]['default_attributes'] or []) if rows else []


# ── The two views ───────────────────────────────────────────────────────────


def test_the_gene_view_leads_with_a_gene_id_and_carries_the_proteins(gene_rows):
    """One NCBI Gene id, a symbol as its label, and a UniProt array beside it."""

    leading = [
        row for row in gene_rows
        if str(row['source'] or '').isdigit() and row['source_uniprots']
    ]

    assert leading, (
        'no row of the ligand-receptor preset leads with a numeric gene id '
        'carrying proteins, on a class whose endpoints are gene entities'
    )

    for row in leading:

        assert 'source_uniprots' in row and 'target_uniprots' in row
        assert isinstance(row['source_uniprots'], list)
        assert row['source_label'] and row['source_label'] != row['source'], (
            'the gene view labels a node with its symbol, not with its id '
            'repeated'
        )


def test_the_protein_view_leads_with_an_accession_and_carries_the_genes(protein_rows):
    """One UniProt, a symbol as its label, and a gene-id array beside it."""

    assert protein_rows, 'the protein view returned no rows'

    for row in protein_rows:

        assert 'source_gene_ids' in row and 'target_gene_ids' in row

    leading = [
        row for row in protein_rows
        if row['source_gene_ids'] and row['source'] not in row['source_gene_ids']
    ]

    assert leading, (
        'no row leads with an accession carrying its gene ids; the array the '
        'protein view is named for is empty everywhere'
    )

    for row in leading:

        assert not str(row['source'] or '').isdigit(), (
            f'{row["source"]!r} leads the protein view but reads as a gene id'
        )
        assert str(row['source_gene_ids'][0]).isdigit()


def test_a_node_with_no_protein_falls_back_to_what_it_is_known_by(protein_rows):
    """The fallback is the entity's own identifier, never nothing.

    Not every gene in this build has a representative protein — a row whose
    leading identifier were null would be a row a caller cannot join on, which
    is worse than an identifier in the wrong namespace. So the protein view
    falls back to the node's canonical identifier and says so by leaving it in
    the gene-id array beside it.
    """

    fallen = [
        row for row in protein_rows
        if row['source_gene_ids'] and row['source'] in row['source_gene_ids']
    ]

    for row in fallen:

        assert row['source'], 'a node came back with no identifier at all'

    assert all(row['source'] is not None for row in protein_rows), (
        'the protein view left a node unnamed'
    )


def test_the_two_views_return_the_same_interactions(gene_rows, protein_rows):
    """`view` renames the identifiers. It does not select different rows."""

    def keys(rows: list[dict[str, Any]]) -> list[tuple[str, str, int]]:

        return [
            (
                str(row['subject_entity_id']),
                str(row['object_entity_id']),
                int(row['interaction_class_id']),
            )
            for row in rows
        ]

    assert keys(gene_rows) == keys(protein_rows), (
        'the two views disagree about which interactions exist, so one of them '
        'is a filter rather than a projection'
    )


def test_every_node_column_is_present_on_every_row(gene_rows):
    """A frame consumer reads columns, so no key may appear only sometimes."""

    for row in gene_rows:

        for side in SIDES:

            missing = [
                f'{side}{suffix}' for suffix in NODE_COLUMNS
                if f'{side}{suffix}' not in row
            ]

            assert not missing, f'{missing} absent from a row'


# ── The standard interaction columns ────────────────────────────────────────


def test_every_standard_column_is_present_on_every_row(gene_rows):
    """The legacy column set, in full, on every row of a plain query."""

    for row in gene_rows:

        missing = [name for name in STANDARD_COLUMNS if name not in row]

        assert not missing, f'{missing} absent from a row'


def test_the_rebuildable_columns_leave_the_default_row(db, gene_rows):
    """Four columns are selected rather than given, and that is the change."""

    declared = set(_declared_attributes(db, PRESET))

    for row in gene_rows:

        for name in SELECTED_COLUMNS:

            if name in declared:

                continue

            assert name not in row, (
                f'{name} is on a row that never named it; it is rebuildable '
                f'from what the row already carries'
            )


def test_each_rebuildable_column_returns_when_it_is_named(selected_rows):
    """Naming one costs nothing: every one of them is already on the row."""

    assert selected_rows, 'the preset returned no rows'

    for row in selected_rows:

        missing = [name for name in SELECTED_COLUMNS if name not in row]

        assert not missing, f'{missing} absent from a row that named them'


def test_a_page_keyed_on_the_interaction_carries_its_members_unasked(db):
    """Where the row is not a pair, the array is the only ends it has.

    The gate is the key shape and nothing else — not the grain word a request
    wrote, not the dataset it named — so the preset registered at participant
    grain carries the array without asking for it, while an ordered pair has
    to name it.
    """

    rows = _run(
        db,
        {'filters': {'datasets': [REACTION_PRESET]}, 'limit': 5},
    )['interactions']

    if not rows:

        pytest.skip(f'the {REACTION_PRESET} preset returned no rows')

    for row in rows:

        assert row['participants'], (
            'a row keyed on the interaction came back naming no endpoint at '
            'all, so the array was dropped where it is the only ends there are'
        )
        assert 'source' not in row, (
            'a row keyed on the interaction carries a flat pair it has no '
            'first and second end for'
        )


def test_the_type_is_a_slug_and_the_label_is_the_display_form(gene_rows, selected_rows):
    """A caller filters by slug. The capitalised form is output-side only."""

    for row in gene_rows:

        assert row['interaction_type'] == CLASS_SLUG

    for row in selected_rows:

        assert row['interaction_type_label'] == CLASS_LABEL


def test_the_provenance_columns_are_delimiter_joined_strings(selected_rows):
    """`resources` is a string, and it names exactly what `sources` holds."""

    for row in selected_rows:

        assert isinstance(row['resources'], str), (
            f'resources came back as {type(row["resources"]).__name__}; the '
            f'legacy column is a joined string'
        )
        assert row['resources'].split(DELIMITER) == sorted(row['sources']), (
            'the joined column and the array disagree about the contributors'
        )
        assert isinstance(row['references'], str)


def test_a_preset_scoped_query_names_the_preset_it_was_asked_for(gene_rows):
    """The legacy scalar means "the dataset you asked for"."""

    for row in gene_rows:

        assert row['interaction_dataset'] == PRESET, (
            f'a query scoped to one preset returned '
            f'{row["interaction_dataset"]!r} as its dataset scalar'
        )


def test_the_raw_dataset_array_is_always_available(gene_rows):
    """`interaction_datasets` keeps the structure the scalar flattens."""

    for row in gene_rows:

        assert isinstance(row['interaction_datasets'], list)
        assert PRESET in row['interaction_datasets'], (
            'a row served under a preset does not carry that preset among its '
            'tags'
        )


def test_an_unscoped_query_joins_the_tags_rather_than_picking_one(db):
    """With no preset asked for, the scalar is every tag the row carries."""

    rows = _run(
        db,
        {
            'filters': {'interaction_classes': [CLASS_SLUG]},
            'limit': PAGE,
        },
    )['interactions']
    tagged = [row for row in rows if row['interaction_datasets']]

    assert tagged, (
        'no row of a class a registered preset covers carries a dataset tag'
    )

    for row in tagged:

        assert row['interaction_dataset'] == DELIMITER.join(
            row['interaction_datasets'],
        ), (
            'an unscoped query must join the tags rather than choose among '
            'them, or the column silently loses one'
        )


# ── The participant array ───────────────────────────────────────────────────


def test_a_binary_row_carries_two_participants(selected_rows):
    """The hyperedge form of the same row, length two in this release."""

    for row in selected_rows:

        assert 'participants' in row, 'the participant array is absent'
        assert len(row['participants']) == 2, (
            f'a binary interaction came back with {len(row["participants"])} '
            f'participants'
        )


def test_a_participant_says_the_same_thing_as_the_flat_columns(selected_rows):
    """The nested form is the flat form rearranged, never a second answer."""

    for row in selected_rows:

        for side, participant in zip(SIDES, row['participants']):

            assert participant['entity'] == row[side]
            assert participant['label'] == row[f'{side}_label']
            assert participant['organism'] == row[f'{side}_organism']
            assert participant['entity_type'] == row[f'{side}_entity_type']
            assert participant['role'] == row[f'{side}_role']


def test_a_folded_pair_reports_no_participation_detail(selected_rows):
    """A pair may speak for several interactions, so it names none of theirs.

    The side, the ordinal, the stoichiometry and the compartment are stored per
    participation, and a row keyed on an ordered pair folds every interaction
    reported under that pair. There is no one participant row for it to report,
    and a null in its place would claim the build looked and found nothing.
    """

    for row in selected_rows:

        for participant in row['participants']:

            named = [
                name for name in PARTICIPATION_DETAIL if name in participant
            ]

            assert not named, (
                f'a folded ordered pair reports {named} per participant, which '
                f'it can only have taken from one of the interactions it folds'
            )


# ── One row per interaction ─────────────────────────────────────────────────


@pytest.fixture(scope = 'module')
def participant_rows(db) -> list[dict[str, Any]]:
    """The same preset read one row per interaction, whatever its arity."""

    rows = _preset_page(db, view = 'gene', grain = 'participant')

    if not rows:

        pytest.skip('the ligand-receptor preset returned no rows per interaction')

    return rows


def _party_of(db, identifiers: list[str]) -> dict[str, list[tuple[Any, ...]]]:
    """What the graph itself says the members of these interactions are.

    Read straight from the participant table rather than through the engine, so
    the comparison is against the record and not against the projection being
    tested.

    Args:
        db: An open connection.
        identifiers: The interaction ids of one page.

    Returns:
        `{interaction_id: [(role, side, ordinal, label), …]}`, in the order the
        graph holds them.
    """

    rows = db.execute(
        f"""
        SELECT p.interaction_id,
               role.name AS role,
               p.side,
               p.ordinal,
               COALESCE(e.label, e.canonical_identifier) AS label
        FROM {SCHEMA}.interaction_party p
        JOIN {SCHEMA}.vocab_relation_role role
          ON role.relation_role_id = p.role_id
        JOIN {SCHEMA}.entity e ON e.entity_id = p.entity_id
        WHERE p.interaction_id = ANY(%s::uuid[])
        ORDER BY p.interaction_id, p.ordinal NULLS LAST, p.side NULLS LAST,
                 p.entity_id
        """,
        (identifiers,),
    ).fetchall()

    out: dict[str, list[tuple[Any, ...]]] = {}

    for row in rows:

        out.setdefault(str(row['interaction_id']), []).append(
            (row['role'], row['side'], row['ordinal'], row['label']),
        )

    return out


def test_a_row_per_interaction_drops_the_flat_pair(participant_rows):
    """No first and second end, so no column that names one."""

    for row in participant_rows:

        named = [name for name in FLAT_NODE_COLUMNS if name in row]

        assert not named, (
            f'{named} came back on a row that stands for one interaction; an '
            f'empty endpoint column says the build has a source and a target '
            f'and does not know them, which is not what is true of a reaction'
        )

        assert 'source_count' in row, (
            'the per-interaction resource count was dropped along with the '
            'endpoints, on the strength of its name beginning with a side'
        )


def test_the_members_are_the_ones_the_graph_names(db, participant_rows):
    """Role, side, ordinal and identity, each checked against the record."""

    identifiers = [str(row['interaction_id']) for row in participant_rows]
    party = _party_of(db, identifiers)

    assert party, 'the participant table holds nothing for this page at all'

    for row in participant_rows:

        recorded = party[str(row['interaction_id'])]
        served = [
            (
                participant['role'],
                participant['side'],
                participant['ordinal'],
                participant['label'],
            )
            for participant in row['participants']
        ]

        assert served == recorded, (
            f'the members of {row["interaction_id"]} came back as {served} '
            f'where the graph holds {recorded}'
        )


def test_the_member_count_is_the_arity_the_graph_holds(db, participant_rows):
    """Two for a pair of molecules, one for a molecule acting on itself.

    This is where the array stops being the flat pair rewritten. An
    interaction of an entity with itself is stored as the one participant it
    names, and the flat columns report it twice because they have two slots to
    fill. The array reports it once, and reads correctly for a reaction of five
    members for the same reason it reads correctly for this one.
    """

    arity = {
        str(row['interaction_id']): int(row['members'])
        for row in db.execute(
            f"""
            SELECT interaction_id, count(DISTINCT entity_id) AS members
            FROM {SCHEMA}.interaction_party
            WHERE interaction_id = ANY(%s::uuid[])
            GROUP BY 1
            """,
            ([str(row['interaction_id']) for row in participant_rows],),
        ).fetchall()
    }

    for row in participant_rows:

        held = arity[str(row['interaction_id'])]

        assert len(row['participants']) == held, (
            f'{row["interaction_id"]} names {held} entities and came back with '
            f'{len(row["participants"])} participants'
        )

    assert sorted(set(arity.values())) == [1, 2], (
        f'this page carries arities {sorted(set(arity.values()))}; it is meant '
        f'to hold both a pair and a molecule acting on itself, and a page of '
        f'one of them alone cannot show that the count is read rather than '
        f'assumed'
    )


def test_a_member_is_named_the_way_the_requested_view_names_it(db):
    """The view chooses the identifier per participant exactly as per side."""

    rows = _preset_page(db, view = 'protein', grain = 'participant')

    assert rows, 'the protein view returned no rows per interaction'

    for row in rows:

        for participant in row['participants']:

            assert participant['entity'] is not None, (
                'a member came back with no identifier at all'
            )
            assert 'gene_ids' in participant, (
                'the array the protein view is named for is absent from a '
                'member, so the view reaches the flat pair and not the array'
            )

    leading = [
        participant
        for row in rows
        for participant in row['participants']
        if participant['gene_ids']
        and participant['entity'] not in participant['gene_ids']
    ]

    assert leading, (
        'no member leads with an accession carrying its gene ids; the protein '
        'view renders the participant array as the gene view does'
    )


def test_a_page_of_interactions_is_serialisable(participant_rows):
    """The key of this grain is a uuid, and a uuid is not JSON on its own."""

    json.dumps(participant_rows)


def test_the_participation_detail_is_projected_even_where_it_is_empty(
        db,
        participant_rows,
):
    """Both columns are read; this build happens to hold neither.

    The keys are asserted first and unconditionally, because their presence is
    the projection doing its work. Only the values depend on a build that
    states any, and where none are stated the test says so rather than passing
    on the silence.
    """

    for row in participant_rows:

        for participant in row['participants']:

            missing = [
                name for name in PARTICIPATION_DETAIL
                if name not in participant
            ]

            assert not missing, f'{missing} absent from a member'

    stated = db.execute(
        f"""
        SELECT p.interaction_id, p.stoichiometry, p.compartment
        FROM {SCHEMA}.interaction_party p
        WHERE p.stoichiometry IS NOT NULL OR p.compartment IS NOT NULL
        LIMIT 1
        """,
    ).fetchone()

    if stated is None:

        pytest.skip(
            'no participant row of this build states a stoichiometry or a '
            'compartment: every one of the 28,003,036 of them leaves both '
            'null, so a value assertion here would pass on the absence of the '
            'data rather than on the projection of it'
        )

    served = [
        participant
        for row in _run(
            db,
            {
                'filters': {'entities': _entities_of(db, stated['interaction_id'])},
                'grain': 'participant',
                'limit': PAGE,
            },
        )['interactions']
        if str(row['interaction_id']) == str(stated['interaction_id'])
        for participant in row['participants']
    ]

    assert served, (
        f'{stated["interaction_id"]} states a stoichiometry or a compartment '
        f'and no page reached it'
    )
    assert any(
        participant['stoichiometry'] is not None
        or participant['compartment'] is not None
        for participant in served
    ), (
        'the interaction the record states a stoichiometry or a compartment '
        'for came back with neither on any member'
    )


def _entities_of(db, interaction_id) -> list[str]:
    """The entity ids one interaction names, as a filter reaches them.

    Args:
        db: An open connection.
        interaction_id: The interaction.

    Returns:
        The entity ids, as strings.
    """

    rows = db.execute(
        f'SELECT entity_id FROM {SCHEMA}.interaction_party '
        f'WHERE interaction_id = %s::uuid',
        (str(interaction_id),),
    ).fetchall()

    return [str(row['entity_id']) for row in rows]


def test_a_reaction_comes_back_as_one_row_naming_every_member(db):
    """The case the grain exists for, when a build carries one."""

    wide = db.execute(
        f"""
        SELECT interaction_id, count(DISTINCT entity_id) AS members
        FROM {SCHEMA}.interaction_party
        GROUP BY 1
        HAVING count(DISTINCT entity_id) > 2
        ORDER BY 2 DESC
        LIMIT 1
        """,
    ).fetchone()

    if wide is None:

        pytest.skip(
            'no interaction of this build names more than two entities — '
            '13,998,969 name a pair and 5,098 a molecule acting on itself — '
            'because the record stores ordered pairs and no derive has run '
            'since the wider shape landed; there is no reaction here whose '
            'members could outnumber a pair'
        )

    rows = [
        row for row in _run(
            db,
            {
                'filters': {'entities': _entities_of(db, wide['interaction_id'])},
                'grain': 'participant',
                'limit': PAGE,
            },
        )['interactions']
        if str(row['interaction_id']) == str(wide['interaction_id'])
    ]

    assert len(rows) == 1, (
        f'a reaction of {wide["members"]} members came back as {len(rows)} rows'
    )
    assert len(rows[0]['participants']) == wide['members'], (
        f'a reaction of {wide["members"]} members came back naming '
        f'{len(rows[0]["participants"])} of them'
    )

# ── The layered node annotations ────────────────────────────────────────────


def test_the_default_layer_is_a_compact_class_array(gene_rows):
    """A per-node array of the categories a node carries, and nothing wider."""

    annotated = [row for row in gene_rows if row['source_annotation_class']]

    assert annotated, (
        f'no endpoint of the ligand-receptor preset carries an annotation '
        f'category, on a build where {SOURCE_CATEGORY} alone reaches 36 of '
        f'this page\'s source endpoints'
    )

    for row in gene_rows:

        for side in SIDES:

            assert isinstance(row[f'{side}_annotation_class'], list)
            # The scalar beside the array. Present on every row and null on a
            # protein, because a metabolic domain is a property of a chemical
            # and a key that appears only sometimes is a column a frame
            # consumer cannot read.
            assert f'{side}_metabolic_domain' in row
            assert row[f'{side}_metabolic_domain'] is None or isinstance(
                row[f'{side}_metabolic_domain'], str,
            )

        assert f'{SIDES[0]}_annotation' not in row, (
            'the by-resource object is opt-in and must not widen the default '
            'frame'
        )
        assert f'{SIDES[0]}_annotation_function' not in row, (
            'the protein-function layer is 41,399 terms and reaches no '
            'default column'
        )
        assert not [name for name in row if name.startswith('source_is_')], (
            'a per-category boolean appeared without being asked for'
        )


def test_an_endpoint_with_no_class_reports_the_empty_value(gene_rows):
    """Absence is T098's empty value of the field's own type, never a gap."""

    bare = [row for row in gene_rows if not row['source_annotation_class']]

    assert bare, (
        'every source endpoint of this page carries a category, so the empty '
        'case is untested; widen the page or pick a preset with thinner '
        'coverage'
    )

    for row in bare:

        assert row['source_annotation_class'] == [], (
            f'an unannotated endpoint reports '
            f'{row["source_annotation_class"]!r} rather than the empty array'
        )
        assert 'source_annotation_class' in row, (
            'the key was dropped rather than emptied, so a frame consumer '
            'cannot tell an unannotated endpoint from a missing column'
        )


@pytest.mark.skip(
    reason = (
        'Phase 9 owns this. T100 puts `ligand` and `receptor` explicitly out '
        'of scope: the model states a role per assertion, so an entity-level '
        'flag needs the cross-resource consensus the Intercell rebuild '
        '(FR-029, US6) produces. The interim layer serves locations and '
        'chemical classes, and faking a role flag from them would publish a '
        'consensus nothing computed. Re-enable this when the rebuild lands.'
    ),
)
def test_the_ligand_receptor_roles_reach_the_default_layer(gene_rows):
    """The preset's own endpoints are annotated as what they are."""

    ligands = [
        row for row in gene_rows
        if 'ligand' in (row['source_annotation_class'] or [])
    ]
    receptors = [
        row for row in gene_rows
        if 'receptor' in (row['target_annotation_class'] or [])
    ]

    assert ligands, 'no source endpoint is annotated as a ligand'
    assert receptors, 'no target endpoint is annotated as a receptor'


def test_the_full_layer_is_a_by_resource_object(db):
    """Asked for, each node gains `{category: [resources]}` with the sources named."""

    rows = _preset_page(db, attributes = ['annotation.full'])
    objects = [
        (side, row) for row in rows for side in SIDES
        if row.get(f'{side}_annotation')
    ]

    assert objects, 'the full annotation layer came back empty everywhere'

    multi = 0

    for side, row in objects:

        assert isinstance(row[f'{side}_annotation'], dict)

        for category, resources in row[f'{side}_annotation'].items():

            assert isinstance(resources, list) and resources, (
                f'{category!r} carries no resource, so the layer preserves no '
                f'provenance'
            )
            assert category in row[f'{side}_annotation_class'], (
                f'{category!r} is in the object but not in the summary the '
                f'object is supposed to detail'
            )

            multi += len(resources) > 1

    assert multi, (
        'no category anywhere on the page names more than one resource, on a '
        'build where LOCATE and UniProt both place proteins in the cytoplasm'
    )


def test_the_metabolic_domain_names_no_resource(db):
    """A derived column has no contributor, and must not claim one.

    Read against a compound-protein page rather than the ligand-receptor
    preset, because the domain is a property of a chemical and every endpoint
    of a ligand-receptor pair is a protein — the assertion would hold
    vacuously there.
    """

    from api_service.interactions import annotate

    rows = _run(
        db,
        {
            'filters': {'datasets': ['metalinksdb']},
            'limit': PAGE,
            'attributes': ['annotation.full'],
        },
    )['interactions']
    # The six buckets as the vocabulary declares them, not as the page happens
    # to use them: a page that carried only `other` would make this vacuous.
    domains = {
        term.category for term in annotate.vocabulary(db).terms.values()
        if term.layer == annotate.DOMAIN_LAYER
    }
    served = [
        row for row in rows for side in SIDES
        if row[f'{side}_metabolic_domain']
    ]

    assert len(domains) > 1, 'the domain vocabulary is a single bucket'
    assert served, 'no endpoint of this page carries a metabolic domain'

    for row in rows:

        for side in SIDES:

            named = set(row.get(f'{side}_annotation') or {})

            assert not (named & domains), (
                f'the by-resource object names {sorted(named & domains)}, '
                f'which is a metabolic domain — a column of `entity` that no '
                f'resource asserted, so the object cannot honestly name one'
            )


def test_named_categories_come_back_as_flat_booleans(db):
    """`annotation:is_<category>` becomes four boolean columns."""

    rows = _preset_page(
        db,
        attributes = [f'annotation:is_{SOURCE_CATEGORY},is_{TARGET_CATEGORY}'],
    )

    assert rows

    for row in rows:

        for side in SIDES:

            for name in (f'is_{SOURCE_CATEGORY}', f'is_{TARGET_CATEGORY}'):

                column = f'{side}_{name}'

                assert column in row, f'{column} was asked for and is absent'
                assert isinstance(row[column], bool), (
                    f'{column} came back as {type(row[column]).__name__}'
                )

        assert f'source_is_{UNASKED_CATEGORY}' not in row, (
            'a category nobody named was materialised anyway'
        )

    assert any(row[f'source_is_{SOURCE_CATEGORY}'] for row in rows), (
        f'no source endpoint of the ligand-receptor preset is in the '
        f'{SOURCE_CATEGORY}'
    )


def test_a_boolean_is_true_inside_a_location_and_false_outside_it(db):
    """Both values appear, or the flag is a constant rather than a statement."""

    rows = _preset_page(db, attributes = [f'annotation:is_{TARGET_CATEGORY}'])
    inside = [row for row in rows if row[f'target_is_{TARGET_CATEGORY}']]
    outside = [row for row in rows if not row[f'target_is_{TARGET_CATEGORY}']]

    assert inside, (
        f'no target endpoint reads true for {TARGET_CATEGORY}, which 33 of '
        f'this page\'s target endpoints carry'
    )
    assert outside, (
        f'every target endpoint reads true for {TARGET_CATEGORY}; a boolean '
        f'that is never false distinguishes nothing'
    )

    for row in inside:

        assert TARGET_CATEGORY in row['target_annotation_class']

    for row in outside:

        assert TARGET_CATEGORY not in row['target_annotation_class']


def test_a_boolean_agrees_with_the_summary_it_is_drawn_from(db):
    """The layers are renderings of one annotation, not independent reads."""

    rows = _preset_page(db, attributes = [f'annotation:is_{SOURCE_CATEGORY}'])

    for row in rows:

        assert row[f'source_is_{SOURCE_CATEGORY}'] == (
            SOURCE_CATEGORY in (row['source_annotation_class'] or [])
        )


def test_a_new_category_reaches_all_three_layers_without_moving_a_column(db, monkeypatch):
    """Extensibility: the default schema is fixed, the vocabulary is not.

    The property is SC-016's and survives T100 unchanged; the mechanism does
    not. There is no flat `{term: category}` constant to poke any more — the
    vocabulary is a per-layer declaration of `(predicate, namespace)` pairs,
    read from `omnipath.relation` and pruned to the terms that populate — so
    the extension here adds a **vocabulary**, which is the smallest thing a
    deployment can actually add.
    """

    from api_service.interactions import annotate

    before = sorted(
        name for name in _preset_page(db, limit = 5)[0]
        if name.startswith(('source_', 'target_'))
    )

    # `located_in` to `vesiclepedia_vesicle_type`: 23 terms over 89,603 links,
    # a real namespace T100 leaves off the allow-list because it is one
    # resource's private localisation idiom. That makes it the honest test
    # subject — it is populated, so the pruning cannot hide it, and it is not
    # already served, so the categories it adds are new.
    widened = dict(annotate.LAYERS)
    widened['location'] = annotate.Layer(
        vocabularies = (
            *annotate.LAYERS['location'].vocabularies,
            annotate.Vocabulary(
                'located_in', 'vesiclepedia_vesicle_type', rank = 0,
            ),
        ),
        note = annotate.LAYERS['location'].note,
    )
    monkeypatch.setattr(annotate, 'LAYERS', widened)
    annotate.forget()

    try:

        after = sorted(
            name for name in _preset_page(db, limit = 5)[0]
            if name.startswith(('source_', 'target_'))
        )
        added = set(annotate.categories(db)) - set(before)

        assert after == before, (
            f'registering a vocabulary changed the default columns: '
            f'{sorted(set(after) ^ set(before))}'
        )
        assert added, (
            'the added vocabulary registered no category, so the test proves '
            'nothing about what registering one costs'
        )

        category = sorted(added)[0]
        rows = _preset_page(
            db, limit = 5, attributes = [f'annotation:is_{category}'],
        )

        assert f'source_is_{category}' in rows[0], (
            'a newly registered category is not available as a boolean'
        )

    finally:

        monkeypatch.undo()
        annotate.forget()


def test_an_unpopulated_category_is_absent_rather_than_registered_empty(db):
    """The registered set is derived from a count, not from the declaration.

    This is the property whose absence hid the defect T100 repairs. The layer
    was keyed on five declared terms, all five returned no rows, and nothing
    anywhere compared the declaration against the data — so the vocabulary
    reported five categories while serving none of them.
    """

    from api_service.interactions import annotate

    known = annotate.vocabulary(db)

    assert known.counts, 'the vocabulary registers nothing at all'

    empty = [
        category for category, count in known.counts.items() if count < 1
    ]

    assert not empty, (
        f'{empty[:10]} are registered with no entity behind them; a category '
        f'the vocabulary cannot populate has to be absent rather than '
        f'registered and empty'
    )

    # And the pruning is doing work rather than passing everything through.
    # `located_in`→`go` reaches 38 of the 19,068 GO terms the entity table
    # holds, so the registered set has to be far smaller than the declared
    # namespaces' term count or nothing is being pruned.
    declared = db.execute(
        f"""
        SELECT count(*)::bigint AS terms
        FROM {SCHEMA}.entity e
        JOIN {SCHEMA}.vocab_identifier_type it
          ON it.identifier_type_id = e.canonical_identifier_type_id
        WHERE it.name = ANY(%s::text[])
        """,
        ([
            item.namespace
            for name, layer in annotate.LAYERS.items()
            if layer.default
            for item in layer.vocabularies
        ],),
    ).fetchone()['terms']

    assert len(known.terms) < declared, (
        f'{len(known.terms)} terms are registered out of {declared} the '
        f'declared namespaces hold; the declaration is reaching the registry '
        f'unpruned'
    )

# ── The protein-function layer, served on request alone ─────────────────────


def test_the_function_layer_reaches_no_default_column(gene_rows):
    """41,399 terms stay out of the default frame, including its summary."""

    for row in gene_rows:

        for side in SIDES:

            assert f'{side}_annotation_function' not in row, (
                'the function layer reached a default column'
            )


def test_a_request_that_does_not_name_the_function_layer_pays_nothing(db, monkeypatch):
    """Not asking for it must not read it — the cost is the point."""

    from api_service.interactions import annotate

    read: list[str] = []
    original = annotate._collect_functions

    def _watch(*args, **kwargs):

        read.append('called')

        return original(*args, **kwargs)

    monkeypatch.setattr(annotate, '_collect_functions', _watch)

    _preset_page(db, limit = 20)

    assert not read, (
        'a request naming no function layer still read it; the layer is out '
        'of the default row precisely so a page does not pay for it'
    )

    _preset_page(db, limit = 20, attributes = ['annotation.function'])

    assert read, 'a request naming the function layer did not read it'


def test_the_function_layer_is_an_array_of_its_own(db):
    """Asked for, it is a separate array and never joins the summary."""

    rows = _preset_page(db, attributes = ['annotation.function'])
    served = [row for row in rows if row['target_annotation_function']]

    assert served, (
        'the function layer came back empty on every target endpoint, on a '
        'build where 22,664 proteins carry a GO function term'
    )

    for row in rows:

        for side in SIDES:

            assert isinstance(row[f'{side}_annotation_function'], list)

    from api_service.interactions import annotate

    served_values = {
        value for row in served for value in row['target_annotation_function']
    }

    assert served_values - set(annotate.categories(db)), (
        'every function category is also a registered one, so the array adds '
        'nothing the default summary does not already carry and the layer '
        'proves nothing about being open'
    )
    # A slug may be in both, and that is a coincidence of labels rather than a
    # leak: `associated_with`→`go` carries GO cellular components beside the
    # function terms, so `plasma_membrane` is a legitimate member of both the
    # location layer (under `located_in`) and this one. What must not happen is
    # the *function* vocabulary registering as a category, which the assertion
    # above holds.


def test_the_function_layer_takes_a_vocabulary_subset(db):
    """`annotation.function:ec` asks for one of its three vocabularies."""

    whole = _preset_page(db, attributes = ['annotation.function'])
    part = _preset_page(db, attributes = ['annotation.function:ec'])
    wide = {value for row in whole for value in row['target_annotation_function']}
    narrow = {value for row in part for value in row['target_annotation_function']}

    assert narrow < wide, (
        f'naming one vocabulary returned {len(narrow)} categories against the '
        f'whole layer\'s {len(wide)}; the subset is not a restriction'
    )


# ── The allow-list, which is the whole of what reaches a column ─────────────


def test_an_object_outside_a_declared_namespace_never_reaches_a_column(db):
    """Nine localisation namespaces are excluded, and must stay excluded."""

    rows = _preset_page(db, limit = PAGE)
    served = {
        value for row in rows for side in SIDES
        for value in row[f'{side}_annotation_class']
    }
    # `located_in` carries twelve object namespaces and the allow-list takes
    # three. These four come from the excluded nine and are measured as present
    # in `relation` on this build, so if any of them reaches a column the
    # filter is on the namespace-free path.
    excluded = _excluded_terms(
        db,
        (
            'vesiclepedia_vesicle_type',
            'membranome_membrane',
            'humancellmap_localization',
            'locate_protein_class',
        ),
    )

    assert excluded, 'the excluded namespaces returned no term to test against'
    assert not (served & excluded), (
        f'{sorted(served & excluded)} reached a column from a namespace no '
        f'layer declares'
    )


def test_a_keyword_outside_the_declared_list_never_reaches_a_column(db):
    """`uniprot_keyword` needs a term list as well as a namespace entry."""

    from api_service.interactions import annotate

    rows = _preset_page(db, limit = PAGE)
    served = {
        value for row in rows for side in SIDES
        for value in row[f'{side}_annotation_class']
    }
    # 687 of the 1,201 UniProt keywords are used as `associated_with` objects
    # and 71 are declared. These five are used, undeclared, and each is the
    # kind of near-miss a label match would admit: a role, a PTM, a process and
    # two technical terms.
    rejected = _keyword_labels(
        db, ('KW-0675', 'KW-0325', 'KW-0130', 'KW-0002', 'KW-0025'),
    )

    assert rejected, 'the rejected keywords returned no label to test against'
    assert not (served & rejected), (
        f'{sorted(served & rejected)} reached a column from a keyword the '
        f'declared list rejects'
    )

    for accession in ('KW-0675', 'KW-0325', 'KW-0130', 'KW-0002', 'KW-0025'):

        assert accession not in annotate.LOCATION_KEYWORDS, (
            f'{accession} was added to the declared list; it names a role, a '
            f'PTM, a process or a technical term rather than a location'
        )


def test_the_top_of_the_chemont_tree_never_reaches_a_column(db):
    """ChemOnt's top two levels are withdrawn, stated facts included.

    The namespace has one root, `CHEMONTID:9999999` "Chemical entities", over
    `CHEMONTID:0000000` "Organic compounds" and `CHEMONTID:0000001` "Inorganic
    compounds". None of the three distinguishes anything in a build of
    metabolites, and `chemont` declares `drop_top_levels = 2` so that all three
    leave the layer: unregistered, unrendered, unenumerated and therefore
    unrequestable. The resources that state one of them directly go with them —
    2,234 entities carry `Organic compounds` as a fact of their own, and
    rendering the category for exactly those would publish a provenance
    artefact as a distinction.
    """

    from api_service.interactions import annotate

    cut = (
        'CHEMONTID:9999999', 'CHEMONTID:0000000', 'CHEMONTID:0000001',
    )
    known = annotate.vocabulary(db)
    # The entities that state one of the three directly, which are the hard
    # case: the roll-up never reaches them, the base read did.
    stated = [
        str(row['entity_id']) for row in db.execute(
            f"""
            SELECT DISTINCT r.subject_entity_id AS entity_id
            FROM {SCHEMA}.relation r
            JOIN {SCHEMA}.vocab_relation_predicate p
              ON p.relation_predicate_id = r.predicate_id
            JOIN {SCHEMA}.entity oe ON oe.entity_id = r.object_entity_id
            JOIN {SCHEMA}.vocab_identifier_type it
              ON it.identifier_type_id = oe.canonical_identifier_type_id
            WHERE p.name = 'associated_with'
              AND it.name = 'chemont'
              AND oe.canonical_identifier = ANY(%s::text[])
            ORDER BY 1
            LIMIT %s
            """,
            (list(cut), PAGE),
        ).fetchall()
    ]

    assert stated, (
        'no entity states one of the three directly, so the half of the rule '
        'that drops a stated fact is untested'
    )
    registered = [
        key for key in known.terms
        if key[0] == 'chemont' and key[1] in cut
    ]

    assert not registered, (
        f'{registered} is registered; a suppressed term must not be a term '
        f'at all, or a refusal would accept the category it enumerates'
    )
    assert not [
        found for values in known.ancestors.values() for found in values
        if found[0] == 'chemont' and found[1] in cut
    ], 'a suppressed term is still an ancestor, so a roll-up would add it'

    # The two labels ChemOnt alone carries. `Inorganic compounds` is left out
    # of this comparison on purpose: RefMet states it as a super class of its
    # own on two entities, which is a different term that happens to slug the
    # same, and that one is kept.
    gone = {
        annotate.slug('Chemical entities'),
        annotate.slug('Organic compounds'),
    }
    enumerated = set(annotate.categories(db))

    assert not (gone & enumerated), (
        f'{sorted(gone & enumerated)} is enumerated by categories(), so a '
        f'filter would accept a category no row can carry'
    )
    inorganic = annotate.slug('Inorganic compounds')

    assert not [
        key for key in known.by_category.get(inorganic, ())
        if key[0] == 'chemont'
    ], (
        'the surviving inorganic_compounds category still names its ChemOnt '
        'term; it has to be RefMet\'s alone'
    )

    rendered = {
        category
        for entry in annotate.page(stated, conn = db).values()
        for category in entry.classes
    }

    assert not (gone & rendered), (
        f'{sorted(gone & rendered)} reached the summary array of an entity '
        f'whose own resource stated it; the cut has to take the stated facts '
        f'too'
    )
    assert annotate.unknown_categories(sorted(gone), db) == sorted(gone), (
        'a suppressed category is still accepted by the selection filter'
    )


def _excluded_terms(db, namespaces: tuple[str, ...]) -> set[str]:
    """The categories the excluded localisation namespaces would contribute.

    Args:
        db: An open connection.
        namespaces: The `vocab_identifier_type.name` values to read.

    Returns:
        The slugs their terms would become.
    """

    from api_service.interactions import annotate

    rows = db.execute(
        f"""
        SELECT DISTINCT COALESCE(NULLIF(oe.label, oe.canonical_identifier),
                                 oe.canonical_identifier) AS label
        FROM {SCHEMA}.relation r
        JOIN {SCHEMA}.entity oe ON oe.entity_id = r.object_entity_id
        JOIN {SCHEMA}.vocab_identifier_type it
          ON it.identifier_type_id = oe.canonical_identifier_type_id
        WHERE it.name = ANY(%s::text[])
        """,
        (list(namespaces),),
    ).fetchall()
    found = {annotate.slug(row['label']) for row in rows}

    # A term whose label a *declared* vocabulary also uses is not evidence
    # either way, so it leaves the comparison.
    return found - set(annotate.categories(db))


def _keyword_labels(db, accessions: tuple[str, ...]) -> set[str]:
    """The categories a set of UniProt keywords would contribute.

    Args:
        db: An open connection.
        accessions: The `KW-` accessions to read.

    Returns:
        The slugs their labels would become.
    """

    from api_service.interactions import annotate

    rows = db.execute(
        f"""
        SELECT COALESCE(NULLIF(e.label, e.canonical_identifier),
                        e.canonical_identifier) AS label
        FROM {SCHEMA}.entity e
        JOIN {SCHEMA}.vocab_identifier_type it
          ON it.identifier_type_id = e.canonical_identifier_type_id
        WHERE it.name = 'uniprot_keyword'
          AND e.canonical_identifier = ANY(%s::text[])
        """,
        (list(accessions),),
    ).fetchall()
    found = {annotate.slug(row['label']) for row in rows}

    return found - set(annotate.categories(db))


# ── Selecting on a node annotation ──────────────────────────────────────────


def test_an_annotation_filter_returns_only_annotated_endpoints(db):
    """`entity_annotations` selects interactions by what their nodes are."""

    rows = _run(
        db,
        {
            'filters': {
                'entity_annotations': [TARGET_CATEGORY],
                'interaction_classes': [CLASS_SLUG],
            },
            'limit': PAGE,
        },
    )['interactions']

    assert rows, 'the annotation filter returned nothing at all'

    for row in rows:

        annotated = [
            side for side in SIDES
            if TARGET_CATEGORY in (row[f'{side}_annotation_class'] or [])
        ]

        assert annotated, (
            f'an interaction came back neither of whose endpoints is in the '
            f'{TARGET_CATEGORY}; the filter contributed no predicate'
        )


def test_an_annotation_filter_narrows_the_result(db):
    """The filter is a restriction, not a no-op that returns everything."""

    def total(filters: dict[str, Any]) -> int:

        return _run(
            db,
            {'filters': filters, 'limit': 1, 'exact_total': True},
        )['total']

    # A membrane topology keyword rather than a compartment. The compartments
    # are wide — `extracellular region` reaches 76,529 entities and `cytoplasm`
    # 67,469 — and a ligand-receptor pair almost always has one end in one of
    # them, so a compartment here would restrict very little and prove very
    # little. `transmembrane_helix` is a statement about 15 of this page's 200
    # target endpoints, which is a restriction a count can see.
    unfiltered = total({'interaction_classes': [CLASS_SLUG]})
    filtered = total(
        {
            'interaction_classes': [CLASS_SLUG],
            'entity_annotations': ['transmembrane_helix'],
        },
    )

    assert 0 < filtered < unfiltered, (
        f'the annotation filter left {filtered} of {unfiltered} interactions; '
        f'a filter that changes nothing is the failure mode that looks like '
        f'success'
    )


def test_an_unregistered_category_is_refused_rather_than_answered_emptily(db):
    """A misspelt filter target earns a refusal. An empty page would be a claim."""

    from api_service.interactions.guard import GuardrailRefusal

    with pytest.raises(GuardrailRefusal) as refusal:

        _run(db, {'filters': {'entity_annotations': ['ligadn']}, 'limit': 1})

    assert refusal.value.status_code == 400
    assert 'ligadn' in str(refusal.value.context.get('value'))
    assert refusal.value.context.get('known'), (
        'the refusal must name the categories that do exist'
    )


def test_a_refusal_names_the_on_request_vocabularies_and_not_their_terms(db):
    """A function term is a real annotation this filter cannot reach."""

    from api_service.interactions import annotate
    from api_service.interactions.guard import GuardrailRefusal

    # A GO function term, which `associated_with` carries and this filter does
    # not serve. The refusal has to say *why* rather than "no category is
    # registered under it", which is true and unhelpful.
    with pytest.raises(GuardrailRefusal) as refusal:

        _run(
            db,
            {
                'filters': {'entity_annotations': ['protein_binding']},
                'limit': 1,
            },
        )

    context = refusal.value.context
    open_layers = context.get('on_request_only') or []

    assert open_layers, (
        'the refusal names no on-request vocabulary, so a caller filtering on '
        'a function term is told only that nothing is registered under it'
    )
    assert {item['vocabulary'] for item in open_layers} == {
        item.namespace
        for item in annotate.LAYERS[annotate.FUNCTION_LAYER].vocabularies
    }

    for item in open_layers:

        assert item['terms'] > 0, (
            f'{item["vocabulary"]} is reported with no term count, which is '
            f'the whole of what a refusal may say about an open vocabulary'
        )

    body = str(refusal.value) + str(context)

    assert 'protein_binding' in body, 'the refused value is not echoed'
    assert len(str(context.get('known') or [])) < 200_000, (
        'the refusal body carries the whole registry'
    )
