from pathlib import Path

import pytest

from api_service.resource_downloads import build_single_resource_download, list_resource_artifacts


def test_build_single_resource_download_uses_prebuilt_archive(tmp_path: Path):
    archive_path = tmp_path / "signor" / "signor.zip"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_bytes(b"zip-bytes")

    artifact = build_single_resource_download("signor", gold_root=tmp_path)

    assert artifact.path == archive_path
    assert artifact.media_type == "application/zip"
    assert artifact.filename == "signor.zip"
    assert artifact.is_temporary is False


def test_list_resource_artifacts_returns_direct_archive(tmp_path: Path):
    archive_path = tmp_path / "signor" / "signor.zip"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_bytes(b"zip-bytes")

    artifacts = list_resource_artifacts("signor", gold_root=tmp_path)

    assert artifacts == [archive_path]


def test_build_single_resource_download_raises_when_archive_missing(tmp_path: Path):
    (tmp_path / "signor").mkdir(parents=True, exist_ok=True)

    with pytest.raises(Exception) as exc_info:
        build_single_resource_download("signor", gold_root=tmp_path)

    assert "prebuilt download archive" in str(exc_info.value)
