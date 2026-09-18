# Implementation plan

Where the project is and what comes next. Derived from `PRODUCT-SPECIFICATION.md` sections 25 and
26 — the phase structure and delivery order are the specification's, not invented here.

---

## Stage 0 — Engineering foundation ✅ complete

_In plain words: we built all the Lego bricks first. The app itself is not built yet._

Everything needed to build Phase 1 without external services.

- Next.js App Router + TypeScript scaffold, npm, strict `tsconfig`.
- Deterministic core: money, true trip cost, hard constraints, usable vacation time, explainable
  scoring — with unit tests at the boundaries.
- Provider adapter interfaces plus deterministic mocks for flights, hotels, weather, transfers and
  places.
- AI abstraction with guardrails and a deterministic mock provider.
- Repository interfaces with an in-memory implementation; Postgres schema written, not required.
- Queue contract with a full in-process driver; Redis not required.
- Web Push channel abstraction and service worker.
- Design system: Radix primitives on Tailwind tokens, accessible by construction.
- Structured logging, error taxonomy, security baseline, CI, Playwright smoke suite with axe.

**Not** included: any product feature.

---

## Phase 1 — MVP

_In plain words: make the app do its one big job — watch trips and shout when a better one appears._

The goal is one loop, working reliably:

> a user creates a trip watch → the system keeps searching → it finds a materially better trip →
> the user gets an alert → the user can understand and act on it.

Everything below serves that loop. Anything that does not is deferred.

### 1.1 Search orchestration

_In plain words: ask about flights, hotels, rides and weather all at once, then glue them into whole trips._

Fan out across origins, destinations and date windows; call the flight, hotel, transfer and weather
adapters concurrently; assemble `TripCandidate` combinations.

- Partial provider failure degrades the result set; it never fails the search.
- Bound the combinatorics before it bounds itself — a flexible-date × multi-airport × anywhere
  search explodes quickly.
- **Done when:** a search returns ranked, costed, constrained candidates from mocks, with one
  adapter deliberately failing and the search still returning results.

### 1.2 Search UI and structured schema

_In plain words: build the screens where you say what you want and see the trips we found._

The search form, the results list, and a trip detail view.

- Structured input first; natural language sits on top of it, not underneath.
- Cost breakdown shows every line with its confidence tag. Estimates look different from quotes.
- No-Surprise warnings are visible before the user acts.
- Booking hand-off is a single seam: every outbound link is built in one place from the offer's
  `deepLink`, never assembled in a component. Affiliate attribution (§24.4) is then a change to
  that builder, not to the results list.
- **Done when:** a user can run a search and understand why the top result ranks first.

### 1.3 Accounts and preferences

_In plain words: let people log in, and remember what each person likes._

Authentication, `users` and `user_preferences`. Explicit preferences stored separately from
inferred ones, so section 31.7's transparency requirement is possible at all.

- Every user carries a `plan` (`free` for now) and an entitlement set resolved from it. Shipping
  one plan is fine; hard-coding its limits instead of resolving them is not — §24.2 and §24.3
  would then be a rewrite rather than a new row.
- **Done when:** a user can sign in, and preferences survive a restart.

### 1.4 Postgres persistence

_In plain words: put everything in a real database so it is still there tomorrow._

Implement `Repositories` against Postgres. Apply `0001_init.sql`.

- The in-memory implementation stays, and the test suite keeps using it.
- **Done when:** the same repository tests pass against both backends.

### 1.5 Saved searches and Travel Watches

_In plain words: let you keep a search, so the app keeps looking for you after you close it._

A search becomes a watch. Status, priority, `nextRunAt`.

- The active-watch limit is read from the user's entitlements, not from a constant.
- **Done when:** a saved watch persists and appears with its next scheduled run.

### 1.6 Workers and scheduled refresh

_In plain words: little helpers in the background check your saved trips again and again on a timer._

BullMQ driver behind the existing queue interface; a scheduler that picks up due watches.

- Adaptive frequency per section 17: roughly 6–12h normally, 1–3h for high priority, subject to
  provider rate limits and cost.
- Deduplicate: a watch already queued is not queued again.
- Refresh frequency is bounded by the user's entitlements as well as by provider rate limits, so
  a faster tier later is configuration, not a scheduler change.
- **Done when:** watches refresh on schedule against mocks, with Redis running, and the schedule
  survives a worker restart.

### 1.7 Price history

_In plain words: write down every price we see, and where and when we saw it._

Record every observation with source, timestamp, currency and conditions. A price without
provenance cannot honestly be shown.

- **Done when:** a watch accumulates history and the lowest observed total can be queried.

### 1.8 Deal detection

_In plain words: compare the new price to the old ones and decide if it is a real bargain worth telling you about._

Compare a fresh result against history and decide — deterministically — whether the change is
material. Severity is assigned here, never by a model.

- Thresholds are explicit and tunable. A EUR 2 drop on EUR 240 is not an alert.
- **Done when:** a materially better trip produces exactly one alert, and a trivial change produces
  none.

### 1.9 Web Push notifications

_In plain words: send the "good news!" message to your phone or computer._

VAPID keys, subscription management, delivery through the existing channel abstraction. Alert
wording may come from the model; the decision to send never does.

- **Done when:** a detected deal reaches a real browser as a notification that deep-links to the
  trip.

### 1.10 Flight and hotel swapping

_In plain words: let you switch one flight or hotel, and fix every number to match._

Swap a component and recalculate the total, usable time and score.

- **Done when:** swapping a flight updates every derived figure consistently.

### 1.11 First live provider

_In plain words: stop using pretend travel data and plug in one real flight source and one real hotel source._

One flight source and one hotel source behind the existing adapters.

- Nothing outside the adapter changes. That is the test of whether the abstraction was right.
- **Done when:** a live search returns normalised offers, and the mocks still work for tests.

---

## Phase 2 — Intelligence

_In plain words: teach the app to guess if a price will go up or down, and to help plan the trip itself._

Buy/Wait, price-history presentation, deal score surfacing, restaurants, activities, AI itinerary,
what-if simulator, flexible-date heatmap, alternative airports, smarter notification rules.

Predictions are probabilistic and labelled as such. The system never implies a guaranteed price.

## Phase 3 — Discovery and personalisation

_In plain words: help you find places you never thought of, and learn what kind of traveller you are._

Anywhere mode, Surprise Me, Hidden Gems, the transparent travel profile, adaptive monitoring
frequency, budget allocation, group travel, richer PWA.

### Noted, not yet planned — the globe explorer

_In plain words: a spinning globe you can click a country on, then zoom into a map full of
interesting places, and build a trip across several countries at once._

A concept recorded here so later decisions do not quietly rule it out. Nothing below is scheduled,
scoped or estimated.

The idea: an interactive globe as the discovery surface. Countries are selectable; selecting one
drops into a map view; filters ("secret spots", "fun", "food", "nature", "nightlife") pull places
onto that map; and from there a trip can be assembled across **several countries in one itinerary**,
with ground legs — car rental, rail, ferry — as first-class parts of the trip rather than
afterthoughts.

What it would force us to revisit, and why it is worth writing down now:

- **The trip shape.** `TripCandidate` today is one origin, one destination, one flight, one hotel.
  A multi-country trip is a sequence of legs and stays. That is a new domain type, not a bigger
  version of the current one — and cost, constraints, usable time and scoring all read it.
- **A ground-transport provider kind.** Car rental, rail and ferry are not `transfers`. Car rental
  in particular carries deposits, insurance, fuel policy and one-way fees — exactly the kind of
  cost that must land as tagged `known` / `estimated` / `excluded` lines rather than disappear.
- **A geo layer.** Country and region geometry, place coordinates and map tiles are a data
  dependency we do not have. Tile and geocoding licensing is a real constraint, not a detail.
- **Filters are a query, not a vibe.** "Secret places" has to reduce to something deterministic —
  a rating, review-count and popularity threshold over the places provider — or it cannot be
  explained, tested or trusted.
- **Accessibility.** A globe cannot be the only way in. Every country and place reachable by
  spinning and clicking must be reachable by keyboard and by a plain list, or the surface fails
  the line held in `design-system.md`.
- **Performance and cost.** A globe is a heavy client surface, and a multi-country search
  multiplies provider calls. Both collide with the combinatorial bound set in 1.1.

Sequencing instinct, for whenever this is picked up: the multi-leg trip type comes first and is
testable on its own; the globe is a view over data that must already exist.

## Phase 4 — Autonomous travel agent

_In plain words: the app looks after your trip by itself, and can even help you book it._

Stated once, optimised continuously. Booking preparation and, only where integrations, payment
controls, legal review and explicit authorisation permit, assisted booking.

---

## Monetisation readiness (specification §24)

_In plain words: make sure we can switch on any way of earning money later, without rebuilding._

No monetisation ships in Phase 1. The point of this section is that none of §24.1–24.5 is locked
out by what Phase 1 builds. Each model needs a seam, and a seam is cheap now and expensive later.

| Spec  | Model                      | What it needs                                                                                                              | Where it lands                   |
| ----- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| §24.1 | Transaction / service fee  | A fee as a real `CostLine` in its own `CostCategory`, computed from eligible spend by `src/core/`, shown before commitment | Phase 2                          |
| §24.2 | Annual subscription        | A `plan` on the user and entitlements resolved from it: watch limits, refresh frequency, feature gates                     | Hook in 1.3; billing in Phase 2  |
| §24.3 | Hybrid                     | Nothing new — the fee rate is resolved from the plan                                                                       | Falls out of 24.1 + 24.2         |
| §24.4 | Affiliate / partner        | One outbound booking seam carrying attribution, plus click and conversion records                                          | Hook in 1.2; the rest in Phase 2 |
| §24.5 | Sponsored, B2B, premium AI | A placement flag that is displayed and never scored, and per-plan feature gates                                            | Phase 2+                         |

**Already in place.** `FlightOffer.deepLink` and `HotelOffer.deepLink` exist on the normalised
offers, so an affiliate URL has somewhere to live without a type change. Cost lines are already
tagged, attributed and timestamped, which is exactly what a displayed fee needs. `Money` does
percentage arithmetic with explicit rounding and remainder-preserving allocation, so 0.5% of a
total has a correct answer rather than a float.

**Deliberately absent.** No fee cost category, no plan or entitlement concept, no attribution or
conversion records, no placement flag. Each is an addition when a model is chosen — not rework,
provided the hooks in 1.2, 1.3, 1.5 and 1.6 exist.

**Carry §24.1's own caveat forward.** A redirect-only product generally cannot add its own fee to
someone else's checkout; that needs a merchant, payment or partner structure and legal review. This
is why §24.4 is the more natural first model, and why 1.2's hand-off seam matters more than the
fee arithmetic.

**The invariant, whichever model wins.** Revenue never moves a result up the list. A fee is shown
before the user commits, a commission is disclosed, a sponsored slot is labelled and sits where its
score puts it. Easiest to hold by never letting a commercial figure reach `scoring.ts` at all.

## Sequencing rules

_In plain words: the order we build things in, and why that order matters._

1. **The loop before the breadth.** One flight provider and one hotel provider working end to end
   beats five providers and no monitoring.
2. **Deterministic before intelligent.** Cost and ranking must be right before an explanation is
   written about them.
3. **Mocks stay.** Every live provider keeps a mock sibling. The test suite never requires network.
4. **Each stage ships testable.** If a stage cannot be verified without the next one, it is scoped
   wrong.
5. **Money models never touch ranking.** A fee, a commission or a sponsored slot may change what
   the user is told about a result. It may never change the result's position.

## Open decisions

_In plain words: choices only you can make, which nothing can start without._

Carried forward from `SETUP-CHECKLIST.md`; none block Phase 1 development, all block their own
integration:

| Decision                          | Blocks                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| Flight and hotel provider vendors | 1.11                                                           |
| LLM vendor                        | AI explanations going live                                     |
| Postgres hosting (local/managed)  | 1.4                                                            |
| Redis hosting                     | 1.6                                                            |
| Deployment target                 | Any deployment                                                 |
| Git remote / repo hosting         | CI actually running                                            |
| Monetisation model (§24)          | Fee, subscription or affiliate go-live — not the Phase 1 hooks |
