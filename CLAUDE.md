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

## Design engineering

Design references live in three places and they rank:

- `PRODUCT.md` / `docs/PRODUCT-SPECIFICATION.md` — what the product is and promises.
- `DESIGN.md` — the tokens, states and densities that exist, read out of `globals.css`.
- `docs/design-system.md` — why the primitives are what they are, and the accessibility rules.

Four design skills are installed under `.claude/skills/`. They are advisors, not authorities:

| Skill                                                                | What it is for                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `emil-design-eng`                                                    | Emil Kowalski on UI polish, component design and the invisible details                                                                                                                                      |
| `animate`, `review-animations`, `improve-animations`, `apple-design` | Motion: building it, critiquing it, auditing a codebase of it                                                                                                                                               |
| `impeccable`                                                         | A design director's pass. `/impeccable audit`, `critique`, `polish`, `layout`, `typeset`, `harden`, `clarify`, `distill`, `quieter`, `optimize` and more — see the skill's `argument-hint` for the full set |
| `design-taste-frontend`                                              | Taste: anti-slop direction, hierarchy, composition                                                                                                                                                          |

`pick-ui-library`, `prototype` and `review-animations` carry `disable-model-invocation: true` by
their author's design: invoke them explicitly or not at all.

### Precedence, when advice conflicts

```
Voyagr product requirements   (PRODUCT.md, the specification)
        v
existing functionality and data behaviour
        v
accessibility
        v
DESIGN.md and the existing primitives
        v
Emil  >  Impeccable  >  Taste
        v
the simpler, more intentional option
```

**No tool worship.** These skills are written for greenfield work and will suggest things this
product has already decided against. When one of them proposes any of the following, the answer is
no, and no discussion is needed:

- touching the globe, its data, its camera or its rendering;
- replacing the design system, adding a second font, or introducing raw colours;
- rewriting the provider layer, the search, the scoring, the pricing or the data model;
- adding animation for its own sake, or removing information a user needs to decide;
- "going all out" on a refinement task. Impeccable's default voice is a redesign voice. Voyagr work
  is almost always refinement: it preserves the incumbent identity, behaviour and copy.

If a skill's advice would change a number a user sees, it is wrong by construction. Numbers come
from `src/core/`.

### The workflow for any UI task

1. Inspect the existing implementation and what it is handed.
2. Understand the data and the business logic behind it. Do not change either.
3. Identify every component affected, and check whether the pattern already exists elsewhere.
4. Read `DESIGN.md`; use the tokens and primitives that exist. Do not add tokens without a reason.
5. Apply Emil's principles, then Impeccable, then Taste — in that order, and subject to precedence.
6. Implement the smallest coherent change.
7. `npm run typecheck` and `npm run lint`.
8. Build and run the app: `npm run build && npx next start -p 3100`.
9. **Inspect the rendered result in a browser.** Playwright MCP is configured for this.
10. Screenshot at 390, 768 and 1440 at minimum; 320, 375, 430, 1024 and 1280 where relevant.
11. Critique what the screenshots actually show, not what the code intends.
12. Refine, and screenshot again.
13. `npm test` and `npm run test:e2e`.
14. Report what changed, what was deliberately not changed, and what was verified.

### Visual QA is mandatory

A UI can typecheck, lint, build and pass its tests while looking broken. **For any user-facing
change, "it compiles" is not evidence.** Open it.

Playwright is configured twice, for two jobs, and they are not interchangeable:

- **Playwright MCP** (`.mcp.json`) — the design loop. Drive the running app, snapshot the
  accessibility tree, screenshot, resize, read the console. This is how a change is _looked at_.
- **`npm run test:e2e`** (`playwright.config.ts`) — the regression suite, against a production
  build, with axe in a desktop and a mobile viewport. This is how a change is _kept_.

The MCP server uses the locally installed Chrome (`--browser chrome`) because this machine cannot
download Playwright's bundled Chromium. `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` is the same
escape hatch for the suite.

What to look for every time: horizontal overflow, clipped text, broken or missing images, wrapping
that breaks a row, controls that are too small to hit, cards that grow too tall, prices that do not
align, spacing that drifts between sections, and console errors.

### Figma

Use Figma MCP **only when a Figma file, frame or design is actually supplied**, or when the task
names Figma. There is no Voyagr Figma file at the time of writing; do not invent one, and do not
screenshot a design and approximate it. When one is supplied, read its structured data — variables,
components, typography, spacing, layout, states — and implement against that, then verify in the
browser.

## What not to do yet

Phase 1 is not implemented. Do not add live provider integrations, booking, payments, real Travel
Watch monitoring or a production notification pipeline unless explicitly asked. Do not add real
credentials to any file. `.env.example` holds placeholders only.
