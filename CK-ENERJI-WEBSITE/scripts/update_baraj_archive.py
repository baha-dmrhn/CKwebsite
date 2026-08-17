"""EPİAŞ aktif doluluk verisini indirip kalıcı Excel arşivini günceller.

Bu dosya hem GitHub Actions zamanlayıcısından hem de yerel terminalden
çalıştırılabilir. Kimlik bilgileri yalnızca ortam değişkenlerinden okunur.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from datetime import date, datetime
from pathlib import Path
from types import ModuleType
from typing import Any
from zoneinfo import ZoneInfo


SITE_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SITE_ROOT.parent
DEFAULT_WORKBOOK = SITE_ROOT / "Aktif_Doluluk-Delta - Kopya.xlsx"
EPIAS_MODULE_PATH = PROJECT_ROOT / "UEVM-UEÇM" / "main.py"
SOURCE_PAGE_URL = "https://seffaflik.epias.com.tr/electricity/dams/active-fullness"
ACTIVE_FULLNESS_ENDPOINT = "/v1/dams/data/active-fullness"
TR_TZ = ZoneInfo("Europe/Istanbul")

if str(SITE_ROOT) not in sys.path:
    sys.path.insert(0, str(SITE_ROOT))

from ck_suite.baraj_archive import (  # noqa: E402
    ArchiveUpdateResult,
    append_active_fullness_days,
)


class BarajAutomationError(RuntimeError):
    """Günlük arşiv görevinin güvenli biçimde gösterilebilen hatası."""


def _load_epias_module() -> ModuleType:
    if not EPIAS_MODULE_PATH.is_file():
        raise BarajAutomationError(
            f"EPİAŞ istemci modülü bulunamadı: {EPIAS_MODULE_PATH}"
        )
    spec = importlib.util.spec_from_file_location(
        "ck_baraj_automation_epias",
        EPIAS_MODULE_PATH,
    )
    if spec is None or spec.loader is None:
        raise BarajAutomationError("EPİAŞ istemci modülü yüklenemedi.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _payload_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for candidate in (
        payload.get("items"),
        (payload.get("body") or {}).get("items"),
        (payload.get("data") or {}).get("items"),
    ):
        if isinstance(candidate, list):
            return [item for item in candidate if isinstance(item, dict)]
    return []


def _normalized_items(payload: Any) -> list[dict[str, Any]]:
    return [
        {
            "dam": item.get("dam") or item.get("damName") or "",
            "basin": item.get("basin") or item.get("basinName") or "",
            "activeFullnessAmount": item.get("activeFullnessAmount"),
            "date": item.get("date") or "",
        }
        for item in _payload_items(payload)
    ]


def update_archive(
    client: Any,
    workbook_path: str | Path = DEFAULT_WORKBOOK,
    *,
    minimum_records: int = 50,
    latest_allowed_date: date | None = None,
) -> ArchiveUpdateResult:
    """En yeni yayımlanan tam EPİAŞ gününü Excel arşivine ekle."""

    payload = client._post_json(
        ACTIVE_FULLNESS_ENDPOINT,
        {"page": {"number": 1, "size": 500}},
        force_refresh=True,
    )
    items = _normalized_items(payload)
    if not items:
        raise BarajAutomationError(
            "EPİAŞ aktif doluluk servisi geçerli kayıt döndürmedi."
        )
    return append_active_fullness_days(
        workbook_path,
        items,
        minimum_records=max(1, minimum_records),
        latest_allowed_date=latest_allowed_date or datetime.now(TR_TZ).date(),
    )


def _required_environment(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise BarajAutomationError(
            f"{name} tanımlı değil. GitHub Actions için bu adı Repository Secret "
            "olarak ekleyin."
        )
    return value


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="EPİAŞ Baraj Aktif verisini CK Enerji Excel arşivine ekler."
    )
    parser.add_argument(
        "--workbook",
        type=Path,
        default=DEFAULT_WORKBOOK,
        help=f"Güncellenecek Excel dosyası (varsayılan: {DEFAULT_WORKBOOK})",
    )
    parser.add_argument(
        "--minimum-records",
        type=int,
        default=int(os.getenv("CK_BARAJ_ARCHIVE_MIN_RECORDS", "50")),
        help="Bir günün tam kabul edilmesi için gereken en az baraj sayısı.",
    )
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    if not args.workbook.is_file():
        raise BarajAutomationError(f"Excel arşivi bulunamadı: {args.workbook}")

    username = _required_environment("EPIAS_USERNAME")
    password = _required_environment("EPIAS_PASSWORD")
    epias = _load_epias_module()
    client = epias.EpiasClient(username=username, password=password)

    print(f"EPİAŞ Baraj Aktif verisi kontrol ediliyor: {SOURCE_PAGE_URL}")
    result = update_archive(
        client,
        args.workbook,
        minimum_records=args.minimum_records,
    )
    if result.updated:
        print(
            "Excel arşivi güncellendi: "
            f"{', '.join(result.added_dates)} · {result.added_rows} kayıt"
        )
    else:
        print(f"Excel değişmedi: {result.reason}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BarajAutomationError as exc:
        print(f"HATA: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
