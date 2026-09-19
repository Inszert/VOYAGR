# Progress

**Last updated:** 2026-09-20
**Stage:** Phase 1 complete except live providers. Phase 1.10.1 (the frontend build-out) complete.
**Next:** the live-provider readiness gate, then 1.11.

---

## Where things stand

Voyagr runs end to end against deterministic mock providers: a person can search, understand why a
trip ranks where it does, see what moving their dates is worth, discover destinations on a globe,
read about a place, create an account, save a Travel Watch, have a worker re-price it in the
background, and receive a browser push when a materially better combination appears.

**Nothing here is a real price.** Every provider is a mock, and the UI says so on every surface
that shows money. That is a product decision, not a gap left open: see `docs/provider-evaluation.md`
for what choosing a vendor requires and why it has not been done.

`npm run verify` is clean: 812 unit and component tests, plus 148 end-to-end tests with axe
assertions on every user-facing surface.

The repository still runs with **no database, no Redis, no provider credentials and no AI key** —
each of those turns a feature on rather than being required to boot.

---

## Complete

### Deterministic core — `src/core/`

The part that carries the product's credibility. Pure: no clock, no randomness, no I/O.

Integer money with an explicit currency. Trip cost, with every line tagged `known`, `estimated` or
`excluded` and nothing silently dropped. Hard eligibility rules, including day-of-week rules so
"a weekend" means one. Scoring with declared weights, per-factor contributions and a separate
evidence-strength figure. Usable time. Calendar-date arithmetic in UTC, and wall-clock local times
that never pretend to be instants.

### Search — `src/search/`

Planning that bounds the fan-out and reports what it sampled. Orchestration across five adapter
kinds behind one shared concurrency limiter, where a provider failing degrades a search rather than
aborting it. Assembly, costing, ranking, near-misses with their violations attached, component
swap options priced as whole trips, and per-destination summaries drawn from every eligible trip
rather than from the page of results.

A five-minute page cache absorbs reloads and duplicate tabs, collapses identical concurrent
searches, never caches a failure, and reports the age of what it served. `runSearch` itself is not
wrapped: a Travel Watch exists to find out whether the price moved.

Date flexibility presets — exact, plus-or-minus one, three and seven days, weekend, long weekend,
month, custom — as pure functions from two typed dates to the four fields the planner needs. Result
filters that narrow what the search already found rather than re-running it.

### Accounts, persistence and monitoring

Accounts with throttled sign-in scoped per client, saved preferences and plan entitlements the
search actually applies. Repository interfaces with an in-memory implementation and a PostgreSQL
one, both held to a single shared contract suite — 26 tests, run against a live database.

A BullMQ and Redis worker, proven against real Redis and real Postgres, that re-prices watches on a
schedule, records price history, detects materially better deals against what was seen before, and
sweeps expired sessions.

### Notifications — `src/notifications/`

Web Push behind a channel abstraction, proven end to end in a real browser: a genuine
worker-detected deal produced a real push notification. Dead subscriptions are dropped on 404 and
410 rather than retried forever.

### Frontend — Phase 1.10.1

- **Design system.** Radix primitives on OKLCH Tailwind tokens, with elevation, motion and an
  editorial display face as tokens rather than per-component choices.
- **Homepage discovery.** Ten categories as presets over the existing search schema, which can
  never override what the user themselves set. No photographs — see `docs/imagery-options.md`.
- **Rich result cards.** "Why this trip?" in words before any score, an at-a-glance summary, and
  the factor breakdown one disclosure down for anyone who wants it.
- **Filters.** Only the ones backed by real data, and an unknown fact never silently passes or
  fails one.
- **Flexible dates.** Presets in the open, and a price comparison across every date window the
  search priced, with the saving stated and the sampling admitted.
- **Discovery globe.** MapLibre with a Natural Earth basemap committed here: no tile server, no API
  key, no third party in the render path, asserted by a test. The globe is decoration and the list
  beside it is the content.
- **Destination pages.** Built from the same adapters, naming what they cannot tell you.
- **Data provenance.** Every surface that shows money says where it came from, and mock data never
  visually masquerades as a real price.

### Provider readiness — `src/providers/`

Adapter interfaces for flights, hotels, weather, transfers and places, five deterministic mocks,
and a registry where selecting an unimplemented live provider is a hard error rather than a silent
fallback to fixtures.

Encoded from the vendor research: provider-specific pagination cursors nothing outside an adapter
may parse; an operation-aware retry policy where "never retry an order creation" is a property of
the operation and not overridable by a provider; per-operation, per-provider timeouts. Plus a
vendor-agnostic recorded-HTTP fixture harness that replays completely offline.

---

## Not started, deliberately

**Live providers (1.11).** Gated on the readiness task in `docs/implementation-plan.md`. One
question is still outstanding with every candidate vendor: whether background polling for price
monitoring is permitted under their terms. Until that has an answer in writing, choosing a vendor
would be choosing one that might forbid the product's central feature.

**Specification sections 15 to 22** — seasonal intelligence, seasonal globe layers, hidden places,
events and national holidays, trip types, the trip builder. Each needs data the product does not
have. They are named in the interface where a user might expect them rather than rendered as
controls that silently match everything.

**Booking and payments.** Nothing here books anything.

**Per-destination cost of living.** A candidate carries no food, activities or local-transport
estimate. `TripCandidate.extraCosts` is the seam; a guessed line would be worse than an absent one.

**A standalone trip detail route.** The card carries the breakdown, the score, the warnings and the
swaps. A separate route would need to re-run the search and would then show different prices than
the list it was opened from.

Also absent and noted in `docs/security.md`: rate limiting beyond sign-in, CSRF protection, audit
logging, a nonce-based CSP, and a data retention policy beyond session and price-history sweeps.

---

## Known constraints

| Item                      | Detail                                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint pinned to 9.x      | `eslint-config-next@16` bundles an `eslint-plugin-react` incompatible with ESLint 10. Dev-only dependency. Revisit when Next ships support.                                                                 |
| Playwright browser binary | Could not be downloaded in this environment. The suite was verified against locally installed Chrome via `PLAYWRIGHT_CHANNEL=chrome`. CI installs bundled Chromium normally.                                |
| CSP `'unsafe-inline'`     | Required by Next.js streaming injection. Worth replacing with a nonce-based CSP before handling payments.                                                                                                   |
| MapLibre worker is copied | `scripts/copy-map-worker.mjs` copies it out of `node_modules` on every build, because MapLibre resolves it relative to `import.meta.url` and a bundled chunk is the wrong place. See `docs/map-options.md`. |
| No git remote             | CI cannot run until one is configured.                                                                                                                                                                      |

---

## Next step

The live-provider readiness gate — specifically the background-polling question. Every other
finding is recorded and encoded; no vendor should be selected while that one is open.
