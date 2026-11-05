# Phase 4 — Flights audit

**Date:** 2026-11-05. Evidence-based: every claim below is a file path, a grep result, or a test
count actually run, not a read of prior documentation. Where this document disagrees with an
earlier one, trust this one for the current code.

---

## 0. The central finding — a product-model mismatch, read before anything else

The Phase 4 master prompt describes a **classic OTA-style flight search**: fixed departure/return
dates, one-way vs round-trip, adults/children/infants, cabin class, a list of individual flights
sorted and filtered.

**Voyagr is not that product, by original design, not by accident or omission.** Per
`docs/PRODUCT-SPECIFICATION.md` and the actual domain model, Voyagr prices **whole trips** —
flights, a hotel, and transfers together, ranked by value against a flexible date _window_ and a
budget, not a single fixed itinerary search. Concretely, confirmed in the code:

- `SearchProfile.passengers` (`src/core/trip/types.ts:238`) is one flat headcount. No
  adults/children/infants breakdown exists anywhere in the schema, the core types, or either
  provider adapter.
- There is no cabin-class field anywhere in `FlightSearchQuery`, `FlightOffer`, `SearchProfile`,
  or the form (`src/components/search/search-form.tsx`). Zero matches for `cabinClass` in the
  entire `src/` tree.
- `FlightOffer.inbound: FlightLeg` (`src/core/trip/types.ts:125`) is **required**, not optional —
  the domain model has no way to represent a one-way flight at all. Same for
  `FlightSearchQuery.returnDate: IsoDate` (`src/providers/types.ts:147`), also required.
- The search form has no departure/return date pickers. It has **"Earliest departure"**,
  **"Latest return"**, **"Shortest trip (nights)"** and **"Longest trip (nights)"** — a window and
  a duration range, not two fixed dates. Confirmed by reading `search-form.tsx` directly, not
  assumed from a label.

**This is not a gap to be filled mechanically.** `CLAUDE.md`'s own Phase 4 instructions say, in the
same breath as the rest of the wishlist: _"Zachovaj existujúcu architektúru... Nerob redesign celej
aplikácie... Ak je nevyhnutná zmena spoločnej komponenty, musí byť minimálna."_ Retrofitting a
one-way/round-trip toggle, three passenger-age tiers and cabin class onto `FlightOffer` would
ripple through `src/core/trip/cost.ts`, `constraints.ts`, `scoring.ts`, every provider adapter, and
every UI component that reads a `FlightOffer` — that is a product-direction change, not "the
smallest safe change."

**Recommendation, acted on below:** implement everything from the Phase 4 wishlist that fits
inside the existing whole-trip model (price/availability honesty, filters, sorting, error
handling, tests, documentation), and **document, rather than silently build or silently skip**, the
parts that would require a real product decision first (one-way search, passenger-age tiers, cabin
class). Flagging this up front rather than either forcing a mismatched redesign or quietly ignoring
explicit instructions.

---

## 1. What actually works today

| Area                                            | Status                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider registry / fail-closed resolution      | **DONE**                                         | `src/providers/registry.ts`, already hardened in phase 2 (Duffel technically unselectable)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Mock flight provider                            | **DONE**                                         | `src/providers/flights/mock.ts`, deterministic, 9+ tests in `providers.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Aviasales/Travelpayouts adapter                 | **DONE, honest, `PENDING` to activate**          | `src/providers/flights/aviasales.ts` (448 lines), 29 tests. Refuses to map a connecting flight it cannot honestly represent (no invented middle segment) rather than guessing. Baggage/transfer fields correctly `null`. `observedAt` taken from the vendor's own cached date, not the fetch time — a 2-day-old fare is reported as 2 days old.                                                                                                                                                                                             |
| Duffel adapter                                  | **DONE, code-complete, permanently prohibited**  | `src/providers/flights/duffel.ts` (631 lines), 29 tests against a real recorded sandbox fixture. Cannot be selected (`FLIGHT_PROVIDER` has no `'duffel'` value — phase 2). Retained as a historical reference only.                                                                                                                                                                                                                                                                                                                         |
| Currency conversion for foreign-quoted offers   | **DONE (real)**                                  | ECB-backed (`src/providers/fx/`, phase 3), never invents a rate                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Search orchestration (fan-out, limits, budgets) | **DONE**                                         | `src/search/orchestrator.ts`, 48+ tests, provider-call ceiling, per-provider concurrency, time budget                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Date-window flexibility / "what a week costs"   | **DONE**                                         | `src/search/date-options.ts`, `flexibility.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Filters                                         | **MOSTLY DONE**                                  | `src/search/filters.ts`: max total price, direct-only, max stops, depart-after/arrive-before hour, free cancellation, min review score, exclude self-transfer, require-priced-transfer, date window, destination. **Missing**: explicit airline filter, explicit flight-duration filter, a price-range _lower_ bound (only an upper `maxTotal` exists)                                                                                                                                                                                      |
| Sorting                                         | **PARTIAL, at the wrong level for the wishlist** | Ranking (`optimisationMode`: best value / cheapest / nicest-within-budget / etc.) ranks **whole trips**, not individual flights within one route — correct for this product, but does not literally match "fastest / earliest departure" per-flight sorting the wishlist describes                                                                                                                                                                                                                                                          |
| Price/availability provenance                   | **PARTIAL**                                      | Per-trip `ProvenanceBadge`/`SourceStrip` (`trip-card.tsx`) correctly labels DEMO vs the real vendor name, and a mock component already poisons the whole total's label (`combineProvenance`, phase 2/3 finding, unchanged). **Real gap**: `src/core/freshness.ts`'s stale/fresh/unknown classification and `FlightOffer.expiresAt` are **never rendered anywhere in the UI** — confirmed by grep, zero matches. A cached Aviasales fare that is already stale by the engine's own 30-minute rule says nothing about that to the user today. |
| Tests                                           | **STRONG**                                       | 29 (Aviasales) + 29 (Duffel, offline fixture) + 48 (orchestrator) + dedicated filter/sort/schema suites. Full counts in §6                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Documentation                                   | **PARTIAL, now corrected**                       | `docs/provider-policy.md`/`docs/provider-evaluation.md` (phase 2/3) already accurately track Aviasales as `PENDING`. This document and its siblings are new.                                                                                                                                                                                                                                                                                                                                                                                |

## 2. What is mock / simulation only

- The **default** flight provider is `mock` (`FLIGHT_PROVIDER` defaults to `'mock'`,
  `src/lib/env.ts`) — every flight shown is fixture data unless explicitly configured otherwise.
- Duffel is code-complete but **permanently prohibited** (zero-billing policy, phase 2) — not a gap
  to close, a deliberate wall.
- Aviasales is real and free but currently `PENDING`, not `APPROVED` (§3) — one unresolved term
  with the vendor, inherited unchanged from phase 2/3's own audit.

## 3. What is partially implemented

- **Price/availability labelling**: the mechanism exists (`DataProvenance`, `combineProvenance`,
  `PROVENANCE_LABEL`) but the specific LIVE/CACHED/INDICATIVE/TEST/UNKNOWN vocabulary the Phase 4
  prompt asks for, and the "last verified" timestamp for cached data, are not fully surfaced for
  flights specifically. See §4.
- **Filters**: present, missing an explicit airline filter and an explicit duration filter (price
  lower bound also missing — see §1 table).

## 4. What is completely missing

- **Freshness/staleness display** for flight offers — `src/core/freshness.ts` is never read by any
  component. This is the single highest-value, lowest-risk item from the Phase 4 wishlist: it fits
  the existing architecture exactly (the data already exists; it is a rendering gap, not a new
  provider or a schema change) and is explicitly called out as critical in Etapa 4 of the prompt.
- **One-way search, passenger-age tiers, cabin class** — see §0. Not implemented; a product
  decision, not a bug.
- **Explicit airline filter, explicit flight-duration filter, price-range lower bound** — small,
  additive, low-risk; fit the existing `ResultFilters` shape exactly.

## 5. Technical obstacles

- Aviasales cannot honestly represent a connecting flight (no connection airport/time in the
  response) — already correctly handled by refusing to map it, not an obstacle to overcome, a
  limit to keep respecting.
- No second free, legally-clear flight-price source exists beyond Aviasales (see
  `docs/phase-4-flights-provider-evaluation.md` for the fresh search this phase).
- The whole-trip domain model (`FlightOffer.inbound` required) is the real technical obstacle to
  one-way search, not provider availability.

## 6. What can be safely reused

Everything in §1 marked DONE. The provider adapter pattern, the `Result`/`AppError` handling, the
provenance system, the filter/sort infrastructure, and the test harness (recorded-cassette pattern
for Aviasales/Duffel) are all solid foundations — Phase 4's work builds on them rather than
replacing any of them.

## 7. Completion plan for this phase

1. Re-evaluate free flight-data providers from scratch (`docs/phase-4-flights-provider-evaluation.md`)
   — confirm Aviasales's status is still accurate, look for anything new.
2. Implement freshness/staleness display for flight offers (highest value, fits architecture, no
   schema change).
3. Add the missing filters that fit the existing model: airline, flight duration, price-range lower
   bound.
4. Strengthen error/empty-state handling for the flight search path specifically.
5. Add unit/integration/e2e test coverage for everything above.
6. Write `docs/phase-4-flights-completion-report.md` with an honest PHASE 4 COMPLETE /
   PARTIALLY COMPLETE / BLOCKED verdict — expected to be **PARTIALLY COMPLETE**, given §0's finding
   that one-way/passenger-tiers/cabin-class are out of this phase's safe scope without a product
   decision.
