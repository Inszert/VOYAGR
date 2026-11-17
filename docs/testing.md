# Testing

## Commands

| Command                 | What it runs                             |
| ----------------------- | ---------------------------------------- |
| `npm test`              | Unit (node) and component (jsdom) tests  |
| `npm run test:watch`    | The same, in watch mode                  |
| `npm run test:coverage` | With coverage and thresholds             |
| `npm run test:e2e`      | Playwright against a production build    |
| `npm run test:e2e:ui`   | Playwright in UI mode                    |
| `npm run verify`        | format · lint · typecheck · test · build |

None of these require provider credentials or an AI key - every adapter test injects its own
`fetchImpl` and replays a literal or a recorded fixture. **Two suites are a deliberate exception**:
`src/db/repository-contract.test.ts`'s Postgres half and `src/queue/bullmq.test.ts` genuinely open a
real database and a real Redis when `TEST_DATABASE_URL`/`REDIS_URL` are set, because the property
being proven - "the Postgres repository and the in-memory one satisfy the same contract", "a job
survives a driver restart" - cannot be proven against a mock of the thing being tested. With neither
configured, both report as **skipped**, never as passing, so the gap shows up in the test output
rather than as silence. If a _different_ test ever needs real infrastructure, that is the design
problem this note originally warned about.

## Current numbers

| Suite                           | Result                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm test` (unit and component) | 2470 passed, 1 skipped, across 188 test files. Run 2026-11-17 on the working tree, including uncommitted changes.   |
| `npm run test:e2e`              | Last full run: 278 passed, 1 skipped, 1 failed then fixed (run before commit 1638a79). Not re-run for this section. |

The end-to-end run used the locally installed Chrome (`PLAYWRIGHT_CHANNEL=chrome`), because this
machine cannot download Playwright's Chromium. CI uses the bundled one. The Postgres contract suite
and the BullMQ suite skip without `TEST_DATABASE_URL` and `REDIS_URL`, so they are not part of
those numbers.

## The three levels

**Unit** (`src/**/*.test.ts`, node environment) — the deterministic core, adapters, guardrails,
queue, configuration. Fast, and where most of the value is.

**Component** (`src/**/*.test.tsx`, jsdom) — design system components, asserted through their
accessible behaviour.

**End-to-end** (`tests/e2e/*.spec.ts`, Playwright) — the real browser: rendering, navigation,
headers, manifest, service worker, accessibility tree.

The split is configured as two Vitest projects so a money-arithmetic test never pays for a jsdom
environment.

---

## What the core tests actually assert

The deterministic core carries the product's credibility, so it is tested hardest. A wrong total is
worse than a missing feature, because the user only finds out after paying.

**Boundaries, not middles.** A budget ceiling of EUR 850 is tested at 849, 850 and 851. The
boundary _is_ the rule.

**Exactness for money.** Never `toBeCloseTo` on a price. One test adds one cent a thousand times
and asserts the result is exactly ten euros — the case that fails under float arithmetic.

**Conservation properties.** Splitting a total must sum back to it, across many totals and many
split counts. A category breakdown must equal its own total. A score must equal the sum of its
reported contributions. These catch whole classes of bug that single-value assertions miss.

**Determinism.** Mocks are called twice in the same test and compared.

**Degenerate input.** Zero nights, one passenger, empty lists, inverted date ranges, null review
scores, missing transfers, mixed currencies.

**Honesty.** A low-confidence forecast must pull the weather score toward neutral, not toward
optimism. There is a test for that, because it is a product requirement rather than a nicety.

---

## Component tests

Assert roles, accessible names, states and associations. Query with `getByRole`, `getByLabelText`,
`getByText`.

Never assert on a class name. Such a test breaks on every restyle and catches none of the bugs that
matter. If a test would still pass with the label removed, it is testing nothing.

Representative assertions from `src/components/ui/ui.test.tsx`:

- A loading button keeps its accessible name and gains `aria-busy` — swapping the label for a
  spinner would leave a screen reader with an unnamed control mid-request.
- `asChild` with an anchor produces a link, not a button.
- A required field announces "(required)", because a red asterisk conveys nothing to a screen
  reader.
- The skip link is the first tab stop.

---

## End-to-end tests

Run against a **production build**, because that is what users get: the dev server caches
differently and the service worker is disabled there.

The suite covers the app shell and landmarks, the skip link under real keyboard input, a 404, the
health endpoint (including that it leaks no configuration), the PWA manifest and every icon it
declares, the service worker's cache policy, the offline page, and the security headers.

It also runs **axe** against the page and fails on any violation, in both a desktop and a mobile
viewport. That check has already earned its place — it caught a real contrast failure where status
badges used dark ink that fell to 2.04:1 against dark-mode surfaces.

Treat axe as a floor, not a target. It catches perhaps a third of real accessibility problems; tab
through what you build.

### The hermetic environment

`playwright.config.ts` starts `npm run build && next start` on port 3100 (`PLAYWRIGHT_PORT`) with a
fixed environment, so the result does not depend on what is in the developer's `.env`:

- `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL` blank; `QUEUE_DRIVER=memory`. Accounts live in
  memory.
- `ALLOW_MOCK_IN_PRODUCTION=true` and every provider (`FLIGHT`, `HOTEL`, `WEATHER`, `TRANSFER`,
  `PLACES`, `FX`) set to `mock`. A production build otherwise refuses fixtures. This is the one place
  that opts in. It also turns off the Travelpayouts Drive script.
- `DATA_SOURCE_SWITCH=true`, so the API/MOCK switch can be asserted on.
- `AVIASALES_API_TOKEN`, VAPID keys blank; `IMAGERY_PROVIDER=none`, so no run needs Wikimedia.

What it cannot prove: real provider behaviour, real email, Postgres, Redis, push delivery, or that a
photograph appears.

### Support helpers (`tests/e2e/support/`)

| File          | Helper                                 | Use                                                                                                                                                                                              |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `searches.ts` | `hydrated(locator)`                    | Waits until React has hydrated the element (it carries a `__reactProps$` key) before pressing it. A client form submitted before hydration is a native POST and the press is lost                |
| `searches.ts` | `aSearch`, `openSearch`, `closeSearch` | Build a search with dates relative to the run day (UTC), and open the folded search controls                                                                                                     |
| `axe.ts`      | `axeFindings(page, { include })`       | Runs axe with the WCAG 2.0 and 2.1 A and AA tags; returns one readable line per violating node                                                                                                   |
| `axe.ts`      | `waitForEntranceMotion(page)`          | Waits for finished animations, ignoring infinite loops and scroll-driven animations                                                                                                              |
| `menu.ts`     | `openMenuIfPhone(page)`                | Opens the "Menu" sheet (shown below 1024px) and returns whether it had to; repeats the press until open, because the trigger does nothing before hydration                                       |
| `requests.ts` | `watchRequests(page)`                  | Listens on the browser context, so it also sees MapLibre's worker and the service worker. Records `/geo/` paths and any non-same-origin URL (`external` must stay empty). Start it before `goto` |

`tests/e2e/pages.spec.ts` checks, for each surface, that it raises no uncaught page error (which is
how React reports a hydration mismatch) and has no axe violations, in both viewports. With two Playwright projects, default workers can be too many
for a WebGL globe per page; `--workers=4` removes the resulting flake.

### Avoiding flake

- Use web-first assertions (`await expect(locator).toBeVisible()`); they retry.
- Never `waitForTimeout`. Wait for the thing itself.
- Keep tests independent — `fullyParallel` is on.

### Environment escape hatches

| Variable                    | Effect                                                     |
| --------------------------- | ---------------------------------------------------------- |
| `PLAYWRIGHT_CHANNEL=chrome` | Use a locally installed Chrome instead of bundled Chromium |
| `PLAYWRIGHT_VIDEO=1`        | Record video on failure (needs Playwright's ffmpeg)        |
| `PLAYWRIGHT_PORT`           | Change the port the test server binds                      |

The channel override exists for machines where Playwright's browser CDN is unreachable. It changes
which binary runs, never what is asserted. CI uses bundled Chromium.

---

## Coverage

Thresholds in `vitest.config.ts` are a **floor that catches accidentally-deleted tests**, not a
target to chase. The deterministic core sits far above them. Do not write a test whose only purpose
is to move the number.

---

## Rules

1. **Never weaken a test to make a suite pass.** A failing test is usually right. If it is genuinely
   wrong, say why before changing it.
2. **No real clock, network or randomness.** Use fake timers; mocks derive variation from a hash of
   the query.
3. **Name tests as the behaviour they prove.** `rejects a trip one minor unit over the maximum`,
   not `test budget 2`.
4. **A bug fix comes with a regression test** that fails before the fix.
5. **Use the builders** in `src/core/trip/test-support.ts` so a test about budgets does not also
   have to spell out a flight itinerary.
