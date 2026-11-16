"""Voyagr's Google Flights sidecar.

**OWNER-APPROVED EXCEPTION, OFF BY DEFAULT.** This wraps `fast-flights`, an UNOFFICIAL scraper of
Google Flights. Google's terms do not permit automated access, the results can stop at any time,
and the library may be blocked. Read README.md before running it. Nothing in Voyagr starts or
calls this unless GOOGLE_FLIGHTS_SIDECAR_URL is configured and the provider is selected.

Standard library only for the server itself; `fast_flights` is imported lazily, on the first real
search, so parameter validation and the cache can be tested without it.

    GET /health
    GET /search?origin=VIE&destination=FCO&date=2026-12-07[&return_date=2026-12-12]
               [&adults=1][&currency=EUR][&max_stops=]

Environment:
    VOYAGR_SIDECAR_HOST          bind address, default 127.0.0.1
    VOYAGR_SIDECAR_PORT          default 8765
    VOYAGR_SIDECAR_KEY           shared secret; when set, /search needs X-Voyagr-Sidecar-Key
    VOYAGR_SIDECAR_MIN_INTERVAL  seconds between upstream requests, default 3
    VOYAGR_SIDECAR_CACHE_TTL     seconds a search answer is reused, default 600
    VOYAGR_SIDECAR_FETCH_TIMEOUT seconds before an upstream fetch is abandoned, default 25
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
from datetime import date as Date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlsplit

KEY_HEADER = "X-Voyagr-Sidecar-Key"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
# Google sells flights roughly 11 months out; a date beyond that is a mistake, not a search.
MAX_DAYS_AHEAD = 365

log = logging.getLogger("google-flights-sidecar")


class ParamError(ValueError):
    """A request parameter is missing or malformed. Becomes a 400."""


class UpstreamError(Exception):
    """Google or the library did not give us flights. Carries a stable `code` for the caller."""

    def __init__(self, code: str, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class Params:
    origin: str
    destination: str
    date: str
    return_date: Optional[str]
    adults: int
    currency: str
    max_stops: Optional[int]

    def cache_key(self) -> tuple:
        return (
            self.origin,
            self.destination,
            self.date,
            self.return_date,
            self.adults,
            self.currency,
            self.max_stops,
        )


# --- Parameters ---------------------------------------------------------------------------


def _one(query: dict, name: str) -> Optional[str]:
    values = query.get(name)
    if not values:
        return None
    value = values[0].strip()
    return value or None


def _calendar_date(name: str, value: str) -> Date:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ParamError(f"{name} must be YYYY-MM-DD")
    try:
        return Date.fromisoformat(value)
    except ValueError:
        raise ParamError(f"{name} is not a real date") from None


def validate_params(query: dict, today: Optional[Date] = None) -> Params:
    """Read and check a /search query string. `today` is injectable for tests."""
    today = today or datetime.now(timezone.utc).date()

    origin = (_one(query, "origin") or "").upper()
    destination = (_one(query, "destination") or "").upper()
    for name, code in (("origin", origin), ("destination", destination)):
        if not re.fullmatch(r"[A-Z]{3}", code):
            raise ParamError(f"{name} must be a three-letter IATA code")
    if origin == destination:
        raise ParamError("origin and destination must differ")

    raw_date = _one(query, "date")
    if raw_date is None:
        raise ParamError("date is required")
    departure = _calendar_date("date", raw_date)
    if departure < today:
        raise ParamError("date is in the past")
    if departure > today + timedelta(days=MAX_DAYS_AHEAD):
        raise ParamError("date is too far ahead")

    raw_return = _one(query, "return_date")
    return_date: Optional[str] = None
    if raw_return is not None:
        back = _calendar_date("return_date", raw_return)
        if back < departure:
            raise ParamError("return_date is before date")
        return_date = back.isoformat()

    raw_adults = _one(query, "adults") or "1"
    if not re.fullmatch(r"\d", raw_adults) or not 1 <= int(raw_adults) <= 9:
        raise ParamError("adults must be 1 to 9")

    currency = (_one(query, "currency") or "EUR").upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise ParamError("currency must be a three-letter ISO 4217 code")

    raw_stops = _one(query, "max_stops")
    max_stops: Optional[int] = None
    if raw_stops is not None:
        if not re.fullmatch(r"\d", raw_stops) or int(raw_stops) > 3:
            raise ParamError("max_stops must be 0 to 3, or omitted")
        max_stops = int(raw_stops)

    return Params(
        origin=origin,
        destination=destination,
        date=departure.isoformat(),
        return_date=return_date,
        adults=int(raw_adults),
        currency=currency,
        max_stops=max_stops,
    )


# --- Cache and rate limit -----------------------------------------------------------------


class ResponseCache:
    """A small in-memory TTL cache. Only successful answers go in; a block is never remembered."""

    def __init__(self, ttl_seconds: float, max_entries: int = 200,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._clock = clock
        self._items: dict = {}
        self._lock = threading.Lock()

    def get(self, key: tuple) -> Any:
        with self._lock:
            hit = self._items.get(key)
            if hit is None:
                return None
            stored_at, value = hit
            if self._clock() - stored_at >= self._ttl:
                del self._items[key]
                return None
            return value

    def put(self, key: tuple, value: Any) -> None:
        with self._lock:
            if len(self._items) >= self._max and key not in self._items:
                oldest = min(self._items, key=lambda k: self._items[k][0])
                del self._items[oldest]
            self._items[key] = (self._clock(), value)


class Throttle:
    """One upstream request per `interval` seconds for the whole process.

    A caller waits for its slot rather than being refused, because one Voyagr search is two
    back-to-back one-way queries. If the wait would exceed `max_wait` it is refused instead:
    a queue that grows without bound is how an impatient user turns into a ban.
    """

    def __init__(self, interval: float, max_wait: float = 20.0,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep) -> None:
        self._interval = interval
        self._max_wait = max_wait
        self._clock = clock
        self._sleep = sleep
        self._next_slot = 0.0
        self._lock = threading.Lock()

    def acquire(self) -> Optional[float]:
        """Wait for a slot. Returns the seconds waited, or None when the queue is too long."""
        with self._lock:
            now = self._clock()
            start = max(now, self._next_slot)
            wait = start - now
            if wait > self._max_wait:
                return None
            self._next_slot = start + self._interval
        if wait > 0:
            self._sleep(wait)
        return wait


# --- Library result -> JSON ---------------------------------------------------------------


def _stamp(day: Any, clock: Any) -> Optional[str]:
    """`(y, m, d)` and `(h, m)` as a zoneless `YYYY-MM-DDTHH:MM`, or None when either is off."""
    try:
        year, month, dom = day
        hour, minute = clock
        return datetime(year, month, dom, hour, minute).strftime("%Y-%m-%dT%H:%M")
    except (TypeError, ValueError):
        return None


def _minutes_between(earlier: Optional[str], later: Optional[str]) -> Optional[int]:
    if not earlier or not later:
        return None
    gap = datetime.fromisoformat(later) - datetime.fromisoformat(earlier)
    minutes = int(gap.total_seconds() // 60)
    return minutes if minutes >= 0 else None


def flights_to_offers(results: Any, currency: str) -> list:
    """Library `Flights` objects as JSON-ready dicts. Anything the library did not state is None.

    What `fast-flights` 3.x really returns per itinerary: a whole-currency-unit integer price (no
    cents, no currency symbol), airline *names* for the itinerary (no codes, no flight numbers),
    and per segment the airports, local departure/arrival clock faces, a duration in minutes
    and a plane type. It has no "best" flag, no baggage, no fare brand and no booking link, so
    `is_best` is always null here rather than a guess.

    A round-trip query returns the *outbound* itineraries priced as the round trip; the return
    flight is not in the result.
    """
    offers: list = []
    for result in results:
        segments = []
        for hop in getattr(result, "flights", None) or []:
            segments.append({
                "from_airport": hop.from_airport.code or None,
                "from_name": hop.from_airport.name or None,
                "to_airport": hop.to_airport.code or None,
                "to_name": hop.to_airport.name or None,
                "departs_at": _stamp(hop.departure.date, hop.departure.time),
                "arrives_at": _stamp(hop.arrival.date, hop.arrival.time),
                "duration_minutes": hop.duration if isinstance(hop.duration, int) else None,
                "plane_type": hop.plane_type or None,
            })
        if not segments:
            continue

        # Layovers are the gap between landing and the next take-off at the *same* airport, so
        # both clock faces are in one zone and the subtraction is sound. Anything else (a
        # missing stamp, a negative gap) makes the total unknown rather than short.
        total: Optional[int] = 0
        for index, segment in enumerate(segments):
            if segment["duration_minutes"] is None or total is None:
                total = None
                break
            total += segment["duration_minutes"]
            if index + 1 < len(segments):
                layover = _minutes_between(segment["arrives_at"], segments[index + 1]["departs_at"])
                total = None if layover is None else total + layover

        carbon = getattr(result, "carbon", None)
        price = result.price
        offers.append({
            # A whole-unit integer from the library, carried as a string so no consumer ever
            # sees a float; the caller parses it exactly.
            "price": str(price) if isinstance(price, int) and price > 0 else None,
            "currency": currency,
            "airlines": [str(name) for name in (getattr(result, "airlines", None) or [])],
            "stops": len(segments) - 1,
            "duration_minutes": total,
            "departs_at": segments[0]["departs_at"],
            "arrives_at": segments[-1]["arrives_at"],
            "is_best": None,
            "type": getattr(result, "type", None),
            "carbon_grams": getattr(carbon, "emission", None),
            "typical_carbon_grams": getattr(carbon, "typical_on_route", None),
            "segments": segments,
        })
    return offers


# --- Upstream -----------------------------------------------------------------------------


def fetch_offers(params: Params) -> list:
    """One real Google Flights query through `fast-flights`. Slow, network, may be blocked."""
    try:
        from fast_flights import (FlightQuery, FlightsNotFound, Passengers, create_query,
                                  fetch_flights_html)
        from fast_flights.parser import parse
    except ImportError as exc:  # environment problem, not a request problem
        raise UpstreamError("library_missing", f"fast-flights is not installed: {exc}", 500)

    legs = [FlightQuery(date=params.date, from_airport=params.origin,
                        to_airport=params.destination)]
    if params.return_date:
        legs.append(FlightQuery(date=params.return_date, from_airport=params.destination,
                                to_airport=params.origin))
    query = create_query(
        flights=legs,
        trip="round-trip" if params.return_date else "one-way",
        passengers=Passengers(adults=params.adults),
        currency=params.currency,
        language="en",
        max_stops=params.max_stops,
    )

    html = fetch_flights_html(query)
    # Seen on a real run from an EU address: Google answers 200 with its cookie-consent page,
    # which carries no flight data. We do not click through or fake the consent cookie.
    if "consent.google.com" in html[:2000] or "<title>Before you continue" in html[:4000]:
        raise UpstreamError("consent_wall", "Google served its consent page instead of results.",
                            503)
    try:
        results = parse(html)
    except FlightsNotFound:
        return []
    except Exception as exc:  # the parser indexes into Google's private payload by position
        raise UpstreamError("unparsable", f"Google's page was not understood ({type(exc).__name__}).")
    return flights_to_offers(results, params.currency)


class Service:
    """The request logic, separated from HTTP so it can be tested with a fake fetcher."""

    def __init__(self, fetch: Callable = fetch_offers,
                 cache: Optional[ResponseCache] = None, throttle: Optional[Throttle] = None,
                 fetch_timeout: float = 25.0,
                 now: Callable = lambda: datetime.now(timezone.utc)) -> None:
        self._fetch = fetch
        self.cache = cache or ResponseCache(600)
        self.throttle = throttle or Throttle(3.0)
        self._timeout = fetch_timeout
        self._now = now
        # One worker: the throttle already serialises upstream calls, and a hung fetch must not
        # be able to fan out into a thread per request.
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gf-fetch")

    def search(self, params: Params) -> dict:
        cached = self.cache.get(params.cache_key())
        if cached is not None:
            return {**cached, "cached": True}

        if self.throttle.acquire() is None:
            raise UpstreamError("rate_limited", "Too many requests queued; try again shortly.", 429)

        future = self._pool.submit(self._fetch, params)
        try:
            offers = future.result(timeout=self._timeout)
        except FutureTimeout:
            future.cancel()
            raise UpstreamError("timeout", "Google did not answer in time.", 504) from None

        body = {
            "provider": "google-flights",
            "trip": "round-trip" if params.return_date else "one-way",
            "origin": params.origin,
            "destination": params.destination,
            "date": params.date,
            "return_date": params.return_date,
            "adults": params.adults,
            "currency": params.currency,
            "fetched_at": self._now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "offers": offers,
        }
        self.cache.put(params.cache_key(), body)
        return {**body, "cached": False}


# --- HTTP ---------------------------------------------------------------------------------


def make_handler(service: Service, key: Optional[str]) -> type:
    class Handler(BaseHTTPRequestHandler):
        server_version = "voyagr-google-flights"

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            # Method and path only: the query string names the traveller's route.
            log.info("%s %s", self.command, urlsplit(self.path).path)

        def _send(self, status: int, body: dict, headers: Optional[dict] = None) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)

        def _authorised(self) -> bool:
            if not key:
                return True
            supplied = self.headers.get(KEY_HEADER, "")
            return hmac.compare_digest(supplied.encode(), key.encode())

        def do_GET(self) -> None:  # noqa: N802
            parts = urlsplit(self.path)
            if parts.path == "/health":
                self._send(200, {"status": "ok", "provider": "google-flights"})
                return
            if parts.path != "/search":
                self._send(404, {"error": {"code": "not_found"}})
                return
            if not self._authorised():
                self._send(401, {"error": {"code": "unauthorised"}})
                return
            try:
                params = validate_params(parse_qs(parts.query))
            except ParamError as exc:
                self._send(400, {"error": {"code": "bad_request", "message": str(exc)}})
                return
            try:
                self._send(200, service.search(params))
            except UpstreamError as exc:
                log.warning("upstream failure: %s", exc.code)
                self._send(exc.status, {"error": {"code": exc.code, "message": str(exc)}},
                           {"Retry-After": "10"} if exc.status == 429 else None)
            except Exception:  # never leak a traceback or the query to the caller
                log.exception("unexpected failure")
                self._send(500, {"error": {"code": "internal"}})

    return Handler


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    try:
        return float(raw) if raw else default
    except ValueError:
        raise SystemExit(f"{name} must be a number")


def main() -> None:
    # Root at WARNING, ours at INFO: the HTTP client underneath logs every response URL at INFO,
    # and that URL encodes the route and dates (seen on a real run).
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(message)s")
    log.setLevel(logging.INFO)
    host = os.environ.get("VOYAGR_SIDECAR_HOST", "127.0.0.1")
    port = int(_float_env("VOYAGR_SIDECAR_PORT", 8765))
    key = os.environ.get("VOYAGR_SIDECAR_KEY") or None

    if host not in LOOPBACK_HOSTS and not key:
        raise SystemExit("Refusing to listen beyond loopback without VOYAGR_SIDECAR_KEY set.")

    service = Service(
        cache=ResponseCache(_float_env("VOYAGR_SIDECAR_CACHE_TTL", 600)),
        throttle=Throttle(_float_env("VOYAGR_SIDECAR_MIN_INTERVAL", 3)),
        fetch_timeout=_float_env("VOYAGR_SIDECAR_FETCH_TIMEOUT", 25),
    )
    httpd = ThreadingHTTPServer((host, port), make_handler(service, key))
    log.info("google-flights sidecar on %s:%d (key %s)", host, port, "required" if key else "off")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    sys.exit(main())
