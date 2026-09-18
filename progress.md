# Progress

**Last updated:** 2026-09-18
**Stage:** Engineering foundation complete. Phase 1.1 and 1.2 complete; 1.3 next.

---

## Where things stand

The repository holds a working, tested engineering foundation plus the first product feature: the
search engine. It builds, lints, typechecks, passes 283 unit and component tests and 26 end-to-end
tests, and runs with **no database, no Redis, no provider credentials and no AI key**.

A search can be run from the browser against the mock providers and returns ranked, costed,
constrained trips that explain themselves. There is still no live provider, no account, no
persistence, no monitoring loop and no notification pipeline, and nothing here books anything.
That is intentional — see `docs/implementation-plan.md`.

---

## Complete

### Deterministic core — `src/core/`

The part that carries the product's credibility. Pure, exhaustively tested.

- **Money** — integer minor units, currency-safe arithmetic, remainder-preserving allocation,
  explicit rounding modes. Mixing currencies throws rather than converting implicitly.
- **True trip cost** — three totals (known, estimated, combined), every line tagged and attributed,
  excluded costs surfaced rather than dropped, category breakdown that provably equals its total.
- **Hard constraints** — budget ceilings, duration, date windows, origin, party size, and explicit
  user requirements. All violations collected, never short-circuited.
- **Travel warnings** — the No-Surprise check: self-transfer risk, baggage, late arrival, long
  transfer, non-refundable rates, estimate-heavy totals, weak forecasts.
- **Usable vacation time** — real hours at the destination, not nights.
- **Scoring** — weighted, style- and mode-aware, and explainable by construction: a test asserts the
  score equals the sum of its reported contributions.

### Search orchestration — `src/search/` (Phase 1.1)

The first product feature. `runSearch()` takes a `SearchProfile` and a destination list and returns
ranked, costed, constrained trips.

- **Planning is separate from execution.** `buildSearchPlan()` decides what will be asked of the
  providers before anything is asked, and it is where the combinatorics stop. A profile allowing
  165 date windows is sampled down to a bounded, evenly spread set — sampled rather than truncated,
  so a flexible search does not quietly become a search of the first week. What was dropped is
  reported, not hidden.
- **Fan-out is bounded and shaped.** Weather and transfers are fetched once per destination rather
  than once per trip; a destination with no flights costs no hotel call; and every provider call in
  a search passes through one shared limiter. The limiter is a shared object rather than a number
  handed to each fan-out precisely because the first version was the latter, and a nested fan-out
  that applies the same number twice permits its square. The observed peak is reported in the
  diagnostics and asserted in a test, so the bound is provable rather than merely intended.
- **One provider failing degrades a search, never aborts it.** Each call is isolated and each
  failure is recorded with its public message only, so the diagnostics are safe to return to a
  client. An adapter that throws instead of returning a `Result` is handled identically.
- **No number is produced here.** Assembly decides which candidates exist; `cost.ts`,
  `constraints.ts` and `scoring.ts` decide what they are worth. Ranking is score, then price, then
  id — the last tiebreak exists so two equal trips cannot swap places between refreshes and look
  like news.
- **Ineligible trips are returned, not discarded.** `nearMisses` carries every violation, so a
  search that finds nothing can explain what came close.

### Search UI and structured schema — `src/search/schema.ts`, `src/components/search/` (Phase 1.2)

The screens. A structured form at `/`, a results list, and a detail view inside each card.

- **A search is a URL.** The form submits as a GET, so a search can be shared, bookmarked and
  reloaded, the back button behaves, and the page works before JavaScript arrives. Native
  `<select>` and `<details>` are used for the same reason — platform controls, not hand-rolled
  ones. A saved watch in 1.5 needs the same properties.
- **Structured input is the foundation.** `schema.ts` validates the form deterministically and
  converts budgets to `Money` with `fromMajor`. The natural-language box in Phase 2 will fill this
  schema in, never bypass it.
- **One booking seam.** `src/booking/handoff.ts` builds every outbound link. It is also a trust
  boundary: a provider's `deepLink` goes into an `href`, so anything that is not `http(s)` is
  dropped rather than rendered.
- **Estimates never look like quotes**, warnings sit in the card rather than behind a disclosure,
  and excluded costs get a section that says the trip will cost more than the total shown.

### Honesty fixes carried into the core

Three things the search work exposed, fixed rather than deferred.

- **A flight time is a `LocalDateTime`, not an instant.** The type claimed UTC while every reader
  took the hour straight off the clock face, and the mock wrote local-looking hours with a `Z` so
  the two errors cancelled. Flight times are now a distinct type that refuses a zone suffix, read
  through one helper, with the reason written down: 23:40 in Antalya must read as 23:40 whether the
  process runs in Vienna or a UTC CI box.
- **A provider's silence is `null`, not `false`.** Baggage and self-transfer were non-nullable
  booleans, so "the provider did not say" became a confident denial in exactly the fields the
  No-Surprise check reads. Unknown is now its own case everywhere: it does not satisfy a hard
  requirement, it raises a `needs_verification` warning instead of a false statement, it takes half
  the scoring penalty rather than all or none, and it lowers the trip's data confidence.
- **A reload no longer re-runs the search.** A five-minute page-level cache absorbs reloads,
  duplicate tabs and back-navigation, collapses identical concurrent searches into one run, never
  caches a failure, and reports the age of what it served. `runSearch` itself is not wrapped: a
  Travel Watch refresh exists to find out whether the price moved.

### Provider architecture — `src/providers/`

Adapter interfaces for flights, hotels, weather, transfers and places. Five deterministic mocks,
varying by a hash of the query rather than randomness. A registry resolving implementations from
configuration, where selecting an unimplemented live provider is a hard error, never a silent
fallback to fixtures.

### AI abstraction — `src/ai/`

An interface with no method that can return a price, a total or an eligibility decision. Guardrails
that schema-check model output, convert intent to `Money` deterministically, and discard generated
prose containing figures its source facts do not support. A deterministic rule-based mock provider.

### Persistence — `src/db/`

Repository interfaces for users, searches, watches, price history, notifications and push
subscriptions. A complete in-memory implementation. A Postgres schema and a migration runner, needed
only when a real database arrives. `pg` is behind a dynamic import, so no driver loads without a
`DATABASE_URL`.

### Background jobs — `src/queue/`

Job contract with a full in-process driver: delays, retries with exponential backoff,
deduplication, stats and deterministic draining for tests.

### Application and UI

Next.js App Router scaffold, foundation status page, offline page, error and not-found boundaries,
a health endpoint that reports capabilities without leaking configuration. A design system of Radix
primitives on OKLCH Tailwind tokens, accessible in both colour schemes. PWA manifest, generated
icons and a hand-written service worker that is network-first for anything priced.

### Engineering baseline

Structured logging with central redaction, an error taxonomy separating public from internal
detail, security response headers, validated configuration, GitHub Actions CI across four jobs,
Dependabot, Claude Code project configuration and eleven agents, and seven documents.

---

## Fixed during the bootstrap

Two real defects, both caught by the tooling rather than by inspection:

1. **Status badges failed contrast in dark mode** (2.04:1, against a 4.5:1 requirement). Caught by
   axe in the Playwright suite. Fixed at the source by introducing scheme-aware `*-ink` tokens
   rather than by excluding the rule.
2. **`describeEnv()` omitted unset secrets entirely** instead of reporting them as `false`, so a
   configuration report read "no such setting" rather than "not configured". Caught by a unit test.

One design correction: the usable-time model originally clamped arrival-day time to hotel check-in,
which double-penalised a midday arrival — reception stores bags and the day starts anyway. The
clamp was removed and the two now-unused assumptions deleted rather than left as dead configuration.

---

## Not started

Everything in `docs/implementation-plan.md` from Phase 1.3 onward: accounts, Postgres persistence,
saved watches, workers, price history, deal detection, Web Push delivery, component swapping, and
the first live provider.

Also absent by design: a standalone trip detail route. It would either re-run the search and show
different prices than the list it was opened from, or need a result cache that arrives with 1.4
and 1.5.

Within the search engine specifically: a candidate carries no food, activities or local-transport
estimate. Those need per-destination cost-of-living data the project does not have, and a guessed
line would be worse than an absent one. `TripCandidate.extraCosts` is the seam.

Also absent and noted in `docs/security.md`: authentication, rate limiting, CSRF protection, audit
logging, a nonce-based CSP, and a data retention policy.

---

## Known constraints

| Item                      | Detail                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint pinned to 9.x      | `eslint-config-next@16` bundles an `eslint-plugin-react` incompatible with ESLint 10. Dev-only dependency. Revisit when Next ships support.                                                             |
| Playwright browser binary | Could not be downloaded in the bootstrap environment (CDN unreachable). The suite was verified against locally installed Chrome via `PLAYWRIGHT_CHANNEL=chrome`. CI installs bundled Chromium normally. |
| CSP `'unsafe-inline'`     | Required by Next.js streaming injection. Worth replacing with a nonce-based CSP before handling payments.                                                                                               |
| No git remote             | CI cannot run until one is configured.                                                                                                                                                                  |

---

## Next step

Phase 1.1 — search orchestration. It is the first piece that turns the foundation into a product,
and it exercises every layer at once: adapters, cost engine, constraints, scoring.
