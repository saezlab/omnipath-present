# Dokploy routing for public API exposure

Recommended public routing:

- `/` -> `next-omnipath:8082`
- `/api` -> `api-service:8081`
- `/app-api` -> `next-omnipath:8082`

## Why

- `/api/*` is now the public machine-facing OmniPath API served directly by FastAPI.
- `/app-api/*` is reserved for Next.js application-specific endpoints such as chat.
- This avoids proxying large API downloads through Next.js while keeping app-specific handlers available.

## Endpoints served by FastAPI under `/api`

Examples:

- `GET /api/health`
- `GET /api/ontologies`
- `POST /api/entity-lookup`
- `POST /api/terms`
- `POST /api/terms/search`
- `POST /api/tree`
- `POST /api/exports/entities/parquet`
- `POST /api/exports/interactions/parquet`
- `POST /api/exports/associations/parquet`
- `GET /api/resources/{resource_id}/download`
- `POST /api/resources/download`
- `POST /api/resources/workspace/manifest`
- `GET /api/resources/{resource_id}/artifacts/{artifact_name}`
- `GET /api/interactions/{interaction_id}/evidence`
- `GET /api/associations/{association_id}/evidence`

## Endpoints served by Next.js under `/app-api`

Examples:

- `POST /app-api/chat`

## Frontend expectations

The frontend has been updated to:

- call ontology/resource/export/evidence/entity-lookup APIs via `/api/*`
- call app-owned routes via `/app-api/*`
- send FastAPI-native ontology payloads like `{ "term_ids": [...] }`

## Dokploy / Traefik notes

Set path-based routing so `/api` takes precedence over `/`.
If you also expose `/app-api`, route that to `next-omnipath` explicitly.
