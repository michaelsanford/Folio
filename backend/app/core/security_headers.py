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
left to the app alone (its ``upgrade-insecure-requests`` depends on the mode).
Change a value here and mirror it there; ``test_security_headers`` checks the
Permissions-Policy and X-Robots-Tag copies match.

Everything the page loads comes from its own origin: the fonts are bundled
with the app, and sign-in goes through the app's own ``/api/auth`` routes, so
the browser never talks to another host.

Deliberately not sent: ``Cross-Origin-Embedder-Policy: require-corp``. Nothing
in the app needs cross-origin isolation (no SharedArrayBuffer), so it would
only add a way to break future changes.
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
# A private household app: nothing here is for search engines or AI crawlers
# (robots.txt says the same for those that read it).
X_ROBOTS_TAG = "noindex, nofollow"

# Every powerful feature is denied, except clipboard-write: the MFA setup screen
# copies the TOTP secret with navigator.clipboard.writeText. Nothing uses
# fullscreen, so it is denied too.
#
# Only names Chromium (Chrome and Edge) recognizes: an unknown name makes the
# browser log "Unrecognized feature" on every page load. That rules out the
# Privacy Sandbox ad features (run-ad-auction, join-ad-interest-group,
# attribution-reporting, private-aggregation, browsing-topics), which Edge
# never shipped and Chrome is retiring; the app loads no third-party content
# that could use them anyway. Firefox and Safari ignore names they do not know.
#
# unload: the app never listens for it, and browsers are phasing it out; denying
# it keeps the page eligible for the back/forward cache in every browser.
#
# A future passkey sign-in would need publickey-credentials-get and
# publickey-credentials-create set to (self).
_DENIED_FEATURES = (
    "accelerometer",
    "ambient-light-sensor",
    "autoplay",
    "bluetooth",
    "camera",
    "compute-pressure",
    "display-capture",
    "encrypted-media",
    "fullscreen",
    "gamepad",
    "geolocation",
    "gyroscope",
    "hid",
    "identity-credentials-get",
    "idle-detection",
    "keyboard-map",
    "local-fonts",
    "magnetometer",
    "microphone",
    "midi",
    "otp-credentials",
    "payment",
    "picture-in-picture",
    "publickey-credentials-create",
    "publickey-credentials-get",
    "screen-wake-lock",
    "serial",
    "storage-access",
    "unload",
    "usb",
    "web-share",
    "window-management",
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
    "X-Robots-Tag": X_ROBOTS_TAG,
}


def build_csp(is_production: bool | None = None) -> str:
    """Content-Security-Policy: everything from the app's own origin."""
    if is_production is None:
        is_production = settings.is_production

    directives = [
        "default-src 'self'",
        "script-src 'self'",
        # Stylesheets only from the app itself (nothing injects <style>
        # elements). Inline style *attributes* stay allowed: the charts' SVG
        # renderer and the start-up placeholder in index.html set them.
        "style-src 'self'",
        "style-src-attr 'unsafe-inline'",
        # The type styles' fonts are bundled under /assets.
        "font-src 'self' data:",
        # No external images: the MFA QR code is a data: URI.
        "img-src 'self' data: blob:",
        # Sign-in goes through the app's /api/auth routes, never to the
        # identity service directly.
        "connect-src 'self'",
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
