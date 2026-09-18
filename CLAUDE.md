# Voyagr — project instructions for Claude Code

Voyagr is an AI travel deal hunter: it searches for **complete trips**, keeps monitoring them in
the background, and alerts the user when a materially better combination appears.

- Product source of truth: `docs/PRODUCT-SPECIFICATION.md` (do not edit without being asked).
- Architecture: `docs/architecture.md`. Plan: `docs/implementation-plan.md`.
- Current state: `progress.md`, `verification-status.json`.

## The one rule that matters most

**Deterministic software owns every number. The model owns language.**

| Deterministic code only             | Model may do this                         |
| ----------------------------------- | ----------------------------------------- |
| Prices, totals, currency arithmetic | Parse free-text requests into structure   |
| Budget limits and eligibility       | Explain a score that was already computed |
| Date and night calculations         | Draft itineraries from selected places    |
| Deal scores and ranking             | Word a notification already decided on    |
| Hard constraints                    | Infer soft preferences                    |

If you are about to let a model produce, adjust or "sanity check" a number that a user will see,
stop. That number belongs in `src/core/`.

Concretely:

- Money is `Money` from `src/core/money.ts` — integer minor units plus a currency. Never a float,
  never a bare number. Never `parseFloat` a price and add it to another.
- Totals come from `src/core/trip/cost.ts`. Eligibility from `constraints.ts`. Scores from
  `scoring.ts`. Do not recompute any of them inline.
- Every cost line is tagged `known` / `estimated` / `excluded`. Never silently drop a cost, and
  never fold an excluded one into a total — a missing transfer becomes an `excluded` line, not a
  zero.
- AI output is validated in `src/ai/guardrails.ts` before it can affect anything. Generated prose
  is scanned for figures absent from its source facts, and discarded if it invents one.

## Project layout

```
src/
  core/         Deterministic domain logic. Pure, no I/O, no clock, no randomness.
    money.ts    Integer money arithmetic.
    trip/       Cost, constraints, usable time, scoring, domain types.
  providers/    Travel data adapters behind interfaces. All mock today.
  ai/           AI abstraction + guardrails. Never import a vendor SDK elsewhere.
  db/           Repository interfaces + in-memory implementation + SQL migrations.
  queue/        Background job abstraction. In-process driver today.
  notifications/ Channel abstraction. Web Push first.
  lib/          env, logger, errors, Result, cn.
  components/ui/ Design system (Radix primitives + Tailwind tokens).
  app/          Next.js App Router.
tests/e2e/      Playwright.
```

## Conventions

- **Imports:** `@/*` maps to `src/*`. Use it rather than deep relative paths.
- **Config:** never read `process.env` outside `src/lib/env.ts`. Import `getEnv()`.
- **Logging:** never `console.log`. Use `getLogger('module.name')` from `src/lib/logger.ts`.
  Redaction is configured centrally — do not log a subscription key, connection string or API key
  even "temporarily".
- **Errors:** throw `AppError` with a code from `src/lib/errors.ts`. Anything returned to a client
  goes through `toProblemDetails()`, which strips context, causes and stack traces.
- **Expected failures:** provider adapters return `Result`, not exceptions. One provider failing
  must degrade a search, not abort it.
- **SQL:** always parameterised. String interpolation into SQL is never acceptable.
- **Mocks:** deterministic. Derive variation from a hash of the query, never `Math.random()` or
  `new Date()` — see `src/providers/fixtures/deterministic.ts`.

## Testing

- `npm test` — unit (node) and component (jsdom) tests.
- `npm run test:e2e` — Playwright against a production build.
- `npm run verify` — format, lint, typecheck, test, build. Run before saying work is done.

Write tests that assert behaviour, not implementation. For components that means roles, accessible
names and states, never class names. Do not weaken an assertion to make a suite pass; if a test
fails, the test is usually right.

`PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` runs against a locally installed Chrome, for machines
where the Playwright browser download is blocked.

## Accessibility

The design system is Radix primitives styled with Tailwind tokens (`docs/design-system.md`). Do not
hand-roll an interactive control that Radix already provides, and do not add a one-off component
outside `src/components/ui/` without a reason.

Every surface must keep: a visible focus indicator, a real label associated with every input,
colour never as the sole signal, and 4.5:1 contrast in both light and dark schemes. The Playwright
suite runs axe against the app and fails on any violation.

## What not to do yet

Phase 1 is not implemented. Do not add live provider integrations, booking, payments, real Travel
Watch monitoring or a production notification pipeline unless explicitly asked. Do not add real
credentials to any file. `.env.example` holds placeholders only.
