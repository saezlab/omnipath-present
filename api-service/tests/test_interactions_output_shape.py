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

**Node annotations are layered, and the layers are the extensibility.** The
default is a compact per-node array of main classes, so a frame stays narrow.
Asking for the full form gets a by-resource object per node, which is where the
provenance lives. Asking for named categories gets flat booleans, which is what
a dataframe tool wants. Registering a further category must reach all three
without moving a single default column, because that is what makes the annotation
source replaceable underneath.

Alongside the flat pair, every row also carries a `participants` array — length
two for a binary interaction — so the hyperedge form is the same object seen
whole rather than a second shape bolted on later.

    DATABASE_URL=... pytest tests/test_interactions_output_shape.py -v
"""

from __future__ import annotations

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
    'interaction_type_label',
    'interaction_dataset',
    'interaction_datasets',
    'resources',
    'references',
)

#: Per-node columns every row carries, for each side.
NODE_COLUMNS = ('', '_label', '_organism', '_entity_type', '_intercell_class')

#: The two sides, as the tabular output names them.
SIDES = ('source', 'target')

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


def test_the_type_is_a_slug_and_the_label_is_the_display_form(gene_rows):
    """A caller filters by slug. The capitalised form is output-side only."""

    for row in gene_rows:

        assert row['interaction_type'] == CLASS_SLUG
        assert row['interaction_type_label'] == CLASS_LABEL


def test_the_provenance_columns_are_delimiter_joined_strings(gene_rows):
    """`resources` is a string, and it names exactly what `sources` holds."""

    for row in gene_rows:

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


def test_a_binary_row_carries_two_participants(gene_rows):
    """The hyperedge form of the same row, length two in this release."""

    for row in gene_rows:

        assert 'participants' in row, 'the participant array is absent'
        assert len(row['participants']) == 2, (
            f'a binary interaction came back with {len(row["participants"])} '
            f'participants'
        )


def test_a_participant_says_the_same_thing_as_the_flat_columns(gene_rows):
    """The nested form is the flat form rearranged, never a second answer."""

    for row in gene_rows:

        for side, participant in zip(SIDES, row['participants']):

            assert participant['entity'] == row[side]
            assert participant['label'] == row[f'{side}_label']
            assert participant['organism'] == row[f'{side}_organism']
            assert participant['entity_type'] == row[f'{side}_entity_type']
            assert participant['role'] == row[f'{side}_role']


# ── The layered node annotations ────────────────────────────────────────────


def test_the_default_layer_is_a_compact_class_array(gene_rows):
    """A per-node array of main classes, and nothing wider, by default."""

    annotated = [row for row in gene_rows if row['source_intercell_class']]

    assert annotated, (
        'no endpoint of the ligand-receptor preset carries a main class, on a '
        'build where 15,123 entities are annotated as ligands'
    )

    for row in gene_rows:

        for side in SIDES:

            assert isinstance(row[f'{side}_intercell_class'], list)

        assert f'{SIDES[0]}_intercell' not in row, (
            'the by-resource object is opt-in and must not widen the default '
            'frame'
        )
        assert not [name for name in row if name.startswith('source_is_')], (
            'a per-category boolean appeared without being asked for'
        )


def test_the_ligand_receptor_roles_reach_the_default_layer(gene_rows):
    """The preset's own endpoints are annotated as what they are."""

    ligands = [row for row in gene_rows if 'ligand' in (row['source_intercell_class'] or [])]
    receptors = [row for row in gene_rows if 'receptor' in (row['target_intercell_class'] or [])]

    assert ligands, 'no source endpoint is annotated as a ligand'
    assert receptors, 'no target endpoint is annotated as a receptor'


def test_the_full_layer_is_a_by_resource_object(db):
    """Asked for, each node gains `{category: [resources]}` with the sources named."""

    rows = _preset_page(db, attributes = ['intercell.full'])
    objects = [row for row in rows if row.get('source_intercell')]

    assert objects, 'the full annotation layer came back empty everywhere'

    multi = 0

    for row in objects:

        assert isinstance(row['source_intercell'], dict)

        for category, resources in row['source_intercell'].items():

            assert isinstance(resources, list) and resources, (
                f'{category!r} carries no resource, so the layer preserves no '
                f'provenance'
            )
            assert category in row['source_intercell_class'], (
                f'{category!r} is in the object but not in the summary the '
                f'object is supposed to detail'
            )

            multi += len(resources) > 1

    assert multi, (
        'no category anywhere on the page names more than one resource, on a '
        'build where five resources annotate ligands'
    )


def test_named_categories_come_back_as_flat_booleans(db):
    """`intercell:is_ligand,is_receptor` becomes four boolean columns."""

    rows = _preset_page(db, attributes = ['intercell:is_ligand,is_receptor'])

    assert rows

    for row in rows:

        for side in SIDES:

            for name in ('is_ligand', 'is_receptor'):

                column = f'{side}_{name}'

                assert column in row, f'{column} was asked for and is absent'
                assert isinstance(row[column], bool), (
                    f'{column} came back as {type(row[column]).__name__}'
                )

        assert 'source_is_secreted' not in row, (
            'a category nobody named was materialised anyway'
        )

    assert any(row['source_is_ligand'] for row in rows), (
        'no source endpoint of the ligand-receptor preset is a ligand'
    )


def test_a_boolean_agrees_with_the_summary_it_is_drawn_from(db):
    """The three layers are three renderings of one annotation, not three reads."""

    rows = _preset_page(db, attributes = ['intercell:is_ligand'])

    for row in rows:

        assert row['source_is_ligand'] == (
            'ligand' in (row['source_intercell_class'] or [])
        )


def test_a_new_category_reaches_all_three_layers_without_moving_a_column(db, monkeypatch):
    """Extensibility: the default schema is fixed, the vocabulary is not."""

    from api_service.interactions import annotate

    before = sorted(
        name for name in _preset_page(db, limit = 5)[0]
        if name.startswith(('source_', 'target_'))
    )

    monkeypatch.setitem(annotate.CATEGORIES, 'Tissue Location:OM:0691', 'tissue')
    annotate.forget()

    after = sorted(
        name for name in _preset_page(db, limit = 5)[0]
        if name.startswith(('source_', 'target_'))
    )

    assert after == before, (
        f'registering a category changed the default columns: '
        f'{sorted(set(after) ^ set(before))}'
    )
    assert 'tissue' in annotate.categories(), (
        'the new category is not requestable'
    )

    rows = _preset_page(db, limit = 5, attributes = ['intercell:is_tissue'])

    assert 'source_is_tissue' in rows[0], (
        'a newly registered category is not available as a boolean'
    )

    annotate.forget()


# ── Selecting on a node annotation ──────────────────────────────────────────


def test_an_annotation_filter_returns_only_annotated_endpoints(db):
    """`entity_annotations` selects interactions by what their nodes are."""

    rows = _run(
        db,
        {
            'filters': {
                'entity_annotations': ['ligand'],
                'interaction_classes': [CLASS_SLUG],
            },
            'limit': PAGE,
        },
    )['interactions']

    assert rows, 'the annotation filter returned nothing at all'

    for row in rows:

        annotated = [
            side for side in SIDES
            if 'ligand' in (row[f'{side}_intercell_class'] or [])
        ]

        assert annotated, (
            'an interaction came back neither of whose endpoints is annotated '
            'as a ligand; the filter contributed no predicate'
        )


def test_an_annotation_filter_narrows_the_result(db):
    """The filter is a restriction, not a no-op that returns everything."""

    def total(filters: dict[str, Any]) -> int:

        return _run(
            db,
            {'filters': filters, 'limit': 1, 'exact_total': True},
        )['total']

    # A membrane annotation, not a ligand one: every endpoint of this class is
    # annotated as a ligand or a receptor by the resource that publishes it, so
    # `ligand` here restricts nothing and would prove nothing either.
    unfiltered = total({'interaction_classes': [CLASS_SLUG]})
    filtered = total(
        {
            'interaction_classes': [CLASS_SLUG],
            'entity_annotations': ['transmembrane'],
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
