"""Sign and direction as the API returns them: three-valued, summarised, honest.

`is_directed`, `is_stimulation` and `is_inhibition` are nullable booleans, and
the three states mean three different things. `true` is a resource saying so.
`false` is a resource saying the opposite. `null` is nobody in the queried
scope saying anything at all. A client that reads the third as the second
converts silence into a claim, and it does so on the overwhelming majority of
this build: 13,677,139 of 14,686,404 record rows assert no direction and
14,562,471 assert no stimulation.

So this file pins the response surface rather than the storage:

- **Null survives the whole path.** The flags leave the fold as `None`, are
  serialised as JSON `null`, and the row carries the key either way. An absent key
  and a `false` are both wrong answers, and they are wrong in different ways.
- **Nothing is defaulted.** The build stores no asserted `false` anywhere, so
  the only way a `false` could reach a response is if the service invented it.
  Every flag on a page is therefore `True` or `None`, and the fold names no
  coalescing of them.
- **Disagreement is preserved rather than resolved.** Both sign flags may be
  true on one row, and `sign_source_count` says how many resources spoke so a
  caller can tell one dissenter from a consensus.
- **Provenance outruns the summary.** `resources` and `references` list every
  contributor, including the ones that assert neither sign nor direction, so
  `sign_source_count` is at most the number of resources and is often less.
- **The counts describe the query's own scope.** Narrowing to one resource
  narrows the counts, and does not hand back the numbers of a wider fold.
- **An opposite-direction pair is two rows.** A→B and B→A are separate
  statements with separate provenance, and no bidirectional row is invented to
  hold both.

    DATABASE_URL=... pytest tests/test_interactions_sign_direction.py -v
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
    reason = 'DATABASE_URL not set; the sign contract needs a built DB',
)

#: The three nullable flags, in the order the contract names them.
FLAGS = ('is_directed', 'is_stimulation', 'is_inhibition')

#: The two counts that let a caller weigh the summary above.
COUNTS = ('sign_source_count', 'direction_source_count')

#: The delimiter the joined provenance columns use.
DELIMITER = ';'

#: A page wide enough that "no flag is ever False" is a claim about data rather
#: than about three rows.
PAGE = 500


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


def _record(db, sql: str, args: tuple = ()) -> list[dict[str, Any]]:
    """Read the record table, so expectations come from the build itself.

    Args:
        db: An open connection.
        sql: A statement with `{record}` placeholders.
        args: Positional arguments.

    Returns:
        The rows.
    """

    from api_service.interactions.select import RECORD_TABLE

    return db.execute(
        sql.format(record = f'{SCHEMA}.{RECORD_TABLE}'),
        args,
    ).fetchall()


@pytest.fixture(scope = 'module')
def disagreeing_key(db) -> dict[str, Any]:
    """A collapse key two resources sign in opposite senses.

    Args:
        db: An open connection.

    Returns:
        The key, its resource count and its signing-resource count.
    """

    rows = _record(
        db,
        """
        SELECT r.subject_entity_id, r.object_entity_id, r.interaction_class_id,
               count(DISTINCT r.source_id)::int AS sources,
               (count(DISTINCT r.source_id) FILTER (
                  WHERE r.is_stimulation IS NOT NULL OR r.is_inhibition IS NOT NULL
                ))::int AS signing
        FROM {record} r
        WHERE r.interaction_class_id = 1
        GROUP BY 1, 2, 3
        HAVING bool_or(r.is_stimulation) AND bool_or(r.is_inhibition)
           AND count(DISTINCT r.source_id) FILTER (
                 WHERE r.is_stimulation IS NOT NULL OR r.is_inhibition IS NOT NULL
               ) >= 2
        LIMIT 1
        """,
    )

    if not rows:

        pytest.skip('this build holds no cross-resource sign disagreement')

    return dict(rows[0])


@pytest.fixture(scope = 'module')
def attribute_poor_key(db) -> dict[str, Any]:
    """A key one resource signs and another contributes to without signing.

    The case the provenance rule is about: the silent resource still owes its
    name to `resources` and its references to `references`, and must not be
    dropped for being attribute-poor.

    Args:
        db: An open connection.

    Returns:
        The key, its resource count and its signing-resource count.
    """

    rows = _record(
        db,
        """
        SELECT r.subject_entity_id, r.object_entity_id, r.interaction_class_id,
               count(DISTINCT r.source_id)::int AS sources,
               (count(DISTINCT r.source_id) FILTER (
                  WHERE r.is_stimulation IS NOT NULL OR r.is_inhibition IS NOT NULL
                ))::int AS signing
        FROM {record} r
        GROUP BY 1, 2, 3
        HAVING count(DISTINCT r.source_id) > count(DISTINCT r.source_id) FILTER (
                 WHERE r.is_stimulation IS NOT NULL OR r.is_inhibition IS NOT NULL
               )
           AND count(DISTINCT r.source_id) FILTER (
                 WHERE r.is_stimulation IS NOT NULL OR r.is_inhibition IS NOT NULL
               ) > 0
        LIMIT 1
        """,
    )

    if not rows:

        pytest.skip('no key in this build mixes a signing and a silent resource')

    return dict(rows[0])


@pytest.fixture(scope = 'module')
def opposite_pair(db) -> dict[str, Any]:
    """Two entities this build reports in both orders, within one class.

    Args:
        db: An open connection.

    Returns:
        The two entity ids and the class they share.
    """

    rows = _record(
        db,
        """
        SELECT r.subject_entity_id, r.object_entity_id, r.interaction_class_id
        FROM {record} r
        WHERE r.interaction_class_id = 1
          AND EXISTS (
            SELECT 1 FROM {record} r2
            WHERE r2.subject_entity_id = r.object_entity_id
              AND r2.object_entity_id = r.subject_entity_id
              AND r2.interaction_class_id = r.interaction_class_id
          )
        LIMIT 1
        """,
    )

    if not rows:

        pytest.skip('this build reports no endpoint pair in both directions')

    return dict(rows[0])


def _key_payload(key: dict[str, Any], **extra: Any) -> dict[str, Any]:
    """A request narrowed to one collapse key's endpoints.

    Args:
        key: A record key.
        extra: Further filter terms.

    Returns:
        The request payload.
    """

    return {
        'filters': {
            'entities': [
                str(key['subject_entity_id']),
                str(key['object_entity_id']),
            ],
            **extra,
        },
        'limit': PAGE,
    }


def _row_for(answer: dict[str, Any], key: dict[str, Any]) -> dict[str, Any]:
    """The response row matching one collapse key.

    Args:
        answer: An engine answer.
        key: The record key.

    Returns:
        The row.
    """

    wanted = (
        str(key['subject_entity_id']),
        str(key['object_entity_id']),
        int(key['interaction_class_id']),
    )
    matching = [
        row for row in answer['interactions']
        if (
            str(row['subject_entity_id']),
            str(row['object_entity_id']),
            int(row['interaction_class_id']),
        ) == wanted
    ]

    assert len(matching) == 1, (
        f'expected exactly one row for {wanted}; got {len(matching)}'
    )

    return matching[0]


# ── Null is a state, not a missing value ────────────────────────────────────


def test_every_flag_is_present_on_every_row(db):
    """The three flags are keys of every row, whatever their value."""

    answer = _run(db, {'limit': PAGE})

    assert answer['interactions'], 'the unscoped first page is empty'

    for row in answer['interactions']:

        missing = [flag for flag in FLAGS if flag not in row]

        assert not missing, (
            f'{missing} absent from a row; an absent key and a null are '
            f'different answers to a frame consumer, and only one of them is '
            f'the contract'
        )


def test_an_unasserted_flag_serialises_as_null_not_false(db):
    """Null reaches the wire as `null`, distinguishable from `false`."""

    answer = _run(db, {'limit': PAGE})
    unasserted = [
        row for row in answer['interactions']
        if row['is_stimulation'] is None
    ]

    assert unasserted, (
        'no row on the first page leaves stimulation unasserted, which cannot '
        'be right on a build where 14,562,471 of 14,686,404 record rows are '
        'silent about it'
    )

    body = json.loads(json.dumps(unasserted[0]))

    assert body['is_stimulation'] is None
    assert body['is_stimulation'] is not False
    assert '"is_stimulation": null' in json.dumps(body, indent = None), (
        'the flag must serialise as an explicit null'
    )


def test_no_flag_is_ever_fabricated_false(db):
    """Nothing is defaulted: this build stores no `false`, so none is returned."""

    stored = _record(
        db,
        """
        SELECT count(*)::int AS asserted_false
        FROM {record} r
        WHERE r.is_directed IS FALSE
           OR r.is_stimulation IS FALSE
           OR r.is_inhibition IS FALSE
        """,
    )[0]['asserted_false']

    assert stored == 0, (
        'the build has gained asserted negatives; this test now has a real '
        'false to check against and should assert it survives the fold'
    )

    answer = _run(db, {'limit': PAGE})
    fabricated = [
        (row['subject_entity_id'], flag)
        for row in answer['interactions']
        for flag in FLAGS
        if row[flag] is False
    ]

    assert not fabricated, (
        f'{len(fabricated)} flags came back false while the record stores no '
        f'negative assertion at all; the only place they can have come from '
        f'is a default'
    )


def test_the_fold_never_coalesces_a_flag():
    """The aggregation carries no default for a silent contributor."""

    from api_service.interactions import fold

    body = fold._PROJECTION.lower()

    assert 'coalesce' not in body, (
        'a coalesce over the sign flags turns silence into an assertion for '
        'every row of the build'
    )

    for flag in FLAGS:

        assert f'bool_or(r.{flag}) as {flag}' in body, (
            f'{flag} must be summarised with bool_or, which ignores nulls and '
            f'returns null when every contributor is silent'
        )


# ── Disagreement is preserved, and countable ────────────────────────────────


def test_both_sign_flags_may_be_true(db, disagreeing_key):
    """Resources that disagree both reach the row. Neither one wins."""

    row = _row_for(_run(db, _key_payload(disagreeing_key)), disagreeing_key)

    assert row['is_stimulation'] is True
    assert row['is_inhibition'] is True, (
        'one sign silently won; the summary must surface both'
    )
    assert row['sign_source_count'] >= 2, (
        f'{row["sign_source_count"]} resources credited with a sign on a key '
        f'{disagreeing_key["signing"]} resources sign'
    )


def test_the_assertion_counts_are_exposed(db):
    """Both counts are on every row, as integers a caller can weigh."""

    answer = _run(db, {'limit': PAGE})

    for row in answer['interactions']:

        for name in COUNTS:

            assert name in row, f'{name} is not exposed'
            assert isinstance(row[name], int), (
                f'{name} came back as {type(row[name]).__name__}; a caller '
                f'weighs a summary with a number'
            )


def test_a_count_never_exceeds_the_resources_it_counts(db):
    """`sign_source_count` is at most the number of contributing resources."""

    answer = _run(db, {'limit': PAGE})

    for row in answer['interactions']:

        contributors = len(str(row['resources']).split(DELIMITER)) if row.get('resources') else 0

        for name in COUNTS:

            assert row[name] <= row['source_count'], (
                f'{name} of {row[name]} over {row["source_count"]} resources'
            )
            assert row[name] <= contributors, (
                f'{name} of {row[name]} over {contributors} named resources'
            )


# ── Provenance outruns the summary ──────────────────────────────────────────


def test_a_silent_resource_still_appears_in_the_provenance(db, attribute_poor_key):
    """A contributor that asserts no sign is still named in `resources`."""

    row = _row_for(
        _run(db, _key_payload(attribute_poor_key)),
        attribute_poor_key,
    )
    named = [name for name in str(row['resources']).split(DELIMITER) if name]

    assert len(named) == attribute_poor_key['sources'], (
        f'{len(named)} resources named for a key {attribute_poor_key["sources"]} '
        f'resources contribute to; a contributor was dropped for being '
        f'attribute-poor'
    )
    assert row['sign_source_count'] == attribute_poor_key['signing']
    assert row['sign_source_count'] < len(named), (
        'this key was chosen because a resource contributes without signing; '
        'the count must be strictly below the contributor list'
    )


def test_references_name_the_resource_that_published_them(db):
    """`references` is delimiter-joined `resource:reference_id`, not bare ids."""

    answer = _run(
        db,
        {'filters': {'resources': ['signor']}, 'limit': PAGE},
    )
    referenced = [
        row for row in answer['interactions'] if row.get('references')
    ]

    assert referenced, 'a resource that publishes references returned none'

    for row in referenced:

        for entry in str(row['references']).split(DELIMITER):

            resource, separator, identifier = entry.partition(':')

            assert separator and resource and identifier, (
                f'{entry!r} is not a `resource:reference_id` pair'
            )
            assert resource in str(row['resources']).split(DELIMITER), (
                f'{resource!r} publishes a reference on a row it does not '
                f'contribute to'
            )


# ── The counts describe the query's own scope ───────────────────────────────


def test_narrowing_the_scope_narrows_the_sign_count(db, disagreeing_key):
    """One resource's query reports one resource's sign, not the wider fold's."""

    whole = _row_for(_run(db, _key_payload(disagreeing_key)), disagreeing_key)
    resources = [name for name in str(whole['resources']).split(DELIMITER) if name]

    assert len(resources) >= 2

    signed_alone = 0

    for name in resources:

        answer = _run(db, _key_payload(disagreeing_key, resources = [name]))
        row = _row_for(answer, disagreeing_key)

        assert row['resources'] == name, (
            f'a scope of {name!r} returned provenance {row["resources"]!r}'
        )
        assert row['sign_source_count'] <= 1, (
            f'{name!r} alone was credited with {row["sign_source_count"]} '
            f'signing resources; the counts of a wider fold leaked into a '
            f'narrower scope'
        )

        signed_alone += row['sign_source_count']

    assert signed_alone >= 2, (
        'the resources of a disagreeing key each sign alone, so the per-scope '
        'counts must add up to the wider one'
    )


# ── Two directions, two rows ────────────────────────────────────────────────


def test_an_opposite_direction_pair_is_two_rows(db, opposite_pair):
    """A→B and B→A stay apart, each with its own provenance."""

    answer = _run(db, _key_payload(opposite_pair))
    forward = (
        str(opposite_pair['subject_entity_id']),
        str(opposite_pair['object_entity_id']),
    )
    reverse = (forward[1], forward[0])
    seen = {
        (str(row['subject_entity_id']), str(row['object_entity_id']))
        for row in answer['interactions']
        if int(row['interaction_class_id']) == int(opposite_pair['interaction_class_id'])
    }

    assert forward in seen, 'the forward statement is missing'
    assert reverse in seen, (
        'the reverse statement is missing; the two directions were merged into '
        'one bidirectional row'
    )

    rows = [
        row for row in answer['interactions']
        if (str(row['subject_entity_id']), str(row['object_entity_id'])) in {forward, reverse}
        and int(row['interaction_class_id']) == int(opposite_pair['interaction_class_id'])
    ]

    assert len(rows) == 2, f'expected two rows for the pair, got {len(rows)}'
