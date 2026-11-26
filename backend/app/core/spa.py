"""Serves the built single-page app: hashed assets, root files and the shell.

Layout of the Vite build (``frontend/dist``):

- ``assets/``  content-hashed JS/CSS, mounted as static files
- other files: ``index.html``, the service worker (``sw.js``,
  ``workbox-*.js``), ``manifest.webmanifest``, the favicon and app icons,
  ``robots.txt`` and the install-dialog ``screenshots/``
- anything else that looks like an app route gets ``index.html``; a path that
  looks like a file (``/llms.txt``, ``/.well-known/...``) but is not in the
  build is a 404, so probes and crawlers see the truth instead of the shell

Those files are indexed once at startup into a path -> file dictionary, so a
request can only ever reach a file that was in the build; there is no path
joining on user input.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

# The service worker, its manifest and the shell must be revalidated on every
# load so a new deploy is seen at once; CloudFront's default behaviour does not
# cache them either. Icons change rarely and are fine to cache for a week.
NO_CACHE = "no-cache"
ICON_CACHE = "public, max-age=604800"
# Vite puts a content hash in every file name under /assets: a changed file is a
# new URL, so browsers may keep each one for a year without asking again.
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
_REVALIDATE_SUFFIXES = {".js", ".webmanifest", ".html"}

mimetypes.add_type("application/manifest+json", ".webmanifest")


def index_root_files(static_dir: Path) -> dict[str, Path]:
    """Every file of the build outside ``assets/``, by its URL path, except the shell."""
    files: dict[str, Path] = {}
    for path in static_dir.rglob("*"):
        if not path.is_file():
            continue
        key = path.relative_to(static_dir).as_posix()
        if key == "index.html" or key.startswith("assets/"):
            continue
        files[key] = path
    return files


def cache_control_for(name: str) -> str:
    return NO_CACHE if Path(name).suffix in _REVALIDATE_SUFFIXES else ICON_CACHE


def looks_like_a_file(path: str) -> bool:
    """A request for a file or a well-known resource rather than an app route."""
    return path.startswith(".well-known/") or "." in path.rsplit("/", 1)[-1]


class HashedAssets(StaticFiles):
    """``/assets``: content-hashed build output, cacheable for a year."""

    async def get_response(self, path: str, scope: Scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = IMMUTABLE_CACHE
        return response


def mount_spa(app: FastAPI, static_dir: Path) -> bool:
    """Register the asset mount and the catch-all route. False when there is no build."""
    index_html = static_dir / "index.html"
    if not index_html.is_file():
        return False

    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", HashedAssets(directory=str(assets_dir)), name="assets")

    root_files = index_root_files(static_dir)

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_spa(full_path: str):
        # Unknown API paths are API errors, not app routes: answer with a JSON 404
        # instead of the SPA shell, so clients and probes see the real status.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        name = full_path.strip("/")
        target = root_files.get(name)
        if target is not None:
            return FileResponse(target, headers={"Cache-Control": cache_control_for(name)})
        if name != "index.html" and looks_like_a_file(name):
            raise HTTPException(status_code=404, detail="Not Found")
        # All other application paths render the Single Page Application shell
        return FileResponse(index_html, headers={"Cache-Control": NO_CACHE})

    return True
