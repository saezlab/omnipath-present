from __future__ import annotations

import json
import os
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from fastapi import HTTPException


@dataclass(frozen=True)
class DownloadArtifact:
    path: Path
    media_type: str
    filename: str
    is_temporary: bool = False


def _default_gold_root() -> Path:
    here = Path(__file__).resolve()
    candidates: list[Path] = []

    for base in [here.parent, *here.parents]:
        candidates.append(base / "omnipath_build" / "data_v2" / "gold")
        candidates.append(base / "data_v2" / "gold")

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return candidates[0]


def get_gold_root() -> Path:
    configured = os.getenv("OMNIPATH_GOLD_ROOT") or os.getenv("OMNIPATH_BUILD_GOLD_ROOT")
    return Path(configured).expanduser().resolve() if configured else _default_gold_root().resolve()


def _latest_pointer_path(gold_root: Path, resource_id: str) -> Path:
    return gold_root / resource_id / "latest"


def _read_latest_version(gold_root: Path, resource_id: str) -> str:
    latest_path = _latest_pointer_path(gold_root, resource_id)
    if not latest_path.exists():
        raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' has no gold build")

    raw = latest_path.read_text(encoding="utf-8").strip()
    if not raw:
        raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' has no active gold version")

    if raw.startswith("{"):
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail=f"Invalid latest pointer for resource '{resource_id}'") from exc
        version = payload.get("version")
        if not version:
            raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' has no active gold version")
        return str(version)

    return raw


def resolve_resource_version_dir(resource_id: str, gold_root: Path | None = None) -> Path:
    root = gold_root or get_gold_root()
    if not root.exists():
        raise HTTPException(status_code=500, detail=f"Gold root does not exist: {root}")

    version = _read_latest_version(root, resource_id)
    version_dir = root / resource_id / version
    if not version_dir.exists() or not version_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' gold version '{version}' not found")
    return version_dir


def _resource_archive_path(version_dir: Path, resource_id: str) -> Path:
    return version_dir / f"{resource_id}.zip"



def list_resource_artifacts(resource_id: str, gold_root: Path | None = None) -> list[Path]:
    version_dir = resolve_resource_version_dir(resource_id, gold_root)
    archive_path = _resource_archive_path(version_dir, resource_id)
    return sorted(path for path in version_dir.iterdir() if path.is_file() and path != archive_path)


def _sanitize_download_name(name: str) -> str:
    text = (name or "").strip().replace("/", "_")
    return text or "resources"


def _write_zip_bundle(entries: Iterable[tuple[Path, str]], prefix: str) -> DownloadArtifact:
    temp_file = tempfile.NamedTemporaryFile(prefix=f"{prefix}_", suffix=".zip", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.close()

    with zipfile.ZipFile(temp_path, mode="w", compression=zipfile.ZIP_STORED) as zf:
        for source_path, archive_name in entries:
            zf.write(source_path, arcname=archive_name)

    return DownloadArtifact(
        path=temp_path,
        media_type="application/zip",
        filename=f"{prefix}.zip",
        is_temporary=True,
    )


def build_single_resource_download(resource_id: str, gold_root: Path | None = None) -> DownloadArtifact:
    version_dir = resolve_resource_version_dir(resource_id, gold_root)
    archive_path = _resource_archive_path(version_dir, resource_id)
    if not archive_path.exists() or not archive_path.is_file():
        raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' has no prebuilt download archive")

    return DownloadArtifact(
        path=archive_path,
        media_type="application/zip",
        filename=archive_path.name,
        is_temporary=False,
    )


def build_multi_resource_download(resource_ids: list[str], gold_root: Path | None = None, filename: str | None = None) -> DownloadArtifact:
    unique_ids: list[str] = []
    seen: set[str] = set()
    for resource_id in resource_ids:
        normalized = resource_id.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique_ids.append(normalized)

    if not unique_ids:
        raise HTTPException(status_code=400, detail="At least one resource_id is required")

    entries: list[tuple[Path, str]] = []
    for resource_id in unique_ids:
        artifacts = list_resource_artifacts(resource_id, gold_root)
        if not artifacts:
            raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' has no downloadable artifacts")
        for artifact in artifacts:
            entries.append((artifact, f"{resource_id}/{artifact.name}"))

    bundle_name = _sanitize_download_name(filename or f"resources_{'_'.join(unique_ids[:3])}{'_more' if len(unique_ids) > 3 else ''}")
    return _write_zip_bundle(entries, prefix=bundle_name)
