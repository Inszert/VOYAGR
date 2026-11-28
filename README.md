# Voyagr

Voyagr is a travel deal hunter. It searches for complete trips (flights, a stay where one can be
priced, weather, extras) instead of isolated flights, keeps checking prices in the background, and
tells you when a materially better combination appears. Every number a person sees is computed by
deterministic code in `src/core/`; a language model, where one is used, only handles words.

State of the repository: branch `feat/mcp-only-flights` (not pushed; `main` is untouched). It has
never been deployed. The decision of record (2026-11-14) is that
production never serves mock data; see [`docs/finish-plan.md`](docs/finish-plan.md).

## What works today, and what needs a key

| Area                         | With no keys (local dev)               | With a key or account                                                |
| ---------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| Search, trip cost, ranking   | Works on deterministic fixtures        | Real flight prices come from Kiwi.com's MCP server (no key needed)   |
| Flight prices                | Kiwi MCP by default (no key)           | Kiwi.com offers, cached 12 hours; the legacy sources are off         |
| Stays                        | Fixture stays                          | Affiliate links only (no price); a priced hotel feed does not exist  |
| Weather                      | Open-Meteo (keyless, live)             | Same; the free tier is non-commercial, see `docs/provider-policy.md` |
| Currency conversion          | ECB daily rates (keyless, live)        | Same                                                                 |
| Accounts, watches, alerts    | In memory, lost on restart             | Postgres (`DATABASE_URL`)                                            |
| Background price refresh     | Not running                            | Worker plus Redis (`REDIS_URL`, `QUEUE_DRIVER=bullmq`)               |
| Email                        | Logged to the console                  | Resend (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, verified domain)  |
| Push notifications           | Off                                    | VAPID key pair (`npm run vapid:generate`)                            |
| In-app notification bell     | Works for signed-in users              | Same                                                                 |
| Trip hub (plan, expenses)    | Works, in memory                       | Persisted with Postgres (migration 0009)                             |
| AI                           | Deterministic mock only                | `AI_PROVIDER=anthropic` is rejected at startup (not implemented)     |
| Transfers, priced hotels     | Fixtures in dev; absent in production  | No adapter exists                                                    |
| Things to do and photographs | Fixtures in dev                        | Wikidata and Wikimedia Commons (keyless; the production default)     |
| Cookie consent               | Banner; the Drive script is not loaded | The Travelpayouts Drive script loads only after "accept"             |

In production (`NODE_ENV=production`) mock providers are refused at startup unless
`ALLOW_MOCK_IN_PRODUCTION=true`, which exists only for the end-to-end suite. Slots with no live
adapter (priced hotels, transfers) resolve to `absent`; places resolve to Wikidata, and the cost line is `excluded`,
not zero.

Not verified: real email delivery, and migrations 0008, 0009 and 0016 to 0019 against a real
Postgres. See `STATUS.md`, "Not verified yet".

## Flight source: Kiwi.com's MCP server

`FLIGHT_PROVIDER` defaults to `kiwi-mcp`. Flights come from the Kiwi.com MCP server at
`https://mcp.kiwi.com`, which needs no key. The host is fixed in code
(`src/providers/mcp/constants.ts`); nothing a user sends can change it.

- **12-hour read path** (`src/providers/flights/kiwi-read-path.ts`). A lookup reads the cache, then
  the Postgres table `kiwi_offers`, and only when both are older than 12 hours (or empty) makes one
  MCP call. If that call fails, the newest stored offers are shown labelled with their age ("checked
  14 h ago"); with nothing stored the answer is an honest "no data". A price is refreshed only when
  it is older than 12 hours and someone asked for it.
- **Guarded client.** 5 second timeout per call, bounded retries, a circuit breaker, at most 2
  calls in flight, about one call a second, and a daily call budget (`KIWI_MCP_DAILY_BUDGET`,
  default 200, counted per process).
- **The legacy flight sources** (`aviasales`, `liteapi`, `live`) are still in the tree, but a
  production build refuses them unless `ALLOW_LEGACY_FLIGHT_PROVIDERS=true`. `mock` is still
  governed by `ALLOW_MOCK_IN_PRODUCTION`. A local `.env` that names a legacy provider makes a
  production build fail; set `FLIGHT_PROVIDER=kiwi-mcp` in the environment.
- **Kiwi's terms are not verified.** Nobody has checked whether they allow this commercial,
  automated use. The owner must check them before any public launch (`docs/provider-policy.md`).
- **Booking links** are Kiwi's own `bookingUrl`. They are not Voyagr affiliate links.

Running it: `npm run dev` (or `npm run build` then `npm start`) for the web process, and
`npm run worker` for the worker. The worker runs the watch refresh, the cache refresh and the
nightly cleanup of past-departure offers (03:00 UTC by default, `CLEANUP_UTC_HOUR`). Details are in
`docs/runbook.md`.

## Screenshots

Captured on 2026-11-15 from a development build running on fixture data (the `API / MOCK` switch
in the header only appears outside production). Prices in them are fixtures, not real fares. The
destination shot shows "Updated 303 d ago" because fixture timestamps are old; that is a fixture
artefact. The home and sign-in shots were taken on the day of the shared-globe commit; the explore
and destination shots slightly earlier, before the final end-to-end fixes.

| Page                               | File                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Home: globe, search bar            | [`docs/screenshots/home.jpg`](docs/screenshots/home.jpg)               |
| Explore: results (top of the page) | [`docs/screenshots/explore.jpg`](docs/screenshots/explore.jpg)         |
| Destination: Antalya               | [`docs/screenshots/destination.jpg`](docs/screenshots/destination.jpg) |
| Sign in                            | [`docs/screenshots/sign-in.jpg`](docs/screenshots/sign-in.jpg)         |

![Home](docs/screenshots/home.jpg)

## Quick start

Needs Node 24.15 or newer (`engines.node`, `.node-version`, and `engine-strict=true` in `.npmrc`
make an older Node a hard failure).

```bash
npm ci
cp .env.example .env     # optional; every value has a working default
npm run dev              # http://localhost:3000
```

`next dev` reads `.env.local` and `.env`. `npm run worker` and `npm run db:migrate` read `.env`
only, so use that name if you want all three to see the same values.

The worker is a separate process. Locally it is optional; without Redis its cache refreshes go to
its own memory and no page sees them (it logs a warning saying so). A page never runs the
full-catalogue price search itself: it reads what the worker cached (yesterday's entry, labelled, just
after 00:00 UTC) and shows "Prices are loading" when nothing is cached yet. Run the worker to fill it.

```bash
npm run worker           # background jobs: watches, notifications, cache refresh
npm run db:migrate       # only when DATABASE_URL points at a real database
```

For a real deployment follow [`SETUP-CHECKLIST.md`](SETUP-CHECKLIST.md) and
[`docs/runbook.md`](docs/runbook.md).

## Environment variables

Declared in `src/lib/env.ts`, which is the only file that reads `process.env`. An invalid value
fails at startup and names the variable, never its value. Unset optional values turn a capability
off; they do not crash the app. The "Production" column says what a real deployment needs.

| Variable                          | Purpose                                                         | Default                           | Production                                          |
| --------------------------------- | --------------------------------------------------------------- | --------------------------------- | --------------------------------------------------- |
| `NODE_ENV`                        | `development`, `test`, `production`                             | `development`                     | `production` (set by `next start`)                  |
| `NEXT_PUBLIC_APP_URL`             | Origin used in links inside emails                              | `http://localhost:3000`           | Required: refused if unset or localhost             |
| `PUBLIC_BASE_URL`                 | Origin for sitemap and robots; empty sitemap if unset           | unset                             | Recommended                                         |
| `LOG_LEVEL`                       | `fatal` to `trace`                                              | `info`                            | Optional                                            |
| `DATABASE_URL`                    | Postgres connection string                                      | unset (in-memory)                 | Required                                            |
| `DATABASE_SSL`                    | TLS to Postgres                                                 | `false`                           | Usually `true` on a managed host                    |
| `DATABASE_POOL_MAX`               | Pool size, 1 to 100                                             | `10`                              | Optional                                            |
| `REDIS_URL`                       | Shared cache and BullMQ queue                                   | unset                             | Required (worker and web must share it)             |
| `QUEUE_DRIVER`                    | `memory` or `bullmq`; `bullmq` needs `REDIS_URL`                | `memory`                          | `bullmq`                                            |
| `PRICE_REFRESH_MINUTES`           | Worker cache refresh interval, 1 to 1440                        | `30`                              | Optional; see quota maths in `docs/architecture.md` |
| `PLACES_REFRESH_HOURS`            | Worker pre-warm of things to do, 1 to 720 hours; 40 a round     | `168`                             | Optional; keep long (Wikidata etiquette)            |
| `FLEX_DAYS`                       | Days either side shown by the flexible-dates strip, 0 to 7      | `3`                               | Optional                                            |
| `AI_PROVIDER`                     | `mock`; `anthropic` is rejected until an adapter exists         | `mock`                            | Leave unset                                         |
| `AI_MODEL`                        | Model name for a future adapter                                 | `claude-sonnet-5`                 | Not used                                            |
| `ANTHROPIC_API_KEY`               | Key for a future adapter                                        | unset                             | Not used                                            |
| `FLIGHT_PROVIDER`                 | `kiwi-mcp`, `mock`, `live`, `aviasales`, `liteapi`              | `kiwi-mcp`                        | `kiwi-mcp`; legacy values and `mock` are refused    |
| `ALLOW_LEGACY_FLIGHT_PROVIDERS`   | Lets production use `aviasales`, `liteapi` or `live`            | `false`                           | Leave unset                                         |
| `KIWI_MCP_DAILY_BUDGET`           | Kiwi MCP calls per process per UTC day, 1 to 100000             | `200`                             | Optional                                            |
| `CLEANUP_UTC_HOUR`                | UTC hour of the worker's nightly cleanup, 0 to 23               | `3`                               | Optional                                            |
| `AVIASALES_API_TOKEN`             | Travelpayouts token (secret), legacy flight source              | unset                             | Only with `aviasales` and the legacy flag           |
| `AVIASALES_PARTNER_ID`            | Affiliate marker in outbound links (public)                     | unset                             | Required for affiliate links                        |
| `GOOGLE_FLIGHTS_SIDECAR_URL`      | Google Flights scraper sidecar (unofficial); off unless set     | unset                             | Off by default                                      |
| `GOOGLE_FLIGHTS_SIDECAR_KEY`      | Shared secret the sidecar expects (secret)                      | unset                             | Only with the sidecar                               |
| `TRAVELPAYOUTS_HOTEL_PROGRAM_ID`  | Hotel programme for "Find a stay" links (public)                | unset                             | Needed for `travelpayouts-links`                    |
| `TRAVELPAYOUTS_HOTEL_CAMPAIGN_ID` | Hotel campaign for those links (public)                         | unset                             | Needed for `travelpayouts-links`                    |
| `STAY_PROVIDERS`                  | Comma list: `mock`, `absent`, `travelpayouts-links`             | `mock` (`absent` in production)   | `travelpayouts-links` for link-out stays            |
| `HOTEL_PROVIDER`                  | Priced hotels for trip totals: `mock`, `live`, `absent`         | `mock` (`absent` in production)   | `absent` (no priced adapter exists)                 |
| `WEATHER_PROVIDER`                | `mock`, `live`, `open-meteo`                                    | `open-meteo` (`mock` under test)  | `open-meteo`                                        |
| `TRANSFER_PROVIDER`               | `mock`, `live`, `absent`                                        | `mock` (`absent` in production)   | `absent`                                            |
| `PLACES_PROVIDER`                 | `mock`, `live`, `absent`, `wikidata`                            | `mock` (`wikidata` in production) | `wikidata`                                          |
| `FX_PROVIDER`                     | `mock` (no rates) or `ecb`                                      | `ecb`                             | `ecb`                                               |
| `IMAGERY_PROVIDER`                | `wikimedia` or `none` (photo fallback when no illustration)     | `wikimedia`                       | Optional                                            |
| `EMAIL_PROVIDER`                  | `console` or `resend`                                           | `console`                         | `resend`; `console` makes every send fail           |
| `RESEND_API_KEY`                  | Resend API key (secret)                                         | unset                             | Required with `resend`                              |
| `EMAIL_FROM`                      | Sender                                                          | `Voyagr <hello@voyagrfind.com>`   | Must be on a verified Resend domain                 |
| `EMAIL_REPLY_TO`                  | Reply-to address                                                | unset                             | Optional                                            |
| `EMAIL_POSTAL_ADDRESS`            | Postal address in email footers; a visible placeholder if unset | unset                             | Optional                                            |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`    | Web Push public key                                             | unset (push off)                  | Needed for push                                     |
| `VAPID_PRIVATE_KEY`               | Web Push private key (secret)                                   | unset (push off)                  | Needed for push                                     |
| `VAPID_SUBJECT`                   | `mailto:` contact for push services                             | `mailto:dev@example.invalid`      | Set your own                                        |
| `DATA_SOURCE_SWITCH`              | Show the runtime API/MOCK switch                                | unset (on outside production)     | Leave unset                                         |
| `ALLOW_MOCK_IN_PRODUCTION`        | Lets a production build serve fixtures                          | `false`                           | Never set in a real deployment                      |
| `DRIVE_TEST_STUB`                 | Test only: Drive script from a same-origin stub                 | `false`                           | Never set; needs `ALLOW_MOCK_IN_PRODUCTION` anyway  |

Secrets (never logged): `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `AVIASALES_API_TOKEN`,
`GOOGLE_FLIGHTS_SIDECAR_KEY`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY`.

## Scripts

| Script                   | Does                                                                           |
| ------------------------ | ------------------------------------------------------------------------------ |
| `npm run dev`            | Development server (copies the MapLibre worker first)                          |
| `npm run build`          | Production build (copies the MapLibre worker first)                            |
| `npm start`              | Serve the production build                                                     |
| `npm run worker`         | Background worker as its own process; reads `.env`                             |
| `npm run db:migrate`     | Apply SQL migrations; reads `.env`                                             |
| `npm test`               | Unit and component tests (Vitest)                                              |
| `npm run test:watch`     | The same, in watch mode                                                        |
| `npm run test:coverage`  | Tests with coverage                                                            |
| `npm run test:db`        | Postgres repository contract suite (needs `TEST_DATABASE_URL`)                 |
| `npm run test:e2e`       | Playwright against a production build                                          |
| `npm run test:e2e:ui`    | Playwright UI mode                                                             |
| `npm run e2e:install`    | Install Playwright's Chromium                                                  |
| `npm run lint`           | ESLint                                                                         |
| `npm run lint:fix`       | ESLint with fixes                                                              |
| `npm run format`         | Prettier, write                                                                |
| `npm run format:check`   | Prettier, check                                                                |
| `npm run typecheck`      | `tsc --noEmit`                                                                 |
| `npm run verify`         | format check, lint, typecheck, test, build                                     |
| `npm run check:calendar` | Probe the Aviasales calendar for a route (`scripts/check-calendar-prices.mjs`) |
| `npm run vapid:generate` | Print a Web Push key pair                                                      |
| `npm run icons:generate` | Regenerate PWA icons                                                           |

Data-build scripts, run by hand and committed with their output: `scripts/build-geo.mjs`,
`build-airports.mjs`, `build-earth-texture.mjs`, `build-city-lights.mjs`, `build-emergency.mjs`,
`export-destination-images.mjs`. Two of them import `sharp`, a dev dependency.

## Testing

```bash
npm test                                    # unit and component
npm run test:e2e                            # Playwright, production build, desktop and phone
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e  # use a locally installed Chrome
npm run test:e2e -- --workers=4             # fewer workers if the globe makes the suite flake
npm run verify                              # run before calling anything done
```

Numbers and details: [`docs/testing.md`](docs/testing.md).

## Project layout

```
src/
  core/            Pure domain logic: money, trip cost/constraints/scoring, dates, fx, freshness,
                   flex-dates, expenses (shared-expense arithmetic)
  search/          Search planning, orchestration, assembly, day prices (price calendar)
  discovery/       The globe's data: countries, routes, snapshot, stage loader
  providers/       Adapters behind interfaces, registry, mock policy, absent slots
  cache/           Cache store (memory, Redis), read-through, refresh targets and job, places pre-warm
  worker/          The worker process entry and maintenance sweeps
  queue/           Job contract, in-process and BullMQ drivers
  watches/         Travel Watch refresh and scheduler
  notifications/   Web Push channel, in-app feed, alert preferences
  email/           Provider interface, console and Resend drivers, templates
  booking/         Partner registry and link hand-off checks
  trip-hub/        Trips, plan items, expenses service, emergency data
  auth/            Accounts, sessions, throttles, token flows
  ai/              AI interface, guardrails, mock provider
  db/              Repository interfaces, memory and Postgres implementations, migrations
  lib/             env, logger, errors, Result
  components/      ui/ (design system), discovery/ (globe), home/, search/, destination/, partners/
  app/             Next.js App Router: (stage), (column), (auth) route groups, api/
  consent/         The consent cookie, the Drive script decision and the CSP built from it
  proxy.ts         Per-request CSP nonce, and the CSP's Drive origin only for a consenting request
scripts/           Data builds, worker launcher, migration runner
tests/e2e/         Playwright specs and support helpers
```

## Documentation

| Document                                                         | Contents                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| [`docs/PRODUCT-SPECIFICATION.md`](docs/PRODUCT-SPECIFICATION.md) | The product. Source of truth.                         |
| [`docs/architecture.md`](docs/architecture.md)                   | How it is built, caching, data flow, go-live decision |
| [`docs/runbook.md`](docs/runbook.md)                             | Running web and worker, cache, quota, email, deploy   |
| [`SETUP-CHECKLIST.md`](SETUP-CHECKLIST.md)                       | Going-live checklist                                  |
| [`WHAT-I-NEED-FROM-YOU.md`](WHAT-I-NEED-FROM-YOU.md)             | Accounts, keys and DNS the owner must supply          |
| [`docs/finish-plan.md`](docs/finish-plan.md)                     | Decision log D1 to D20                                |
| [`docs/design-direction.md`](docs/design-direction.md)           | Design direction, with what was and was not built     |
| [`DESIGN.md`](DESIGN.md)                                         | Tokens as they exist in `globals.css`                 |
| [`docs/design-system.md`](docs/design-system.md)                 | Components and accessibility rules                    |
| [`docs/testing.md`](docs/testing.md)                             | Testing strategy and current numbers                  |
| [`docs/security.md`](docs/security.md)                           | Security baseline and known gaps                      |
| [`docs/provider-policy.md`](docs/provider-policy.md)             | Status of every data provider                         |
| [`docs/deployment-checklist.md`](docs/deployment-checklist.md)   | Earlier deployment notes                              |
| [`progress.md`](progress.md), [`STATUS.md`](STATUS.md)           | History and current state                             |

## Licence

Not yet chosen.
