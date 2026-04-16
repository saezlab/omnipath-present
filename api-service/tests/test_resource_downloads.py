from pathlib import Path

import pytest

from api_service.resource_downloads import build_single_resource_download, list_resource_artifacts


def _write_latest(resource_root: Path, version: str = "1") -> Path:
    resource_root.mkdir(parents=True, exist_ok=True)
    (resource_root / "latest").write_text(version, encoding="utf-8")
    version_dir = resource_root / version
    version_dir.mkdir(parents=True, exist_ok=True)
    return version_dir


def test_build_single_resource_download_uses_prebuilt_archive(tmp_path: Path):
    version_dir = _write_latest(tmp_path / "signor")
    archive_path = version_dir / "signor.zip"
    archive_path.write_bytes(b"zip-bytes")

    artifact = build_single_resource_download("signor", gold_root=tmp_path)

    assert artifact.path == archive_path
    assert artifact.media_type == "application/zip"
    assert artifact.filename == "signor.zip"
    assert artifact.is_temporary is False


def test_list_resource_artifacts_excludes_generated_archive(tmp_path: Path):
    version_dir = _write_latest(tmp_path / "signor")
    (version_dir / "entity.parquet").write_text("entity", encoding="utf-8")
    (version_dir / "interaction.parquet").write_text("interaction", encoding="utf-8")
    (version_dir / "signor.zip").write_bytes(b"zip-bytes")

    artifacts = list_resource_artifacts("signor", gold_root=tmp_path)

    assert [path.name for path in artifacts] == ["entity.parquet", "interaction.parquet"]


def test_build_single_resource_download_raises_when_archive_missing(tmp_path: Path):
    _write_latest(tmp_path / "signor")

    with pytest.raises(Exception) as exc_info:
        build_single_resource_download("signor", gold_root=tmp_path)

    assert "prebuilt download archive" in str(exc_info.value)
