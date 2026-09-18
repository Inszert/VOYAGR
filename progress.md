# Progress

**Last updated:** 2026-09-18
**Stage:** Engineering foundation complete. Phase 1 not started.

---

## Where things stand

The repository now holds a working, tested engineering foundation. It builds, lints, typechecks,
passes 195 unit and component tests and 26 end-to-end tests, and runs with **no database, no Redis,
no provider credentials and no AI key**.

No product feature exists. There is no travel search, no live provider, no booking, no monitoring
loop and no notification pipeline. That is intentional — see `docs/implementation-plan.md`.

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

Everything in `docs/implementation-plan.md` from Phase 1.1 onward: search orchestration, search UI,
accounts, Postgres persistence, saved watches, workers, price history, deal detection, Web Push
delivery, component swapping, and the first live provider.

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
