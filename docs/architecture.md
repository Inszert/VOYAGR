# Architecture

How Voyagr is put together, and why. The product itself is defined in
`PRODUCT-SPECIFICATION.md`; this document covers engineering decisions. Brought up to date with the
code as of 2026-11-15 (after commit `ff14d21`). Where something is not built or not verified, it says so.
 
---

## 1. The organising principle

The specification (section 23) splits responsibility in two, and the codebase is arranged around
that split:

| Deterministic software owns         | The language model owns              |
| ----------------------------------- | ------------------------------------ |
| Prices, totals, currency arithmetic | Parsing free text into structure     |
| Budget limits and hard eligibility  | Explaining an already-computed score |
| Date and night calculations         | Drafting itineraries                 |
| Deal scores and ranking             | Wording an alert already decided on  |
| Provider constraints                | Inferring soft preferences           |

A model that can adjust a price can be wrong about money the user is about to spend. The split is
enforced structurally:

- `src/core/` is pure: no I/O, no clock, no randomness, no model. Everything numeric lives here.
- `src/ai/` exposes an interface whose methods cannot return a price, a total or an eligibility
  decision.
- `src/ai/guardrails.ts` validates model output, converts intent into `Money` deterministically, and
  scans generated prose for figures absent from its source facts.

Today the only AI provider is a deterministic mock. `AI_PROVIDER=anthropic` is rejected by
environment validation (`src/lib/env.ts`) with "anthropic is not implemented yet", so the process
stops at startup rather than quietly serving mock output. The schema widens when an adapter exists.

---

## 2. Layers

```
Browser (PWA)
  |
  +- Next.js App Router ------------- src/app/  (route groups: (stage), (column), (auth))
  +- Design system ------------------ src/components/ui/
  +- The globe ---------------------- src/components/discovery/, src/discovery/
  |
Application layer
  +- Deterministic core ------------- src/core/   money, trip cost/constraints/scoring,
  |                                   dates, fx, freshness, flex-dates, expenses
  +- Search ------------------------- src/search/  plan, orchestrate, assemble, day prices
  +- Provider adapters -------------- src/providers/  flights, hotels, stays, weather,
  |                                   transfers, places, fx, imagery
  +- Cache -------------------------- src/cache/  memory + Redis, read-through, refresh targets
  +- Persistence -------------------- src/db/  repository interfaces, memory, Postgres, migrations
  +- Background jobs ---------------- src/queue/ (memory, BullMQ), src/worker/
  +- Notifications ------------------ src/notifications/  Web Push, in-app feed
  +- Email -------------------------- src/email/  Resend, console, templates
  +- Partners and hand-off ---------- src/booking/
  +- Trip hub ----------------------- src/trip-hub/ (service), src/core/expenses/ (arithmetic)
  +- AI abstraction ----------------- src/ai/  interface, guardrails, mock
```

Dependencies point inward. `core/` imports nothing from `providers/`, `ai/`, `db/` or `app/`.

---

## 3. Key decisions

### 3.1 Next.js App Router, TypeScript, npm

Route handlers serve as the backend; there is no separate API service. The one extra process is the
worker (section 6), a plain Node entry point (`scripts/worker.mjs` -> `src/worker/main.ts`) that
shares the code and the database and Redis with the web process.

### 3.2 Money as integer minor units

`src/core/money.ts`. Every amount is an integer in the currency's minor unit plus an ISO 4217 code.
Mixing currencies throws; conversion is `src/core/fx.ts` only, with a dated rate, and a missing rate
fails and names the pair. `allocate()` splits an amount into shares that sum back to the original.

### 3.3 Three totals, not one

`src/core/trip/cost.ts` reports `knownTotal` (provider-quoted), `estimatedTotal` (our models) and
`total` (their sum), plus a separate list of `excluded` lines. A missing stay or transfer is an
`excluded` line, not a zero, and an excluded line is never folded into a total.

### 3.4 Hard constraints are separate from scoring

`constraints.ts` decides whether a trip is allowed; `scoring.ts` decides how good an allowed trip
is. All violations are collected so a near miss can be explained in full. `detectTravelWarnings()`
is separate on purpose: a warning never filters a trip out and a hard rule is never downgraded.

### 3.5 Scores are explainable by construction

Every factor is normalised to 0-1, weighted and reported individually; the score equals the sum of
its contributions (a test asserts it).

### 3.6 Usable vacation time

`usable-time.ts` counts time inside an 08:00-22:00 window. Hotel check-in is not modelled: an early
arrival still counts, because bags can be stored and the day starts anyway.

### 3.7 Providers, and the mock / absent / live policy

Every external source implements an interface in `src/providers/types.ts` and returns `Result`.
`src/providers/registry.ts` is the one place that picks an adapter. Mocks are deterministic
(variation from a hash of the query, never `Math.random()` or `new Date()`).

Three kinds of answer exist for a slot:

| Mode     | Meaning                                                          | Where allowed                                  |
| -------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| `mock`   | Fixtures                                                         | Dev and tests; production only with the opt-in |
| `live`   | A real vendor answered (flights are labelled `indicative`)       | Everywhere it is configured                    |
| `absent` | No data source; adapter answers with nothing; cost is `excluded` | Production default for hotels, transfers       |

The rule lives in `src/providers/mock-policy.ts`: `mockAllowed(env)` is true outside production, and
in production only when `ALLOW_MOCK_IN_PRODUCTION=true`. That flag exists for the end-to-end suite,
which runs a production build on fixtures. Do not set it in a real deployment; it also switches off
the Travelpayouts Drive script.

What a production process does, per slot:

| Slot             | Configuration                                    | Result in production                                            |
| ---------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Flights          | `aviasales` + `AVIASALES_API_TOKEN`              | Live (indicative). No token: startup error                      |
| Flights          | `mock` (the default)                             | Startup error. `live`: "not implemented" error                  |
| Weather          | `open-meteo` (the default)                       | Live, keyless                                                   |
| Hotels (priced)  | default                                          | `absent`; an explicit `mock` is refused; `live` not implemented |
| Transfers        | default, or `mock`                               | `absent` (a `mock` here becomes absent, not an error)           |
| Places           | `wikidata` (the production default)              | Live, keyless (section 5). `mock` becomes `absent`; `absent` ok |
| Stays (`/stays`) | default `absent`; `travelpayouts-links` optional | Link-out offers with no price; an explicit `mock` is refused    |
| FX               | `ecb` (the default)                              | Live, keyless                                                   |
| Email            | `resend` + `RESEND_API_KEY`                      | `console` is refused: sends fail (3.7)                          |

`assertNoMockInProduction()` in the registry constructor is the backstop: if any slot ends up a
mock, the registry throws and names it. Env defaults for production are set in `productionAwareDefaults`
in `src/lib/env.ts`. An email setting that cannot deliver (`console` in production, or `resend` with no
`RESEND_API_KEY`) does not stop the process: `src/email/registry.ts` returns a provider whose every
`send` fails with the configuration error, and logs it once at error level. The worker resolves it at
startup so the problem is logged then; sign-up still creates the account and price refresh keeps
running, while no mail is delivered.

Duffel is prohibited (zero paid search cost, 2026-11-04); `FLIGHT_PROVIDER` has no `duffel` value.
Provider input is untrusted and schema-checked in `src/providers/schema.ts`.

### 3.8 The database is not required

`src/db/repository.ts` defines interfaces; `memory.ts` and `postgres.ts` implement them, both held to
one contract suite. With `DATABASE_URL` unset nothing loads `pg`. Money is `BIGINT` minor units plus
`CHAR(3)`. Migrations are in section 11.

### 3.9 The queue

`src/queue/` has a job contract with an in-process driver and a BullMQ driver. `QUEUE_DRIVER=bullmq`
without `REDIS_URL` is a hard error. The job names are `travel-watch.refresh`,
`notification.deliver` and `cache.refresh`, and the worker registers a handler for each (a test holds
the two lists equal). A name is added to the contract only together with the code that enqueues it:
deal detection runs inside the watch refresh, and due watches are found by the scheduler sweep, so
neither is a job of its own.

### 3.10 PWA

A hand-written service worker (`public/sw.js`): navigations and API requests are network-first,
only content-hashed static assets (and `/geo/`, which is versioned and immutable) are cache-first,
and there is an offline page with no prices. Registration is skipped in development.

---

## 4. Caching and refresh

Pages must not call Aviasales per request. Prices are read from a cache the worker keeps warm.

**Two tiers.** L1 is in-process (`MemoryCacheStore`, on `globalThis`); L2 is Redis
(`RedisCacheStore`, `ioredis`, imported only when used). `getCacheStore()` picks Redis when
`REDIS_URL` is set and memory otherwise. A missing or dead Redis is a miss, not an outage (2 second
connect timeout, one retry per request). Without Redis the worker's refreshes land in the worker's
memory and no page sees them.

**Entries are observations.** A `CacheStore` returns `{ value, observedAt }`. `readThrough` reads
`observedAt` through `src/core/freshness.ts`, so an undated entry is `unknown` and is served and
refreshed, never called fresh or stale. The stored TTL is `fresh + stale`, so Redis drops an entry
after its stale window.

**`readThrough` is stale-while-revalidate:**

| Entry age              | What happens                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `<= freshMs`           | Returned.                                                                                                    |
| `<= freshMs + staleMs` | Returned at once; one background refresh per key, however many reads                                         |
| older, or missing      | Loaded, stored, returned. Concurrent misses share one load.                                                  |
| load fails             | Any entry left is served, labelled stale; otherwise null value and the error on the result. It never throws. |

**Keys:** `voyagr:v1:<kind>:<first 128 bits of SHA-256 of the key-sorted JSON of the query>`. `v1`
is the stored shape; bump it when that changes. The data source (`api` / `mock`) is part of the
query, so one is never served under the other's label. Because the discovery query contains dates
derived from "today" (UTC), the discovery key changes at 00:00 UTC every day; the next section says
what a page does in the gap.

**A page view never runs the full-catalogue search.** That search is up to 2000 provider calls, so
`SearchDiscoverySource.read` (`src/discovery/snapshot.ts`) only reads the cache. It looks, in order, at
today's entry for the visitor's own settings, yesterday's, then the default profile's for today and
yesterday, and serves the first it finds. An entry that is not today's, or has aged, is served as it is
and labelled by its own `observedAt` ("Updated 90 min ago"), and the page enqueues the same
`cache.refresh` job the worker's schedule uses (same dedupe key, `src/cache/request-refresh.ts`) and
moves on. With nothing cached at all - first boot - the globe shows the places without prices and a
"Prices are loading" line. The one exception is the fixtures source (`mock`): it calls no provider, so
there is no quota to protect and a page may build it. With `QUEUE_DRIVER=memory` in the web process
nothing consumes the job, so run the worker (or accept an unpriced globe) outside the end-to-end suite.

**TTLs** (constants in `src/discovery/snapshot.ts`, `src/search/cache.ts`, `src/search/day-prices.ts`,
`src/core/trip/weather-window.ts`):

| Kind        | Query                                             | Fresh   | Stale window | Written by                         |
| ----------- | ------------------------------------------------- | ------- | ------------ | ---------------------------------- |
| `discovery` | discovery request + source                        | 60 min  | 24 h         | worker (a page only reads)         |
| `search`    | search request + source                           | 5 min   | none         | page only                          |
| `flex`      | one month of per-day prices (day-prices)          | 60 min  | 24 h         | page or API route, on a miss       |
| `weather`   | forecast (a day of the trip is within 15 days)    | 3 h     | 3 h          | page, on a miss                    |
| `weather`   | climate average (all dates beyond 15 days)        | 30 days | 60 days      | page, on a miss                    |
| `places`    | a destination's things to do, and Commons credits | 7 days  | 30 days      | worker pre-warm, or page on a miss |

Explicit user searches stay live: remembered five minutes by query key, no stale window, because a
search is a question about now. They are cached at the page, never inside `runSearch`, because a
Travel Watch refresh exists to find out whether the price moved.

**The refresh.** The worker enqueues one `cache.refresh` job per target every `PRICE_REFRESH_MINUTES`
(default 30), spread evenly across the interval and deduplicated by target id. On start it runs a
round at once (the first target, `recommended`, with no delay). It also looks at the UTC date every
30 seconds and starts a round the moment the date changes (`checkRollover` in `src/cache/refresh.ts`,
the clock injected), so the new day's keys are filled within the first minutes after 00:00 UTC rather than
within the next interval; until then pages serve yesterday's entry, labelled. The target list is code,
`src/cache/targets.ts`: `recommended` (what the globe and the recommended trip show an anonymous
visitor), `origin:X` for `POPULAR_ORIGINS` (LHR, JFK, CDG, AMS, FRA), and `collection:<name>` for
`COLLECTIONS` (`beach-escapes`, `city-breaks`, `winter-sun`). A failed refresh throws so the queue
retries with backoff, and the old entry keeps being served. `discovery` entries and `places` entries are
refreshed by the worker; `flex`, `weather` and `search` entries are filled by visits.

**Pre-warming things to do.** The first look at a city asks Wikidata a heavy question (15 to 45
seconds), so the worker asks it first. Every `PLACES_REFRESH_HOURS` (default 168, a week) and at
start it enqueues `cache.refresh` jobs with ids `places:<airport code>`: up to 40 destinations per round
(`PLACES_DESTINATIONS_PER_ROUND`) from the catalogue, the themed collections first, skipping any whose
entry is still fresh, a minute apart. The lookups go one at a time through the places provider's
limiter. The destination page keeps its Suspense skeleton for a cache miss. At 40 a round the whole
catalogue takes several rounds to cover; lower `PLACES_REFRESH_HOURS` to cover it sooner. Wikidata
etiquette (a descriptive User-Agent naming the app, one query at a time, low rate, long cache) is
in the comments of `src/providers/places/wikidata.ts` and `src/cache/refresh.ts`.

**Quota maths.** Calls per hour = sum of target call ceilings x 60 / `PRICE_REFRESH_MINUTES`. A
ceiling is the most a refresh can spend, not a forecast. Values come from `src/cache/targets.ts` and
`DISCOVERY_LIMITS` in `src/discovery/snapshot.ts` (`maxProviderCalls` 2000, `maxDateWindows` 4,
`maxOrigins` 2):

| Item                                                            | Value                                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Targets                                                         | 1 recommended + 5 origins + 3 collections (collections only keep codes the catalogue can place) |
| Ceiling, recommended and each origin                            | 2000 each, so 12,000 for the six                                                                |
| Ceiling, a collection                                           | `destinations x (4 + 3) x 2` = 140 (10 places), 140, 112 (8)                                    |
| Ceiling per round                                               | about 12,400 calls (12,392 if every collection code is placeable)                               |
| At 30 min                                                       | about 24,800 calls per hour                                                                     |
| Aviasales limit (600 per minute, as declared in `aviasales.ts`) | 36,000 calls per hour                                                                           |
| Headroom                                                        | about 31%, before user searches                                                                 |

**Two one-way tickets (user searches).** When the round-trip cache has no fare for a pair of days,
`runSearch` also asks the one-way cache (`searchOneWay`) for each route, in both directions, for
every month the windows leave in and come back in, and pairs single flights into trips marked
`two_one_way` (`src/core/trip/one-way-pair.ts`; a return fare that is cheaper or equal wins). That
is `origins x destinations x (departure months + return months)` extra calls, only for searches of
at most `ONE_WAY_MAX_DESTINATIONS` (3) places, each counted against `maxProviderCalls` and cached per
route, direction and month (`flex`, 60 min fresh, 24 h stale). A one-place search over one month
adds 2 calls. The snapshot's "anywhere" search adds none.

Below about 21 minutes the ceiling exceeds the limit. `src/cache/refresh.test.ts` asserts the default
stays inside it. User searches spend from the same per-provider limiter and are not in this figure.
The 600 per minute figure is what the adapter declares; this file does not claim it was re-measured.

**Price calendar and day prices.** `src/search/day-prices.ts` loads the cheapest flight on each day
of a month, behind both the price calendar (`/api/price-calendar`) and the flexible-dates strip, so
neither repeats the other's call. For a vendor that answers by month (Aviasales in `calendar`
window mode, `metadata.answersByMonth`) it makes **two** calls per destination per month: one for
returns within the month, one for returns running into the next, because the vendor filters the
return by month too, plus **three** day questions (`monthFareSources` in `aviasales.ts`): one-way
`prices_for_dates` (`one_way=true`), `v1/prices/calendar` and `v2/prices/latest`; the last two answer
by city and are kept only where the city is the code asked. Per day the cheapest fare wins and keeps
its own observed time; one-way fares are stored apart and shown as "one way from", never as a return
price. So five calls per destination per month. A vendor that does not (the mock) is asked one call
per day. The API route accepts at most 5 destinations, so one month costs at most 25 Aviasales
calls, then is cached for an hour (stale for a day more); every figure is a party total and the
party is in the cache key. A day with no price is absent, not zero. The route is unauthenticated, so
it is bounded (`docs/security.md`, section 10): a month outside this month through twelve months ahead
is a 400 before any provider work, each client gets 60 requests a minute (429 with `Retry-After`; a
request with no client address shares no bucket), and a per-process budget of 120 cache misses a
minute (`DAY_PRICE_LOADS_PER_MINUTE`) makes a month past it answer "could not be loaded" instead of
calling the vendor. Cache hits cost nothing.

### 4.x The LiteAPI hotel snapshot (Part 10)

Visitors never call LiteAPI. Hotel rates are read from our own tables, which the worker fills on a
schedule. The stays registry builds `SnapshotStayProvider` (`src/providers/stays/snapshot.ts`) for
`liteapi`; the live adapter (`src/providers/stays/liteapi.ts`) is imported only by the refresh job,
and `src/liteapi-snapshot/import-guard.test.ts` fails if any file under `src/app/` can reach it.

**Storage** (migration `0013_liteapi_snapshot.sql`): `liteapi_hotels` (mapped property, 7 day expiry),
`liteapi_rates_snapshot` (one row per destination, window, party, currency and nationality; the rates
are one JSONB column of validated, mapped offers with Money as `{ amount, currency }`, plus a
`schema_version` that a reader checks) and `liteapi_refresh_runs` (the audit trail and the real call
counter). A row's `expires_at` is observed plus three intervals.

**Schedule.** `LITEAPI_SNAPSHOT_REFRESHES_PER_DAY` (1 to 24, default 3) rounds a day at fixed UTC
slots (00:00, 08:00, 16:00 by default). A 30 second check starts a round when the slot changes; a
restart in a slot that already ran starts none. One job per destination and window
(`liteapi.snapshot.refresh`), one attempt each. Off unless `LITEAPI_SNAPSHOT_ENABLED=true` and a key is
set: with the flag off the worker starts no scheduler and the handler records `disabled`, calling nothing.

**One run, at most two calls:** hotel content (`data/hotels`, only when missing or expired), then
`hotels/rates` for the stored ids; then the validated result replaces the row. A provider failure
keeps the old row and records only the error code. Every call goes through one process-level limiter
keyed `liteapi`.

**Calls a day = destinations x windows x refreshes** (plus one content call a destination as an
over-allowance in the daily ceiling, and about six `data/hotels` calls a week in practice).

| Setting                                        | Rates calls a day | Worst case at $0.02 a call     |
| ---------------------------------------------- | ----------------: | ------------------------------ |
| 6 destinations x 3 windows x 3 a day (default) |            **54** | $1.08 a day, about $32 a month |
| one more destination                           |                +9 | +$0.18 a day                   |
| one more daily refresh                         |               +18 | +$0.36 a day                   |
| one more window                                |               +18 | +$0.36 a day                   |
| hourly (24 a day)                              |               432 | $8.64 a day (8 times)          |

Sandbox runs the same code with the same counts. The launch destinations are one constant
(`LAUNCH_DESTINATIONS`, owner to confirm).

**What a visitor reads** (`src/liteapi-snapshot/read.ts`): fresh (age at most twice the interval,
16 h by default) "Updated N hours ago"; aging "Prices last checked N hours ago"; missing (no row, a
window or party not refreshed, or expired) "Hotel prices are not loaded for these dates yet." with no
price; unknown (observed in the future) shows the price with no age claim. A sandbox key, or any
rate marked `test`, adds a visible "Test prices" note (owner answer Q2).

**Flights follow the same pattern** (Part 4). Migration `0014_liteapi_flights_snapshot.sql` adds
`liteapi_flights_snapshot`: one row per origin, destination, departure and return day, adults, currency and
cabin, holding the cheapest 30 validated offers (each with its own vendor `expiresAt`). The job
`liteapi.flights.refresh` (`src/liteapi-snapshot/flights-job.ts`) makes one `POST /flights/rates` call per run
through the same one `liteapi` limiter, and is registered, and its rounds scheduled, only with
`LITEAPI_SNAPSHOT_ENABLED`. Origins come from `LITEAPI_SNAPSHOT_ORIGINS` (default `BUD,VIE,PRG,LON`).
The live fetch (`src/providers/flights/liteapi.ts`) is reachable only from the worker; the reader
(`src/providers/flights/liteapi-snapshot.ts`, built for `FLIGHT_PROVIDER=liteapi`) reads the table, never shows an
offer past its own expiry, and on a missing row reads only the cached Aviasales one-way months with
`store.get` (never `loadAndStore`, never a live call). No entry means the route is unpriced. Run records reuse
`liteapi_refresh_runs` with the route as `ORIGIN-DESTINATION` in `destination_code`; hotels and flights
count their daily calls separately (`callsSince(since, job)`). Stored flight prices carry the line "Fares
change often. Check the airline before you book."

---

## 5. Data flow by kind

**Flights.** Aviasales Data API (`prices_for_dates` and `calendar`): cached price points from other
people's searches, labelled `indicative`, not bookable quotes. Search planning bounds the fan-out;
every call goes through a per-provider `Limiter` sized from `rateLimitPerMinute`; one failing call
degrades a search, it does not abort it. The front page reads the `discovery` cache, not the
provider.

**Stays.** Travelpayouts closed its hotel API on 2025-10-20, so no priced hotel feed exists. A trip
is assembled without a stay: `TripCandidate.hotel` is `HotelOffer | null` and `null` means nobody
priced one.

| Where                      | What a null stay does                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `core/trip/cost.ts`        | An `excluded` `hotel` line, amount zero. The total is flights (and transfer) only.                    |
| `core/trip/coverage.ts`    | Says "Flights only - stay not included". "All in" is said only when no line is excluded.              |
| `core/trip/constraints.ts` | Free cancellation, review score and beach distance are unproven; a `NO_STAY_PRICED` warning is added. |
| `core/trip/scoring.ts`     | Hotel factors take a neutral 0.5; data confidence drops.                                              |
| `search/assemble.ts`       | One candidate per flight with `hotel: null`. No flights still means no trip.                          |
| `search/orchestrator.ts`   | A hotel slot in `absent` mode is not called and not reported as an outage.                            |

`src/providers/stays/travelpayouts-links.ts` implements `StayProvider` for affiliate links only: its
offers carry a literal `price: null` (checked by `stayLinkOfferSchema`) and `searchStays` returns an
empty list. The link is `https://tp.media/r?marker=<AVIASALES_PARTNER_ID>&campaign_id=<...>&p=<program>&u=<encoded vendor search>`.
It needs `AVIASALES_PARTNER_ID`, `TRAVELPAYOUTS_HOTEL_PROGRAM_ID` and
`TRAVELPAYOUTS_HOTEL_CAMPAIGN_ID`; with any unset it returns `PROVIDER_UNAVAILABLE` and never
guesses an id. Enable with `STAY_PROVIDERS=travelpayouts-links`. The trip card, the destination page
(when dates are known) and `/stays` render it via `FindStayLink`, whose href is checked by
`buildStayLinkHandoff`. The Booking.com URL parameters were not verified against a live click.

Plugging in a priced feed (LiteAPI, Amadeus Self-Service, Booking.com Demand): two slots exist.
Trips ask a `HotelProvider` (`HOTEL_PROVIDER`) for `HotelOffer`s; `/stays` asks every `StayProvider`
in `STAY_PROVIDERS`. Write the adapter to the interface (`Result`, `Money`, explicit `null` for
unstated facts, `observedAt` on every offer), register it in `resolveHotelProvider` and/or `ADAPTERS`
in `src/providers/stays/registry.ts`, declare `metadata.mode` honestly, and test against recorded
fixtures. Once `searchHotels` returns offers, the stay line becomes `known` and the "Flights only"
statement disappears by itself. No such adapter exists.

**Weather.** Open-Meteo (keyless). A forecast when any day of the trip is within the 15-day horizon,
a climate average (three real past years) beyond it, labelled "Typical for these dates". The free
tier is scoped to non-commercial use; whether affiliate revenue counts is unresolved (see
`WHAT-I-NEED-FROM-YOU.md`).

**Places.** Wikidata (`PLACES_PROVIDER=wikidata`, the production default; keyless, CC0), in
`src/providers/places/wikidata.ts`. Places are ranked by sitelink count, a public count and not a
rating; there are no restaurants, prices or reviews, so `searchPlaces` answers an empty list and the
destination page's "cannot tell you yet" note keeps naming what is missing (photographs are dropped
from that note once a listed place has one). `loadThingsToDo` (`src/discovery/things-to-do.ts`) reads
the `places` cache and shows up to 30. Pictures come from Wikimedia Commons by file name and are
served from our own origin by `/api/places/image` (a Commons file name and one of two widths in; the
upstream address is built on the server, redirects are followed once and only to
`upload.wikimedia.org`, JPEG, PNG and WebP only, size-capped), so the visitor's browser contacts
neither Wikidata nor Wikimedia and `img-src` stays at `'self'`. Author and licence are read from the
Commons API and printed beside each picture. `mock` resolves to `absent` in production.

**Transfers.** No live adapter. In production the slot is `absent`. Partner links (section 9) answer
the transfer need.

**Currency.** `src/core/fx.ts` with ECB daily rates (`FX_PROVIDER=ecb`), table cached on
`globalThis`, last good table kept on a failed refresh.

---

## 6. Worker, jobs and housekeeping

`npm run worker` starts, in one process:

| Component              | Interval                                                             | Does                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Watch scheduler        | every 60 s                                                           | Finds due Travel Watches and enqueues `travel-watch.refresh`                                                                                            |
| `travel-watch.refresh` | per job                                                              | Re-prices a watch, records price history, detects a better deal, writes a notification, enqueues `notification.deliver`                                 |
| `notification.deliver` | per job                                                              | Sends a Web Push for a recorded notification; stamps `deliveredAt` only on real delivery                                                                |
| `cache.refresh`        | `PRICE_REFRESH_MINUTES`, the UTC date change, `PLACES_REFRESH_HOURS` | Section 4: prices, and pre-warming things to do                                                                                                         |
| Maintenance            | 6 h / 24 h                                                           | Deletes expired sessions (6 h); price history older than 90 days except each watch's cheapest ever, and provider request logs older than 30 days (24 h) |

**Health.** `GET /api/health` answers 200 with `status: ok` when the database (if configured) is
reachable and every _configured_ provider is healthy, and 503 with `degraded` otherwise. A slot that
is `absent` is configuration, not an outage: it is listed with status `absent` and never degrades the
status, so a production deployment with no hotel, transfer or stay source is healthy. A configured
provider that is down or degraded still degrades it. The rule is `summariseProviderHealth` in
`src/providers/health-summary.ts`; `/status` shows the same slots as "Absent".

At start the worker also sweeps due watches once. The web process and the worker must share
`DATABASE_URL` and `REDIS_URL`, and `QUEUE_DRIVER=bullmq`, or the web side enqueues into a queue the
worker cannot see (the worker warns when the driver is `memory`).

---

## 7. Email and notifications

**Email is transactional only (D14).** Three templates in `src/email/templates/transactional.ts`:
welcome (carries the verification link), password reset (1 hour link) and email change
confirmation. Nothing else is emailed; there is no digest, no alert email and no unsubscribe
machinery. Drivers: `console` (writes the link to the log; refused in production) and `resend`
(plain HTTPS `fetch` to `https://api.resend.com/emails`, 10 second timeout, no SDK; 429 is
`RATE_LIMITED`, 5xx `PROVIDER_UNAVAILABLE`, other 4xx `PROVIDER_ERROR`). The log carries status and
message id, never the key, recipient, subject or body. Sending is throttled per account (3 per hour)
and per client (10 per hour) by `SendThrottle`, in process memory, so the limit is per instance.
Failing to send never fails the action that triggered it.

**Notifications are push plus in-app.** The watch pipeline writes a `notifications` row the moment a
deal is detected; that row is the alert. The bell in the header reads it through
`loadNotificationFeed` (latest 30, unread count) via `/api/notifications`. Web Push is one way of
pointing at the row: it needs the VAPID pair, and dead subscriptions (404, 410) are dropped. A
failed push leaves the alert in the bell. Alert preferences (home airport, up to 12 destinations,
budget, date window, price-drop on/off) live in `alert_preferences` (migration 0008) and are edited
on the account page.

---

## 8. Flexible dates

`src/core/flex-dates.ts` (pure): given the chosen dates and the cheapest flight observed on each
nearby day, `flexOptions` returns, for each offset from `-windowDays` to `+windowDays`, the price,
the saving against the chosen day, and its freshness. The trip moves as a whole (same number of
nights). A day nobody priced is `unknown`: never an average of neighbours, never zero. A saving
exists only when both prices are known and in the same currency.
`windowDays` is `FLEX_DAYS` (default 3, at most 7). Prices come from `loadMonthDayPrices`
(section 4), so the strip and the price calendar share calls and cache entries. The strip is
`src/components/search/flex-dates-strip.tsx`, shown on the destination page and results.

---

## 9. Partners, hand-off and the Drive script

**Partner registry.** `src/booking/partners.ts` is the whole list as data: Intui (transfers), AirHelp
(flight compensation), Yesim and GigSky (eSIM). Categories for car rental, activities, insurance,
rail/bus, luggage and stay exist in the type; no offers are registered for them. An offer has **no
price field**: a partner quotes on its own site. Links must be `https` on `tpk.lv` or `tp.media`
(or a subdomain), with no credentials in the URL; the registry is validated when the module loads.
Promo codes (`activePromo`) are supported by the type and hidden after expiry; none are registered.
Offers render as our own components (`PartnerOfferCard`, `PartnerOfferRow`, `TripExtras`) with
`rel="sponsored"` and a disclosure that these are partner links. `src/booking/handoff.ts` checks
hrefs before they are rendered.

**Cookie consent and the Drive script.** The Travelpayouts Drive script from `https://emrldco.com`
loads only for a request that carries `voyagr-consent=accepted`. A banner asks once; the choice is
one word in a cookie (`accepted` or `declined`) that lasts 12 months, is `SameSite=Lax`, `Secure` in
production and readable by the banner, set by a server action (so Next's origin check is the CSRF
defence). `src/consent/` holds it: `cookie.ts` (the choice), `drive.ts` (`driveScriptSrc`, the one
function that decides whether and from where the script loads, and `driveCspOrigin`) and `csp.ts`.
`AffiliateDrive` renders the `<script>` tag server-side from that answer, with the request's CSP nonce,
so before a choice or after a decline there is no tag in the HTML and no request to `emrldco.com`.
`src/proxy.ts` builds the CSP per request from the same answer: only a consenting request has
`https://emrldco.com` in `script-src`, `style-src` and `connect-src`, `https://www.travelpayouts.com`
in `connect-src` (the script's auth check) and `blob:` in `worker-src` (its worker). Everyone else
gets a policy that does not mention either host. Those are the only third-party origins the CSP
ever names. `img-src` is `'self' blob: data:`.
Accepting reloads the page, because a CSP belongs to the document response and a refreshed render
cannot widen an already-loaded page. The script loads in real production only, not with
`ALLOW_MOCK_IN_PRODUCTION`. `DRIVE_TEST_STUB` (test only, honoured only together with
`ALLOW_MOCK_IN_PRODUCTION`) swaps the vendor URL for the same-origin stub `/api/test/drive-stub`, so the
end-to-end suite can prove the gating without contacting a third party. Partner link-outs
(`tpk.lv`, `tp.media`) are plain links and need no consent.

**Security headers.** HSTS, frame-ancestors and Permissions-Policy are static in `next.config.ts`;
the CSP is per request in `src/proxy.ts` because `script-src` carries a nonce and no
`'unsafe-inline'`. `style-src` keeps `'unsafe-inline'` because components set CSS custom properties
through style attributes, which the nonce does not cover. See `docs/security.md`.

---

## 10. Trip hub

Routes `/trips` and `/trips/[id]` (migration 0009: `trips`, `trip_members`, `plan_items`,
`trip_expenses`, `emergency_contacts`).

- **Plan.** Items (flight, stay, transfer, eSIM, insurance, activity and so on) added by the user.
  Nothing is added silently and nothing is marked booked unless the user says so. A place added from "Things to do" keeps its Wikipedia or Wikidata page as the item's link: `isPlaceSourceUrl` (`src/trip-hub/place-url.ts`, https and an exact host, no credentials) is checked when it is saved and again when the plan renders it, as a plain `noopener noreferrer` link that opens in a new tab and is not counted as an affiliate link. A service method
  and server action to add a partner offer to a plan exist, and an "Add to my plan" control is on
  the results page for signed-in users; its coverage elsewhere has not been reviewed in a browser.
- **Expenses.** Tricount-style. All arithmetic is in `src/core/expenses/` on `Money`: split,
  per-currency balances, settle-up transfers, conversion only through `src/core/fx.ts`. Tests assert
  conservation (shares sum to the amount; balances sum to zero).
- **Access.** `TripHubService` decides access, not the pages: every method takes the session user's
  id and starts by proving membership; a non-member gets `NOT_FOUND`, the same as a missing trip.
  Only the owner deletes the trip or changes members. A non-UUID id is "not found" before any query, and
  there are ceilings: 100 trips per account, 30 people per trip and 20 emergency contacts per account
  (the actions turn a limit into a message, not a 500).
- **Emergency numbers.** From Wikidata property P2852 (CC0), numbers read from P1329, retrieved
  2026-11-14, written by `node scripts/build-emergency.mjs` to
  `src/trip-hub/emergency.generated.json` and schema-checked at load. A country with no entry shows
  "No verified number on file"; there is no fallback to 112 or 911. Which service a number reaches
  is not claimed. Never model-written.
- **Not built (D17 follow-ups):** invitations by link or email, a currency picker, and promo codes
  on partner offers. `addMember` exists in the service; no invite flow was verified.

---

## 11. Migrations

`src/db/migrations/0001` to `0009`, applied by `npm run db:migrate` (`scripts/migrate.mjs`): files
in name order, each recorded in `schema_migrations`, already-applied files skipped. Forward-only:
there is no down migration and no rollback tooling.

| File                                | Adds                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `0001_init.sql`                     | users, preferences, searches, watches, price history, notifications, push subscriptions, provider requests |
| `0002_accounts.sql`                 | credentials, sessions                                                                                      |
| `0003_saved_search_destinations`    | destination columns on saved searches                                                                      |
| `0004_notification_url.sql`         | `notifications.url`                                                                                        |
| `0005_email_verification.sql`       | verification tokens, `users.email_verified_at`                                                             |
| `0006_password_reset.sql`           | password reset tokens                                                                                      |
| `0007_email_change.sql`             | email change tokens                                                                                        |
| `0008_alert_preferences.sql`        | alert preferences                                                                                          |
| `0009_trip_hub.sql`                 | trips, members, plan items, expenses, emergency contacts                                                   |
| `0013_liteapi_snapshot.sql`         | LiteAPI snapshot: hotels, rates by window, refresh runs (section 4.x)                                      |
| `0014_liteapi_flights_snapshot.sql` | LiteAPI flights snapshot: offers by route and window (section 4.x)                                         |

0008 and 0009 have not been run against a real Postgres.

---

## 12. The shared persistent globe

The home page and `/explore` are the same globe. Route groups under `src/app/`:

| Group      | Pages                                                    | Layout                                                          |
| ---------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `(stage)`  | `/` and `/explore`                                       | Mounts `StageHost` once; the pages only give it a slot and data |
| `(column)` | account, trips, watches, status, privacy, terms, offline | Narrow column pages                                             |
| `(auth)`   | sign in, sign up, forgot and reset password              | Split layout with an illustration                               |

`/destinations/[code]` and `/stays` sit outside the groups.

How it works (`src/components/discovery/stage-*.ts(x)`):

- `stage-store.ts` is a module-level store read with `useSyncExternalStore`. It holds the data
  (pins, routes, home airport, selected country), the variant (`stage` or `explorer`), the slot (the
  box the globe should fill) and a `pending` flag.
- `stage-slot.tsx` (a page's box) and `stage-sync.tsx` (a page's data) publish into it.
  `stage-host.tsx`, mounted by the layout, owns the one MapLibre instance and places it over the
  current slot.
- When the slot changes between the hero and the explorer column, the host plays a 420 ms FLIP of
  the globe's own box (uniform scale, `--ease-out-expo`), skipped under reduced motion.
- The host turns plain links and plain GET forms that target `/` or `/explore` into client-side
  `router.push` navigations, so a search no longer rebuilds the globe. While a navigation is
  pending, pins dim and a 2 px progress line runs along the top, until the next page's data lands
  (give-up after 20 s).
- The canvas is decoration; every fact on it is also a link or card in the DOM.
- Geo files in `public/geo/` are immutable and versioned (the service worker caches them forever by
  URL); never rewrite one in place. The globe contacts no origin but ours.

---

## 13. Imagery pipeline

- **Destination pictures:** 16 AI-generated illustrations. Masters in `assets/destination-masters/`
  (1024 px wide), exported by `node scripts/export-destination-images.mjs` to
  `public/img/destinations/` as AVIF and WebP at 480, 768 and 1024 px plus a blur placeholder and a
  manifest. `DestinationPicture` prefers the shipped illustration, then the imagery provider's
  photograph (Wikimedia, `IMAGERY_PROVIDER`, served through `/api/imagery/[code]` on our origin),
  then a tile in the place's own colour. An illustration is labelled "AI-generated illustration"
  where it is shown; it is not a photograph of the place.
- **Globe surface:** NASA Earth Observatory Blue Marble Next Generation (topography and bathymetry,
  public domain), reprojected and cut into 256 px WebP tiles for zoom 0 to 4 by
  `scripts/build-earth-texture.mjs`, committed under `public/geo/earth/v1/`. City lights come from
  NASA's Black Marble composite via `scripts/build-city-lights.mjs`. Nothing reaches NASA at runtime.
  The credit "Imagery: NASA Earth Observatory / Blue Marble" is shown on the globe stage.
- **Vector geo:** Natural Earth via `scripts/build-geo.mjs`. Never hand-edited.
- **Not built:** hero video loops; upscaled masters (they are 1024 px wide).

---

## 14. Honesty on the page: no provenance badges (D20)

At the owner's request, chips such as "Indicative price", "Demo data" and the provenance badges are
removed from every surface (the components `ProvenanceBadge`, `SourceStrip` remain in
`src/components/ui/` but are not rendered on any page). Provenance stays in the data model
(`DataProvenance`, `metadata.mode`). Honesty is carried by:

- "from" on prices;
- the "Updated N min ago" line (`UpdatedAgo`, from `observedAt`);
- the footer sentence: "Prices and availability are observed from providers and can change.
  Nothing here is a booking.";
- wording that names what a total excludes ("Flights only - stay not included");
- "Typical for these dates" on weather beyond the forecast horizon;
- an `absent` slot answering nothing instead of a number;
- the disclosure on partner links.

The `/status` page still shows provider slots, cache warmth and per-provider call figures.

---

## 15. Go-live decision (2026-11-14)

Voyagr goes live. Mocks stay for tests and local development only. A production process refuses to
start on a mock flight, weather or email provider, and never shows a fixture price. All decisions
D1 to D20 are in `docs/finish-plan.md` with their reasons. The deployment itself has not happened;
see `SETUP-CHECKLIST.md` and `docs/runbook.md`.

## 15a. Google Flights sidecar (owner-approved exception, off by default)

Aviasales is a sparse cache of other people's searches, so on 2026-11-16 the owner approved a second
flight source with eyes open: Google Flights, scraped by the unofficial `fast-flights` library. It
breaks `docs/provider-policy.md` (unclear terms; Google's do not permit automated access) and is
recorded there as an exception. Nothing reaches it unless `GOOGLE_FLIGHTS_SIDECAR_URL` is set and the
registry is told to select it.

```
search -> CombinedFlightProvider -> aviasales adapter        -> Travelpayouts Data API
                                 -> google-flights adapter   -> sidecar (127.0.0.1:8765) -> Google
```

- **Sidecar** (`services/google-flights/`): Python, standard-library HTTP server around
  `fast-flights==3.1.0`. Loopback only unless a key is set; `X-Voyagr-Sidecar-Key` shared secret;
  one upstream request per 3 s per process; 10 minute in-memory cache; never logs a query string.
- **Adapter** (`src/providers/flights/google-flights.ts`): returns `Result`, schema-checks every row
  (`googleFlightsRowSchema`), parses the price string to exact minor units
  (`price-text.ts`), declares `indicative` and 10 calls a minute. The library lists only _outbound_
  itineraries for a return, so a return is searched as two one-way queries and paired by
  `pairOneWayFares`: every result is `ticketing: 'two_one_way'`. The library states no flight number
  (shown as an em dash), no baggage, and no expiry (`expiresAt` is `null`).
- **Combiner** (`src/providers/flights/combined.ts`): `combineFlightOffers` is pure. Same airports,
  stops and local departure/arrival within 5 minutes on both legs is one itinerary; the cheaper
  price wins (an equal price prefers one return ticket over two singles) and `reportedBy` lists
  every provider that had it. A different currency goes through `src/core/fx.ts` or is dropped with
  a named reason. `CombinedFlightProvider` gives each source its own limiter from the search's
  `LimiterPool` and degrades when one fails.
- **What it cannot do:** answer a month (no day-price calendar, no `searchOneWay`), name a flight
  number, promise a price (there is no quote, only a listing) or keep working: a block shows up as
  `PROVIDER_UNAVAILABLE` ("Google Flights is blocking the scraper"). It was blocked on its first
  real run, by Google's EU cookie-consent page; see `docs/runbook.md`, section 5a.

---

## 16. Cross-cutting concerns

**Configuration.** `src/lib/env.ts` is the only module that reads `process.env` (apart from the CSP
proxy reading `NODE_ENV`, and scripts). `describeEnv()` reports secrets as booleans.

**Logging.** `src/lib/logger.ts` wraps pino; redaction is central.

**Errors.** `src/lib/errors.ts`: stable code, HTTP status, `publicMessage` separate from `context`
and `cause`. `toProblemDetails()` is client-safe.

**Concurrency.** One `Limiter` per provider from a `LimiterPool`, sized from the vendor's declared
`rateLimitPerMinute`; a search has a `maxProviderCalls` ceiling.

---

## 17. Absent by shape

Multi-country trips: `TripCandidate` models one origin, one destination, one flight and at most one
hotel. Ground transport such as car rental, rail and ferry would be a new provider kind. Also not
built: booking, payments, a priced hotel feed, an AI adapter, rate limiting on the search page,
audit logging. See `docs/security.md` and `SETUP-CHECKLIST.md`.
