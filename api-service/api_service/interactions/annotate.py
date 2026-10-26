"""
The per-entity annotation layers — what a response says *about* each node.

An interaction says that two molecules meet. Which of them sits in the plasma
membrane, which is secreted, which lipid class the metabolite belongs to is
the same property in every interaction that entity takes part in, so storing
it per interaction would multiply one fact by the degree of the node. It is
stored once per entity, and this module projects it.

**Four layers, not a wide boolean matrix.** A fixed matrix of category columns
grows every time the annotation vocabulary does, and every consumer's frame
changes with it. Instead:

* the default is a compact array of the categories a node carries, so a frame
  stays as narrow as the interaction itself, and the bare layer name
  `annotation` asks for that default form and nothing else;
* `annotation.full` adds a by-resource object per node — `{category:
  [resources]}` — the only form that preserves *who said so*, and it has to be
  named explicitly, because the registry puts the bare name on every
  `metalinksdb` request and the bare name used to mean this one;
* `annotation:is_cytoplasm,is_secreted` adds flat booleans for exactly the
  categories named, because that is what a dataframe tool wants and there is no
  reason to materialise the other three thousand;
* `annotation.function` adds the protein-function array, and nothing else
  reaches it. It is 41,399 terms against the other layers' 4,173, and a
  vocabulary that large belongs behind an explicit request.

Registering a further category reaches the first three and moves no default
column, which is what makes the annotation source replaceable underneath.

**The vocabulary is read whole and the entity links are read per page, and both
halves of that are measurements.** Measured on dev5, 2026-10-23, over
`relation`, which is the store these layers are read from:

* **a page costs about 20 ms** — two hundred endpoints and the three default
  layers through `page`, roll-up and metabolic-domain read included, at 18.4,
  20.4, 21.6, 26.4 and 32.9 ms over five runs. The read itself is one indexed
  statement over `relation_unique_idx`, 11.3 to 23.2 ms for 281 links; the
  domain is a primary-key lookup on `entity` at 3.0 ms; and the
  protein-function layer is a second statement of the same shape, 21.2 to
  27.8 ms in all.
* **the whole index costs 8.4 s and several hundred megabytes resident**, so
  the per-page read never breaks even against an eager one. It is the cheaper
  strategy from the first request and it stays correct when the build changes
  underneath a long-lived process.
* **the resource join costs ten times the page.** `relation_evidence_relation`
  is LIST-partitioned on `source_id` into 172 partitions and a `relation_id`
  lookup prunes none of them, so the same page costs 171 to 260 ms with the
  resource against 20 ms without, and the plan is unstable — 18 s, 73 s and
  211 s for the same rows in different statements. **So the resource is paid
  for only by the request that asks for the by-resource object**, and the fix,
  if it ever has to be on the default path, is an index on
  `relation_evidence_relation (relation_id)`: a build-side change, not a cache
  here.

What *is* cached per process is the **vocabulary** — the terms, their labels,
their populated entity counts and the `subclass_of` tree over the class
vocabularies. It is bounded by the vocabulary rather than by the build's entity
count, so it does not grow when the build gains entities, which is exactly what
the index did. `vocabulary` carries the figures.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

from ..graph import SEARCH_SCHEMA

_log = logging.getLogger(__name__)

# The name a request writes to reach these layers. It is deliberately not
# `intercell`: the terms below are GO cellular components, UniProt keywords,
# UBERON tissues and five chemical class vocabularies, and `intercell` names a
# role classification none of them states, so the name changed with the
# meaning.
LAYER = 'annotation'

# The spelling the registry of dev5 still carries in `mandatory_attributes` and
# in the `annotate` composition step. Accepted on input so a build registered
# before the rename keeps its mandatory attribute instead of dropping it into
# the long-tail projection and coming back null; never emitted, so no column
# name carries it. `_definitions.py` has the new spelling, and re-registering
# the `network_views` product retires this alias.
DEPRECATED_LAYER = 'intercell'

# The suffixes the layers take on a side. **Every one of them is derived from
# `LAYER` rather than spelled out**, because the two that used to be literals
# silently agreed with the constant and would not have moved with it — which is
# precisely how `*_intercell_class` outlived the vocabulary it was named for.
# `_assert_derived` below holds that property rather than trusting it.
SUMMARY_SUFFIX = f'{LAYER}_class'
OBJECT_SUFFIX = LAYER
FUNCTION_SUFFIX = f'{LAYER}_function'
BOOLEAN_PREFIX = 'is_'

# The coarse metabolic domain is a scalar and not a member of the summary
# array, so its column is named for what it is rather than for the layer.
DOMAIN_SUFFIX = 'metabolic_domain'

# **The one switch that decides whether the metabolic domain is served by
# default.** It reads `other` on 99.02 % of this build's chemicals — 1,454,595
# of 1,469,018 — so as a default column it is very nearly constant, and the
# 14,423 chemicals that are not `other` are the only ones it says anything
# about. It is kept on the default row because it costs a 3 ms primary-key
# lookup, though a reviewer may reasonably decide a column that constant
# belongs behind a request. Flipping this to False withdraws
# `*_metabolic_domain` entirely: the column leaves the row, the six buckets
# leave `categories()`, and the lookup stops running. It does not move the
# domain behind a request — giving it a request spelling of its own is a
# further decision, and a one-line switch cannot make it.
SERVE_METABOLIC_DOMAIN = True

# Spellings of "give me the by-resource object", and **no bare layer name is
# one of them**. The bare name means the layer's default form, the compact
# summary array: the object joins `relation_evidence_relation` and cost
# 247–306 ms a page against the summary's 50–59 ms (re-measured 2026-10-26
# over one 244-endpoint page at 292–326 against 61–72 ms). The bare name is
# what the registry writes, so reading it as a synonym for `.full` made every
# default page of `metalinksdb` pay about five times over for provenance it
# had not asked for. The object is one explicit suffix away.
FULL_NAMES: frozenset[str] = frozenset({
    f'{LAYER}.full',
    f'{LAYER}.by_resource',
    f'{DEPRECATED_LAYER}.full',
    f'{DEPRECATED_LAYER}.by_resource',
})

# The published spellings, for discovery. The deprecated alias is accepted and
# not advertised: a caller who learns it would learn a name this cycle removes.
# The bare name is not advertised either, and for the opposite reason — it is
# accepted and it asks for the default row, so advertising it among the names
# that *add* something would teach a caller that it adds the object.
PUBLISHED_FULL_NAMES: tuple[str, ...] = (
    f'{LAYER}.full',
    f'{LAYER}.by_resource',
)

# How a request names the protein-function layer: `annotation.function` for all
# three of its vocabularies, `annotation.function:go,ec` for a subset. The
# colon is the same separator the booleans use, so a caller learns one rule.
FUNCTION_NAME = f'{LAYER}.function'

# UniProt keywords that state where a protein is, or how it sits in a membrane.
#
# **Derived once and then frozen, not derived at runtime.** The set is the
# transitive closure of `KW-9998` "Cellular component" over `subclass_of` in
# `entity_ontology_relation` — 180 keywords, 75 of them actually used — minus
# ten rejected from inside it, plus the six topology and lipid-anchor keywords
# UniProt files under `KW-9994` "Domain" and `KW-9991` "PTM". A closure walked
# at request time would make the published vocabulary move whenever the build
# moves, which is the one thing a declared allow-list prevents, so the result
# is a literal and the derivation is a comment.
#
# The ten rejected from inside the closure are the keywords UniProt files as
# cellular components that are not places a molecule is — `KW-0034` Amyloid,
# `KW-1279` T cell receptor. Thirteen more are rejected from outside it, where
# a label match would have pulled in a process, a disease, a PTM or a role,
# among them `KW-0025` Alternative splicing, which `KW-9997` "Coding sequence
# diversity" holds on 11,842 proteins and which states no location at all.
#
# The eleven `# assembly` lines are macromolecular complexes and the four
# lipoprotein particles are cargo rather than places. Dropping both blocks
# leaves a strict compartment-and-topology layer of 47 terms; they are kept
# because a consumer asking "where is this protein" is well served by "in the
# spliceosome".
LOCATION_KEYWORDS: dict[str, str] = {
    # --- compartments and subcellular structures -----------------------
    'KW-0963': 'Cytoplasm',
    'KW-0539': 'Nucleus',
    'KW-0906': 'Nuclear pore complex',
    'KW-0158': 'Chromosome',
    'KW-0137': 'Centromere',
    'KW-0779': 'Telomere',
    'KW-0995': 'Kinetochore',
    'KW-0256': 'Endoplasmic reticulum',
    'KW-0492': 'Microsome',
    'KW-0703': 'Sarcoplasmic reticulum',
    'KW-0333': 'Golgi apparatus',
    'KW-0458': 'Lysosome',
    'KW-0926': 'Vacuole',
    'KW-0576': 'Peroxisome',
    'KW-0496': 'Mitochondrion',
    'KW-0999': 'Mitochondrion inner membrane',
    'KW-1000': 'Mitochondrion outer membrane',
    'KW-1135': 'Mitochondrion nucleoid',
    'KW-0967': 'Endosome',
    'KW-0968': 'Cytoplasmic vesicle',
    'KW-0271': 'Exosome',
    'KW-0168': 'Coated pit',
    'KW-0551': 'Lipid droplet',
    # --- membranes and the outside ------------------------------------
    'KW-0472': 'Membrane',
    'KW-1003': 'Cell membrane',
    'KW-0628': 'Postsynaptic cell membrane',
    'KW-1052': 'Target cell membrane',
    'KW-1053': 'Target membrane',
    'KW-0964': 'Secreted',
    'KW-0272': 'Extracellular matrix',
    'KW-0084': 'Basement membrane',
    'KW-0965': 'Cell junction',
    'KW-0796': 'Tight junction',
    'KW-0303': 'Gap junction',
    # --- projections, cytoskeleton, synapse ---------------------------
    'KW-0966': 'Cell projection',
    'KW-0969': 'Cilium',
    'KW-0282': 'Flagellum',
    'KW-0770': 'Synapse',
    'KW-0771': 'Synaptosome',
    'KW-0206': 'Cytoskeleton',
    'KW-0493': 'Microtubule',
    'KW-0403': 'Intermediate filament',
    'KW-0787': 'Thick filament',
    'KW-0416': 'Keratin',
    'KW-0946': 'Virion',
    'KW-0261': 'Viral envelope protein',
    # --- lipoprotein particles ----------------------------------------
    'KW-0162': 'Chylomicron',
    'KW-0345': 'HDL',
    'KW-0427': 'LDL',
    'KW-0850': 'VLDL',
    # --- assemblies ---------------------------------------------------
    'KW-0138': 'CF(0)',                          # assembly
    'KW-0139': 'CF(1)',                          # assembly
    'KW-0243': 'Dynein',                         # assembly
    'KW-0473': 'Membrane attack complex',        # assembly
    'KW-0544': 'Nucleosome core',                # assembly
    'KW-0639': 'Primosome',                      # assembly
    'KW-0647': 'Proteasome',                     # assembly
    'KW-0733': 'Signal recognition particle',    # assembly
    'KW-0736': 'Signalosome',                    # assembly
    'KW-0747': 'Spliceosome',                    # assembly
    # --- topology and targeting ---------------------------------------
    'KW-0812': 'Transmembrane',
    'KW-1133': 'Transmembrane helix',
    'KW-1134': 'Transmembrane beta strand',
    'KW-0735': 'Signal-anchor',
    'KW-0732': 'Signal',
    'KW-0809': 'Transit peptide',
    # --- lipid anchors (children of KW-0449 Lipoprotein) --------------
    'KW-0449': 'Lipoprotein',
    'KW-0336': 'GPI-anchor',
    'KW-0519': 'Myristate',
    'KW-0564': 'Palmitate',
    'KW-0636': 'Prenylation',
}


@dataclass(frozen = True)
class Vocabulary:
    """
    One allow-listed source of annotation terms.

    **The key is the pair, never the namespace alone.** GO sits in two layers
    and only the predicate tells them apart: `located_in`→`go` is 38 cellular
    compartments, `associated_with`→`go` is 19,030 function terms. A
    namespace-only allow-list would pull the whole function vocabulary into the
    default summary array.

    Attributes:
        predicate: A row of `vocab_relation_predicate.name`.
        namespace: A row of `vocab_identifier_type.name`, reached through the
            **object** entity's `canonical_identifier_type_id`. Deliberately
            not `entity_ontology_term.ontology_id`, which the rest of the
            service joins on: that column spells GO `gene_ontology` and carries
            no `lipidmaps_class`, no `refmet_*` and no `interpro` at all, so an
            allow-list built there would look like it worked and serve about
            half of the class layer. `uberon` and `cl` are lowercase.
        rank: Where this vocabulary's terms sort in the summary array: the
            locations lead, then LIPID MAPS, then RefMet, then ChemOnt.
        terms: The accessions admitted, or None for every term the namespace
            reaches under this predicate. Only `uniprot_keyword` needs a term
            list, because the build stores no keyword category and 616 of its
            687 used keywords state a function, a process or a disease.
        rolls_up: Whether a term's `subclass_of` ancestors join the set.
        drop_top_levels: How many levels at the top of this vocabulary's own
            tree carry no information and are therefore withdrawn from the
            layer entirely — never registered, rendered, enumerated or
            accepted by the selection filter. Counted from the namespace's own
            roots out of the stored tree, for the reason `_top_levels` gives.
            Zero for every vocabulary whose roots say something: LIPID MAPS's
            eight roots are its two-character categories, `GP` and `FA`, which
            is exactly what a consumer wants the roll-up to reach. It is read
            off the same tree the roll-up is, so it says nothing on a
            vocabulary whose terms do not roll up.
    """

    predicate: str
    namespace: str
    rank: int
    terms: frozenset[str] | None = None
    rolls_up: bool = False
    drop_top_levels: int = 0


@dataclass(frozen = True)
class Layer:
    """
    One layer of the projection, and how much a request pays for it.

    Attributes:
        vocabularies: The allow-list. Empty for the metabolic domain, which is
            a column of `entity` rather than an asserted fact.
        note: What the layer says, for discovery.
        default: Whether it reaches the default row.
        closed: Whether `categories()` may enumerate it. A layer that is not
            closed is reported by vocabulary name and term count and never by
            term — a registered category costs a value row in
            `/interactions/parameter-values`, an attribute name beside it and a
            line in every 400 body, and 41,399 of those is not an answer.
        request: The `attributes=` spelling that asks for a non-default layer.
    """

    vocabularies: tuple[Vocabulary, ...]
    note: str
    default: bool = True
    closed: bool = True
    request: str | None = None


# The four layers: protein location, chemical location and class, metabolic
# domain, protein function. The first two are one declaration here because they
# share `located_in`→`go` and the subject type is what separates them in the
# data. Measured on dev5: no chemical carries a `uniprot_keyword` fact and no
# protein carries a class-vocabulary one, so the split is the build's and needs
# no clause.
LAYERS: dict[str, Layer] = {
    'location': Layer(
        vocabularies = (
            # 38 GO cellular components over proteins and chemicals both, from
            # LOCATE, HMDB and iMM1415. No accession allow-list is needed:
            # `located_in` with a GO object *is* the compartment set, and it is
            # stable at 38 because only those three make the statement.
            Vocabulary('located_in', 'go', rank = 0),
            Vocabulary('located_in', 'uberon', rank = 0),
            Vocabulary('located_in', 'cl', rank = 0),
            Vocabulary(
                'associated_with', 'uniprot_keyword', rank = 0,
                terms = frozenset(LOCATION_KEYWORDS),
            ),
        ),
        note = (
            'where the molecule is: GO cellular components and the UniProt '
            'cellular-component and topology keywords for proteins, UBERON '
            'tissues and cell types for metabolites'
        ),
    ),
    'chemical_class': Layer(
        vocabularies = (
            Vocabulary('associated_with', 'lipidmaps_class', rank = 1, rolls_up = True),
            Vocabulary('associated_with', 'refmet_super_class', rank = 2, rolls_up = True),
            Vocabulary('associated_with', 'refmet_main_class', rank = 2, rolls_up = True),
            Vocabulary('associated_with', 'refmet_sub_class', rank = 2, rolls_up = True),
            # **ChemOnt's top two levels are dropped**, which is three terms:
            # the one root `CHEMONTID:9999999` "Chemical entities" and its only
            # two children, `CHEMONTID:0000000` "Organic compounds" and
            # `CHEMONTID:0000001` "Inorganic compounds". None of the three
            # distinguishes anything in a build of metabolites, and the roll-up
            # put one of them on nearly every chemical: the summary array ran
            # median 3, p95 25 and maximum 64 over 3,000 chemicals carrying a
            # class fact. Level 2 below them is 31 terms and those *are*
            # informative, so the cut is two levels and not three.
            #
            # **The directly stated facts go too.** 2,234 entities carry
            # `Organic compounds` as an `associated_with` fact of their own and
            # 53 carry `Inorganic compounds`, and rendering the category for
            # exactly those would publish a provenance artefact as a
            # distinction: organic is true of nearly every metabolite here, and
            # the 2,234 are only the ones whose source happened to spell it
            # out. One spelling for a useless category, and that is absence.
            Vocabulary(
                'associated_with', 'chemont', rank = 3, rolls_up = True,
                drop_top_levels = 2,
            ),
        ),
        note = (
            'what kind of molecule it is, ranked LIPID MAPS then RefMet then '
            'ChemOnt and rolled up to every class that contains it'
        ),
    ),
    'metabolic_domain': Layer(
        vocabularies = (),
        note = (
            'a coarse six-bucket domain read off the entity, which is `other` '
            'for 99 per cent of this build\'s chemicals; a flag beside the '
            'class layer and not a substitute for it'
        ),
        default = SERVE_METABOLIC_DOMAIN,
    ),
    'function': Layer(
        vocabularies = (
            Vocabulary('associated_with', 'go', rank = 4),
            Vocabulary('associated_with', 'ec', rank = 4),
            Vocabulary('associated_with', 'interpro', rank = 4),
        ),
        note = (
            'what the protein does: GO function and process terms, EC numbers '
            'and InterPro domains. Served on request alone, and reported by '
            'vocabulary name and term count rather than by term'
        ),
        default = False,
        closed = False,
        request = FUNCTION_NAME,
    ),
}

#: The layer the metabolic domain is declared under, so the one name is spelled
#: once and the switch above and the discovery answer agree.
DOMAIN_LAYER = 'metabolic_domain'

#: The layer served on request alone.
FUNCTION_LAYER = 'function'

# `{schema: Terms}`, the vocabulary read once per process.
_VOCABULARY: dict[str, 'Terms'] = {}

# Schemas whose first page read has already been reported, so that line is
# logged once rather than per page.
_REPORTED: set[str] = set()

# Whether the deprecated layer name has been logged this process. Once is
# enough: the fix is one registry row, and a line per request would bury it.
_ALIAS_LOGGED: set[str] = set()

# Whether a bare layer name has been reported this process, by the same
# once-per-process rule: it is a legitimate request that arrives on every page
# of a preset that declares it, so a line per page would annotate a hot path.
_BARE_REPORTED: set[str] = set()


def _assert_derived() -> None:
    """
    Hold the column suffixes to the layer name they are named for.

    The suffixes decide the output column names and used to be literals that
    happened to agree with `LAYER`, as their declaration explains. This holds
    the derivation so a later edit cannot quietly undo it.

    Returns:
        None.

    Raises:
        AssertionError: If a suffix stops being derived from `LAYER`.
    """

    assert SUMMARY_SUFFIX.startswith(LAYER), SUMMARY_SUFFIX
    assert OBJECT_SUFFIX == LAYER, OBJECT_SUFFIX
    assert FUNCTION_SUFFIX.startswith(LAYER), FUNCTION_SUFFIX
    assert LAYER != DEPRECATED_LAYER, LAYER


_assert_derived()


@dataclass(frozen = True)
class Term:
    """
    One annotation term, as the vocabulary holds it.

    Attributes:
        namespace: The vocabulary it belongs to.
        accession: Its identifier inside that vocabulary. **The key is the
            pair** — 235 RefMet accession strings are label text that occurs in
            two RefMet namespaces at once, so an index keyed on the accession
            alone silently merges a main class into a sub class.
        entity_id: The object entity the term is, for the selection filter.
        predicate_id: The predicate that reaches it, for the same filter. **It
            travels with the term because the term is not enough** — see
            `Filter.term_pairs` for why the pair is the key.
        label: Its name, falling back to the accession where the build stored
            the accession as the label, as four of the 38 GO compartments do.
        category: The output slug.
        rank: Its vocabulary's rank.
        layer: The layer it belongs to.
        entities: How many entities carry it, for the discovery facet.
    """

    namespace: str
    accession: str
    entity_id: str
    predicate_id: int
    label: str
    category: str
    rank: int
    layer: str
    entities: int = 0


@dataclass
class Terms:
    """
    The whole vocabulary of one schema, with the hierarchy over its classes.

    Attributes:
        terms: `{(namespace, accession): Term}` for every populated term of the
            closed layers.
        counts: `{category: entities}` over the closed, default layers, which
            the discovery facet reports and `categories()` is derived from — a
            category nothing populates is absent from both.
        open_counts: `{vocabulary: terms}` for the layers that are not closed.
        ancestors: `{(namespace, accession): ((namespace, accession), …)}`, the
            `subclass_of` closure over the class vocabularies.
        descendants: `{(namespace, accession): ((predicate_id, entity_id), …)}`,
            the same tree read downwards, for the selection filter.
        by_category: `{category: ((namespace, accession), …)}`.
    """

    terms: dict[tuple[str, str], Term] = field(default_factory = dict)
    counts: dict[str, int] = field(default_factory = dict)
    open_counts: dict[str, int] = field(default_factory = dict)
    ancestors: dict[tuple[str, str], tuple[tuple[str, str], ...]] = (
        field(default_factory = dict)
    )
    descendants: dict[tuple[str, str], tuple[tuple[int, str], ...]] = (
        field(default_factory = dict)
    )
    by_category: dict[str, tuple[tuple[str, str], ...]] = (
        field(default_factory = dict)
    )


@dataclass
class Hit:
    """
    One category on one entity, and where it came from.

    Attributes:
        rank: The best rank among the terms that produced it, so the summary
            array can lead with the vocabulary that ranks first.
        resources: The resources that asserted it, empty unless the request
            asked for the by-resource object.
    """

    rank: int
    resources: set[str] = field(default_factory = set)


@dataclass
class Entry:
    """
    Everything the layers say about one entity on one page.

    Attributes:
        classes: The default summary's categories — the location and class
            layers together.
        functions: The protein-function categories, empty unless a request
            named the layer.
        domain: The coarse metabolic domain, or None where the entity carries
            none. A scalar, so its empty value is null, for the reason
            `columns` gives.
    """

    classes: dict[str, Hit] = field(default_factory = dict)
    functions: dict[str, Hit] = field(default_factory = dict)
    domain: str | None = None


@dataclass
class Layers:
    """Which annotation layers one request asked for, beyond the default."""

    # The by-resource object per node.
    full: bool = False
    # The categories to render as flat booleans, in the caller's order.
    booleans: list[str] = field(default_factory = list)
    # The function vocabularies named, or None where the request named no
    # function layer. **None and an empty tuple are different answers**: None
    # means the layer costs nothing, and an empty tuple cannot occur because
    # `annotation.function` with no list means every vocabulary.
    functions: tuple[str, ...] | None = None

    @property
    def asked(self) -> bool:
        """Whether anything beyond the default summary was requested."""

        return self.full or bool(self.booleans) or self.functions is not None


@dataclass
class Filter:
    """
    An `entity_annotations` request, resolved to what a query can match.

    **The ids are terms, not entities, and that is the whole point.** A term
    list is three or four uuids whatever the category's reach, where the
    entities carrying it run to tens of thousands; `resolve_filter` carries the
    measurement.

    Attributes:
        categories: The categories as the caller's request resolved to them.
        term_pairs: The `(predicate_id, object_entity_id)` pairs a matching
            `relation` row carries, including every descendant of a named class
            so the filter admits exactly what the rendered column shows. **The
            predicate is half the key**: GO:0005886 is a location under
            `located_in` and a function annotation under `associated_with`, and
            matching the object alone admitted the second — rows whose rendered
            array does not carry the category the caller asked for.
        domain_ids: The `vocab_metabolic_domain` ids a named domain resolves
            to, which is a column on `entity` and not a `relation` fact.
    """

    categories: tuple[str, ...]
    term_pairs: tuple[tuple[int, str], ...]
    domain_ids: tuple[int, ...]

    @property
    def empty(self) -> bool:
        """Whether the filter can match nothing at all."""

        return not self.term_pairs and not self.domain_ids

    @property
    def by_predicate(self) -> list[tuple[int, list[str]]]:
        """
        The terms grouped by the predicate that reaches them.

        **Grouped rather than crossed.** A `(predicate ANY, object ANY)` pair
        of arrays is not the same predicate: `cytoplasm` is GO `located_in` and
        UniProt keyword `associated_with`, so the crossing admits
        `(associated_with, GO:0005737)`, which exists as a function annotation
        and is not what was asked for. In practice there are two groups.

        Returns:
            `[(predicate_id, [object_entity_id, …]), …]`, sorted.
        """

        grouped: dict[int, list[str]] = {}

        for predicate, entity in self.term_pairs:

            grouped.setdefault(predicate, []).append(entity)

        return [(predicate, grouped[predicate]) for predicate in sorted(grouped)]


def slug(text: str) -> str:
    """
    The output category one term's label becomes.

    Lower case and underscores, because `_category` lower-cases a requested
    boolean and a slug it could not reproduce would be unrequestable. The
    merging this causes is wanted: 4,173 terms collapse to 3,361 categories,
    and every collision measured is one chemical class named by three
    vocabularies, which a consumer wants one category for. The index
    underneath stays keyed on `(namespace, accession)`, so the ranking and the
    roll-up never merge.

    Args:
        text: The term's label.

    Returns:
        The slug, or an empty string for a label with nothing in it.
    """

    return re.sub(r'[^a-z0-9]+', '_', str(text).lower()).strip('_')


def categories(conn = None) -> list[str]:
    """
    Every category the closed, default layers actually populate.

    **Derived from a populated count, not from the declaration.** A category
    the vocabulary cannot populate is absent from here rather than registered
    and empty — which is what the dead five-term vocabulary was, and what made
    a test that only checked the column was present pass over it.

    Args:
        conn: An open connection, which builds the vocabulary if it is not yet
            read. Called without one it reports what has already been read,
            because `read()` splits an attribute list with no connection in
            reach and must not open one.

    Returns:
        The category slugs, sorted, without duplicates.
    """

    if conn is not None:

        return sorted(vocabulary(conn).counts)

    known = _VOCABULARY.get(SEARCH_SCHEMA)

    return sorted(known.counts) if known else []


def open_vocabularies(conn = None) -> list[dict[str, Any]]:
    """
    The layers served on request alone, by name and term count.

    This is the whole of what discovery and a refusal may say about them, and
    their terms are never listed: 41,399 value rows is not an answer a caller
    can read, and registering them would put that cost on every refusal body.

    Args:
        conn: An open connection, or None to report what has been read.

    Returns:
        One entry per vocabulary, carrying its name, its term count, the layer
        it belongs to and how to ask for it.
    """

    known = vocabulary(conn) if conn is not None else _VOCABULARY.get(SEARCH_SCHEMA)
    counted = known.open_counts if known else {}

    return [
        {
            'vocabulary': item.namespace,
            'terms': counted.get(item.namespace, 0),
            'layer': name,
            'request': f'{layer.request}:{item.namespace}',
        }
        for name, layer in LAYERS.items()
        if not layer.closed
        for item in layer.vocabularies
    ]


def forget() -> None:
    """
    Drop the cached vocabulary so the next read rebuilds it.

    The declaration above is a module constant a deployment may extend, and the
    vocabulary, its counts and its hierarchy are derived from it, so extending
    one without dropping the other leaves a category registered and invisible.

    Returns:
        None.
    """

    _VOCABULARY.clear()
    _REPORTED.clear()
    _ALIAS_LOGGED.clear()
    _BARE_REPORTED.clear()


def read(names: Sequence[str]) -> tuple[Layers, list[str]]:
    """
    Split an attribute list into annotation requests and everything else.

    Args:
        names: The `attributes=` names as the caller wrote them.

    Returns:
        The layers asked for, and the names this module does not claim — which
        go on to the long-tail projection unchanged. A name claimed here must
        not reach that projection: it names no key of the record's attribute
        document, so it would come back null and read as a build that carries
        no annotation at all. **That is why the deprecated spelling is claimed
        too** — dev5's registry still declares `intercell` as `metalinksdb`'s
        mandatory attribute, and letting it fall through would answer
        `attributes: {"intercell": null}`. **A bare layer name is claimed and
        adds nothing** for the same reason: it means the layer's default form,
        so it sets no flag and names no boolean.
    """

    layers = Layers()
    rest: list[str] = []

    for name in names:

        text = str(name).strip()
        lowered = text.lower()
        head = lowered.partition(':')[0]

        if lowered in FULL_NAMES:

            layers.full = True
            _warn_alias(lowered)

        elif head in _function_names():

            layers.functions = _function_vocabularies(text)
            _warn_alias(head)

        elif head in (LAYER, DEPRECATED_LAYER):

            _warn_alias(head)

            if ':' not in lowered:

                # The bare name asks for nothing beyond the default row, and
                # it must not reach the token loop below either, whose single
                # empty token would report a missing category for a request
                # that named none.
                _report_bare(head)

                continue

            for token in text.partition(':')[2].split(','):

                category = _category(token)

                if category and category not in layers.booleans:

                    layers.booleans.append(category)

                elif not category:

                    _log.info(
                        'no annotation category is registered under %r; the '
                        'boolean is rendered false rather than refused', token,
                    )

        elif head.startswith(f'{LAYER}.') or head.startswith(f'{DEPRECATED_LAYER}.'):

            # A name that looks like this layer and is not one of its spellings
            # is dropped here rather than passed on, because the long-tail
            # projection would answer it null — the same silent failure as a
            # claimed name falling through, arrived at by a typo.
            _log.warning(
                '%r names no layer of %r, whose spellings are %s and %s; the '
                'attribute is dropped rather than answered null',
                # The bare name leads the list because it is the cheapest
                # spelling and is not in `PUBLISHED_FULL_NAMES`.
                text, LAYER, [LAYER, *sorted(PUBLISHED_FULL_NAMES)],
                FUNCTION_NAME,
            )

        else:

            rest.append(name)

    return layers, rest


def canonical_layer(name: Any) -> Any:
    """
    One layer name, in the spelling this cycle emits.

    A composition step records which layer it annotated with, and it comes
    from the registry, which still spells it `intercell` on a build registered
    before the rename. The response carries that value, and a value is as much
    "emitted" as a column name is.

    Args:
        name: The layer name as the recipe wrote it, or None.

    Returns:
        The new spelling where the old one was given, and the name unchanged
        otherwise — including for a layer this module does not own, which is
        not this function's business to judge.
    """

    if isinstance(name, str) and name.strip().lower() == DEPRECATED_LAYER:

        return LAYER

    return name


def _function_names() -> frozenset[str]:
    """
    The spellings that name the protein-function layer.

    Returns:
        `annotation.function` and its deprecated twin, lower case.
    """

    return frozenset({FUNCTION_NAME, f'{DEPRECATED_LAYER}.function'})


def _function_vocabularies(text: str) -> tuple[str, ...]:
    """
    Which function vocabularies one request named.

    Args:
        text: The attribute name as the caller wrote it, with or without a
            `:go,ec` list after it.

    Returns:
        The namespaces named, or every one of the layer's where the request
        named none. A namespace the layer does not declare is dropped with a
        log rather than refused, which is how an unregistered boolean is
        already treated.
    """

    declared = tuple(
        item.namespace for item in LAYERS[FUNCTION_LAYER].vocabularies
    )
    asked = [
        token.strip().lower()
        for token in text.partition(':')[2].split(',')
        if token.strip()
    ]

    if not asked:

        return declared

    if unknown := [name for name in asked if name not in declared]:

        _log.info(
            'the function layer declares %s and the request named %s; the '
            'unknown names reach no column', list(declared), unknown,
        )

    return tuple(name for name in declared if name in asked) or declared


def _warn_alias(name: str) -> None:
    """
    Say once that a request reached this layer under its retired name.

    Args:
        name: The spelling the caller used.

    Returns:
        None.
    """

    if not name.startswith(DEPRECATED_LAYER) or DEPRECATED_LAYER in _ALIAS_LOGGED:

        return

    _ALIAS_LOGGED.add(DEPRECATED_LAYER)
    _log.info(
        'an attribute request reached the %r layer under its retired name '
        '%r, which is accepted and never emitted; re-register the '
        'network_views product so the registry stops declaring it',
        LAYER, DEPRECATED_LAYER,
    )


def _report_bare(name: str) -> None:
    """
    Say once what a bare layer name resolved to.

    **Info and not a warning**, because the bare name is a legitimate request
    for the layer's default form and the spelling the registry writes, so every
    page of a preset that declares it arrives here. A line per page would bury
    the one fact a caller needs: the by-resource object has to be asked for.

    Args:
        name: The spelling the caller used, without its suffix.

    Returns:
        None.
    """

    if name in _BARE_REPORTED:

        return

    _BARE_REPORTED.add(name)
    # **No figures in the line.** The cost of the resource join is measured in
    # the `FULL_NAMES` comment and moves when the build does, and a log string
    # is behaviour: a stale benchmark in it reaches a caller as a fact.
    _log.info(
        'an attribute request named the %r layer with no suffix, which '
        'resolves to its default form — the compact *_%s summary array, '
        'already on the row. %r is the by-resource object, which the bare '
        'name no longer buys and which pays a resource join for its '
        'provenance',
        name, SUMMARY_SUFFIX, f'{LAYER}.full',
    )


def _category(token: str) -> str | None:
    """
    The category one requested boolean names.

    Args:
        token: A name from an `annotation:` list, with or without the `is_`
            prefix a caller reads off the output column.

    Returns:
        The category slug, or None for an empty token. It is lower-cased and
        underscored through the same `slug` the vocabulary is built with, so a
        caller may write the category as it appears in the summary array or as
        the term's own label and reach the same place.
    """

    text = str(token).strip().lower()

    if text.startswith(BOOLEAN_PREFIX):

        text = text[len(BOOLEAN_PREFIX):]

    return slug(text) or None


def vocabulary(conn) -> Terms:
    """
    Every annotation term the allow-lists reach, read once per process.

    One statement over `relation` carries both grains: the closed layers come
    back per term, with the entity count the discovery facet reports, and the
    open layer comes back per term too and is reduced to a count here. Asking
    for the open layer's counts separately costs 7.9 s because
    `count(DISTINCT subject)` over a whole namespace is 54,771 distinct values
    from 360,000 rows; folded into the per-term grouping the whole statement
    costs **3.6 s** and returns 45,376 rows. The hierarchy is a second
    statement, 6,515 edges in **0.9 s**, closed in Python rather than by a
    recursive CTE — the recursive form measured 6.8 s for the same answer. So
    4,173 closed terms and 6,515 edges for a 5.5 s build, once per process.

    Args:
        conn: An open connection.

    Returns:
        The vocabulary of this schema.
    """

    if SEARCH_SCHEMA in _VOCABULARY:

        return _VOCABULARY[SEARCH_SCHEMA]

    built = Terms()
    predicates: dict[str, int] = {}
    clauses, args = _allow_list(every = True)
    rows = conn.execute(
        f"""
        SELECT p.name AS predicate,
               p.relation_predicate_id AS predicate_id,
               it.name AS namespace,
               oe.entity_id,
               oe.canonical_identifier AS accession,
               COALESCE(NULLIF(oe.label, oe.canonical_identifier),
                        oe.canonical_identifier) AS label,
               count(DISTINCT r.subject_entity_id)::bigint AS entities
        FROM {SEARCH_SCHEMA}.relation r
        JOIN {SEARCH_SCHEMA}.vocab_relation_predicate p
          ON p.relation_predicate_id = r.predicate_id
        JOIN {SEARCH_SCHEMA}.entity oe
          ON oe.entity_id = r.object_entity_id
        JOIN {SEARCH_SCHEMA}.vocab_identifier_type it
          ON it.identifier_type_id = oe.canonical_identifier_type_id
        WHERE ({clauses})
        GROUP BY 1, 2, 3, 4, 5, 6
        """,
        args,
    ).fetchall()

    for row in rows:

        predicates[row['predicate']] = int(row['predicate_id'])
        declared = _declared(row['predicate'], row['namespace'])

        if declared is None:

            continue

        name, item = declared

        if not LAYERS[name].closed:

            # The open layer is counted and discarded: keeping 41,399 terms
            # resident to serve three numbers is not a cache worth having.
            built.open_counts[item.namespace] = (
                built.open_counts.get(item.namespace, 0) + 1
            )

            continue

        category = slug(row['label'])

        if not category:

            continue

        built.terms[(item.namespace, row['accession'])] = Term(
            namespace = item.namespace,
            accession = row['accession'],
            entity_id = str(row['entity_id']),
            predicate_id = int(row['predicate_id']),
            label = row['label'],
            category = category,
            rank = item.rank,
            layer = name,
            entities = int(row['entities']),
        )

    _hierarchy(built, conn, predicates)
    _domains(built, conn)
    _index_categories(built)
    _VOCABULARY[SEARCH_SCHEMA] = built

    _log.info(
        'the annotation vocabulary covers %d categories over %d terms in the '
        'closed layers, and %s on request',
        len(built.counts), len(built.terms),
        ', '.join(
            f'{name} ({count} terms)'
            for name, count in sorted(built.open_counts.items())
        ) or 'nothing',
    )

    return built


def _declared(predicate: str, namespace: str) -> tuple[str, Vocabulary] | None:
    """
    The layer and vocabulary one `(predicate, namespace)` pair belongs to.

    Args:
        predicate: A `vocab_relation_predicate.name`.
        namespace: A `vocab_identifier_type.name`.

    Returns:
        The layer name and its vocabulary entry, or None for a pair no layer
        declares.
    """

    for name, layer in LAYERS.items():

        for item in layer.vocabularies:

            if item.predicate == predicate and item.namespace == namespace:

                return name, item

    return None


def _allow_list(*, every: bool) -> tuple[str, list[Any]]:
    """
    The allow-list as one SQL disjunction over the object's namespace.

    **Keyed on the pair and not on the namespace**, for the reason
    `Vocabulary` gives. And keyed on a declared list rather than on the shape
    of the accession, because `associated_with`'s tail names molecules and
    diseases rather than terms — `Entrez:MI:0477` (4.08 M links),
    `Standard Inchi Key:MI:1101` (1.29 M), `hpo` and `mondo` — and every one of
    them is typed, so a test for a typed accession admits all of it.

    Args:
        every: Whether to include the layers served on request alone.

    Returns:
        The disjunction and its positional arguments.
    """

    clauses: list[str] = []
    args: list[Any] = []

    for name, layer in LAYERS.items():

        if not every and not layer.default:

            continue

        for item in layer.vocabularies:

            if item.terms is None:

                clauses.append(
                    '(p.name = %s AND it.name = %s)',
                )
                args.extend([item.predicate, item.namespace])

            else:

                clauses.append(
                    '(p.name = %s AND it.name = %s '
                    'AND oe.canonical_identifier = ANY(%s::text[]))',
                )
                args.extend([
                    item.predicate, item.namespace, sorted(item.terms),
                ])

    return ' OR '.join(clauses) or 'false', args


def _hierarchy(built: Terms, conn, predicates: dict[str, int]) -> None:
    """
    Read the `subclass_of` tree over the class vocabularies and close it.

    Args:
        built: The vocabulary being built.
        conn: An open connection.
        predicates: `{predicate name: id}`, for registering a parent the
            selection filter can match.

    Returns:
        None. `built` gains its `ancestors` and `descendants`, and the parents
        the roll-up reaches. It loses the terms the top-level cut suppresses,
        including any the base read registered.
    """

    parents, children, described = _subclass_tree(conn)
    suppressed = _suppress(built, parents, children)
    built.ancestors, below = _closed_tree(parents, children, suppressed)

    _register_ancestors(built, below, described, predicates)

    built.descendants = _descendants(built, below)


def _subclass_tree(conn) -> tuple[
        dict[tuple[str, str], set[tuple[str, str]]],
        dict[tuple[str, str], set[tuple[str, str]]],
        dict[tuple[str, str], tuple[str, str]],
]:
    """
    The stored `subclass_of` edges over the vocabularies that roll up.

    **The stored tree, not the accession.** `entity_ontology_relation` holds
    1,875,849 `subclass_of` rows where `relation` holds none, and a prefix rule
    on the accession would reach LIPID MAPS alone: ChemOnt's are arbitrary
    seven-digit ids and RefMet's are the labels themselves, so no string
    surgery rolls up the 4,824 ChemOnt and 1,305 RefMet edges this read also
    carries.

    Args:
        conn: An open connection.

    Returns:
        `{child: {parent}}`, the same edges downwards as `{parent: {child}}`,
        and `{parent: (entity_id, label)}` for every parent the read saw, which
        is what registering a parent as a term needs. All three are empty where
        no vocabulary rolls up, and then no statement runs.
    """

    rolling = sorted({
        item.namespace
        for layer in LAYERS.values()
        for item in layer.vocabularies
        if item.rolls_up
    })

    if not rolling:

        return {}, {}, {}

    rows = conn.execute(
        f"""
        SELECT DISTINCT
               cit.name AS child_namespace,
               child.canonical_identifier AS child,
               pit.name AS parent_namespace,
               parent.canonical_identifier AS parent,
               parent.entity_id AS parent_entity_id,
               COALESCE(NULLIF(parent.label, parent.canonical_identifier),
                        parent.canonical_identifier) AS parent_label
        FROM {SEARCH_SCHEMA}.entity_ontology_relation eor
        JOIN {SEARCH_SCHEMA}.vocab_relation_predicate p
          ON p.relation_predicate_id = eor.predicate_id
        JOIN {SEARCH_SCHEMA}.entity child
          ON child.entity_id = eor.subject_entity_id
        JOIN {SEARCH_SCHEMA}.vocab_identifier_type cit
          ON cit.identifier_type_id = child.canonical_identifier_type_id
        JOIN {SEARCH_SCHEMA}.entity parent
          ON parent.entity_id = eor.object_entity_id
        JOIN {SEARCH_SCHEMA}.vocab_identifier_type pit
          ON pit.identifier_type_id = parent.canonical_identifier_type_id
        WHERE p.name = 'subclass_of'
          AND cit.name = ANY(%s::text[])
          AND pit.name = ANY(%s::text[])
        """,
        [rolling, rolling],
    ).fetchall()

    parents: dict[tuple[str, str], set[tuple[str, str]]] = {}
    children: dict[tuple[str, str], set[tuple[str, str]]] = {}
    described: dict[tuple[str, str], tuple[str, str]] = {}

    for row in rows:

        child = (row['child_namespace'], row['child'])
        parent = (row['parent_namespace'], row['parent'])
        parents.setdefault(child, set()).add(parent)
        children.setdefault(parent, set()).add(child)
        described[parent] = (str(row['parent_entity_id']), row['parent_label'])

    return parents, children, described


def _suppress(
        built: Terms,
        parents: dict[tuple[str, str], set[tuple[str, str]]],
        children: dict[tuple[str, str], set[tuple[str, str]]],
) -> frozenset[tuple[str, str]]:
    """
    Withdraw the uninformative top of a tree, base terms included.

    A vocabulary declaring `drop_top_levels` withdraws that many levels of its
    own tree from the layer entirely, and the depths come from the tree read,
    so this is also where the base terms the caller registered are pruned.
    **Pruned after the tree read rather than read before it**: reading the tree
    first would move a 0.9 s statement in front of a 3.6 s one for nothing,
    because the base read has to filter on something this read produces either
    way, and a pop from a dict the caller has just filled is cheaper.

    Measured on dev5, 2026-10-26: the cut takes ChemOnt's root out of the
    ancestors and its two directly stated children out of the base terms, so
    the vocabulary is 4,173 terms over 3,361 categories against 4,176 over
    3,363, and the summary array of 3,000 chemicals carrying a class fact runs
    p95 23 and maximum 62 against 25 and 64, mean 7.4 against 8.4.
    `inorganic_compounds` survives and should: RefMet states it as a super
    class of its own on two entities, a different term that happens to slug
    the same, so its count falls from ChemOnt's 53 to RefMet's 2.

    Args:
        built: The vocabulary being built, whose base terms are pruned here.
        parents: `{child: {parent}}` as the tree read it.
        children: The same edges downwards.

    Returns:
        The keys no later step may register, render or enumerate, taken before
        anything else is derived from the tree.
    """

    suppressed = _top_levels(parents, children)

    for key in suppressed:

        built.terms.pop(key, None)

    return suppressed


def _closed_tree(
        parents: dict[tuple[str, str], set[tuple[str, str]]],
        children: dict[tuple[str, str], set[tuple[str, str]]],
        suppressed: frozenset[tuple[str, str]],
) -> tuple[
        dict[tuple[str, str], tuple[tuple[str, str], ...]],
        dict[tuple[str, str], set[tuple[str, str]]],
]:
    """
    Close the tree transitively, in both directions.

    The cut is taken out of the closures as well as out of the base terms, so a
    suppressed term cannot be reached through one direction after being
    withdrawn from the other.

    Args:
        parents: `{child: {parent}}` as the tree read it.
        children: The same edges downwards.
        suppressed: The keys the top-level cut withdrew.

    Returns:
        Every term's ancestors, sorted, which `built.ancestors` becomes, and
        every term's descendants as sets, which the registration step reads
        its counts out of.
    """

    above = {
        key: tuple(sorted(_closure(key, parents) - suppressed))
        for key in parents
        if key not in suppressed
    }
    below = {
        key: _closure(key, children) - suppressed
        for key in children
        if key not in suppressed
    }

    return above, below


def _register_ancestors(
        built: Terms,
        below: dict[tuple[str, str], set[tuple[str, str]]],
        described: dict[tuple[str, str], tuple[str, str]],
        predicates: dict[str, int],
) -> None:
    """
    Register the ancestors the roll-up reaches as terms of their own.

    **A parent nothing states directly is registered anyway, if anything can
    reach it.** 416 of the 1,634 distinct ancestors carry no `associated_with`
    fact of their own: a resource states `GP0301` and the ontology knows it is
    a `GP`. Dropping them all would throw away a quarter of the roll-up, and
    keeping them unregistered would break the rule that a rendered category is
    one `categories()` enumerates and a refusal therefore accepts. So the
    **193** with a populated term somewhere below them join the vocabulary —
    **192** once the top-level cut takes ChemOnt's root — carrying the widest
    count among those terms, which is the same floor every multi-vocabulary
    category already reports. The other **223** have nothing populated below
    them either, so no entity can ever reach them, and the 619 ancestor links
    they account for, of 25,340, go with them.

    Args:
        built: The vocabulary being built.
        below: Every term's descendants, from `_closed_tree`.
        described: `{parent: (entity_id, label)}`, from the tree read.
        predicates: `{predicate name: id}`, for a parent the selection filter
            can match.

    Returns:
        None. `built.terms` gains one term per ancestor with something
        populated below it.
    """

    for key, found in below.items():

        if key in built.terms or key not in described:

            continue

        category = slug(described[key][1])
        declared = _of_namespace(key[0])

        if not category or declared is None:

            continue

        name, item = declared
        reach = max(
            (built.terms[child].entities for child in found
             if child in built.terms),
            default = 0,
        )

        if not reach:

            # Nothing below it is populated either, so no entity can ever
            # reach it and registering it would put an empty category in
            # `categories()`. ChemOnt alone carries a few hundred of these:
            # `actinide_organides`, `lanthanide_salts`.
            continue

        entity, label = described[key]
        built.terms[key] = Term(
            namespace = key[0],
            accession = key[1],
            entity_id = entity,
            predicate_id = predicates.get(item.predicate, 0),
            label = label,
            category = category,
            rank = item.rank,
            layer = name,
            entities = reach,
        )


def _descendants(
        built: Terms,
        below: dict[tuple[str, str], set[tuple[str, str]]],
) -> dict[tuple[str, str], tuple[tuple[int, str], ...]]:
    """
    The tree read downwards, as the pairs the selection filter matches.

    Args:
        built: The vocabulary, with its ancestors already registered: a parent
            registered after this ran would be a descendant the filter cannot
            match.
        below: Every term's descendants, from `_closed_tree`.

    Returns:
        `{term: ((predicate_id, entity_id), …)}` over the descendants that
        have a term.
    """

    return {
        key: tuple(sorted(
            (built.terms[found].predicate_id, built.terms[found].entity_id)
            for found in below[key]
            if found in built.terms
        ))
        for key in below
    }


def _top_levels(
        parents: dict[tuple[str, str], set[tuple[str, str]]],
        children: dict[tuple[str, str], set[tuple[str, str]]],
) -> frozenset[tuple[str, str]]:
    """
    The terms a vocabulary's `drop_top_levels` withdraws from the layer.

    **Derived from the stored tree, not from an accession list.** A hardcoded
    `CHEMONTID:9999999` would stop meaning the top of the tree the day the
    ontology is reloaded with a level above it, and would say nothing about
    *why* those three. The depth does: a root is a term that is a parent in its
    own namespace and never a child in it, and the cut is every term the walk
    down from the roots reaches in fewer than `drop_top_levels` steps.

    The namespace boundary matters: RefMet's stored edges run *between* its
    three namespaces, so `refmet_sub_class` is a parent of nothing and has no
    root of its own, and asking for a cut there would cut nothing rather than
    cutting the wrong thing. Only `chemont` asks for a cut.

    Args:
        parents: `{child: {parent}}` as the tree read it, across namespaces.
        children: The same edges downwards.

    Returns:
        The `(namespace, accession)` keys to suppress, which is empty unless a
        vocabulary declares a cut.
    """

    wanted = {
        item.namespace: item.drop_top_levels
        for layer in LAYERS.values()
        for item in layer.vocabularies
        if item.drop_top_levels > 0
    }
    cut: set[tuple[str, str]] = set()

    for namespace, levels in sorted(wanted.items()):

        down = {
            key: {found for found in below if found[0] == namespace}
            for key, below in children.items()
            if key[0] == namespace
        }
        # A term with a parent inside its own namespace is not a root of it,
        # whatever it is a child of elsewhere.
        rooted = {
            key for key in down
            if not any(
                found[0] == namespace for found in parents.get(key, ())
            )
        }
        frontier = rooted

        for _ in range(levels):

            if not frontier:

                break

            cut.update(frontier)
            # Level by level, and a term already cut is never walked again, so
            # a term reachable both near the root and deeper sits at its
            # shallowest depth — the depth "the top two levels" means.
            frontier = {
                found for key in frontier for found in down.get(key, ())
            } - cut

    return frozenset(cut)


def _of_namespace(namespace: str) -> tuple[str, Vocabulary] | None:
    """
    The layer and vocabulary one namespace belongs to.

    Unambiguous for the namespaces that roll up, which appear in one layer
    under one predicate each. It is deliberately not a general lookup: `go` is
    in two layers, which is `_declared`'s business.

    Args:
        namespace: A `vocab_identifier_type.name`.

    Returns:
        The layer name and its vocabulary entry, or None where the namespace is
        declared nowhere or more than once.
    """

    found = [
        (name, item)
        for name, layer in LAYERS.items()
        for item in layer.vocabularies
        if item.namespace == namespace
    ]

    return found[0] if len(found) == 1 else None


def _closure(
        start: tuple[str, str],
        edges: dict[tuple[str, str], set[tuple[str, str]]],
) -> set[tuple[str, str]]:
    """
    Everything reachable from one term, excluding itself.

    The keyword tree is a DAG rather than a tree — `GPI-anchor` has three
    parents — and the class tree may be one too, so the walk deduplicates.

    Args:
        start: The term to walk from.
        edges: The adjacency, upwards or downwards.

    Returns:
        The reachable terms.
    """

    seen: set[tuple[str, str]] = set()
    pending = list(edges.get(start, ()))

    while pending:

        found = pending.pop()

        if found in seen or found == start:

            continue

        seen.add(found)
        pending.extend(edges.get(found, ()))

    return seen


def _domains(built: Terms, conn) -> None:
    """
    Read the metabolic-domain buckets, which are a vocabulary of their own.

    `entity.metabolic_domain_id` is a `smallint` with **no** foreign key to
    `vocab_metabolic_domain`, so every read of it joins defensively and every
    lookup tolerates an id the vocabulary does not name.

    Args:
        built: The vocabulary being built.
        conn: An open connection.

    Returns:
        None. `built` gains one term per populated bucket.
    """

    if not LAYERS[DOMAIN_LAYER].default:

        return

    rows = conn.execute(
        f"""
        SELECT d.metabolic_domain_id, d.name, d.precedence,
               count(e.entity_id)::bigint AS entities
        FROM {SEARCH_SCHEMA}.vocab_metabolic_domain d
        LEFT JOIN {SEARCH_SCHEMA}.entity e
          ON e.metabolic_domain_id = d.metabolic_domain_id
        GROUP BY 1, 2, 3
        """,
    ).fetchall()

    for row in rows:

        if not row['entities']:

            continue

        category = slug(row['name'])
        built.terms[(DOMAIN_LAYER, str(row['metabolic_domain_id']))] = Term(
            namespace = DOMAIN_LAYER,
            accession = str(row['metabolic_domain_id']),
            entity_id = '',
            # No predicate reaches a domain: it is a column of `entity`, so
            # the filter resolves it to a `metabolic_domain_id` instead and
            # never to a `relation` pair.
            predicate_id = 0,
            label = row['name'],
            category = category,
            # `precedence` is the vocabulary's own tie-break order, lowest
            # first, which is what a projection uses when it needs one label
            # from a set. It sorts the domains among themselves and after the
            # location and class layers.
            rank = 5,
            layer = DOMAIN_LAYER,
            entities = int(row['entities']),
        )


def _index_categories(built: Terms) -> None:
    """
    Collapse the terms onto their output categories.

    Args:
        built: The vocabulary being built.

    Returns:
        None. `built` gains its `counts` and `by_category`.
    """

    grouped: dict[str, list[tuple[str, str]]] = {}

    for key, term in built.terms.items():

        grouped.setdefault(term.category, []).append(key)

    built.by_category = {
        category: tuple(sorted(keys)) for category, keys in grouped.items()
    }
    # The count is the widest contributing term's rather than the sum, because
    # the terms of one category overlap: a metabolite that is `FA05` and
    # `CHEMONTID:0001334` is one entity in `fatty_alcohols` and would be two in
    # a sum. An exact union needs the entity sets, so this is a floor.
    built.counts = {
        category: max(built.terms[key].entities for key in keys)
        for category, keys in built.by_category.items()
    }


def page(
        entities: Sequence[str],
        *,
        conn,
        layers: Layers | None = None,
) -> dict[str, Entry]:
    """
    Every layer of every entity on one page, in two or three indexed reads.

    **The page, not the index.** `relation_unique_idx` is
    `(subject_entity_id, predicate_id, object_entity_id)`, so a read filtered
    on the page's own endpoints is a bitmap index scan, the shape `nodes` and
    `shape` already use. The module docstring carries the figures, and why an
    eager whole-index cache loses to this.

    **A request pays for the layers it names and no others**: the resource
    join runs only for the by-resource object, and the function layer is a
    second statement that runs only when a request names it.

    Args:
        entities: The entity ids this page reaches.
        conn: An open connection.
        layers: The layers the request asked for, which decide whether the
            resource is joined and whether the function layer is read at all.

    Returns:
        `{entity_id: Entry}`, carrying an entry only for an entity some layer
        reaches. `columns` renders the absent case, because an empty value is a
        rendering decision and not a fact about the entity.
    """

    layers = layers or Layers()
    known = vocabulary(conn)
    wanted = list(dict.fromkeys(str(value) for value in entities if value))
    out: dict[str, Entry] = {}

    if not wanted:

        return out

    _collect(out, known, wanted, conn = conn, layers = layers)

    if layers.functions is not None:

        _collect_functions(out, wanted, conn = conn, layers = layers)

    if LAYERS[DOMAIN_LAYER].default:

        _collect_domains(out, wanted, conn = conn)

    if SEARCH_SCHEMA not in _REPORTED:

        _REPORTED.add(SEARCH_SCHEMA)
        # There is no startup line any more, because there is no eager index
        # to build at startup; the honest equivalent is what the first page
        # actually reached, said once per process.
        _log.info(
            'the per-entity annotation layers reached %d of this page\'s %d '
            'endpoints across %d categories',
            sum(1 for entry in out.values() if entry.classes),
            len(wanted),
            len({name for entry in out.values() for name in entry.classes}),
        )

    return out


def _collect(
        out: dict[str, Entry],
        known: Terms,
        wanted: Sequence[str],
        *,
        conn,
        layers: Layers,
) -> None:
    """
    Read the default layers for one page and roll the class terms up.

    Args:
        out: The entries being built.
        known: The vocabulary.
        wanted: The page's entity ids.
        conn: An open connection.
        layers: The request's layers, for the resource join.

    Returns:
        None.
    """

    clauses, args = _allow_list(every = False)
    rows = conn.execute(
        f"""
        SELECT r.subject_entity_id AS entity_id,
               p.name AS predicate,
               it.name AS namespace,
               oe.canonical_identifier AS accession
               {', ds.name AS resource' if layers.full else ''}
        FROM {SEARCH_SCHEMA}.relation r
        JOIN {SEARCH_SCHEMA}.vocab_relation_predicate p
          ON p.relation_predicate_id = r.predicate_id
        JOIN {SEARCH_SCHEMA}.entity oe
          ON oe.entity_id = r.object_entity_id
        JOIN {SEARCH_SCHEMA}.vocab_identifier_type it
          ON it.identifier_type_id = oe.canonical_identifier_type_id
        {
            f'''JOIN {SEARCH_SCHEMA}.relation_evidence_relation rer
          ON rer.relation_id = r.relation_id
        JOIN {SEARCH_SCHEMA}.data_source ds
          ON ds.source_id = rer.source_id'''
            if layers.full else ''
        }
        WHERE r.subject_entity_id = ANY(%s::uuid[])
          AND ({clauses})
        """,
        [list(wanted), *args],
    ).fetchall()

    for row in rows:

        key = (row['namespace'], row['accession'])
        term = known.terms.get(key)

        if term is None:

            # A term the vocabulary read does not carry is a term the build
            # wrote between the two reads. Dropping it keeps the rendered
            # categories inside the set `categories()` enumerates, which is
            # what makes a refusal honest.
            continue

        entry = out.setdefault(str(row['entity_id']), Entry())
        resource = row.get('resource') if layers.full else None
        _hit(entry.classes, term.category, term.rank, resource)

        for ancestor in known.ancestors.get(key, ()):

            if (parent := known.terms.get(ancestor)) is not None:

                # The resource that stated the child carries up to the parent,
                # because the parent is what the child means. So the
                # by-resource object names the resources of the terms that
                # implied a class, which is the only provenance a propagated
                # annotation has.
                _hit(entry.classes, parent.category, parent.rank, resource)


def _collect_functions(
        out: dict[str, Entry],
        wanted: Sequence[str],
        *,
        conn,
        layers: Layers,
) -> None:
    """
    Read the protein-function layer, for a request that named it.

    Args:
        out: The entries being built.
        wanted: The page's entity ids.
        conn: An open connection.
        layers: The request's layers, naming the vocabularies and deciding
            whether the resource is joined.

    Returns:
        None.
    """

    namespaces = list(layers.functions or ())

    if not namespaces:

        return

    predicates = sorted({
        item.predicate
        for item in LAYERS[FUNCTION_LAYER].vocabularies
        if item.namespace in namespaces
    })
    rows = conn.execute(
        f"""
        SELECT r.subject_entity_id AS entity_id,
               it.name AS namespace,
               COALESCE(NULLIF(oe.label, oe.canonical_identifier),
                        oe.canonical_identifier) AS label
               {', ds.name AS resource' if layers.full else ''}
        FROM {SEARCH_SCHEMA}.relation r
        JOIN {SEARCH_SCHEMA}.vocab_relation_predicate p
          ON p.relation_predicate_id = r.predicate_id
        JOIN {SEARCH_SCHEMA}.entity oe
          ON oe.entity_id = r.object_entity_id
        JOIN {SEARCH_SCHEMA}.vocab_identifier_type it
          ON it.identifier_type_id = oe.canonical_identifier_type_id
        {
            f'''JOIN {SEARCH_SCHEMA}.relation_evidence_relation rer
          ON rer.relation_id = r.relation_id
        JOIN {SEARCH_SCHEMA}.data_source ds
          ON ds.source_id = rer.source_id'''
            if layers.full else ''
        }
        WHERE r.subject_entity_id = ANY(%s::uuid[])
          AND p.name = ANY(%s::text[])
          AND it.name = ANY(%s::text[])
        """,
        [list(wanted), predicates, namespaces],
    ).fetchall()

    for row in rows:

        category = slug(row['label'])

        if not category:

            continue

        entry = out.setdefault(str(row['entity_id']), Entry())
        _hit(
            entry.functions, category, 4,
            row.get('resource') if layers.full else None,
        )


def _collect_domains(
        out: dict[str, Entry],
        wanted: Sequence[str],
        *,
        conn,
) -> None:
    """
    Read the coarse metabolic domain, which is a column and not a fact.

    Args:
        out: The entries being built.
        wanted: The page's entity ids.
        conn: An open connection.

    Returns:
        None.
    """

    rows = conn.execute(
        f"""
        SELECT e.entity_id, d.name
        FROM {SEARCH_SCHEMA}.entity e
        LEFT JOIN {SEARCH_SCHEMA}.vocab_metabolic_domain d
          ON d.metabolic_domain_id = e.metabolic_domain_id
        WHERE e.entity_id = ANY(%s::uuid[])
          AND e.metabolic_domain_id IS NOT NULL
        """,
        [list(wanted)],
    ).fetchall()

    for row in rows:

        if not row['name']:

            continue

        out.setdefault(str(row['entity_id']), Entry()).domain = slug(row['name'])


def _hit(
        found: dict[str, Hit],
        category: str,
        rank: int,
        resource: str | None,
) -> None:
    """
    Record one category on one entity, keeping the best rank.

    Args:
        found: The entity's categories so far.
        category: The slug.
        rank: The contributing term's vocabulary rank.
        resource: The resource that asserted it, where one was read.

    Returns:
        None.
    """

    hit = found.get(category)

    if hit is None:

        hit = Hit(rank = rank)
        found[category] = hit

    hit.rank = min(hit.rank, rank)

    if resource:

        hit.resources.add(resource)


def resolve_filter(values: Iterable[str], *, conn) -> Filter:
    """
    Resolve an `entity_annotations` request to terms a query can match.

    **Terms rather than entities, and that is a change of mechanism.** The old
    resolution returned every entity carrying a category and the record
    predicate spliced that list in as two `uuid[]` arguments. Measured on dev5,
    2026-10-23: `cytoplasm` admits 67,469 entities and `extracellular region`
    76,529, against the 15,000 `guard` prices the plan for, and the bounded key
    count costs **11,525 ms** spliced that way against **1,400 ms** as a
    semi-join on the term pair. So the category resolves to its terms instead,
    and `select` writes an `EXISTS` over `relation`.

    A named class resolves to its descendants as well, so the filter admits
    exactly the entities whose rendered array shows the category: without that,
    filtering on `glycerophospholipids` would reach only the chemicals
    annotated with `GP` itself, while the column shows it on every `GP0301`
    below.

    Args:
        values: The requested category names, with or without the `is_` prefix.
        conn: An open connection.

    Returns:
        The resolved filter.
    """

    known = vocabulary(conn)
    wanted = tuple(dict.fromkeys(
        name for name in (_category(value) for value in values) if name
    ))
    terms: dict[tuple[int, str], None] = {}
    domains: dict[int, None] = {}

    for category in wanted:

        for key in known.by_category.get(category, ()):

            term = known.terms[key]

            if term.layer == DOMAIN_LAYER:

                domains.setdefault(int(term.accession), None)

                continue

            terms.setdefault((term.predicate_id, term.entity_id), None)

            for found in known.descendants.get(key, ()):

                terms.setdefault(found, None)

    return Filter(
        categories = wanted,
        term_pairs = tuple(terms),
        domain_ids = tuple(domains),
    )


def unknown_categories(values: Iterable[str], conn = None) -> list[str]:
    """
    The requested category names the vocabulary does not register.

    Args:
        values: The requested names.
        conn: An open connection, which builds the vocabulary if it is not yet
            read.

    Returns:
        The ones nothing is registered under, as the caller wrote them.
    """

    known = set(categories(conn))

    return [
        str(value) for value in values
        if (_category(value) or '') not in known
    ]


def columns(
        entity: Any,
        side: str,
        layers: Layers,
        annotations: dict[str, Entry],
) -> dict[str, Any]:
    """
    One node's annotation columns, named for the side it is on.

    Args:
        entity: The entity id the node stands for, or None.
        side: `source` or `target`.
        layers: The layers this request asked for.
        annotations: The page's entries.

    Returns:
        The default summary array, plus the metabolic domain, the by-resource
        object, the function array and the named booleans where they were asked
        for.

        **Every key is present on every row**, because a key that appears only
        sometimes is a column a frame consumer cannot read. The layers are
        entity-type-specific, so holding that rule means a protein endpoint
        carries the same keys as a chemical one, each at **T098's spelling for
        absence: the empty value of the field's own type.** An array is `[]`,
        an object is `{}`, and the metabolic domain is null because a string
        naming one of six buckets has no empty form that is not a seventh
        bucket.
    """

    entry = annotations.get(str(entity)) if entity is not None else None
    entry = entry or Entry()
    out: dict[str, Any] = {
        f'{side}_{SUMMARY_SUFFIX}': _ordered(entry.classes),
    }

    if LAYERS[DOMAIN_LAYER].default:

        out[f'{side}_{DOMAIN_SUFFIX}'] = entry.domain

    if layers.full:

        # The function categories join the object when both were asked for, and
        # the metabolic domain never does: it is a column of `entity` rather
        # than an asserted fact, so no resource stated it and an empty list
        # beside the others would read as "nobody said so".
        out[f'{side}_{OBJECT_SUFFIX}'] = {
            category: sorted(hit.resources)
            for category, hit in (
                *sorted(entry.classes.items()),
                *sorted(entry.functions.items()),
            )
        }

    if layers.functions is not None:

        out[f'{side}_{FUNCTION_SUFFIX}'] = _ordered(entry.functions)

    for category in layers.booleans:

        out[f'{side}_{BOOLEAN_PREFIX}{category}'] = (
            category in entry.classes
            or category in entry.functions
            or category == entry.domain
        )

    return out


def _ordered(found: dict[str, Hit]) -> list[str]:
    """
    One entity's categories, in the order the ranking puts them.

    The locations come first, then LIPID MAPS, then RefMet, then ChemOnt, and
    this is where the ranking can be seen: the array holds every layer's
    categories at once, and a consumer reading the first element should get the
    most trusted statement rather than the alphabetically first.

    Args:
        found: The entity's categories.

    Returns:
        The slugs, best rank first and alphabetical inside a rank.
    """

    return [
        category for category, _ in
        sorted(found.items(), key = lambda item: (item[1].rank, item[0]))
    ]
