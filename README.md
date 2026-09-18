# Voyagr

An AI travel deal hunter that searches for **complete trips** rather than isolated flights or
hotels, keeps monitoring them after you close the tab, and alerts you when a materially better
combination appears.

> **Status: engineering foundation.** The architecture, deterministic core, provider interfaces,
> testing, security and CI baselines are in place and tested. No product feature is implemented yet
> — there is no real travel search, no live provider integration, and no booking.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # optional; every value has a working default
npm run dev                    # http://localhost:3000
```

No database, no Redis, no API keys. The foundation runs entirely on deterministic mock providers.

```bash
npm run verify                 # format, lint, typecheck, test, build
npm run test:e2e               # Playwright against a production build
```

Requires Node 20.9+ (developed on 24).

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
| Database      | PostgreSQL _(intended; in-memory repositories today)_    |
| Jobs          | Redis + BullMQ _(intended; in-process driver today)_     |
| Notifications | Web Push                                                 |
| CI            | GitHub Actions                                           |

---

## Layout

```
src/
  core/            Deterministic domain logic — pure, no I/O, no clock, no randomness
    money.ts         Integer minor-unit money arithmetic
    trip/            Cost, constraints, usable time, scoring, domain types
  providers/       Travel data adapters behind interfaces (all mock today)
  ai/              AI abstraction + guardrails + deterministic mock
  db/              Repository interfaces, in-memory implementation, SQL migrations
  queue/           Background job contract + in-process driver
  notifications/   Channel abstraction, Web Push
  lib/             env, logger, errors, Result
  components/ui/   Design system
  app/             Next.js App Router
tests/e2e/         Playwright
```

---

## Documentation

| Document                                                         | Contents                                    |
| ---------------------------------------------------------------- | ------------------------------------------- |
| [`docs/PRODUCT-SPECIFICATION.md`](docs/PRODUCT-SPECIFICATION.md) | The product. Source of truth.               |
| [`docs/architecture.md`](docs/architecture.md)                   | How it is built and why                     |
| [`docs/implementation-plan.md`](docs/implementation-plan.md)     | What is done and what comes next            |
| [`docs/testing.md`](docs/testing.md)                             | Testing strategy and rules                  |
| [`docs/security.md`](docs/security.md)                           | Security baseline and known gaps            |
| [`docs/design-system.md`](docs/design-system.md)                 | Component and accessibility system          |
| [`docs/claude-cli.md`](docs/claude-cli.md)                       | Working with Claude Code on this repository |
| [`progress.md`](progress.md)                                     | Current state                               |
| [`SETUP-CHECKLIST.md`](SETUP-CHECKLIST.md)                       | Setup decisions and prerequisites           |

---

## Scripts

| Script                   | Does                                    |
| ------------------------ | --------------------------------------- |
| `npm run dev`            | Development server                      |
| `npm run build`          | Production build                        |
| `npm test`               | Unit and component tests                |
| `npm run test:coverage`  | Tests with coverage                     |
| `npm run test:e2e`       | Playwright smoke suite                  |
| `npm run lint`           | ESLint                                  |
| `npm run typecheck`      | `tsc --noEmit`                          |
| `npm run format`         | Prettier                                |
| `npm run verify`         | All of the above that gate a change     |
| `npm run db:migrate`     | Apply SQL migrations (needs a database) |
| `npm run icons:generate` | Regenerate the PWA icons                |

---

## Licence

Not yet chosen.
