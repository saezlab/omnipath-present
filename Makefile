# Makefile for omnipath-present development.
#
# By default, dev services read local OBO files from a sibling omnipath-build checkout.
# The GitHub repository clones to "omnipath-build", while some local checkouts
# use the Python package-style "omnipath_build"; support both.

BUILD_REPO_CANDIDATES := ../omnipath-build ../omnipath_build
BUILD_REPO_DIR ?= $(firstword $(foreach dir,$(BUILD_REPO_CANDIDATES),$(if $(wildcard $(dir)/data),$(dir))) $(wildcard $(BUILD_REPO_CANDIDATES)))
BUILD_REPO_DIR := $(if $(BUILD_REPO_DIR),$(BUILD_REPO_DIR),../omnipath-build)
DATA_ROOT ?= $(BUILD_REPO_DIR)/data
DATA_DIR ?= $(DATA_ROOT)/combined/latest
ONTOLOGY_DIR ?= $(DATA_ROOT)/obo
GOLD_ROOT_DIR ?= $(DATA_ROOT)/gold
DATABASE_SCHEMA ?= public
DB_REQUIRED_TABLES ?= entity relation resources ontology_terms facet_entity_bitmap facet_relation_bitmap
WARN_ONLY ?=

DEPLOY_INSTANCE ?=
INSTANCE_ROOT ?= $(HOME)/instances/$(DEPLOY_INSTANCE)
DEPLOY_ENV_FILE ?= $(INSTANCE_ROOT)/.env
DEPLOY_COMPOSE_PROJECT ?= omnipath-present-$(DEPLOY_INSTANCE)

.PHONY: setup check-tools validate-data dev stop restart deploy-rebuild-frontend

setup: check-tools
	@test -f .env || cp .env.example .env
	@test -f omnipath-svelte/.env || cp omnipath-svelte/.env.example omnipath-svelte/.env
	pnpm --dir omnipath-svelte install
	DATA_DIR="$(DATA_DIR)" ONTOLOGY_DIR="$(ONTOLOGY_DIR)" GOLD_ROOT_DIR="$(GOLD_ROOT_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml build
	@$(MAKE) validate-data WARN_ONLY=1
	@echo ""
	@echo "Setup complete."
	@echo "Run 'make dev' to start local services, then use omnipath-build to load or refresh data."

check-tools:
	@command -v docker >/dev/null 2>&1 || { echo "Missing Docker. Install Docker Desktop or Docker Engine."; exit 1; }
	@docker compose version >/dev/null 2>&1 || { echo "Missing Docker Compose v2. Install a Docker version with 'docker compose'."; exit 1; }
	@command -v pnpm >/dev/null 2>&1 || { echo "Missing pnpm. Install it or run 'corepack enable' with a recent Node.js."; exit 1; }

validate-data:
	@missing=0; \
	if [ ! -d "$(BUILD_REPO_DIR)" ]; then \
		echo "Missing sibling omnipath-build checkout: $(BUILD_REPO_DIR)"; \
		missing=1; \
	fi; \
	if [ ! -d "$(ONTOLOGY_DIR)" ]; then \
		echo "No local ontology directory found at $(ONTOLOGY_DIR); API service will use configured remote ontology fallbacks where available."; \
	elif ! find "$(ONTOLOGY_DIR)" -maxdepth 2 -type f -name '*.obo' | grep -q .; then \
		echo "No local OBO ontology files found in $(ONTOLOGY_DIR); API service will use configured remote ontology fallbacks where available."; \
	fi; \
	if docker compose -f docker-compose.dev.yaml ps --status running omnipathv2-postgres >/dev/null 2>&1; then \
		for table in $(DB_REQUIRED_TABLES); do \
			if ! docker compose -f docker-compose.dev.yaml exec -T omnipathv2-postgres psql -U omnipath -d omnipath -tAc "SELECT to_regclass('$(DATABASE_SCHEMA).$$table')" | grep -q "$$table"; then \
				echo "Missing Postgres table: $(DATABASE_SCHEMA).$$table"; \
				missing=1; \
			fi; \
		done; \
	else \
		echo "Postgres service is not running; skipping table checks."; \
	fi; \
	if [ "$$missing" -ne 0 ]; then \
		if [ -n "$(WARN_ONLY)" ]; then \
			echo "Runtime data is not ready yet. Start services and load or refresh data from the sibling omnipath-build repository."; \
		else \
			exit 1; \
		fi; \
	fi

# Start all development services: Meilisearch, Entity Service, API Service, and Next.js dev server
dev:
	@$(MAKE) validate-data WARN_ONLY=1
	DATA_DIR="$(DATA_DIR)" ONTOLOGY_DIR="$(ONTOLOGY_DIR)" GOLD_ROOT_DIR="$(GOLD_ROOT_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml up -d
	@echo ""
	@echo "Backend services starting..."
	@echo "  - API Service:      http://localhost:8081"
	@echo "  - Postgres:         postgresql://omnipath:omnipath@localhost:55432/omnipath"
	@echo "  - Frontend:         http://localhost:8083"
	@echo "  - Ontology dir:     $(ONTOLOGY_DIR)"
	@echo "  - Schema:           $(DATABASE_SCHEMA)"
	@echo ""
	@echo "Starting SvelteKit dev server..."
	cd omnipath-svelte && pnpm dev

# Stop Docker services
stop:
	DATA_DIR="$(DATA_DIR)" ONTOLOGY_DIR="$(ONTOLOGY_DIR)" GOLD_ROOT_DIR="$(GOLD_ROOT_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml down

# Restart Docker services and rebuild images
restart:
	@$(MAKE) validate-data WARN_ONLY=1
	DATA_DIR="$(DATA_DIR)" ONTOLOGY_DIR="$(ONTOLOGY_DIR)" GOLD_ROOT_DIR="$(GOLD_ROOT_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml down
	DATA_DIR="$(DATA_DIR)" ONTOLOGY_DIR="$(ONTOLOGY_DIR)" GOLD_ROOT_DIR="$(GOLD_ROOT_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml up -d --build
	@echo ""
	@echo "Backend services rebuilt and restarted"
	@echo "  - API Service:      http://localhost:8081"
	@echo "  - Data dir:         $(DATA_DIR)"

# Rebuild the deploy frontend image for one instance and restart its stack
# Example: make deploy-rebuild-frontend DEPLOY_INSTANCE=dev2
# Run this from an omnipath-present checkout after SvelteKit SSR/app-api or
# schema-coupled frontend query changes.
deploy-rebuild-frontend:
	@test -n "$(DEPLOY_INSTANCE)" || { echo "Set DEPLOY_INSTANCE=<name> (for example DEPLOY_INSTANCE=dev2)."; exit 1; }
	@test -f "$(DEPLOY_ENV_FILE)" || { echo "Missing deploy env file: $(DEPLOY_ENV_FILE)"; exit 1; }
	docker compose -p "$(DEPLOY_COMPOSE_PROJECT)" -f docker-compose.deploy.yaml --env-file "$(DEPLOY_ENV_FILE)" build omnipath-svelte
	systemctl --user restart omnipath-present@$(DEPLOY_INSTANCE).service
	@echo ""
	@echo "Frontend image rebuilt and stack restarted for $(DEPLOY_INSTANCE)"
