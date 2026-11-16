# Google Flights sidecar

**Optional. Off by default. An owner-approved exception to `docs/provider-policy.md`.**

A tiny Python HTTP server that asks Google Flights for prices through
[`fast-flights`](https://github.com/AWeirdDev/flights) (PyPI `fast-flights`, MIT) and hands them to
Voyagr as JSON. It exists because the Aviasales Data API is only a sparse cache of other people's
searches. Voyagr works without it, and nothing starts it.

## The risk, in plain words

- **It scrapes Google Flights.** Google's terms do not permit automated access. This is the owner's
  informed exception, not a grey area to be tidied up later.
- **It can be blocked at any time, without notice.** The library's own README jokes about getting
  banned. A ban is on the address, not the process.
- **On its first real run here (2026-11-16, an EU address) it returned nothing.** Google answered
  with its cookie-consent page ("Before you continue") instead of results. The sidecar reports that
  as `consent_wall` (HTTP 503). It deliberately does not fake a consent cookie to get past it.
- **It breaks when Google changes its page.** The library reads a private payload by position. The
  failure shows as `unparsable`.
- **It needs Python at runtime** (3.10 or later) beside the app. There is no SLA.
- **What it returns is a listing, not a quote.** Whole-currency-unit prices, airline names but no
  flight numbers, no baggage, no booking link. A return trip is two one-way queries.

If any of that is not acceptable, do not run it.

## Run it

```
cd services/google-flights
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt        # .venv/bin/pip on Linux and macOS
VOYAGR_SIDECAR_KEY=some-long-random-string .venv/Scripts/python server.py
```

It binds `127.0.0.1:8765`. It refuses to bind anywhere else unless a key is set. In Voyagr:

```
GOOGLE_FLIGHTS_SIDECAR_URL=http://127.0.0.1:8765
GOOGLE_FLIGHTS_SIDECAR_KEY=some-long-random-string
```

and select the provider as described in `docs/runbook.md`, section 5a.

## API

```
GET /health
GET /search?origin=VIE&destination=FCO&date=2026-12-07[&return_date=2026-12-12][&adults=1][&currency=EUR][&max_stops=]
```

`/search` needs the `X-Voyagr-Sidecar-Key` header when a key is configured. It answers

```json
{ "provider": "google-flights", "trip": "one-way", "currency": "EUR",
  "fetched_at": "2026-11-16T12:00:00Z", "cached": false,
  "offers": [ { "price": "54", "currency": "EUR", "airlines": ["Ryanair"], "stops": 0,
                "duration_minutes": 110, "departs_at": "2026-12-07T16:45",
                "arrives_at": "2026-12-07T18:35", "is_best": null, "segments": [ ... ] } ] }
```

Facts the library does not state are `null` (`is_best` always, because there is no such field in
`fast-flights` 3.x). Times are local clock faces with no zone. A failure is
`{"error": {"code": ...}}` with `consent_wall`, `unparsable`, `timeout`, `rate_limited`,
`library_missing` or `bad_request`.

## Settings (environment)

| Variable                       | Default     | Meaning                                              |
| ------------------------------ | ----------- | ---------------------------------------------------- |
| `VOYAGR_SIDECAR_HOST`          | `127.0.0.1` | Bind address. Non-loopback requires a key.           |
| `VOYAGR_SIDECAR_PORT`          | `8765`      |                                                      |
| `VOYAGR_SIDECAR_KEY`           | unset       | Shared secret for `X-Voyagr-Sidecar-Key`.            |
| `VOYAGR_SIDECAR_MIN_INTERVAL`  | `3`         | Seconds between upstream requests, whole process.    |
| `VOYAGR_SIDECAR_CACHE_TTL`     | `600`       | Seconds an answer is reused instead of asking again. |
| `VOYAGR_SIDECAR_FETCH_TIMEOUT` | `25`        | Seconds before an upstream fetch is given up on.     |

Logs carry the method and path only, never the query string. The HTTP client underneath logs full
URLs, so the root logger is held at WARNING.

## Tests

```
python -m unittest test_server -v      # offline: validation, cache, throttle, result mapping
```

`requirements.txt` pins `fast-flights` exactly. `typing_extensions` is listed because 3.1.0 imports
it without declaring it, which fails on a clean Python 3.10.
