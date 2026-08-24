"""
Organism handling — resolve the name, serve what the record holds, refuse the rest.

Three things happen to an `organism=` value, and keeping them apart is the
whole of this module.

**It is resolved.** `9606`, `human` and `hsapiens` name one taxon, and a caller
may write any of them. The names come from the Utils organism table, which is
where the build's own taxon vocabulary comes from; where Utils is out of reach
the build's organism entities answer the Latin names on their own. A value that
resolves to no taxon at all is **refused**. That is the point of this module
rather than an afterthought: an unresolved organism used to parse to nothing,
the filter was dropped, and the caller got the whole record back believing they
had asked for one species. A filter that silently does nothing is worse than an
error, because the caller cannot see it happen.

**It is checked against the record.** A taxon the build holds is served
natively — the rows are the source's own and carry their own organism. A
subspecies the build files under its species is served from the species rows,
and the response says that it was: the Utils taxon-to-species map is what makes
the dog case work, where a source publishes 9615 and the resolver files the
entity under 9612.

**Anything else is refused, and honestly.** A taxon the record does not hold at
all needs orthology — the settled shape is a Utils-exported orthology map
joined at query time, never a live call or a download on the request path. That
export does not exist in the build database, so the request cannot be served
and says so with a 501 naming what is missing. Returning the native rows
labelled as the requested organism is the one outcome the contract forbids, and
an empty page would be the same lie told quietly.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Sequence

from ..graph import SEARCH_SCHEMA

_log = logging.getLogger(__name__)

# The Utils database and the schema its tables live in. It is optional: without
# it numeric taxa and the build's own Latin names still resolve, and the
# subspecies widening below simply does not fire.
UTILS_URL_VARIABLES = (
    'OMNIPATH_UTILS_PG_URL',
    'OMNIPATH_BUILD_UTILS_PG_URL',
)
UTILS_SCHEMA = os.environ.get('OMNIPATH_UTILS_PG_SCHEMA', 'omnipath_utils')

# The columns of the Utils organism table that name a taxon. Every one of them
# is a name a caller might reasonably write.
UTILS_NAME_COLUMNS = (
    'common_name',
    'latin_name',
    'short_latin',
    'ensembl_name',
    'kegg_code',
    'uniprot_code',
    'oma_code',
    'mirbase_code',
)

# The build's own vocabulary of organisms, as entity rows. `Organism:OM:0032`.
ORGANISM_ENTITY_TYPE = 'Organism:OM:0032'

# Cached per schema, because the answer changes only when the build does.
_NATIVE_CACHE: dict[str, frozenset[int]] = {}

# One connection to Utils per process, or the fact that there is none. Utils is
# read for names only, and never on the path of a numeric request.
_UTILS: dict[str, Any] = {}


@dataclass
class OrganismScope:
    """What an `organism=` request resolved to, and how."""

    # The taxa the record is filtered on. Empty means no organism restriction.
    taxa: list[int] = field(default_factory = list)
    # The values the caller wrote, in order.
    requested: list[str] = field(default_factory = list)
    # Every value that was served from its species' rows rather than its own,
    # as `{written value: the taxon actually filtered on}`. A response carries
    # this so a caller can see that the request was widened.
    served_as_species: dict[str, int] = field(default_factory = dict)

    @property
    def asked(self) -> bool:
        """Whether the request restricted the organism at all."""

        return bool(self.requested)

    def as_dict(self) -> dict[str, Any]:
        """
        The resolution as it is carried on a response.

        Returns:
            What was asked for, what it resolved to, and any widening.
        """

        out: dict[str, Any] = {
            'requested': list(self.requested),
            'taxa': list(self.taxa),
        }

        if self.served_as_species:

            out['served_as_species'] = dict(self.served_as_species)

        return out


def resolve(values: Sequence[str], *, conn) -> OrganismScope:
    """
    Turn the organism values of one request into the taxa to filter on.

    Args:
        values: The values the caller wrote, already split into tokens.
        conn: An open connection to the build database.

    Returns:
        The resolved scope. An empty request resolves to an empty scope, which
        places no restriction — the record's own organisms are all served.

    Raises:
        GuardrailRefusal: 400 for a value that names no taxon, 501 for a taxon
            the record does not hold.
    """

    # Imported here rather than at the top of the module: the cost governor
    # reaches the scope, the scope reaches this module, and a module-level
    # import would close that ring. The refusal type is all this module wants
    # from it.
    from .guard import GuardrailRefusal

    requested = [str(value).strip() for value in values if str(value).strip()]

    if not requested:

        return OrganismScope()

    native = native_taxa(conn)
    scope = OrganismScope(requested = requested)
    taxa: list[int] = []

    for value in requested:

        candidates = _taxa_for(value, conn)

        if not candidates:

            raise GuardrailRefusal(
                f'{value!r} does not name an organism. Write an NCBI taxon id '
                f'(9606), a common name (human), or a Latin or Ensembl name '
                f'(Homo sapiens, hsapiens).',
                status_code = 400,
                parameter = 'organism',
                value = value,
            )

        matched = [taxon for taxon in candidates if taxon in native]

        if not matched:

            matched = _species_fallback(candidates, native, conn)

            if matched:

                scope.served_as_species[value] = matched[0]

                _log.info(
                    'organism %r is not filed under its own taxon; serving the '
                    'species rows of %d instead', value, matched[0],
                )

        if not matched:

            raise GuardrailRefusal(
                f'{value!r} resolves to taxon {candidates[0]}, which this '
                f'build holds no interactions for. Serving it would mean '
                f'translating another organism\'s interactions through '
                f'orthology, and the orthology map is not exported into the '
                f'build database yet, so there is nothing to join. Returning '
                f'the interactions of a different organism under this name is '
                f'not an option.' + _species_caveat(),
                status_code = 501,
                parameter = 'organism',
                value = value,
                taxon = candidates[0],
            )

        taxa.extend(taxon for taxon in matched if taxon not in taxa)

    scope.taxa = taxa

    return scope


def _species_caveat() -> str:
    """
    The sentence a refusal gains when the species map could not be consulted.

    A source may publish a subspecies that the resolver files under its
    species, and the check for that lives in the Utils database. Where Utils is
    out of reach the check did not run, and a caller staring at a refusal for
    an organism they know is in the data deserves to be told why.

    Returns:
        The extra sentence, or an empty string when the check did run.
    """

    if _utils_connection() is not None:

        return ''

    return (
        ' The Utils database is not reachable from here, so this answer could '
        'not take account of a subspecies whose interactions the build files '
        'under its species; configure it and ask again.'
    )


def native_taxa(conn) -> frozenset[int]:
    """
    Every organism the build holds an entity for, read once per process.

    The record's `subject_organism` and `object_organism` are the taxonomy of
    the endpoint entities, so the entity table's taxon set is exactly the set a
    filter can match. Counting the record itself would be a scan of fourteen
    million rows to learn the same thing.

    Args:
        conn: An open connection to the build database.

    Returns:
        The taxon ids present.
    """

    if SEARCH_SCHEMA not in _NATIVE_CACHE:

        rows = conn.execute(
            f"""
            SELECT DISTINCT taxonomy_id
            FROM {SEARCH_SCHEMA}.entity
            WHERE taxonomy_id IS NOT NULL
            """,
        ).fetchall()
        _NATIVE_CACHE[SEARCH_SCHEMA] = frozenset(
            int(row['taxonomy_id']) for row in rows
        )

        _log.info(
            'the build holds entities of %d organisms',
            len(_NATIVE_CACHE[SEARCH_SCHEMA]),
        )

    return _NATIVE_CACHE[SEARCH_SCHEMA]


def _taxa_for(value: str, conn) -> list[int]:
    """
    Every taxon one written value could mean.

    Args:
        value: One organism value from the request.
        conn: An open connection to the build database.

    Returns:
        The candidate taxon ids, best first, or an empty list when the value
        names nothing.
    """

    try:

        return [int(value)]

    except ValueError:

        pass

    return _utils_taxa(value) or _build_taxa(value, conn)


def _build_taxa(value: str, conn) -> list[int]:
    """
    Resolve an organism name against the build's own organism entities.

    Args:
        value: A name, matched case-insensitively.
        conn: An open connection to the build database.

    Returns:
        The taxon ids the name matches.
    """

    rows = conn.execute(
        f"""
        SELECT DISTINCT e.taxonomy_id
        FROM {SEARCH_SCHEMA}.entity e
        JOIN {SEARCH_SCHEMA}.vocab_entity_type et
          ON et.entity_type_id = e.entity_type_id
        WHERE et.name = %s
          AND e.taxonomy_id IS NOT NULL
          AND (lower(e.canonical_identifier) = %s OR lower(e.label) = %s)
        """,
        (ORGANISM_ENTITY_TYPE, value.lower(), value.lower()),
    ).fetchall()

    return sorted(int(row['taxonomy_id']) for row in rows)


def _utils_taxa(value: str) -> list[int]:
    """
    Resolve an organism name against the Utils organism table.

    Args:
        value: A name, matched case-insensitively against every naming column.

    Returns:
        The taxon ids the name matches, or an empty list when Utils is out of
        reach — in which case the build's own names still get their turn.
    """

    conn = _utils_connection()

    if conn is None:

        return []

    matches = ' OR '.join(f'lower({column}) = %s' for column in UTILS_NAME_COLUMNS)

    try:

        rows = conn.execute(
            f'SELECT ncbi_tax_id FROM {UTILS_SCHEMA}.organism WHERE {matches}',
            [value.lower()] * len(UTILS_NAME_COLUMNS),
        ).fetchall()

    except Exception as exc:

        _log.warning('the Utils organism table is unreadable: %s', exc)
        _drop_utils_connection()

        return []

    return sorted(int(row[0]) for row in rows)


def _species_fallback(
        candidates: Sequence[int],
        native: frozenset[int],
        conn,
) -> list[int]:
    """
    The species rows that stand in for a subspecies the build does not file.

    A source may publish a subspecies where the identifier resolver files the
    entity under the species — dog, published as 9615, resolved to 9612 — and
    a request for the published value would otherwise find nothing while the
    rows sit one rank above it. The rows keep their own organism in the
    response; only the filter is widened, and the response says so.

    Args:
        candidates: The taxa the request resolved to.
        native: The taxa the build holds.
        conn: An open connection to the build database.

    Returns:
        The native taxa of the same species, or an empty list.
    """

    conn_utils = _utils_connection()

    if conn_utils is None:

        return []

    try:

        rows = conn_utils.execute(
            f"""
            SELECT DISTINCT species_tax_id
            FROM {UTILS_SCHEMA}.taxon_species
            WHERE tax_id = ANY(%s::int[])
            """,
            (list(candidates),),
        ).fetchall()

    except Exception as exc:

        _log.warning('the Utils species map is unreadable: %s', exc)
        _drop_utils_connection()

        return []

    return [
        int(row[0]) for row in rows
        if int(row[0]) in native and int(row[0]) not in candidates
    ]


def _drop_utils_connection() -> None:
    """
    Forget a Utils connection that stopped answering, so the next call retries.

    Without this a single network hiccup would silently disable name resolution
    for the life of the process, and every organism name written after it would
    be refused as unknown.

    Returns:
        None.
    """

    conn = _UTILS.pop('conn', None)

    if conn is not None:

        try:

            conn.close()

        except Exception:

            pass


def _utils_connection():
    """
    The read-only Utils connection, opened once and never required.

    Returns:
        An open connection, or None when no Utils database is configured or it
        cannot be reached. Every caller degrades rather than fails: Utils
        widens what a caller may write, and its absence must not turn a
        numeric request into an error.
    """

    if 'conn' in _UTILS:

        return _UTILS['conn']

    _UTILS['conn'] = None
    url = next(
        (
            os.environ[name] for name in UTILS_URL_VARIABLES
            if os.environ.get(name)
        ),
        None,
    )

    if not url:

        _log.info(
            'no Utils database is configured, so organism names resolve '
            'against the build alone',
        )

        return None

    try:

        import psycopg

        _UTILS['conn'] = psycopg.connect(url, autocommit = True)

    except Exception as exc:

        _log.warning('the Utils database is out of reach: %s', exc)

    return _UTILS['conn']
