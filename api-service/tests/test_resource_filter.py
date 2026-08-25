"""Forgiving resource-filter resolution.

A resource filter given as slug / short / synonym (any case) resolves to the same
canonical resource key. Needs DATABASE_URL pointing at a built DB with the
resources 3-name columns. Skipped otherwise.
"""

from __future__ import annotations

import os

import pytest

DATABASE_URL = os.environ.get("DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="DATABASE_URL not set; resource-filter test needs a build"
)


@pytest.fixture(scope="module")
def catalog():
    pytest.importorskip("psycopg")
    from api_service import resource_catalog

    resource_catalog._resource_filter_index.cache_clear()
    return resource_catalog


def test_slug_short_synonym_resolve_to_same_key(catalog):
    # SIGNOR is in resources.json with synonym 'Signor'; short 'SIGNOR'.
    slug = catalog.resolve_resource_filter("signor")
    assert catalog.resolve_resource_filter("SIGNOR") == slug
    assert catalog.resolve_resource_filter("Signor") == slug


def test_unknown_filter_passes_through(catalog):
    assert catalog.resolve_resource_filter("no_such_resource_xyz") == "no_such_resource_xyz"


def test_resolve_list_dedups(catalog):
    resolved = catalog.resolve_resource_filters(["signor", "SIGNOR", "Signor"])
    assert len(resolved) == 1


def test_list_resources_returns_three_names(catalog):
    resources = catalog.list_resources()
    assert resources
    sample = resources[0]
    assert {"slug", "short", "full", "synonyms"} <= set(sample)
