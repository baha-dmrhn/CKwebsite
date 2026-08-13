"""Per-user TV dashboard preference storage.

The HTTP layer owns authentication; this module only validates and persists the
small preference document.  Keeping it here prevents the main web server from
also becoming the owner of TV-specific business rules.
"""

from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TV_SLIDE_KEYS = {
    "overview",
    "market",
    "dam",
    "production",
    "consumption",
    "currency",
}
TV_DEFAULT_SETTINGS = {
    "mode": "rotate",
    "slides": [
        "overview",
        "market",
        "dam",
        "production",
        "consumption",
        "currency",
    ],
    "fixedSlide": "overview",
}
DEFAULT_PROFILE_NAME = "Varsayılan"


def user_key(username: str) -> str:
    """Return a stable non-plain-text key so users never share preferences."""

    return hashlib.sha256(username.strip().casefold().encode("utf-8")).hexdigest()


def normalize_settings(candidate: Any) -> dict[str, Any]:
    if not isinstance(candidate, dict):
        return dict(TV_DEFAULT_SETTINGS)
    slides: list[str] = []
    for value in candidate.get("slides", []):
        key = str(value)
        if key in TV_SLIDE_KEYS and key not in slides:
            slides.append(key)
    if not slides:
        slides = list(TV_DEFAULT_SETTINGS["slides"])
    fixed_slide = str(candidate.get("fixedSlide") or "")
    return {
        "mode": "fixed" if candidate.get("mode") == "fixed" else "rotate",
        "slides": slides,
        "fixedSlide": fixed_slide if fixed_slide in slides else slides[0],
    }


def normalize_profile_name(value: Any) -> str:
    name = " ".join(str(value or "").strip().split())[:40]
    return name or DEFAULT_PROFILE_NAME


def normalize_preferences(candidate: Any) -> dict[str, Any]:
    """Accept legacy single settings or the current profile-based document."""

    if not isinstance(candidate, dict):
        return {
            "activeProfile": DEFAULT_PROFILE_NAME,
            "profiles": {DEFAULT_PROFILE_NAME: dict(TV_DEFAULT_SETTINGS)},
        }
    raw_profiles = candidate.get("profiles")
    profiles: dict[str, dict[str, Any]] = {}
    if isinstance(raw_profiles, dict):
        for raw_name, raw_settings in raw_profiles.items():
            name = normalize_profile_name(raw_name)
            if name not in profiles and len(profiles) < 12:
                profiles[name] = normalize_settings(raw_settings)
    if not profiles:
        profiles[DEFAULT_PROFILE_NAME] = normalize_settings(candidate)
    active = normalize_profile_name(candidate.get("activeProfile"))
    if active not in profiles:
        active = next(iter(profiles))
    return {"activeProfile": active, "profiles": profiles}


class TvSettingsStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def _read(self) -> dict[str, Any]:
        try:
            if not self.path.is_file():
                return {}
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return value if isinstance(value, dict) else {}

    def _write(self, payload: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.path.with_suffix(".tmp")
        temporary_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        temporary_path.replace(self.path)

    def get(self, username: str) -> dict[str, Any]:
        key = user_key(username)
        with self._lock:
            entry = self._read().get(key)
        preferences = normalize_preferences(
            entry.get("preferences") if isinstance(entry, dict) else entry
        )
        return {
            "ok": True,
            "userKey": key,
            "preferences": preferences,
            "settings": preferences["profiles"][preferences["activeProfile"]],
            "stored": bool(entry),
        }

    def save(self, username: str, preferences: Any) -> dict[str, Any]:
        key = user_key(username)
        normalized = normalize_preferences(preferences)
        updated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        with self._lock:
            store = self._read()
            store[key] = {"preferences": normalized, "updatedAt": updated_at}
            self._write(store)
        return {
            "ok": True,
            "userKey": key,
            "preferences": normalized,
            "settings": normalized["profiles"][normalized["activeProfile"]],
            "updatedAt": updated_at,
        }
