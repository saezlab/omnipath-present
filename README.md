# omnipath-present

`omnipath-present` is the local presentation and exploration app for OmniPath
v2 data. It provides:

- a SvelteKit frontend in `omnipath-svelte/`
- a FastAPI backend in `api-service/`
- a PostgreSQL 18 development database with the `pg_roaringbitmap` extension
- Docker Compose wiring that reads generated data from a sibling
  `omnipath-build` checkout

The app expects the build repository and presentation repository to live in the
same parent directory:

```bash
Code/
  omnipath-build/
  omnipath-present/
```

Some existing local checkouts use `omnipath_build` instead of
`omnipath-build`; the Makefile supports both names.

## Prerequisites

- Docker with Docker Compose v2
- Node.js with `pnpm` available
- Python tooling required by `omnipath-build`, especially `uv`

## Clone the repositories

```bash
mkdir -p ~/Code
cd ~/Code
git clone https://github.com/saezlab/omnipath-build.git
git clone https://github.com/saezlab/omnipath-present.git
```

If you use a fork, keep the two checkout directories side by side.

## One-time setup

Set up the build repository first:

```bash
cd ~/Code/omnipath-build
make setup
```

Then set up the presentation repository:

```bash
cd ~/Code/omnipath-present
make setup
```

`make setup` in this repository creates local `.env` files from the examples,
installs the SvelteKit dependencies, and builds the development Docker images.
It does not build OmniPath data; that still happens in `omnipath-build`.

## Build or refresh data

`omnipath-present` reads from the PostgreSQL database and data artifacts
created by `omnipath-build`. Start the presentation services first so the
PostgreSQL database is available:

```bash
cd ~/Code/omnipath-present
make dev
```

On a first-time setup, this may warn that data outputs are missing. That is
expected before the build pipeline has run; the PostgreSQL service still starts
so `omnipath-build` can load it.

In a second terminal, run the build pipeline against that database:

```bash
cd ~/Code/omnipath-build
make all DROP_EXISTING=1
```

Some upstream sources cannot be downloaded automatically by the build pipeline.
Download those manually when needed and place them in the `pypath-data/`
directory inside the `omnipath-build` checkout. HMDB is one example of a source
that may require this manual step.

For smaller development runs, use the narrower build targets from
`omnipath-build`, for example:

```bash
make db-setup DROP_EXISTING=1
make load SOURCE=signor MAX_RECORDS=200000
make derive
```

The default database URL used by `omnipath-build` matches the development
database started here:

```bash
postgresql://omnipath:omnipath@localhost:55432/omnipath
```

## Daily development

Start everything from `omnipath-present`:

```bash
make dev
```

This starts the backend services with Docker Compose and then runs the
SvelteKit dev server. Useful local URLs:

- Frontend: <http://localhost:8083>
- API service: <http://localhost:8081>
- PostgreSQL: `postgresql://omnipath:omnipath@localhost:55432/omnipath`

Stop the Docker services when you are done:

```bash
make stop
```

Rebuild and restart backend containers after Dockerfile or backend dependency
changes:

```bash
make restart
```

## Runtime data

The active app is backed by PostgreSQL. Entity, relation, resource, facet, and
ontology-term search data are loaded into the development database by
`omnipath-build`.

The API service can mount local OBO files for ontology lookup. By default,
`make dev` checks `../omnipath-build` and `../omnipath_build`, preferring the
checkout that already has a `data/` directory, and uses this path when present:

- `../omnipath-build/data/obo`

Override any path when needed:

```bash
make dev ONTOLOGY_DIR=/path/to/obo
```

Run `make validate-data` to print the local ontology status. Missing local OBO
files are not fatal because the API service has configured remote ontology
fallbacks where available. If the development PostgreSQL service is already
running, `validate-data` also verifies that expected tables exist in the
configured schema.

## Repository layout

- `omnipath-svelte/`: SvelteKit application, UI components, server-side
  database queries, and API proxy routes
- `api-service/`: FastAPI service for ontology lookup, graph search, facets,
  and resource metadata
- `postgres/`: PostgreSQL image with `pg_roaringbitmap`, required by derived
  facet bitmap tables from `omnipath-build`
- `docker-compose.dev.yaml`: local backend services used together with the
  SvelteKit dev server
- `docker-compose.yaml`: production/staging Compose file
- `docs/`: working notes for migration, routing, and UI/data workflows

## Troubleshooting

If `make dev` says data is missing, run or refresh the build pipeline in the
sibling `omnipath-build` repository.

If the frontend starts but database-backed pages fail, verify that the build
pipeline has loaded PostgreSQL on port `55432` and run:

```bash
cd ~/Code/omnipath-build
make derive
```

If Docker reports stale containers or a bad local database volume, stop the
services and remove the `omnipath-postgres18-data` volume only if you are
comfortable rebuilding the local database from `omnipath-build`.
