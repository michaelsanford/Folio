"""The built SPA: root files with the right type and cache policy, the shell for routes."""
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.spa import ICON_CACHE, NO_CACHE, mount_spa

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    (tmp_path / "index.html").write_text("<!doctype html><title>Folio</title>")
    (tmp_path / "sw.js").write_text("self.addEventListener('install', () => {});")
    (tmp_path / "workbox-abc123.js").write_text("// workbox")
    (tmp_path / "manifest.webmanifest").write_text('{"name": "Folio"}')
    (tmp_path / "favicon.ico").write_bytes(b"\x00\x00\x01\x00")
    (tmp_path / "folio-icon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    for name in ("pwa-192x192.png", "pwa-512x512.png", "maskable-icon-512x512.png", "apple-touch-icon-180x180.png"):
        (tmp_path / name).write_bytes(PNG)
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index-abc.js").write_text("console.log(1)")
    # A file outside the build that traversal must never reach.
    (tmp_path.parent / "secret.txt").write_text("nope")

    app = FastAPI()
    assert mount_spa(app, tmp_path)
    return TestClient(app)


@pytest.mark.parametrize(
    ("path", "content_type"),
    [
        ("/favicon.ico", "image/"),
        ("/folio-icon.svg", "image/svg+xml"),
        ("/pwa-192x192.png", "image/png"),
        ("/pwa-512x512.png", "image/png"),
        ("/maskable-icon-512x512.png", "image/png"),
        ("/apple-touch-icon-180x180.png", "image/png"),
    ],
)
def test_icons_are_served_as_images_and_cached(client, path, content_type):
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(content_type)
    assert response.headers["cache-control"] == ICON_CACHE


def test_manifest_has_its_media_type_and_is_revalidated(client):
    response = client.get("/manifest.webmanifest")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/manifest+json")
    assert response.headers["cache-control"] == NO_CACHE


@pytest.mark.parametrize("path", ["/sw.js", "/workbox-abc123.js"])
def test_service_worker_files_are_revalidated(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert "javascript" in response.headers["content-type"]
    assert response.headers["cache-control"] == NO_CACHE


@pytest.mark.parametrize("path", ["/", "/ledger", "/some/deep/route", "/index.html"])
def test_app_routes_get_the_shell_uncached(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == NO_CACHE
    assert "<title>Folio</title>" in response.text


@pytest.mark.parametrize("path", ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/..%2fsecret.txt"])
def test_traversal_never_leaves_the_build(client, path):
    response = client.get(path)
    assert "nope" not in response.text


def test_unknown_api_paths_are_json_404(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


def test_hashed_assets_are_served(client):
    response = client.get("/assets/index-abc.js")
    assert response.status_code == 200


def test_head_is_supported(client):
    assert client.head("/pwa-192x192.png").status_code == 200


def test_no_build_means_nothing_mounted(tmp_path):
    app = FastAPI()
    assert mount_spa(app, tmp_path / "missing") is False
