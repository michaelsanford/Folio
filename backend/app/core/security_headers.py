"""Security response headers: the single source of truth for every value.

The application sets these on every response (``SecurityHeadersMiddleware`` in
``app.main``), so a Docker run gets them too. Two are HTTPS-only and are sent
only when ``settings.is_production`` (every Lambda stack): HSTS and the CSP's
``upgrade-insecure-requests``. Docker on ``http://localhost`` must not pin the
browser to HTTPS for localhost.

CloudFront backstop: ``FolioSecurityHeadersPolicy`` in ``template.yaml`` (an
``AWS::CloudFront::ResponseHeadersPolicy``) mirrors HSTS (override on) and the
static headers below (override off, so the app's values win and CloudFront
fills them in only on edge-generated responses such as 502/504). The CSP is
left to the app alone because it depends on the Cognito region. Change a value
here and mirror it there.

Deliberately not sent: ``Cross-Origin-Embedder-Policy: require-corp``. It would
block the Google Fonts stylesheet and font files, which are served without
``Cross-Origin-Resource-Policy``. Nothing in the app needs cross-origin
isolation (no SharedArrayBuffer), so the trade is not worth it.
"""
from __future__ import annotations

from app.core.config import settings

# Two years; no "preload": a *.cloudfront.net name cannot be preloaded.
# Revisit with a custom domain.
STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains"

X_FRAME_OPTIONS = "DENY"  # Older browsers; modern ones use frame-ancestors.
X_CONTENT_TYPE_OPTIONS = "nosniff"
REFERRER_POLICY = "strict-origin-when-cross-origin"
CROSS_ORIGIN_OPENER_POLICY = "same-origin"
CROSS_ORIGIN_RESOURCE_POLICY = "same-origin"
X_PERMITTED_CROSS_DOMAIN_POLICIES = "none"
# "0" disables the legacy XSS auditor, whose filtering itself caused
# vulnerabilities; the CSP is the real protection.
X_XSS_PROTECTION = "0"
# Financial data must not sit in browser or proxy caches.
API_CACHE_CONTROL = "no-store"

# Every powerful feature is denied, except clipboard-write: the MFA setup screen
# copies the TOTP secret with navigator.clipboard.writeText. Nothing uses
# fullscreen, so it is denied too.
_DENIED_FEATURES = (
    "accelerometer",
    "autoplay",
    "bluetooth",
    "browsing-topics",
    "camera",
    "display-capture",
    "encrypted-media",
    "fullscreen",
    "geolocation",
    "gyroscope",
    "hid",
    "idle-detection",
    "magnetometer",
    "microphone",
    "midi",
    "payment",
    "picture-in-picture",
    "publickey-credentials-get",
    "screen-wake-lock",
    "serial",
    "usb",
    "xr-spatial-tracking",
)
_SELF_FEATURES = ("clipboard-write",)
PERMISSIONS_POLICY = ", ".join(
    [f"{feature}=()" for feature in _DENIED_FEATURES]
    + [f"{feature}=(self)" for feature in _SELF_FEATURES]
)

# Headers sent on every response, in every mode.
STATIC_HEADERS: dict[str, str] = {
    "X-Frame-Options": X_FRAME_OPTIONS,
    "X-Content-Type-Options": X_CONTENT_TYPE_OPTIONS,
    "Referrer-Policy": REFERRER_POLICY,
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": CROSS_ORIGIN_OPENER_POLICY,
    "Cross-Origin-Resource-Policy": CROSS_ORIGIN_RESOURCE_POLICY,
    "X-Permitted-Cross-Domain-Policies": X_PERMITTED_CROSS_DOMAIN_POLICIES,
    "X-XSS-Protection": X_XSS_PROTECTION,
}


def build_csp(is_production: bool | None = None) -> str:
    """Content-Security-Policy, with the Cognito hosts resolved for this region."""
    if is_production is None:
        is_production = settings.is_production

    connect_src = ["'self'"]
    if settings.is_cognito_enabled:
        region = settings.COGNITO_REGION
        connect_src.append(f"https://cognito-idp.{region}.amazonaws.com")
        connect_src.append(f"https://cognito-identity.{region}.amazonaws.com")

    directives = [
        "default-src 'self'",
        "script-src 'self'",
        # index.html loads Newsreader, Source Sans 3, Inter, Figtree, IBM Plex
        # Sans and IBM Plex Mono from Google Fonts. Without these two hosts the
        # policy blocks the stylesheet and the font files, and the UI silently
        # falls back to system fonts. Self-hosting the families would let both
        # entries be dropped.
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        # No external images: the MFA QR code is a data: URI.
        "img-src 'self' data: blob:",
        "connect-src " + " ".join(connect_src),
        "worker-src 'self'",  # PWA service worker
        "manifest-src 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
    if is_production:
        directives.append("upgrade-insecure-requests")
    return "; ".join(directives)


def is_api_path(path: str) -> bool:
    return path == "/api" or path.startswith("/api/")


def security_headers(path: str, is_production: bool | None = None) -> dict[str, str]:
    """Every header to set on a response for ``path``.

    ``Cache-Control`` is included for /api/* paths only; callers must not let it
    replace a Cache-Control the route set itself.
    """
    if is_production is None:
        is_production = settings.is_production
    headers = dict(STATIC_HEADERS)
    headers["Content-Security-Policy"] = build_csp(is_production)
    if is_production:
        headers["Strict-Transport-Security"] = STRICT_TRANSPORT_SECURITY
    if is_api_path(path):
        headers["Cache-Control"] = API_CACHE_CONTROL
    return headers
