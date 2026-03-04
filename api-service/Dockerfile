FROM python:3.12-slim

WORKDIR /app

# Install git (required for git-based dependencies) and uv
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN pip install uv

# Copy dependency files
COPY omnipath-present/api-service/pyproject.toml .
COPY omnipath-present/api-service/README.md .

# Copy application code
COPY omnipath-present/api-service/ontology_service/ ontology_service/

# Install dependencies (ontograph is pulled from git via tool.uv.sources)
RUN uv pip install --system -e .

# Create data and cache directories
RUN mkdir -p /app/data /app/cache

ENV ONTOLOGY_DATA_DIR=/app/data
ENV ONTOLOGY_CACHE_DIR=/app/cache

EXPOSE 8081

CMD ["uvicorn", "ontology_service.main:app", "--host", "0.0.0.0", "--port", "8081"]
