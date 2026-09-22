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
  search/       Search orchestration: plan the fan-out, assemble candidates, rank them.
  discovery/    The globe's model: countries, great-circle routes, the discovery snapshot, stage
                data. Pure where it can be; the page loader is the only part that does I/O.
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
- **Provider input is untrusted.** Everything a provider returns is schema-checked at the boundary
  by `src/providers/schema.ts` before it reaches `src/core/`. An adapter's TypeScript signature is
  a promise about our code, not about the JSON on the wire. A malformed offer is dropped and
  reported, never fatal. A fact the vendor did not state must arrive as an explicit `null`; a
  field that is simply missing is an adapter bug and fails validation.
- **Currency:** converting is `src/core/fx.ts` and nothing else. **A rate is data, never a guess**
  — there is no default rate, no reciprocal derived from the opposite pair, and no identity between
  two different currencies. A conversion with no rate fails and says which pair was missing; the
  caller degrades. `RateSource` is the seam a real feed will sit behind.
- **SQL:** always parameterised. String interpolation into SQL is never acceptable.
- **Mocks:** deterministic. Derive variation from a hash of the query, never `Math.random()` or
  `new Date()` — see `src/providers/fixtures/deterministic.ts`.
- **Dates:** calendar dates are `YYYY-MM-DD` strings and are compared and advanced with
  `src/core/dates.ts`. Never parse one into a `Date` for arithmetic — that reintroduces the
  timezone drift those helpers exist to avoid.
- **Times:** an `IsoDateTime` is a real instant in UTC (`observedAt`). A `LocalDateTime` is the
  clock face where the event happens (a flight's `departsAt`) and carries no zone. Read one with
  `minutesIntoLocalDay`/`localHour`, never through `Date`, and never subtract two of them to get a
  duration — that is what `FlightLeg.durationMinutes` is for.
- **Freshness:** every offer carries `observedAt`, and `src/core/freshness.ts` reads it. Three
  states, not two: `unknown` is its own case and never collapses into `stale`, and an observation
  dated well into the future is not believed rather than being the freshest thing on the page.
- **Unknowns:** a fact a provider did not state is `null`, never a default. `false` where the
  provider said nothing is a claim we cannot support, and it lands in the fields the No-Surprise
  check reads. Unknown gets its own branch: unproven for a hard requirement, a
  `needs_verification` warning, half a scoring penalty, and lower data confidence.
- **Geo data:** `public/geo/*` and `src/discovery/countries.generated.json` are written by
  `scripts/build-geo.mjs` from Natural Earth. Never hand-edit them; change the script and rerun it.
  The globe reaches no origin but ours, and a test asserts it.
- **One scheme, and it is night.** The whole product is dark, in every colour scheme. `surface`,
  `ink` and `border` are night values; there is no light block in `globals.css` and adding one
  would split the site in two again. `stage-*` still names the parts of that night the planet
  itself owns — the ocean, the land, the atmosphere, a price chip — and only the globe and the
  surfaces around it use those directly.
- **The stage:** the canvas is decoration — every fact on the globe is also a link or a card in
  the DOM. What is drawn _around_ the sphere (the atmosphere, the flight arcs) is decoration too,
  and lives outside the canvas because it is about the silhouette on screen, not about the
  ground: see `globe-arcs.ts` and the `voyagr-orb` rules.
- **Fan-out:** every provider call in one operation goes through a shared `Limiter` from
  `src/lib/concurrency.ts` — **one per provider**, handed out by a `LimiterPool` keyed on the
  provider id, sized from that vendor's declared `rateLimitPerMinute` (see `src/providers/rate.ts`).
  One impatient user must not become a rate-limit outage, and a rate limit belongs to a vendor
  rather than to a search. Within a provider there is still exactly one limiter for the whole
  operation: wrap the leaf call, never the fan-out around it — a task holding a slot while waiting
  for another deadlocks — and never bound a nested fan-out by passing the same number to both
  levels, which permits its square. A search also has a ceiling on how many calls it may make at
  all (`maxProviderCalls`); reaching it degrades the search and says so, exactly as a failed call
  does.

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
colour never as the sole signal, and 4.5:1 contrast. The Playwright suite runs axe against the app
in both a desktop and a mobile viewport and fails on any violation.

The one place contrast cannot be read off a token pair is a price chip on the globe, because what
is behind it depends on which way the world is facing. That one carries its own halo, the way a
map label always has.

## What not to do yet

Phase 1 is not implemented. Do not add live provider integrations, booking, payments, real Travel
Watch monitoring or a production notification pipeline unless explicitly asked. Do not add real
credentials to any file. `.env.example` holds placeholders only.
