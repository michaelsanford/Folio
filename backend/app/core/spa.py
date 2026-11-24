"""Serves the built single-page app: hashed assets, root files and the shell.

Layout of the Vite build (``frontend/dist``):

- ``assets/``  content-hashed JS/CSS, mounted as static files
- top-level files: ``index.html``, the service worker (``sw.js``,
  ``workbox-*.js``), ``manifest.webmanifest``, the favicon and app icons
- anything else is an app route and gets ``index.html``

Top-level files are indexed once at startup into a name -> path dictionary, so
a request can only ever reach a file that was in the build; there is no path
joining on user input.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# The service worker, its manifest and the shell must be revalidated on every
# load so a new deploy is seen at once; CloudFront's default behaviour does not
# cache them either. Icons change rarely and are fine to cache for a week.
NO_CACHE = "no-cache"
ICON_CACHE = "public, max-age=604800"
_REVALIDATE_SUFFIXES = {".js", ".webmanifest", ".html"}

mimetypes.add_type("application/manifest+json", ".webmanifest")


def index_root_files(static_dir: Path) -> dict[str, Path]:
    """Every regular top-level file of the build except the shell itself."""
    return {
        path.name: path
        for path in static_dir.iterdir()
        if path.is_file() and path.name != "index.html"
    }


def cache_control_for(name: str) -> str:
    return NO_CACHE if Path(name).suffix in _REVALIDATE_SUFFIXES else ICON_CACHE


def mount_spa(app: FastAPI, static_dir: Path) -> bool:
    """Register the asset mount and the catch-all route. False when there is no build."""
    index_html = static_dir / "index.html"
    if not index_html.is_file():
        return False

    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

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
        # All other application paths render the Single Page Application shell
        return FileResponse(index_html, headers={"Cache-Control": NO_CACHE})

    return True
