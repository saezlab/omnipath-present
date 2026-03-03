# Makefile for omnipath-present development
#
# Prerequisites: Run `make export` from the omnipath_build repo to populate data/

.PHONY: dev stop restart validate-data

# Validate that all required data files exist
validate-data:
	@echo "Checking required data files..."
	@missing=0; \
	if [ ! -f data/entity_identifier.parquet ]; then \
		echo "  ✗ Missing: data/entity_identifier.parquet"; \
		missing=1; \
	else \
		echo "  ✓ data/entity_identifier.parquet"; \
	fi; \
	if [ ! -f data/omnipath_mi.obo ]; then \
		echo "  ✗ Missing: data/omnipath_mi.obo"; \
		missing=1; \
	else \
		echo "  ✓ data/omnipath_mi.obo"; \
	fi; \
	for f in search_entities.parquet search_interactions.parquet search_associations.parquet search_sources.parquet; do \
		if [ ! -f "data/$$f" ]; then \
			echo "  ✗ Missing: data/$$f"; \
			missing=1; \
		else \
			echo "  ✓ data/$$f"; \
		fi; \
	done; \
	if [ $$missing -eq 1 ]; then \
		echo ""; \
		echo "Run export from omnipath_build to generate data files."; \
		exit 1; \
	fi
	@echo ""
	@if [ -f data/.data_version ]; then \
		echo "Data version: $$(cat data/.data_version)"; \
	fi
	@echo "✓ All data files present"

# Start all development services: Meilisearch, Entity Service, Ontology Service, and Next.js dev server
dev: validate-data
	COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml up -d
	@echo ""
	@echo "Backend services starting..."
	@echo "  - Meilisearch:      http://localhost:7700"
	@echo "  - Entity Service:   http://localhost:8080"
	@echo "  - Ontology Service: http://localhost:8081"
	@echo ""
	@echo "Starting Next.js dev server..."
	cd next-omnipath && npm run dev

# Stop Docker services
stop:
	COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml down

# Restart Docker services and rebuild images
restart: validate-data
	COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml down
	COMPOSE_BAKE=true docker compose -f docker-compose.dev.yaml up -d --build
	@echo ""
	@echo "Backend services rebuilt and restarted"
	@echo "  - Meilisearch:      http://localhost:7700"
	@echo "  - Entity Service:   http://localhost:8080"
	@echo "  - Ontology Service: http://localhost:8081"
