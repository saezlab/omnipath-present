# Makefile for omnipath-present development
#
# By default, dev services read data directly from omnipath_build latest output.
# Override with: make dev DATA_DIR=/path/to/versioned/output

DATA_DIR ?= ../omnipath_build/data/combined

.PHONY: dev stop restart validate-data

# Validate that all required data files exist

# Start all development services: Meilisearch, Entity Service, API Service, and Next.js dev server
dev: 
	DATA_DIR="$(DATA_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml up -d
	@echo ""
	@echo "Backend services starting..."
	@echo "  - API Service:      http://localhost:8081"
	@echo "  - Data dir:         $(DATA_DIR)"
	@echo ""
	@echo "Starting SvelteKit dev server..."
	cd omnipath-svelte && pnpm dev

# Stop Docker services
stop:
	DATA_DIR="$(DATA_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml down

# Restart Docker services and rebuild images
restart: 
	DATA_DIR="$(DATA_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml down
	DATA_DIR="$(DATA_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml up -d --build
	@echo ""
	@echo "Backend services rebuilt and restarted"
	@echo "  - API Service:      http://localhost:8081"
	@echo "  - Data dir:         $(DATA_DIR)"
