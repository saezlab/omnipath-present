from __future__ import annotations

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
        candidates.append(base / "omnipath_build" / "data" / "gold")
        candidates.append(base / "data" / "gold")

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return candidates[0]


def get_gold_root() -> Path:
    configured = os.getenv("OMNIPATH_GOLD_ROOT") or os.getenv("OMNIPATH_BUILD_GOLD_ROOT")
    return Path(configured).expanduser().resolve() if configured else _default_gold_root().resolve()


def _resource_archive_path(root: Path, resource_id: str) -> Path:
    return root / resource_id / f"{resource_id}.zip"


def list_resource_artifacts(resource_id: str, gold_root: Path | None = None) -> list[Path]:
    """List downloadable artifacts for a resource.

    The new gold layout exposes one direct archive per resource:
    ``gold/<resource>/<resource>.zip``.
    """
    root = gold_root or get_gold_root()
    archive_path = _resource_archive_path(root, resource_id)
    return [archive_path] if archive_path.exists() and archive_path.is_file() else []


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
    root = gold_root or get_gold_root()
    if not root.exists():
        raise HTTPException(status_code=500, detail=f"Gold root does not exist: {root}")

    archive_path = _resource_archive_path(root, resource_id)
    if not archive_path.exists() or not archive_path.is_file():
        raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' has no prebuilt download archive")

    return DownloadArtifact(
        path=archive_path,
        media_type="application/zip",
        filename=archive_path.name,
        is_temporary=False,
    )


def build_multi_resource_download(resource_ids: list[str], gold_root: Path | None = None, filename: str | None = None) -> DownloadArtifact:
    root = gold_root or get_gold_root()
    if not root.exists():
        raise HTTPException(status_code=500, detail=f"Gold root does not exist: {root}")

    unique_ids: list[str] = []
    seen: set[str] = set()
    for resource_id in resource_ids:
        normalized = str(resource_id).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique_ids.append(normalized)

    if not unique_ids:
        raise HTTPException(status_code=400, detail="At least one resource_id is required")

    entries: list[tuple[Path, str]] = []
    for resource_id in unique_ids:
        archive_path = _resource_archive_path(root, resource_id)
        if not archive_path.exists() or not archive_path.is_file():
            raise HTTPException(status_code=404, detail=f"Resource '{resource_id}' has no prebuilt download archive")
        entries.append((archive_path, f"{resource_id}/{archive_path.name}"))

    bundle_name = _sanitize_download_name(filename or f"resources_{'_'.join(unique_ids[:3])}{'_more' if len(unique_ids) > 3 else ''}")
    return _write_zip_bundle(entries, prefix=bundle_name)
