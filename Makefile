# Makefile for omnipath-present development
#
# By default, dev services read data directly from omnipath_build latest output.
# Override with: make dev DATA_DIR=/path/to/versioned/output

DATA_DIR ?= ../omnipath_build/data/latest/output

.PHONY: dev stop restart validate-data

# Validate that all required data files exist
validate-data:
	@echo "Checking required data files in $(DATA_DIR)..."
	@missing=0; \
	if [ ! -f "$(DATA_DIR)/entity_identifier.parquet" ]; then \
		echo "  ✗ Missing: $(DATA_DIR)/entity_identifier.parquet"; \
		missing=1; \
	else \
		echo "  ✓ $(DATA_DIR)/entity_identifier.parquet"; \
	fi; \
	if [ ! -f "$(DATA_DIR)/omnipath_mi.obo" ]; then \
		echo "  ✗ Missing: $(DATA_DIR)/omnipath_mi.obo"; \
		missing=1; \
	else \
		echo "  ✓ $(DATA_DIR)/omnipath_mi.obo"; \
	fi; \
	for f in search_entities.parquet search_interactions.parquet search_associations.parquet search_sources.parquet; do \
		if [ ! -f "$(DATA_DIR)/$$f" ]; then \
			echo "  ✗ Missing: $(DATA_DIR)/$$f"; \
			missing=1; \
		else \
			echo "  ✓ $(DATA_DIR)/$$f"; \
		fi; \
	done; \
	if [ $$missing -eq 1 ]; then \
		echo ""; \
		echo "Run export in omnipath_build, or set DATA_DIR to a valid output folder."; \
		exit 1; \
	fi
	@echo ""
	@if [ -f "$(DATA_DIR)/.data_version" ]; then \
		echo "Data version: $$(cat "$(DATA_DIR)/.data_version")"; \
	fi
	@echo "✓ All data files present"

# Start all development services: Meilisearch, Entity Service, API Service, and Next.js dev server
dev: validate-data
	DATA_DIR="$(DATA_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml up -d
	@echo ""
	@echo "Backend services starting..."
	@echo "  - Meilisearch:      http://localhost:7700"
	@echo "  - Entity Service:   http://localhost:8080"
	@echo "  - API Service:      http://localhost:8081"
	@echo "  - Data dir:         $(DATA_DIR)"
	@echo ""
	@echo "Starting Next.js dev server..."
	cd next-omnipath && npm run dev

# Stop Docker services
stop:
	DATA_DIR="$(DATA_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml down

# Restart Docker services and rebuild images
restart: validate-data
	DATA_DIR="$(DATA_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml down
	DATA_DIR="$(DATA_DIR)" COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml up -d --build
	@echo ""
	@echo "Backend services rebuilt and restarted"
	@echo "  - Meilisearch:      http://localhost:7700"
	@echo "  - Entity Service:   http://localhost:8080"
	@echo "  - API Service:      http://localhost:8081"
	@echo "  - Data dir:         $(DATA_DIR)"
