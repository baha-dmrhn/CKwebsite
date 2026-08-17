"""Brent/TTF Investing quotes and official TCMB USD/EUR rates for TV."""

from __future__ import annotations

import html
import math
import re
import ssl
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from xml.etree import ElementTree
from zoneinfo import ZoneInfo


INVESTING_CURRENCIES = (
    {
        "symbol": "USD/TRY",
        "base": "USD",
        "label": "Investing ABD Doları",
        "unit": "TRY",
        "url": "https://tr.investing.com/currencies/usd-try",
    },
    {
        "symbol": "EUR/TRY",
        "base": "EUR",
        "label": "Investing Euro",
        "unit": "TRY",
        "url": "https://tr.investing.com/currencies/eur-try",
    },
)
INVESTING_COMMODITIES = (
    {
        "symbol": "BRENT",
        "base": "BRENT",
        "label": "Brent Petrol",
        "unit": "USD/varil",
        "url": "https://www.investing.com/commodities/brent-oil-historical-data",
    },
    {
        "symbol": "DUTCH TTF",
        "base": "TTF",
        "label": "Dutch TTF Doğal Gaz",
        "unit": "EUR/MWh",
        "url": "https://tr.investing.com/commodities/dutch-ttf-gas-c1-futures-historical-data",
    },
)
TCMB_TODAY_URL = "https://www.tcmb.gov.tr/kurlar/today.xml"
TR_TZ = ZoneInfo("Europe/Istanbul")


def _verified_https_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    strict_flag = getattr(ssl, "VERIFY_X509_STRICT", 0)
    if strict_flag:
        context.verify_flags &= ~strict_flag
    return context


def _clean_text(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return " ".join(html.unescape(without_tags).replace("\xa0", " ").split())


def _data_test_text(document: str, key: str) -> str | None:
    pattern = re.compile(
        rf"<[^>]+\bdata-test\s*=\s*(['\"]){re.escape(key)}\1[^>]*>"
        rf"(.*?)</[^>]+>",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(document)
    if not match:
        return None
    text = _clean_text(match.group(2))
    return text or None


def _quote_number(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    text = (
        text.replace("−", "-")
        .replace("%", "")
        .replace("(", "")
        .replace(")", "")
        .replace(" ", "")
    )
    text = re.sub(r"[^0-9,\.\-+]", "", text)
    if not text or text in {"-", "+"}:
        return None
    if "," in text and "." in text:
        decimal_separator = "," if text.rfind(",") > text.rfind(".") else "."
        grouping_separator = "." if decimal_separator == "," else ","
        text = text.replace(grouping_separator, "")
        text = text.replace(decimal_separator, ".")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def parse_investing_quote(document: str, pair: dict[str, str]) -> dict[str, Any]:
    """Extract the stable public quote fields from an Investing instrument page."""

    price = _quote_number(_data_test_text(document, "instrument-price-last"))
    if price is None or price <= 0:
        raise ValueError(f"{pair['symbol']} canlı değeri Investing sayfasında bulunamadı.")
    change = _quote_number(_data_test_text(document, "instrument-price-change"))
    change_percent = _quote_number(
        _data_test_text(document, "instrument-price-change-percent")
    )
    update_label = (
        _data_test_text(document, "trading-time-label")
        or _data_test_text(document, "instrument-price-last-update")
    )
    previous_close = price - change if change is not None else None
    direction = (
        "up"
        if (change_percent if change_percent is not None else change or 0) > 0
        else "down"
        if (change_percent if change_percent is not None else change or 0) < 0
        else "flat"
    )
    return {
        "symbol": pair["symbol"],
        "base": pair["base"],
        "label": pair["label"],
        "unit": pair.get("unit"),
        "value": round(price, 6),
        "change": round(change, 6) if change is not None else None,
        "changePercent": (
            round(change_percent, 4) if change_percent is not None else None
        ),
        "previousClose": (
            round(previous_close, 6) if previous_close is not None else None
        ),
        "direction": direction,
        "quoteTimeLabel": update_label,
        "source": "Investing.com",
        "sourceUrl": pair["url"],
    }


def parse_investing_reader_quote(document: str, pair: dict[str, str]) -> dict[str, Any]:
    """Extract a quote from the read-only rendering used after an upstream 403."""

    lines = [line.strip() for line in document.splitlines()]
    marker_index = next(
        (
            index
            for index, line in enumerate(lines)
            if "portföye ekle" in line.casefold()
        ),
        -1,
    )
    values = [line for line in lines[marker_index + 1 :] if line] if marker_index >= 0 else []
    if len(values) < 2:
        raise ValueError(f"{pair['symbol']} salt-okunur fiyat alanı bulunamadı.")
    price = _quote_number(values[0])
    change_match = re.match(
        r"^\s*([+\-−]?[0-9.,]+)\s*\(([+\-−]?[0-9.,]+)\s*%\)",
        values[1],
    )
    if price is None or price <= 0 or not change_match:
        raise ValueError(f"{pair['symbol']} salt-okunur fiyatı ayrıştırılamadı.")
    change = _quote_number(change_match.group(1))
    change_percent = _quote_number(change_match.group(2))
    quote_time = values[2] if len(values) > 2 else None
    previous_close = price - change if change is not None else None
    direction_value = change_percent if change_percent is not None else change or 0
    return {
        "symbol": pair["symbol"],
        "base": pair["base"],
        "label": pair["label"],
        "unit": pair.get("unit"),
        "value": round(price, 6),
        "change": round(change, 6) if change is not None else None,
        "changePercent": round(change_percent, 4) if change_percent is not None else None,
        "previousClose": round(previous_close, 6) if previous_close is not None else None,
        "direction": "up" if direction_value > 0 else "down" if direction_value < 0 else "flat",
        "quoteTimeLabel": quote_time,
        "source": "Investing.com",
        "sourceUrl": pair["url"],
        "readerFallback": True,
    }


def parse_tcmb_rates(document: bytes) -> list[dict[str, Any]]:
    """Read only USD and EUR indicative forex buying/selling rates."""

    root = ElementTree.fromstring(document)
    rates: list[dict[str, Any]] = []
    labels = {"USD": "ABD Doları", "EUR": "Euro"}
    for currency in root.findall("Currency"):
        code = str(currency.attrib.get("CurrencyCode") or "")
        if code not in labels:
            continue
        buying = _quote_number(currency.findtext("ForexBuying"))
        selling = _quote_number(currency.findtext("ForexSelling"))
        if buying is None and selling is None:
            continue
        rates.append(
            {
                "symbol": f"{code}/TRY",
                "base": code,
                "label": labels[code],
                "unit": "TRY",
                "value": selling if selling is not None else buying,
                "buying": buying,
                "selling": selling,
                "change": None,
                "changePercent": None,
                "previousClose": None,
                "direction": "flat",
                "quoteTimeLabel": str(root.attrib.get("Date") or "TCMB günlük kur"),
                "source": "TCMB",
                "sourceUrl": TCMB_TODAY_URL,
            }
        )
    rates.sort(key=lambda rate: ("USD", "EUR").index(str(rate["base"])))
    return rates


class InvestingFxService:
    """Fetch Investing USD/EUR/Brent/TTF and official TCMB USD/EUR."""

    def __init__(
        self,
        *,
        cache_seconds: int = 300,
        timeout_seconds: float = 8.0,
        daily_refresh_hour: int | None = None,
        opener: Callable[[urllib.request.Request, float], bytes] | None = None,
    ) -> None:
        self.cache_seconds = max(60, int(cache_seconds))
        self.timeout_seconds = max(1.0, float(timeout_seconds))
        self.daily_refresh_hour = (
            max(0, min(23, int(daily_refresh_hour)))
            if daily_refresh_hour is not None
            else None
        )
        self._opener = opener
        self._lock = threading.Lock()
        self._payload: dict[str, Any] | None = None
        self._expires = 0.0
        self._failure_payload: dict[str, Any] | None = None
        self._failure_expires = 0.0

    def _next_expiry(self, now: float) -> float:
        if self.daily_refresh_hour is None:
            return now + self.cache_seconds
        local_now = datetime.fromtimestamp(now, TR_TZ)
        refresh_at = local_now.replace(
            hour=self.daily_refresh_hour, minute=0, second=0, microsecond=0
        )
        if refresh_at <= local_now:
            refresh_at += timedelta(days=1)
        return refresh_at.timestamp()

    def _download(self, url: str) -> bytes:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
                "Cache-Control": "no-cache",
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0 Safari/537.36"
                ),
            },
        )
        if self._opener is not None:
            return self._opener(request, self.timeout_seconds)
        with urllib.request.urlopen(
            request,
            timeout=self.timeout_seconds,
            context=_verified_https_context(),
        ) as response:
            return response.read()

    def _download_investing(self, url: str) -> tuple[bytes, bool]:
        try:
            return self._download(url), False
        except urllib.error.HTTPError as exc:
            if exc.code != 403:
                raise
        reader_target = url.replace("https://www.investing.com/", "https://tr.investing.com/")
        reader_url = f"https://r.jina.ai/{reader_target}"
        request = urllib.request.Request(
            reader_url,
            headers={"Accept": "text/plain", "User-Agent": "Mozilla/5.0"},
        )
        if self._opener is not None:
            return self._opener(request, self.timeout_seconds), True
        with urllib.request.urlopen(
            request,
            timeout=max(20.0, self.timeout_seconds),
            context=_verified_https_context(),
        ) as response:
            return response.read(), True

    def _fetch(self) -> dict[str, Any]:
        pairs: list[dict[str, Any]] = []
        investing_pairs: list[dict[str, Any]] = []
        commodities: list[dict[str, Any]] = []
        errors: list[str] = []

        def load_pair(pair: dict[str, str]) -> dict[str, Any]:
            raw_document, reader_fallback = self._download_investing(pair["url"])
            document = raw_document.decode("utf-8", errors="replace")
            return (
                parse_investing_reader_quote(document, pair)
                if reader_fallback
                else parse_investing_quote(document, pair)
            )

        instruments = INVESTING_CURRENCIES + INVESTING_COMMODITIES
        with ThreadPoolExecutor(max_workers=5, thread_name_prefix="ck-market-indicators") as executor:
            futures = {
                executor.submit(load_pair, pair): pair
                for pair in instruments
            }
            tcmb_future = executor.submit(self._download, TCMB_TODAY_URL)
            for future in as_completed(futures):
                pair = futures[future]
                try:
                    quote = future.result()
                    if pair in INVESTING_CURRENCIES:
                        investing_pairs.append(quote)
                    else:
                        commodities.append(quote)
                except (OSError, ValueError, urllib.error.URLError) as exc:
                    errors.append(f"{pair['symbol']}: {exc}")
            try:
                pairs = parse_tcmb_rates(tcmb_future.result())
                if len(pairs) != 2:
                    errors.append("TCMB: USD ve EUR kurları eksik geldi.")
            except (OSError, ValueError, urllib.error.URLError, ElementTree.ParseError) as exc:
                errors.append(f"TCMB: {exc}")
        investing_pairs.sort(
            key=lambda item: ("USD", "EUR").index(str(item["base"]))
        )
        commodities.sort(
            key=lambda item: ("BRENT", "TTF").index(str(item["base"]))
        )
        now = datetime.now(timezone.utc).replace(microsecond=0)
        return {
            "date": now.date().isoformat(),
            "source": "Investing.com · TCMB",
            "sourceUrls": {
                **{f"INVESTING_{item['base']}": item["url"] for item in instruments},
                "TCMB": TCMB_TODAY_URL,
            },
            "updatedAt": now.isoformat().replace("+00:00", "Z"),
            "pairs": pairs,
            "investingPairs": investing_pairs,
            "commodities": commodities,
            "availablePairs": len(pairs),
            "availableInvestingPairs": len(investing_pairs),
            "availableCommodities": len(commodities),
            "available": len(pairs) == 2 and len(investing_pairs) == 2 and len(commodities) == 2,
            "errors": errors,
            "cached": False,
            "stale": False,
            "refreshSeconds": self.cache_seconds,
        }

    def dashboard(self, *, force_refresh: bool = False) -> dict[str, Any]:
        now = time.time()
        next_expiry = self._next_expiry(now)
        with self._lock:
            if not force_refresh and self._payload and self._expires > now:
                return {**self._payload, "cached": True}
            if (
                not force_refresh
                and self._failure_payload
                and self._failure_expires > now
            ):
                return {**self._failure_payload, "cached": True}

        fetched = self._fetch()
        with self._lock:
            if fetched["availablePairs"] or fetched["availableInvestingPairs"] or fetched["availableCommodities"]:
                self._payload = fetched
                self._expires = next_expiry
                self._failure_payload = None
                self._failure_expires = 0.0
                return fetched
            if self._payload:
                warning = "; ".join(fetched.get("errors") or [])
                response = {
                    **self._payload,
                    "cached": True,
                    "stale": True,
                    "warning": warning or "Piyasa göstergeleri geçici olarak yenilenemedi.",
                }
            else:
                response = fetched
            # Failed upstream requests use the same interval so every TV does
            # not retry the external sources more frequently than configured.
            self._failure_payload = response
            self._failure_expires = next_expiry
            return response
