from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from .resource_downloads import resolve_resource_version_dir

WORKSPACE_ARTIFACT_NAMES = {
    "entities.parquet",
    "interactions.parquet",
    "associations.parquet",
    "annotations.parquet",
    "entity_identifiers_source.parquet",
    "entity_identifiers_resolved.parquet",
}


def _normalize_resource_ids(resource_ids: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for resource_id in resource_ids:
        value = str(resource_id).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def resolve_workspace_artifact(resource_id: str, artifact_name: str) -> Path:
    normalized_name = artifact_name.strip()
    if normalized_name not in WORKSPACE_ARTIFACT_NAMES:
        raise HTTPException(status_code=404, detail=f"Unsupported resource artifact '{artifact_name}'")

    version_dir = resolve_resource_version_dir(resource_id)
    artifact_path = version_dir / normalized_name
    if not artifact_path.exists() or not artifact_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"Resource '{resource_id}' does not provide artifact '{normalized_name}'",
        )
    return artifact_path


def build_workspace_manifest(resource_ids: list[str]) -> dict:
    normalized_ids = _normalize_resource_ids(resource_ids)
    if not normalized_ids:
        raise HTTPException(status_code=400, detail="At least one resource_id is required")

    resources: list[dict] = []
    available_artifacts: set[str] = set()

    for resource_id in normalized_ids:
        version_dir = resolve_resource_version_dir(resource_id)
        artifacts = [
            name
            for name in sorted(WORKSPACE_ARTIFACT_NAMES)
            if (version_dir / name).exists() and (version_dir / name).is_file()
        ]
        available_artifacts.update(artifacts)
        resources.append(
            {
                "resource_id": resource_id,
                "version": version_dir.name,
                "artifacts": artifacts,
            }
        )

    return {
        "resource_ids": normalized_ids,
        "resources": resources,
        "available_artifacts": sorted(available_artifacts),
    }
