"""Central asset versions for the unified CK Enerji site."""

from __future__ import annotations


ASSET_VERSIONS: dict[str, int] = {
    "/android-app.css": 18,
    "/piyasa/app.js": 62,
    "/piyasa/styles.css": 41,
    "/piyasa/config.js": 1,
    "/piyasa-charts.js": 20,
    "/portal-shell.css": 11,
    "/chart-fullscreen.css": 6,
    "/chart-fullscreen.js": 6,
    "/suite-loading.js": 4,
    "/theme-sync.js": 4,
    "/command-center.js": 3,
    "/piyasa-suite.css": 35,
    "/system-direction-forecast.css": 22,
    "/system-direction-forecast.js": 22,
    "/module-suite.css": 63,
    "/module-suite.js": 17,
    "/executive-report.css": 5,
    "/executive-report.js": 2,
    "/uretim/styles.css": 1,
    "/uretim/reference-theme.css": 1,
    "/uretim/app.js": 19,
    "/suite-assets/ck-logo.png": 6,
    "/suite-assets/ck-logo-white.png": 1,
    "/suite-assets/ck-mark.png": 3,
    "/suite-assets/icon-192.png": 7,
    "/suite-assets/icon-512.png": 7,
    "/suite-assets/apple-touch-icon.png": 7,
    "/favicon.ico": 4,
}

def asset_url(path: str) -> str:
    """Return a cache-busting URL for a known static asset."""

    version = ASSET_VERSIONS.get(path)
    return f"{path}?v={version}" if version is not None else path
