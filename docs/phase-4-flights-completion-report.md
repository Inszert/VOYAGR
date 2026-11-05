# Phase 4 — Flights completion report

**Status: CLOSED WITH KNOWN LIMITATIONS**, approved 2026-11-05 after an independent final review
(`docs/phase-4-flights-final-review.md`) re-verified every claim in this report against a fresh
test run rather than trusting it on sight. Closure does not mean every item in the original Phase 4
wishlist is implemented - it means everything that fit the existing architecture is done and
verified, and everything left out is a recorded, deliberate deferral, not an unnoticed gap. See
§7-9 below and the final review for the full justification.

**Date:** 2026-11-05.

---

## 1. What the audit found

Full detail in `docs/phase-4-flights-audit.md`. The headline finding: the Phase 4 master prompt
describes a classic OTA-style flight search (one-way/round-trip, adults/children/infants, cabin
class, a list of individual flights). Voyagr is architected around a different model entirely -
whole trips, priced together, ranked by value against a flexible date window and a budget. This is
confirmed in the domain types themselves (`FlightOffer.inbound` is required, there is no
cabin-class field anywhere, `SearchProfile.passengers` is one flat headcount), not assumed from
documentation.

## 2. What was implemented

1. **Per-trip quote-freshness display** (highest-value item, previously completely missing from
   the UI despite the underlying computation already existing). `RankedTrip` now carries its own
   `quoteFreshness` verdict, computed once by the orchestrator against the same clock the
   search-wide aggregate banner already used - the two can never disagree. `TripCard` shows a
   short, quiet notice ("May have moved - checked 15 Jan, 09:00 UTC") only when a trip's quote is
   actually stale; nothing is shown for a fresh or unjudged quote, keeping the common case quiet.
2. **A price-range lower bound** (`ResultFilters.minTotal`), mirroring the existing upper bound
   exactly - same parsing, same validation, same UI placement.
3. **A fresh, from-scratch evaluation of free flight-data providers** (`docs/phase-4-flights-provider-evaluation.md`),
   confirming Aviasales/Travelpayouts remains the only genuinely free, legally defensible source,
   and specifically ruling out every "free Google Flights API" reseller found this time as both a
   trial-credit trap and an unauthorised scrape of a product Voyagr has no standing to redistribute.
   Also confirmed, from current information rather than an old assumption, that Amadeus's
   Self-Service free tier no longer exists (decommissioned 17 July 2026).

## 3. Files changed

| File                                                                                      | Why                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/search/types.ts`                                                                     | `RankedTrip.quoteFreshness` field                                                                                                                                                                                                                                                                       |
| `src/search/orchestrator.ts`                                                              | Computes and attaches it, reusing the exact value already computed for the aggregate                                                                                                                                                                                                                    |
| `src/search/evaluate.ts`                                                                  | Honest `'unknown'` default for the pure, clock-free evaluation path (component swapping)                                                                                                                                                                                                                |
| `src/components/search/trip-card.tsx`                                                     | The per-trip notice, and a deterministic (non-locale, non-`Date`-based) timestamp formatter chosen specifically to avoid an SSR/hydration mismatch                                                                                                                                                      |
| `src/components/search/test-support.ts`                                                   | `buildRankedTrip` accepts a freshness override for tests                                                                                                                                                                                                                                                |
| `src/components/search/search.test.tsx`                                                   | 2 new tests: notice shown when stale, absent when fresh/unknown                                                                                                                                                                                                                                         |
| `src/search/orchestrator.test.ts`                                                         | 2 new tests: the per-trip value matches the aggregate it was counted under                                                                                                                                                                                                                              |
| `src/search/filters.ts`, `filters.test.ts`                                                | `minTotal` filter, mirroring `maxTotal`                                                                                                                                                                                                                                                                 |
| `src/components/search/result-filters.tsx`                                                | The new "Total at least" field                                                                                                                                                                                                                                                                          |
| `scripts/migrate.mjs`                                                                     | _Unrelated, from the DB-diagnosis session earlier today_ - a real bug found along the way: the script's outer error handler swallowed every failure silently (`catch {}`, no logging). Fixed to actually report what failed. Left uncommitted, same as everything else this phase, pending your review. |
| `docs/phase-4-flights-audit.md`, `docs/phase-4-flights-provider-evaluation.md`, this file | New                                                                                                                                                                                                                                                                                                     |

## 4. Provider evaluation summary

See `docs/phase-4-flights-provider-evaluation.md` for the full table. **No new `APPROVED` live
flight provider exists, and none was added.** Provider classifications, preserved exactly as
approved:

- **Mock** = `DEMO`. The default. Fixture data, clearly labelled, never presented as real.
- **Aviasales/Travelpayouts** = `CONDITIONALLY APPROVED`. Real vendor, genuinely free, but its
  prices are **indicative cached price points, not guaranteed live offers** - a real price
  observed for a similar search at some point, not a quote this exact search received. Safe for
  interactive, user-initiated search; **not yet cleared for unattended background polling**
  (Travel Watch), pending an unanswered question with the vendor about its affiliate terms.
  Unchanged conclusion from phases 2-3, re-verified this phase rather than assumed stale.
- **Duffel** = **technically unreachable / disabled.** `FLIGHT_PROVIDER` has no `'duffel'` value in
  its schema (phase 2); the registry has no code path that can construct the adapter. Not a
  runtime toggle - the value does not exist to select.
- This phase made **no guarantee, implied or explicit, that any flight price or seat availability
  shown by Voyagr is currently bookable.** Mock is demo data; Aviasales is indicative; neither is a
  live, guaranteed offer.

## 5. Data honesty - LIVE / CACHED / INDICATIVE / TEST / UNKNOWN

Already correctly separated before this phase, confirmed rather than rebuilt:

- **Mock** (the default): labelled `DEMO DATA`/`test`-tier provenance, `'intrusive'` emphasis -
  the loudest label the system has, and it poisons the whole trip's combined provenance.
- **Aviasales** (when configured): `'indicative'` - a real vendor price, explicitly not a quote
  for this exact search, and never shown as a guaranteed live offer.
- **Freshness** (new, this phase): `fresh`/`stale`/`unknown`, now visible per trip, not only as a
  search-wide count.

Nothing in this phase changed what counts as LIVE versus CACHED versus INDICATIVE - that system
already existed and was already correct; this phase made one previously-invisible part of it
(freshness) visible.

## 6. Test results

| Check                      | Command                                                                                                                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck                  | `npm run typecheck`                                                                                                                                            | **PASS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Lint                       | `npm run lint`                                                                                                                                                 | **PASS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Format                     | `npm run format:check`                                                                                                                                         | **PASS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Unit/component             | `npm test`                                                                                                                                                     | **1274/1330 pass.** 56 failures: the same 53 pre-existing, unrelated Postgres `ECONNRESET` failures as every prior phase, **plus 3 new, also unrelated to this phase**: `src/providers/weather/open-meteo.test.ts` fails on its own, in isolation, confirmed not caused by anything this phase touched (`git status` shows zero changes to the weather module). Root cause: the test hardcodes `2026-11-04` and reads the real system clock rather than an injected one: the session's own date rolled over to 2026-11-05 between phases, which moved that date from "today" to "yesterday" and changed which code path the adapter takes. A real, pre-existing test fragility, out of this phase's scope to fix (Weather is explicitly excluded from Phase 4), flagged honestly rather than silently absorbed into "no regressions." |
| Build                      | `FLIGHT_PROVIDER=mock npm run build`                                                                                                                           | **PASS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| E2E (flights/search/globe) | `playwright test tests/e2e/search.spec.ts --workers=1`                                                                                                         | **PASS, 72/72**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Browser verification       | Playwright MCP, real Chrome, mock data (whose fixed `observedAt` is genuinely ~10 months old against today's real clock, which is what makes it visibly stale) | **Confirmed directly**: the per-trip notice renders exactly as designed ("May have moved - checked 15 Jan, 09:00 UTC"), the new "Total at least (EUR)" filter field renders correctly labelled, zero console errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**New tests added this phase:** 2 (orchestrator) + 2 (component) + 2 (filters) = 6, all passing.

## 7. Known limitations

- One-way search, passenger-age tiers, and cabin class remain unimplemented - a product-model
  decision (§0 of the audit), not a defect, and explicitly not attempted without that decision.
- An explicit airline filter and an explicit flight-duration filter, both named in the original
  wishlist, were not implemented this phase. **This is a deferred limitation, not a bug**: the
  final review (§9 there) assessed both individually against necessity, data availability and
  implementation risk, and recommended deferring them precisely because they are not required for
  the product to function correctly - not because anything about them failed. Recorded as the
  natural next increment, same shape as `minTotal`, requiring no architecture change.
- The pre-existing Postgres connectivity issue remains unresolved (separate, ongoing diagnosis
  from earlier today - not a Flights concern).
- The open-meteo test's real-clock fragility (§6) should be fixed by whoever next touches Weather -
  inject a clock the same way the orchestrator's own tests already do.

## 8. Remaining to complete Phase 4 fully

1. A human decision on one-way/passenger-tiers/cabin-class - implement only after that, given the
   scope of the ripple (cost engine, constraints, scoring, every provider adapter, every UI
   surface that reads `FlightOffer`).
2. Airline and flight-duration filters, if still wanted, following the `minTotal` pattern exactly.
3. Nothing else from the acceptance criteria is outstanding within the existing architecture.

## 9. Verdict

**PHASE 4 CLOSED WITH KNOWN LIMITATIONS**, approved 2026-11-05 after an independent final review
(`docs/phase-4-flights-final-review.md`) re-verified this report's claims against a fresh test run
rather than trusting them on sight - full evidence there.

Everything that fits the existing whole-trip architecture and was safely achievable without a
product decision is done, tested, and verified in a real browser: price/availability honesty is
measurably more complete than it was (freshness is no longer invisible), filters gained their
missing price floor, and the provider landscape was re-evaluated from scratch rather than assumed
unchanged. What is **not** done - one-way search, passenger-age tiers, cabin class, an explicit
airline/duration filter - is recorded here precisely, not glossed over, because marking it complete
would not be true. None of it blocks closure: each is a recorded, deliberate deferral assessed on
its own merits, not an unnoticed gap or a failure.
