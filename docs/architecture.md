# Architecture

How Voyagr is put together, and why. The product itself is defined in
`PRODUCT-SPECIFICATION.md`; this document covers engineering decisions.

Status: **engineering foundation**. The structure below exists and is tested. No product feature is
implemented.

---

## 1. The organising principle

The specification (section 23) splits responsibility in two, and the entire codebase is arranged
around that split:

| Deterministic software owns         | The language model owns              |
| ----------------------------------- | ------------------------------------ |
| Prices, totals, currency arithmetic | Parsing free text into structure     |
| Budget limits and hard eligibility  | Explaining an already-computed score |
| Date and night calculations         | Drafting itineraries                 |
| Deal scores and ranking             | Wording an alert already decided on  |
| Provider constraints                | Inferring soft preferences           |

This is not a stylistic preference. A model that can adjust a price can be wrong about money the
user is about to spend, and no amount of prompt engineering makes that acceptable.

The split is enforced structurally rather than by convention:

- `src/core/` is pure: no I/O, no clock, no randomness, no model. Everything numeric lives here.
- `src/ai/` exposes an interface whose methods **cannot return a price, a total or an eligibility
  decision**. There is no channel through which the model could become the source of truth for one.
- `src/ai/guardrails.ts` validates model output against a schema, converts intent into `Money`
  deterministically, and scans generated prose for figures absent from its source facts.

The last of those is the backstop. If a model writes "now only EUR 612" when the real total is
EUR 742, the sentence is discarded rather than shown.

---

## 2. Layers

```
Browser (PWA)
  │
  ├─ Next.js App Router ─────────────── src/app/
  │    server components, route handlers, service worker registration
  │
  ├─ Design system ─────────────────── src/components/ui/
  │    Radix primitives + Tailwind tokens
  │
  ▼
Application layer
  │
  ├─ Deterministic core ────────────── src/core/
  │    money · trip cost · constraints · usable time · scoring
  │    pure, total, exhaustively tested
  │
  ├─ Provider adapters ─────────────── src/providers/
  │    flights · hotels · weather · transfers · places
  │    normalise vendor shapes; return Result, never throw
  │
  ├─ AI abstraction ────────────────── src/ai/
  │    interface + guardrails + mock provider
  │
  ├─ Persistence ───────────────────── src/db/
  │    repository interfaces · in-memory impl · SQL migrations
  │
  ├─ Background jobs ───────────────── src/queue/
  │    job contract · in-process driver · (BullMQ driver to come)
  │
  └─ Notifications ─────────────────── src/notifications/
       channel contract · Web Push
```

Dependencies point inward. `core/` imports nothing from `providers/`, `ai/`, `db/` or `app/`.

---

## 3. Key decisions

### 3.1 Next.js App Router, TypeScript, npm

Directly from specification section 20. API routes serve as the backend initially; there is no
separate service. When background workers outgrow a serverless request model, the queue abstraction
is the seam where a standalone worker process attaches — nothing else has to move.

### 3.2 Money as integer minor units

`src/core/money.ts`. Every amount is an integer in the currency's minor unit plus an ISO 4217 code.

Floating-point money is the classic way to produce a total that is a cent off, and a trip total is
the sum of a dozen lines. Mixing currencies throws rather than converting implicitly, so every
conversion is explicit and carries a dated rate.

`allocate()` splits an amount into shares that provably sum back to the original, so a per-person
figure never leaks or invents a minor unit.

### 3.3 Three totals, not one

`src/core/trip/cost.ts` reports `knownTotal` (provider-quoted), `estimatedTotal` (our models) and
`total` (their sum), plus a separate list of `excluded` lines.

Specification sections 10 and 31.11 require every cost to be tagged and forbid implying precision
the data does not support. A missing airport transfer becomes an `excluded` line rather than a
silent zero — the traveller discovering that cost at the airport is exactly the failure the product
exists to prevent.

`knownShare` exposes how much of a total is quoted rather than guessed, and feeds both the score and
the No-Surprise warnings.

### 3.4 Hard constraints are separate from scoring

`constraints.ts` decides whether a trip is _allowed_; `scoring.ts` decides how _good_ an allowed
trip is. A budget ceiling is not a heavily-weighted factor — it is a wall.

All violations are collected rather than short-circuiting, so a near-miss can be explained in full
rather than one problem at a time.

`detectTravelWarnings()` is deliberately a separate function: a warning must never quietly filter a
trip out, and a hard rule must never be downgraded to a warning.

### 3.5 Scores are explainable by construction

Every factor is normalised to 0–1, multiplied by a weight, and reported individually. The score is
exactly the sum of the contributions — a unit test asserts this, so the UI can never display a
number it cannot justify.

Travel style and optimisation mode adjust weights, which are then renormalised to sum to 1 so scores
stay comparable across profiles.

### 3.6 Usable vacation time

`usable-time.ts` implements specification section 31.4. Two trips with five nights each can deliver
very different holidays; a 23:40 arrival and a 05:50 departure turn "5 nights" into roughly three
usable days.

Time is counted within an 08:00–22:00 window. Hotel check-in is deliberately _not_ modelled: an
early arrival is not dead time, because reception stores bags and the day starts anyway.

### 3.7 Providers behind adapters

Every external source implements an interface in `src/providers/types.ts`. Adapters return `Result`
rather than throwing, because one provider timing out must degrade a search, not abort it.

All five adapters are mocks today. Mocks are **deterministic**: variation is derived from a hash of
the query, never `Math.random()` or `new Date()`. Non-deterministic fixtures would make every
downstream test flaky and every price-history diff meaningless.

`registry.ts` resolves adapters from configuration. Selecting a live provider that has no
implementation is a hard error, never a silent fallback to mock — serving fixture prices as real
ones would be far worse than an outage.

### 3.8 The database is not required

`src/db/repository.ts` defines interfaces; `memory.ts` implements them in process. With
`DATABASE_URL` unset, no database driver is ever loaded — `pg` is behind a dynamic import and no
connection is opened at module load.

`migrations/0001_init.sql` holds the Postgres schema for the Phase 1 entities, applied on demand by
`npm run db:migrate`. Money is stored as `BIGINT` minor units plus a `CHAR(3)` currency; no `FLOAT`
or `NUMERIC` is used for money anywhere.

### 3.9 The queue is not required either

`src/queue/` defines the job contract with a full in-process driver: delays, retries with
exponential backoff, and deduplication. The whole Travel Watch monitoring loop can be built and
tested before Redis exists.

`QUEUE_DRIVER=bullmq` without `REDIS_URL` is a hard error. A deployment that silently fell back to
in-process jobs would lose every Travel Watch on restart, which is the one thing this product
cannot afford.

### 3.10 PWA

A hand-written service worker (`public/sw.js`) rather than a generated one, because the requirements
are narrow and specific:

- Navigations and API requests are **network-first**. Only content-hashed static assets are
  cache-first. Serving a cached flight price would violate the product's own rule that every
  displayed price carries a timestamp.
- An offline fallback page that shows no prices at all.
- Push and notification-click handlers — the Web Push foundation.

Registration is skipped in development, where a cached shell only produces confusing stale-content
bugs.

---

## 4. Cross-cutting concerns

**Configuration.** `src/lib/env.ts` is the only module that reads `process.env`. A Zod schema is the
single source of truth for what the app may read. An absent optional variable disables a capability;
it never crashes the app. `describeEnv()` reports secrets as booleans, never values.

**Logging.** `src/lib/logger.ts` wraps pino. Redaction is configured centrally rather than trusted
to call sites, because a credential that leaks into a log is a credential that has leaked.

**Errors.** `src/lib/errors.ts` gives every error a stable code, an HTTP status, and — critically —
separates `publicMessage` from `context` and `cause`. `toProblemDetails()` produces client-safe
output; `toLogPayload()` keeps everything else for logs.

**Security headers.** CSP, HSTS, frame-ancestors and Permissions-Policy are set in
`next.config.ts` and asserted by the end-to-end suite. See `security.md`.

---

## 5. What is deliberately absent

No authentication, no live providers, no booking, no payments, no real monitoring loop, no
production notification pipeline, no deployment target. These are Phase 1 and later — see
`implementation-plan.md`.

The Postgres repository implementation and the BullMQ driver are also absent. Both have their
interfaces defined and their absent case handled explicitly, which is what makes them
straightforward to add without touching anything above them.

Absent by shape rather than by schedule: **multi-country trips and a map or globe discovery
surface**. `TripCandidate` models one origin, one destination, one flight and one hotel, and every
engine that reads it assumes that. A trip across several countries is a sequence of legs and stays
— a new domain type, with cost, constraints, usable time and scoring following it. Ground
transport such as car rental, rail and ferry would likewise be a new provider kind rather than a
stretched `transfers`, and a globe or map view would add a geo data dependency (country geometry,
place coordinates, tiles) that no adapter covers today. Recorded so the current shape is understood
as a deliberate Phase 1 narrowing, not an assumption the product is stuck with. See
`implementation-plan.md`, "Noted, not yet planned — the globe explorer".
