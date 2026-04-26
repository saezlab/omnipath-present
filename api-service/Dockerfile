FROM python:3.12-slim

WORKDIR /app

# Install git (required for git-based dependencies) and uv
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN pip install uv

# Copy dependency files
COPY omnipath-present/api-service/pyproject.toml .
COPY omnipath-present/api-service/uv.lock .
COPY omnipath-present/api-service/README.md .

# Copy application code
COPY omnipath-present/api-service/api_service/ api_service/

# Install dependencies from the checked-in lockfile.
# This avoids re-resolving ontograph's transitive git dependencies during the image build.
RUN uv sync --frozen --no-dev

# Create data and cache directories
RUN mkdir -p /app/data /app/cache

ENV PATH="/app/.venv/bin:$PATH"
ENV ONTOLOGY_DATA_DIR=/app/data
ENV OMNIPATH_PARQUET_DIR=/app/data
ENV ONTOLOGY_CACHE_DIR=/app/cache

EXPOSE 8081

CMD ["uvicorn", "api_service.main:app", "--host", "0.0.0.0", "--port", "8081"]
