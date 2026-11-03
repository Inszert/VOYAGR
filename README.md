# Voyagr

An AI travel deal hunter that searches for **complete trips** rather than isolated flights or
hotels, keeps monitoring them after you close the tab, and alerts you when a materially better
combination appears.

> **Status: Phase 1 MVP loop working end to end.** Search, complete-trip cost and ranking, saved
> Travel Watches, a background worker, and real Web Push notifications all run against Postgres and
> Redis when configured, or entirely in-memory with no setup at all. Two live providers exist under
> a hard zero-paid-search-cost constraint (see `docs/provider-evaluation.md`): Aviasales for
> indicative (cached, not bookable) flight prices, and Open-Meteo for real weather. Hotels have no
> free source and stay mock. No booking yet.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # optional; every value has a working default
npm run dev                    # http://localhost:3000
```

No database, no Redis, no API keys. The foundation runs entirely on deterministic mock providers.
`.env.local` is read by `next dev`/`next build` (Next's own convention); `npm run worker` and
`npm run db:migrate` read `.env` instead - use that name if you want them to see the same values.
See `SETUP-CHECKLIST.md` for every variable and what it turns on.

```bash
npm run verify                 # format, lint, typecheck, test, build
npm run test:e2e               # Playwright against a production build
```

Requires Node 24.15+ — `engines.node` in `package.json` and `engine-strict=true` in `.npmrc` make
an older Node a hard failure rather than a warning, deliberately (see `progress.md`'s "Known
constraints": `jsdom@30` needs 22.22.2+, and several hosts pick the floor of an open-ended range,
which selected an EOL Node 20 when this said `>=20.9.0`).

---

## The idea

Travel search is fragmented. A cheap flight can produce an expensive trip once baggage, transfers,
hotel location and food are counted, and prices move constantly. Voyagr treats planning as a
continuous optimisation problem: understand the constraints, build whole-trip combinations, score
them, keep watching, and speak up only when something genuinely changes.

Full product definition: [`docs/PRODUCT-SPECIFICATION.md`](docs/PRODUCT-SPECIFICATION.md).

---

## The rule the codebase is built around

**Deterministic software owns every number. The model owns language.**

| Deterministic code                  | Language model                       |
| ----------------------------------- | ------------------------------------ |
| Prices, totals, currency arithmetic | Parsing free text into structure     |
| Budget limits and hard eligibility  | Explaining an already-computed score |
| Dates and night counts              | Drafting itineraries                 |
| Deal scores and ranking             | Wording an alert already decided on  |

A model that can adjust a price can be wrong about money someone is about to spend. The split is
enforced structurally: `src/core/` is pure and numeric, the AI interface has no method that returns
a price, and `src/ai/guardrails.ts` discards generated prose containing figures its source facts do
not support.

---

## Stack

| Area          | Choice                                                   |
| ------------- | -------------------------------------------------------- |
| Framework     | Next.js 16 (App Router), React 19, TypeScript            |
| Styling       | Tailwind CSS v4 with OKLCH design tokens                 |
| Components    | Radix UI Primitives ([why](docs/design-system.md))       |
| Testing       | Vitest (unit + component), Playwright + axe (end-to-end) |
| Database      | PostgreSQL, or in-memory with no setup                   |
| Jobs          | Redis + BullMQ, or in-process with no setup              |
| Notifications | Web Push                                                 |
| CI            | GitHub Actions                                           |

---

## Layout

```
src/
  core/            Deterministic domain logic — pure, no I/O, no clock, no randomness
    money.ts         Integer minor-unit money arithmetic
    trip/            Cost, constraints, usable time, scoring, domain types
  providers/       Travel data adapters behind interfaces — Aviasales and Open-Meteo are real
                   and free; everything else is mock (see docs/provider-evaluation.md for why)
  ai/              AI abstraction + guardrails + deterministic mock
  db/              Repository interfaces, in-memory and Postgres implementations, SQL migrations
  queue/           Background job contract, in-process and BullMQ/Redis drivers
  worker/          The process that runs the queue outside a request (npm run worker)
  notifications/   Channel abstraction, Web Push
  lib/             env, logger, errors, Result
  middleware.ts    Per-request CSP nonce
  components/ui/   Design system
  app/             Next.js App Router
tests/e2e/         Playwright
```

---

## Documentation

| Document                                                         | Contents                                      |
| ---------------------------------------------------------------- | --------------------------------------------- |
| [`docs/PRODUCT-SPECIFICATION.md`](docs/PRODUCT-SPECIFICATION.md) | The product. Source of truth.                 |
| [`docs/architecture.md`](docs/architecture.md)                   | How it is built and why                       |
| [`docs/implementation-plan.md`](docs/implementation-plan.md)     | What is done and what comes next              |
| [`docs/testing.md`](docs/testing.md)                             | Testing strategy and rules                    |
| [`docs/security.md`](docs/security.md)                           | Security baseline and known gaps              |
| [`docs/design-system.md`](docs/design-system.md)                 | Component and accessibility system            |
| [`docs/claude-cli.md`](docs/claude-cli.md)                       | Working with Claude Code on this repository   |
| [`progress.md`](progress.md)                                     | Current state                                 |
| [`SETUP-CHECKLIST.md`](SETUP-CHECKLIST.md)                       | Deployment and environment-variable reference |

---

## Scripts

| Script                   | Does                                        |
| ------------------------ | ------------------------------------------- |
| `npm run dev`            | Development server                          |
| `npm run build`          | Production build                            |
| `npm test`               | Unit and component tests                    |
| `npm run test:coverage`  | Tests with coverage                         |
| `npm run test:e2e`       | Playwright smoke suite                      |
| `npm run lint`           | ESLint                                      |
| `npm run typecheck`      | `tsc --noEmit`                              |
| `npm run format`         | Prettier                                    |
| `npm run verify`         | All of the above that gate a change         |
| `npm run db:migrate`     | Apply SQL migrations (needs a database)     |
| `npm run worker`         | Run the background queue as its own process |
| `npm run vapid:generate` | Generate a Web Push key pair                |
| `npm run icons:generate` | Regenerate the PWA icons                    |

---

## Licence

Not yet chosen.
