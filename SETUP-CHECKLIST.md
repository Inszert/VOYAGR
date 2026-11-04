# Voyagr — setup and deployment checklist

Rewritten 3 November 2026. The previous version of this file was generated on 18 September 2026,
when the repository held `docs/PRODUCT-SPECIFICATION.md` and nothing else — no source code, no
`package.json`, one commit. Every decision it listed as open has since been made and built; keeping
that version around was actively misleading about what exists today. This version is grounded in
the actual code: `src/lib/env.ts` (the one place every environment variable is declared), the
scripts in `package.json`, `/api/health`, and this session's updates to `docs/security.md` and
`docs/provider-evaluation.md`.

Source of truth for the decisions, not this file: `progress.md` for what is built, `docs/implementation-plan.md`
for what comes next, `docs/provider-evaluation.md` for why no paid provider is configured by default.

---

## The one rule that decides most of the rest

**Zero paid search API cost, ever** — the project owner's hard constraint, documented in
`docs/provider-evaluation.md`. It rules out every commercial flight/hotel vendor regardless of
their terms, and it is why the two live provider options below (Aviasales, Open-Meteo) are the ones
that exist rather than Duffel, Amadeus, Booking.com or Hotelbeds. Hosting and a domain may cost
money; a search must not.

## Runs with nothing configured

`npm install && npm run dev` works with **no `.env` file at all**. Every one of the following
degrades to a safe default rather than crashing the app:

| Capability | Default | What you lose without it |
| --- | --- | --- |
| Database | In-memory repositories | Data does not survive a restart. |
| Background jobs | In-process queue | A worker restart forgets in-flight jobs. |
| AI | Deterministic mock provider | No real natural-language parsing or itinerary wording. |
| Flights / hotels / weather / transfers / places | Deterministic mock fixtures | No real prices - and the UI says so on every surface that shows money. |
| Destination photographs | Wikimedia (needs no key) | Set `IMAGERY_PROVIDER=none` to turn this off too. |
| Web Push | Disabled | No browser notifications; watches still work, you just will not be pushed one. |

`src/lib/env.ts` is the only module allowed to read `process.env`; every variable below is declared
there with a Zod schema, and an invalid value fails loudly at startup rather than silently.

## To run a real database and queue

| Variable | Required for | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Postgres persistence | `npm run db:migrate` applies `src/db/migrations/*.sql`. Unset = in-memory. |
| `DATABASE_SSL` | TLS to that database | `true`/`false`, default `false`. Turn on in production. |
| `DATABASE_POOL_MAX` | Connection pool size | Default 10. |
| `REDIS_URL` | A shared queue across processes | Unset = in-process queue, fine for one instance, not for several. |
| `QUEUE_DRIVER` | `memory` (default) or `bullmq` | `bullmq` needs `REDIS_URL`. |

Running the worker as its own process: `npm run worker` (reads `.env` if present). It re-prices
Travel Watches on a schedule, records price history, detects materially better deals, and sweeps
expired sessions and old price/provider-request rows (`src/worker/maintenance.ts` - 90 days for
price history except the cheapest observation ever seen, 30 days for provider request logs, every
6 hours for expired sessions). The web process and the worker process must point at the **same**
`DATABASE_URL` and `REDIS_URL` - an in-memory queue is per-process, and a worker that cannot see the
web process's jobs is not wired up, not degraded.

## To turn on a real (free) flight or weather source

| Variable | Turns on | What it actually is |
| --- | --- | --- |
| `FLIGHT_PROVIDER=aviasales` + `AVIASALES_API_TOKEN` | Travelpayouts Data API | Free, real, but **cached price points from other people's searches, not a quote for this one** - labelled `indicative`, never `live`. Direct flights only. |
| ~~`FLIGHT_PROVIDER=duffel`~~ | Nothing - **removed, 2026-11-04** | Duffel is a paid, partner-gated vendor, **prohibited outright** under the project's zero-billing policy - not merely "off by default." `FLIGHT_PROVIDER` no longer has a `'duffel'` value to set it to; the adapter code is kept at `src/providers/flights/duffel.ts` purely as a historical reference and is not imported by the registry. See `docs/provider-policy.md`. |
| `WEATHER_PROVIDER=open-meteo` | Open-Meteo | Free, keyless, no card. Real forecast within 15 days; a climatology normal reconstructed from 3 real past years beyond that. One open question, unresolved: Open-Meteo's free tier is scoped to "non-commercial use" and does not define that boundary publicly - ask them before this product earns revenue. |
| `HOTEL_PROVIDER`, `TRANSFER_PROVIDER`, `PLACES_PROVIDER` | Nothing live exists | **No free hotel source exists at all** - every candidate researched is a one-time trial-credit vendor or a scraping reseller, both ruled out. These stay `mock`; setting them to anything else is a hard error at startup (`ProviderRegistry` refuses to silently fall back to fixtures). |

Setting any `*_PROVIDER` to `live` without an implemented adapter, or to a named provider without
its required token, fails at process startup with a clear message - never a silent fallback to
mock data in production.

## To turn on push notifications

```
npm run vapid:generate
```

writes a public/private key pair. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (safe to expose, hence the
prefix) and `VAPID_PRIVATE_KEY` (never expose), plus `VAPID_SUBJECT` (a `mailto:` address, default
is a placeholder - a real deployment should set its own).

## To turn on real AI reasoning

`AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, `AI_MODEL` (default `claude-sonnet-5`). Guardrails in
`src/ai/guardrails.ts` apply regardless of provider: generated prose is scanned for figures absent
from its source facts and discarded if it invents one. The model is never the source of truth for a
price, a total or an eligibility decision - see `docs/architecture.md` section 1.

## Health and verification

- `GET /api/health` - reports booleans (`database`, `redis`, `backgroundJobs`, `webPush`, `ai`,
  `providersFullyMocked`) and per-provider status, never a connection string or a key. `200` when
  healthy, `503` when a configured dependency is unreachable. Cached nowhere (`Cache-Control:
no-store`).
- `npm run verify` - format, lint, typecheck, unit/component tests, production build. Run this
  before calling anything done.
- `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` - the regression suite against a production build,
  for a machine (like this one) that cannot download Playwright's bundled Chromium.
- CI: `.github/workflows/ci.yml` already exists and runs on every push to `main`/`master` and on
  every pull request - this is not a decision still open.

## Secrets

Production secrets come from the host's secret store, never a file in the repository. `.env.example`
holds inert placeholders only; `.env*` besides it is gitignored. `SECRET_ENV_KEYS` in `src/lib/env.ts`
lists every variable that must never reach a log or a client-visible error - `describeEnv()` reduces
each to a boolean before it can be reported anywhere.

## Backup and rollback

Not built, and worth being honest about rather than implying otherwise: there is no backup tooling
and no rollback procedure beyond standard Postgres practice (point-in-time recovery or your host's
own backup product) and standard SQL-migration discipline (each file in `src/db/migrations/` is
additive and forward-only; there is no down-migration). Needed before this handles anything
customers would notice losing.

## Known gaps, honestly, not hidden

From `docs/security.md`, current as of this file:

- **No rate limiting on the search page.** An attempt was made and reverted this session - a naive
  per-client limiter collapsed into one shared bucket in any topology without a trustworthy
  client-distinguishing signal, which is worse than no limiter. Needed before any public deployment
  with a live provider configured; whoever picks it back up should confirm the real deployment's
  proxy/header topology first.
- **Audit logging** - not built. Needed once bookings or payments exist; neither does yet.
- **Data retention and deletion** - built and documented (`/privacy`, `src/worker/maintenance.ts`,
  account export and erasure both reachable from the account page). Not a gap any more, listed here
  only because an earlier version of this file's sibling doc said it was.

## What is genuinely not applicable yet

Unchanged from the original audit, and still true: mobile app store accounts, booking/checkout
merchant-of-record setup, autonomous booking integrations, community-layer infrastructure, B2B/white
-label infrastructure, multi-region scaling. Nothing in the product today needs any of them.
