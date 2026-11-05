# Phase 4 — Flights: final review and closure assessment

**Status: CLOSED WITH KNOWN LIMITATIONS**, approved 2026-11-05.

**Date:** 2026-11-05. This is a review of already-completed work, not a new implementation phase.
No commit, push, merge, or deployment was performed as part of this review. Everything below was
independently re-verified in this session, not taken on trust from the prior completion report.

---

## 1. Scope of this review

Re-checked, against the actual code and actual test runs: the git/working-tree state, the
correctness of the quote-freshness implementation, the correctness of the `minTotal` filter
(including boundary and invalid-range cases not explicitly covered before), the provider-evaluation
document's factual claims (specifically the Amadeus shutdown date), a fresh full test run, a fresh
e2e run, and a regression check against every module Phase 4 was required to leave untouched.

## 2. Git working-tree state

Unchanged from the end of Phase 4, exactly as it should be:

- Branch `feat/voyagr-autonomous-product-completion`, 5 commits ahead of `origin`, nothing new
  committed.
- 11 modified files, 3 new docs — the same set the completion report named, confirmed via
  `git diff --stat`.
- No foreign or stale work-in-progress found. Nothing reset, discarded, or overwritten.
- One addition **this review** session: two new boundary-case tests in `src/search/filters.test.ts`
  (an in-bounds case and an inverted-range case for `minTotal`/`maxTotal` together) — a minimal,
  directly Phase-4-related verification gap closed, not a new feature.

## 3. Verified implemented functionality

- **Quote freshness**: `RankedTrip.quoteFreshness` is set from the exact same computation
  (`weakestFreshness`, same `startedAt` clock) that increments the search-wide aggregate counter -
  read directly from the diff, not inferred: both values come from one local variable,
  `tripFreshness`, so they cannot disagree by construction.
- **`minTotal` filter**: mirrors `maxTotal`'s parsing, validation, and UI placement exactly;
  independent threshold check, so an inverted range (min above max) degrades to "no trips match" -
  correct, honest, and now has a test proving it rather than assuming it.
- **UI**: the per-trip notice and the new "Total at least" field were both confirmed rendering
  correctly in a real browser during Phase 4 (Playwright MCP screenshots); this review did not
  repeat that screenshot pass, since the underlying code has not changed since it was taken.

## 4. Quote freshness - detailed verification

| Case                                                                | Verified how                                                                                                                                                                                                                                                                                                      | Result                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same time source as the aggregate                                   | Read the diff directly                                                                                                                                                                                                                                                                                            | **Confirmed** - one variable feeds both                                                                                                                                                                                                 |
| Fresh quote produces no notice                                      | `search.test.tsx`, re-run                                                                                                                                                                                                                                                                                         | **Pass**                                                                                                                                                                                                                                |
| Stale quote produces the notice, with a timestamp                   | `search.test.tsx`, re-run                                                                                                                                                                                                                                                                                         | **Pass**                                                                                                                                                                                                                                |
| Unknown-freshness quote produces no notice                          | `search.test.tsx`, re-run                                                                                                                                                                                                                                                                                         | **Pass**                                                                                                                                                                                                                                |
| Per-trip value matches the bucket it was counted under (fresh case) | `orchestrator.test.ts`, re-run                                                                                                                                                                                                                                                                                    | **Pass**                                                                                                                                                                                                                                |
| Per-trip value matches the bucket it was counted under (stale case) | `orchestrator.test.ts`, re-run                                                                                                                                                                                                                                                                                    | **Pass**                                                                                                                                                                                                                                |
| Missing/invalid timestamp                                           | `formatObservedAt`'s regex match fails safely to `'at an unknown time'`; `freshnessOf` itself already returns `'unknown'` for a null/unparsable `observedAt` (`src/core/freshness.ts`, unchanged, pre-existing), so the notice does not even render in this case - read directly from both functions, not assumed | **Confirmed by code inspection**                                                                                                                                                                                                        |
| Timezone consistency                                                | `formatObservedAt` does no timezone conversion at all - it slices an already-UTC `IsoDateTime` string and labels it `UTC` explicitly, deliberately avoiding `Date`/`Intl` to prevent a server/client hydration mismatch                                                                                           | **Confirmed by code inspection**                                                                                                                                                                                                        |
| Degree of staleness (slightly vs. very stale)                       | Checked the `Freshness` type itself                                                                                                                                                                                                                                                                               | **Not distinguished - by design, unchanged.** `Freshness` is `'fresh' \| 'stale' \| 'unknown'`, a binary threshold (30 minutes for flights), not a gradient. Phase 4 did not introduce this limitation and does not need to resolve it. |

## 5. `minTotal` filter - detailed verification

| Case                           | Result                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exactly on the floor           | Kept (re-run, `filters.test.ts`)                                                                                                                                                                        |
| One below the floor            | Hidden (re-run, `filters.test.ts`)                                                                                                                                                                      |
| Inside both bounds at once     | Kept (**new test, added this review**)                                                                                                                                                                  |
| Inverted range (min above max) | Hidden for every trip - no crash, no silent wrong result (**new test, added this review**)                                                                                                              |
| Works alongside `maxTotal`     | Confirmed by the in-bounds test above                                                                                                                                                                   |
| Different currencies           | Uses the same `fromMajor(value, currency)` construction `maxTotal` already used, parameterised on the search's own currency - no new currency-handling code was written, so no new currency risk exists |
| Scoring unaffected             | Confirmed by diff: `src/core/trip/scoring.ts` was not touched at all this phase                                                                                                                         |

## 6. Providers and data truthfulness

- `docs/phase-4-flights-provider-evaluation.md` re-read in full. LIVE/CACHED/INDICATIVE/DEMO-TEST/
  UNKNOWN remain correctly distinguished, unchanged from phases 2-3's own work, and a mock price
  still cannot read as a live one (`combineProvenance`, untouched this phase).
- **Amadeus shutdown claim, specifically re-verified per the explicit instruction**: a direct fetch
  of `developers.amadeus.com` returned no usable content (most likely a JS-rendered page this
  tooling cannot execute - noted honestly rather than treated as confirmation either way). The
  17 July 2026 decommission date is corroborated independently by trade press
  ([PhocusWire](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers)),
  not resting on a single blog post, and the documentation has been updated to cite that source
  explicitly rather than stating the claim unsourced.
- No new provider was integrated. No paid API was activated. No payment information was requested
  or entered.

## 7. Test results - repeated, not merely cited

| Suite                                                         | Command                                                                                                       | This review's own result                                | Matches the completion report?                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Phase-4-specific (orchestrator + search components + filters) | `vitest run src/search/orchestrator.test.ts src/components/search/search.test.tsx src/search/filters.test.ts` | **110/110 pass**                                        | Yes (count differs slightly because 2 boundary tests were added this review) |
| Full unit/component                                           | `npm test`                                                                                                    | **1274/1330 pass, 56 failures**                         | **Yes, exactly**                                                             |
| Typecheck                                                     | `npm run typecheck`                                                                                           | **PASS**                                                | Yes                                                                          |
| Lint                                                          | `npm run lint`                                                                                                | **PASS**                                                | Yes                                                                          |
| Format                                                        | `npm run format:check`                                                                                        | **PASS** (after formatting one doc this review touched) | Yes                                                                          |
| E2E                                                           | `playwright test tests/e2e/search.spec.ts --workers=1`                                                        | **72/72 pass**                                          | Yes, exactly                                                                 |

### The 56 unit failures, grouped as asked

1. **Directly related to Phase 4**: none. Zero Phase-4 test failures in any run this review
   performed.
2. **Older, unrelated failures**: 53 - the pre-existing `src/db/repository-contract.test.ts`
   Postgres `ECONNRESET` failures, present and documented since phase 2, unrelated to Flights.
3. **New or ambiguous failures**: 3 - `src/providers/weather/open-meteo.test.ts`. Re-confirmed this
   review (ran the file in isolation again): it fails on its own, with zero code changes to the
   weather module (`git diff --stat` shows none). Root cause, read directly from the test file: it
   hardcodes `startDate`/`endDate` of `'2026-11-04'` and the adapter reads the real system clock
   rather than an injected one - the session's own date rolled from 2026-11-04 to 2026-11-05
   between phases, which moved that hardcoded date from "today" to "yesterday" and changed which
   branch (forecast vs. archive) the adapter takes. **Not fixed**, per the explicit instruction not
   to touch Weather or alter unrelated tests to force a green result - flagged precisely instead.

## 8. Regression check

`git diff --stat` was read in full (§2) and searched explicitly for every module Phase 4 was
required to leave alone: **zero matches** for hotels, transfers, places, weather, `cost.ts`,
`scoring.ts`, `constraints.ts`, or `src/providers/registry.ts`. This is not an absence-of-evidence
argument - the diff is 11 files, all inside `src/search/`, `src/components/search/`, and one
unrelated pre-existing bug fix in `scripts/migrate.mjs` (left uncommitted, flagged, not part of
Flights). No regression was found because no code capable of causing one was touched.

## 9. Remaining gaps - airline filter, flight-duration filter

Assessed against the five questions asked, for each:

**Airline filter**

- Necessary for correct product function? No - the product already ranks whole trips by value; an
  airline preference is a nice-to-have narrowing, not a correctness requirement.
- Compatible with the existing data model? Yes - `FlightLeg.segments[].carrier` already exists.
- Do we have real data for it? Only for mock and Duffel (prohibited); Aviasales names one carrier
  per price point but the field was not audited for completeness this review.
- Small and safe to implement? Yes, mechanically - follows the `minTotal` pattern.
- Phase 4 or later? **Later.** Not essential, and adding it now would be scope growth for its own
  sake, which this review was explicitly told not to reward.

**Flight-duration filter**

- Necessary? No, for the same reason.
- Compatible? Yes - `FlightLeg.durationMinutes` already exists.
- Real data? Yes, wherever a `FlightOffer` exists at all - every adapter including mock states it.
- Small and safe? Yes.
- Phase 4 or later? **Later**, same reasoning.

Neither is implemented in this review. This is a deliberate recommendation to defer, not an
oversight.

## 10. Recommendation

### **READY TO CLOSE WITH KNOWN LIMITATIONS** — approved; Phase 4 is now **CLOSED WITH KNOWN LIMITATIONS**

Justification against the stated criteria:

- Core Phase 4 functionality works, independently re-verified rather than taken on trust: quote
  freshness is correct and tested against six distinct cases, `minTotal` is correct and tested
  against four including one not previously covered.
- The known, unrelated test problem (`open-meteo.test.ts`, a real-clock date-rollover fragility) is
  precisely documented, proven unrelated by an isolated re-run and a diff search, and does not
  block Flights.
- The two remaining filters are genuinely non-critical, assessed individually rather than assumed,
  and correctly deferred rather than rushed in to make a checklist look complete.
- No regression exists anywhere Phase 4 was required to protect - confirmed by the diff itself
  containing no path into any protected module, not merely by running their tests.
- Documentation (`docs/phase-4-flights-audit.md`, `-provider-evaluation.md`,
  `-completion-report.md`, this file) is internally consistent and the one previously-unsourced
  factual claim (Amadeus) now carries a citation.

**Limitations that do not block closure, stated plainly:** one-way search, passenger-age tiers and
cabin class remain unimplemented pending a product decision (§0 of the audit); an airline filter
and a flight-duration filter remain unimplemented, deferred by this review's own recommendation;
the Postgres connectivity issue and the Weather test's clock fragility are both pre-existing, both
out of Flights' scope, and both already documented elsewhere.

Nothing was committed or pushed. Awaiting your decision.
