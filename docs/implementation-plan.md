# Implementation plan

Where the project is and what comes next. Derived from `PRODUCT-SPECIFICATION.md` sections 25 and
26 — the phase structure and delivery order are the specification's, not invented here.

---

## Stage 0 — Engineering foundation ✅ complete

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

The goal is one loop, working reliably:

> a user creates a trip watch → the system keeps searching → it finds a materially better trip →
> the user gets an alert → the user can understand and act on it.

Everything below serves that loop. Anything that does not is deferred.

### 1.1 Search orchestration

Fan out across origins, destinations and date windows; call the flight, hotel, transfer and weather
adapters concurrently; assemble `TripCandidate` combinations.

- Partial provider failure degrades the result set; it never fails the search.
- Bound the combinatorics before it bounds itself — a flexible-date × multi-airport × anywhere
  search explodes quickly.
- **Done when:** a search returns ranked, costed, constrained candidates from mocks, with one
  adapter deliberately failing and the search still returning results.

### 1.2 Search UI and structured schema

The search form, the results list, and a trip detail view.

- Structured input first; natural language sits on top of it, not underneath.
- Cost breakdown shows every line with its confidence tag. Estimates look different from quotes.
- No-Surprise warnings are visible before the user acts.
- **Done when:** a user can run a search and understand why the top result ranks first.

### 1.3 Accounts and preferences

Authentication, `users` and `user_preferences`. Explicit preferences stored separately from
inferred ones, so section 31.7's transparency requirement is possible at all.

- **Done when:** a user can sign in, and preferences survive a restart.

### 1.4 Postgres persistence

Implement `Repositories` against Postgres. Apply `0001_init.sql`.

- The in-memory implementation stays, and the test suite keeps using it.
- **Done when:** the same repository tests pass against both backends.

### 1.5 Saved searches and Travel Watches

A search becomes a watch. Status, priority, `nextRunAt`.

- **Done when:** a saved watch persists and appears with its next scheduled run.

### 1.6 Workers and scheduled refresh

BullMQ driver behind the existing queue interface; a scheduler that picks up due watches.

- Adaptive frequency per section 17: roughly 6–12h normally, 1–3h for high priority, subject to
  provider rate limits and cost.
- Deduplicate: a watch already queued is not queued again.
- **Done when:** watches refresh on schedule against mocks, with Redis running, and the schedule
  survives a worker restart.

### 1.7 Price history

Record every observation with source, timestamp, currency and conditions. A price without
provenance cannot honestly be shown.

- **Done when:** a watch accumulates history and the lowest observed total can be queried.

### 1.8 Deal detection

Compare a fresh result against history and decide — deterministically — whether the change is
material. Severity is assigned here, never by a model.

- Thresholds are explicit and tunable. A EUR 2 drop on EUR 240 is not an alert.
- **Done when:** a materially better trip produces exactly one alert, and a trivial change produces
  none.

### 1.9 Web Push notifications

VAPID keys, subscription management, delivery through the existing channel abstraction. Alert
wording may come from the model; the decision to send never does.

- **Done when:** a detected deal reaches a real browser as a notification that deep-links to the
  trip.

### 1.10 Flight and hotel swapping

Swap a component and recalculate the total, usable time and score.

- **Done when:** swapping a flight updates every derived figure consistently.

### 1.11 First live provider

One flight source and one hotel source behind the existing adapters.

- Nothing outside the adapter changes. That is the test of whether the abstraction was right.
- **Done when:** a live search returns normalised offers, and the mocks still work for tests.

---

## Phase 2 — Intelligence

Buy/Wait, price-history presentation, deal score surfacing, restaurants, activities, AI itinerary,
what-if simulator, flexible-date heatmap, alternative airports, smarter notification rules.

Predictions are probabilistic and labelled as such. The system never implies a guaranteed price.

## Phase 3 — Discovery and personalisation

Anywhere mode, Surprise Me, Hidden Gems, the transparent travel profile, adaptive monitoring
frequency, budget allocation, group travel, richer PWA.

## Phase 4 — Autonomous travel agent

Stated once, optimised continuously. Booking preparation and, only where integrations, payment
controls, legal review and explicit authorisation permit, assisted booking.

---

## Sequencing rules

1. **The loop before the breadth.** One flight provider and one hotel provider working end to end
   beats five providers and no monitoring.
2. **Deterministic before intelligent.** Cost and ranking must be right before an explanation is
   written about them.
3. **Mocks stay.** Every live provider keeps a mock sibling. The test suite never requires network.
4. **Each stage ships testable.** If a stage cannot be verified without the next one, it is scoped
   wrong.

## Open decisions

Carried forward from `SETUP-CHECKLIST.md`; none block Phase 1 development, all block their own
integration:

| Decision                          | Blocks                     |
| --------------------------------- | -------------------------- |
| Flight and hotel provider vendors | 1.11                       |
| LLM vendor                        | AI explanations going live |
| Postgres hosting (local/managed)  | 1.4                        |
| Redis hosting                     | 1.6                        |
| Deployment target                 | Any deployment             |
| Git remote / repo hosting         | CI actually running        |
| Monetisation model                | Phase 2+ commercial work   |
