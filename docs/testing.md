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

None of these require a database, Redis, provider credentials or an AI key. If a test ever needs
one, something has stopped being mockable — treat that as a design problem, not a setup problem.

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
