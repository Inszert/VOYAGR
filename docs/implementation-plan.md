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

### 1.1 Search orchestration ✅ complete

_In plain words: ask about flights, hotels, rides and weather all at once, then glue them into whole trips._

Fan out across origins, destinations and date windows; call the flight, hotel, transfer and weather
adapters concurrently; assemble `TripCandidate` combinations.

- Partial provider failure degrades the result set; it never fails the search.
- Bound the combinatorics before it bounds itself — a flexible-date × multi-airport × anywhere
  search explodes quickly.
- **Done when:** a search returns ranked, costed, constrained candidates from mocks, with one
  adapter deliberately failing and the search still returning results.

**Delivered.** `src/search/` — `plan.ts` decides what will be asked before anything is asked,
`assemble.ts` turns offers into candidates, `orchestrator.ts` runs the fan-out and hands every
candidate to `src/core/` to be costed, checked and scored. `runSearch()` is the entry point.

Decisions worth carrying forward:

- **The plan is the bound.** Date windows are enumerated, then _sampled evenly_ rather than
  truncated, so a flexible search stays flexible instead of quietly becoming a search of the first
  week. Every limit is a hard ceiling, and `diagnostics.plan` reports what was dropped.
- **Weather and transfers are fetched once per destination**, not once per trip. They answer a
  question about the place, not about a departure date.
- **A destination with no flights costs no hotel call.** The largest saving in the fan-out.
- **Failures are recorded, never thrown.** `diagnostics.issues` carries each failure's public
  message only, so the object is safe to return to a client. An adapter that throws instead of
  returning a `Result` degrades the search exactly as a returned failure does.
- **Ranking is stable.** Score, then price, then id. Without the last tiebreak two equal trips
  could swap places between refreshes and look like news worth alerting on — which 1.8 would then
  have to unlearn.
- **Ineligible trips are returned as `nearMisses`** with every violation attached, so a search that
  finds nothing can say what came close and why it did not qualify.
- **A wrong-currency quote is dropped, not converted.** Inventing a rate here would put a wrong
  number in front of a user.

Not included, deliberately: no food, activities or local-transport estimates on a candidate. They
would need per-destination cost-of-living data the project does not have, and a guessed line is
worse than an absent one. `extraCosts` is the seam when that data arrives.

### 1.2 Search UI and structured schema ✅ complete

_In plain words: build the screens where you say what you want and see the trips we found._

The search form, the results list, and a trip detail view.

- Structured input first; natural language sits on top of it, not underneath.
- Cost breakdown shows every line with its confidence tag. Estimates look different from quotes.
- No-Surprise warnings are visible before the user acts.
- Booking hand-off is a single seam: every outbound link is built in one place from the offer's
  `deepLink`, never assembled in a component. Affiliate attribution (§24.4) is then a change to
  that builder, not to the results list.
- **Done when:** a user can run a search and understand why the top result ranks first.

**Delivered.** `src/search/schema.ts` (the structured schema), `src/booking/handoff.ts` (the
outbound seam), `src/components/search/` and the search page at `/`. The foundation status page
moved to `/status`.

Decisions worth carrying forward:

- **The search is a GET form, so a search is a URL.** Shareable, bookmarkable, reloadable, correct
  with the back button, and working before any JavaScript arrives. A saved Travel Watch in 1.5
  needs exactly those properties, so the query string is the structured request in transit.
- **Native `<select>` and `<details>` rather than the Radix equivalents**, for the same reason.
  These are platform controls, not hand-rolled ones, and they keep the whole flow usable without
  JavaScript. Radix remains the answer for anything the platform does not provide.
- **The hand-off seam is a trust boundary, not just an attribution seam.** A `deepLink` is a string
  a provider gave us and it goes straight into an `href`, so anything that is not plain `http(s)`
  is dropped and the offer renders without a booking button. §24.4 is an edit to one function.
- **Warnings are above the fold, not inside a disclosure.** A No-Surprise warning the user has to
  go looking for is not a warning.
- **Confidence is a word, never a colour.** `Quoted` / `Estimated` / `Not included`, each with a
  screen-reader prefix, and excluded costs get their own section saying the trip will cost more.
- **The results heading counts what matched, not what is displayed.** The page shows the best ten;
  saying "10 trips match" when 192 did would be a number the user could act on and we invented.

Deliberately not built: a standalone trip detail route. A detail page that re-ran the search would
show different prices than the list it was opened from, and one that did not would need a result
cache that does not exist until 1.4 and 1.5. The detail _view_ is a disclosure inside the card, so
the numbers cannot disagree. The shareable route arrives with persistence, which is also when 1.9
has something durable to deep-link into.

### 1.3 Accounts and preferences ✅ complete

_In plain words: let people log in, and remember what each person likes._

Authentication, `users` and `user_preferences`. Explicit preferences stored separately from
inferred ones, so section 31.7's transparency requirement is possible at all.

- Every user carries a `plan` (`free` for now) and an entitlement set resolved from it. Shipping
  one plan is fine; hard-coding its limits instead of resolving them is not — §24.2 and §24.3
  would then be a rewrite rather than a new row.
- **Done when:** a user can sign in, and preferences survive a restart.

**Delivered.** `src/core/entitlements.ts`, `src/auth/`, `src/app/sign-in`, `/sign-up`, `/account`,
and migration `0002_accounts.sql`.

Decisions worth carrying forward:

- **Email and password with server-side sessions**, chosen because it needs no identity provider,
  no new dependency and no credentials in a config file — the same offline-by-default property
  every other seam holds. It is an implementation, not a commitment: everything above
  `AuthService` deals in `AuthenticatedUser` and a cookie, so OAuth later is a second way to make a
  session, not a rewrite.
- **The session cookie carries a token; the database stores only its SHA-256.** A dump of the
  sessions table grants nobody a session.
- **Sign-in never reveals whether an address is registered** — same message, same work, and a decoy
  hash so the timing does not answer it either.
- **Throttling is keyed on email _and_ client.** On email alone the lockout becomes a weapon:
  anyone who knows your address could keep you out of your own account.
- **Entitlements are resolved from the plan, never hard-coded.** The account page displays them by
  resolving them, which is the same rule 1.5 and 1.6 will follow.
- **Explicit and inferred preferences are separate fields**, so §31.7's "what do you believe about
  me?" is answerable. The account page answers it with "nothing yet" rather than with silence.

**The "survive a restart" half is not proven.** The in-memory backend loses every account when the
process stops. What the end-to-end suite proves is the same round trip through the repository — a
preference survives signing out, clearing cookies and signing back in. Real durability is 1.4.

### 1.4 Postgres persistence ✅ complete

_In plain words: put everything in a real database so it is still there tomorrow._

Implement `Repositories` against Postgres. Apply `0001_init.sql`.

- The in-memory implementation stays, and the test suite keeps using it.
- **Done when:** the same repository tests pass against both backends.

**Delivered.** `src/db/postgres.ts` implements every repository against the schema in
`migrations/`, the factory selects it whenever `DATABASE_URL` is set, and
`repository-contract.test.ts` is one suite run against every backend.

**Proven.** The contract suite runs against a live PostgreSQL 17 instance and both backends pass
the same 26 tests. Earlier this section read "written, unproven" because no database was reachable
from the development machine; one is now configured and the migrations are applied.

Running it:

```
npm run db:migrate                 # reads .env
npm test                           # the suite picks up TEST_DATABASE_URL
```

With no `TEST_DATABASE_URL` the Postgres backend is skipped and reported as a skipped test rather
than as silence, so the suite still passes with no database and nobody mistakes that for coverage.

Decisions worth carrying forward:

- **One contract suite, every backend.** Two implementations of an interface that are only ever
  tested separately are two different interfaces wearing one name.
- **`ON CONFLICT` rather than check-then-insert** for users and subscriptions: two simultaneous
  sign-ups for one address both pass a check, and the loser fails on the constraint with an error
  nobody wrote a message for.
- **A patch that sets a value to null is not the same as a patch that omits it.** `bestKnownTotal`
  is the case where COALESCE-everything would quietly do the wrong thing, so it carries an explicit
  flag and a test.
- **Money crosses the boundary as integer minor units**, parsed rather than assumed: `pg` returns
  BIGINT as a string precisely so nobody loses precision, and a value that is not a safe integer
  raises rather than rounds.

### 1.5 Saved searches and Travel Watches ✅ complete

_In plain words: let you keep a search, so the app keeps looking for you after you close it._

A search becomes a watch. Status, priority, `nextRunAt`.

- The active-watch limit is read from the user's entitlements, not from a constant.
- **Done when:** a saved watch persists and appears with its next scheduled run.

**Delivered.** `src/core/watch-schedule.ts`, `src/watches/service.ts`, `/watches`, a save panel on
the results page, and migration `0003_saved_search_destinations.sql`.

Decisions worth carrying forward:

- **A saved search stores its destinations.** A `SearchProfile` says what kind of trip is wanted,
  not where — that lives on the request. Without them a watch cannot replay its own search, which
  is most of what a watch is.
- **Saving and watching are two records, not a flag.** A search can be kept without spending a
  monitoring slot, and a watch can be paused without losing the search behind it.
- **Every limit is read from entitlements, including on resume.** A limit enforced on creation but
  not on resuming is not a limit.
- **Watching an already-watched search resumes it rather than creating a second watch**, which
  would double the provider calls and alert the user twice about one trip.
- **Asking for a priority the plan does not include is not an error**, it is quietly the normal
  cadence. Otherwise the flag becomes a way around the entitlement.
- **The service owns the clock, so it owns "when does this next run".** A component reading
  `Date.now()` during render is impure, untestable without mocking time, and disagrees with itself
  between server render and hydration.
- **The page says background checking is not switched on yet.** Watches are saved and scheduled,
  but nothing runs them until 1.6, and a countdown implying otherwise would describe work nobody
  is doing.

### 1.6 Workers and scheduled refresh ✅ complete

_In plain words: little helpers in the background check your saved trips again and again on a timer._

BullMQ driver behind the existing queue interface; a scheduler that picks up due watches.

- Adaptive frequency per section 17: roughly 6–12h normally, 1–3h for high priority, subject to
  provider rate limits and cost.
- Deduplicate: a watch already queued is not queued again.
- Refresh frequency is bounded by the user's entitlements as well as by provider rate limits, so
  a faster tier later is configuration, not a scheduler change.
- **Done when:** watches refresh on schedule against mocks, with Redis running, and the schedule
  survives a worker restart.

**Delivered.** `src/queue/bullmq.ts`, `src/watches/scheduler.ts`, `src/watches/refresh.ts` and
`src/worker/main.ts`, run with `npm run worker`. Verified against a live Redis 8 and PostgreSQL 17.

Decisions worth carrying forward:

- **The schedule lives in the database, not in Redis.** A watch's `nextRunAt` is the only source of
  truth for when it runs, and the scheduler is a timer that asks the database what is due. That is
  what makes the schedule survive a worker restart, a Redis flush or a move to another machine —
  rather than a durable repeating job that is only as durable as the queue holding it.
- **The dedupe key includes the deadline, not just the watch id.** Keying on the id alone would
  stop a watch being enqueued again after it ran, until its old job was cleaned up.
- **A refresh always reschedules.** Search failed, providers down, whole thing threw — the watch
  still gets a new `nextRunAt`. A watch that stops rescheduling has silently stopped, and nothing
  in the product would announce it.
- **The cadence is resolved from the owner's plan at run time**, not captured when the watch was
  made, so a plan change takes effect without touching a row.
- **Only eligible trips set the best-known total.** A cheaper trip that breaks the user's own hard
  limits is not a better trip, and recording it as the benchmark would make every honest result
  afterwards look like a price rise. A currency change is recorded but never called an improvement.
- **The worker is a plain Node process**, not something Next-specific. A worker has no request and
  no rendering, and running it inside the web server would tie the monitoring loop's uptime to the
  website's.

**Found only by running against real Redis:** BullMQ rejects a job id containing a colon, and the
dedupe keys were full of them — ISO timestamps alone contribute three. The in-memory driver had
accepted them happily. Keys are now hashed into valid ids at the driver boundary, and the contract
documents that a dedupe key is opaque.

### 1.7 Price history ✅ complete

_In plain words: write down every price we see, and where and when we saw it._

Record every observation with source, timestamp, currency and conditions. A price without
provenance cannot honestly be shown.

- **Done when:** a watch accumulates history and the lowest observed total can be queried.

**Delivered.** `src/watches/observations.ts` turns a refreshed trip into rows; the refresh handler
writes them. Verified against live PostgreSQL and Redis: one due watch, enqueued, refreshed, four
observations written, watch rescheduled.

Decisions worth carrying forward:

- **The total and its parts are both recorded.** The total is what a user watches; the parts are
  what explains it, and "the flight dropped but the hotel rose" is not answerable from one number.
- **`observedAt` is when _we_ saw the price**, not when the provider first quoted it. The
  provider's own timestamp stays on the offer. This column is what makes the rows a time series,
  and a cached upstream response must not be able to backdate itself into one.
- **The total is attributed to the cost engine, not to a provider.** It is assembled from several,
  and naming one would be a lie about where the number came from.
- **How much of a total was quoted rather than estimated is recorded as a condition of it.** A
  cheap total that is mostly our own estimates is not the same observation as one a provider stood
  behind, and six months later nobody will remember which.
- **No transfer row rather than a zero** when none was priced. A zero is a price nobody was
  offered, and it would poison every later comparison against it.
- **`bestKnownTotal` is now derived from history, not set beside it.** It is a cache of "the
  cheapest we have ever recorded", re-read from the history after each write, so the two cannot
  drift. A cached value with no observation behind it cannot be substantiated and is replaced.

**Fixed on the way:** `findLowest` compared minor units across currencies, so 50000 GBP ranked
below 60000 EUR. `src/core/money.ts` refuses that comparison on principle and a repository doing it
silently contradicted the rule the whole money model rests on. Currency is now a required argument,
and both backends are held to it by the contract suite.

### 1.8 Deal detection ✅ complete

_In plain words: compare the new price to the old ones and decide if it is a real bargain worth telling you about._

Compare a fresh result against history and decide — deterministically — whether the change is
material. Severity is assigned here, never by a model.

- Thresholds are explicit and tunable. A EUR 2 drop on EUR 240 is not an alert.
- **Done when:** a materially better trip produces exactly one alert, and a trivial change produces
  none.

**Delivered.** `src/core/deal-detection.ts` decides; `src/watches/alerts.ts` words what was already
decided; the refresh handler records the notification.

Decisions worth carrying forward:

- **Two bars, not one.** A percentage bar alone calls EUR 40 off EUR 4,000 news; an absolute bar
  alone calls 5% off a EUR 60 flight news. A drop must clear both. The specification's own example
  — EUR 2 off EUR 240 — fails both.
- **"Exactly one alert" falls out of the model rather than being enforced by a flag.** A drop is
  judged against the _previous_ best; once alerted, that price becomes the best known, so the next
  refresh finding the same price is not cheaper than anything and says nothing.
- **Severity is assigned by the core**, never by whoever writes the words. Either a large share or
  a large absolute sum promotes a drop to important.
- **The verdict carries a machine-readable reason**, so "why was I not told?" is answerable from a
  field rather than from a log.
- **Creating an alert and delivering it are separate steps.** A push that fails must not mean the
  user never learns there was a deal.
- **`alerts.ts` is the seam where a model may eventually write the prose** (§24.5). It could
  replace the wording and nothing else: the decision, the severity and every figure are settled
  before it is called.

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

### Live-provider readiness — the gate before 1.11

_In plain words: before we plug in a real travel company's data, check that their service actually
behaves the way our code already assumes it does._

A validation task, not a build task. Nothing here integrates a provider; it establishes what must
be true about a vendor before 1.11 is safe to start, and settles the assumptions in our own code
that a mock can never falsify. **This does not reopen 1.1.** Phase 1.1 is complete and verified
against deterministic mocks; this is the work that makes its bounds trustworthy against a live API.

**Deterministic mocks remain the default for every unit and integration test.** Nothing in this
task may make the suite require network access, credentials or a sandbox account. Recorded HTTP
fixtures, where used, are committed artefacts replayed offline — they sit alongside the mocks, they
do not replace them (sequencing rule 3).

#### What 1.1 assumes that a live provider may not honour

Found by reviewing the Phase 1.1 code against a live-provider contract. Each is a mock-invisible
assumption, so each needs a deliberate check rather than a passing test.

| Assumption in the code                                   | Why a mock cannot catch it                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6 concurrent provider calls is a safe pace               | The bound itself is now enforced by one shared limiter and asserted end to end, but the _number_ was chosen with no vendor in mind, and in-process mocks never make it cost anything                                      |
| `ProviderMetadata.rateLimitPerMinute` paces the search   | Declared on every adapter and read by nothing                                                                                                                                                                             |
| One call returns every offer worth having (`maxResults`) | No cursor, page token or total count anywhere in the provider contracts                                                                                                                                                   |
| A failed call is simply a failed call                    | No retry or backoff at the provider boundary; only the queue has any                                                                                                                                                      |
| The vendor's times arrive as local wall-clock            | Settled in our own types: flight times are `LocalDateTime` and a `Z`-suffixed one is rejected. What a vendor actually sends — local, zoned or UTC — is the adapter's problem to map, and only a real response shows which |
| The adapter maps a vendor's silence to `null`            | The domain models an unstated fact as `null` and treats it as its own case. Whether a given vendor omits the field, sends an empty string or sends a misleading default is a per-vendor mapping question                  |
| A provider response is well-formed                       | Provider output is never schema-checked, although AI output is (`src/ai/guardrails.ts`)                                                                                                                                   |
| Every quote is current                                   | `observedAt` is recorded on every offer and its staleness is checked nowhere                                                                                                                                              |
| Everything is quoted in one currency                     | There is no FX layer; a mixed-currency response yields zero results and one diagnostic, which reads to a user as "no trips found"                                                                                         |

#### Vendor selection and commercial terms

- Shortlist candidate flight and hotel vendors, and select one of each.
- For each: confirm API capabilities against what the adapters actually need, then licensing,
  pricing and quota tiers, required attribution, caching and display restrictions, and whether the
  commercial terms permit our use — background polling for Travel Watch, and affiliate attribution
  on the 1.2 hand-off seam (§24.4).
- Record the answers. A term discovered after integration is a rewrite.

#### Behaviour to verify against a sandbox or recorded fixtures

- **Pagination** — cursors or offsets, page size caps, stability across pages, and whether
  "cheapest first" survives paging. Decide what `maxResults` means once a provider paginates.
- **Rate limits** — the real limit, how it is reported, whether it is per key, per endpoint or per
  account, and what a breach returns.
- **Retry** — which failures are retryable, whether `Retry-After` is sent and honoured, and what
  backoff the vendor expects. Defined once, at the provider boundary.
- **Timeouts** — that a live adapter honours `ProviderRequestOptions.signal` and `timeoutMs`, what
  the vendor's own timeout is, and whether a search needs an overall deadline as well as a per-call
  one.
- **Malformed, partial, empty and stale responses** — a field missing, a null where a number is
  typed, an empty result set, a success wrapping an error, a cached response past its validity.
  Each needs a decided outcome: reject the offer, degrade it, or mark it unknown. "Mark it
  unknown" is now a real option for baggage and connection ticketing; decide which other
  fields deserve it.
- **Currency** — which currencies can be requested, whether the response honours the request, where
  taxes and fees sit, and what happens to a response that mixes them.
- **Timezone** — whether times are local, UTC or zoned, and map them onto `LocalDateTime` in the
  adapter. The domain now states plainly that a flight time is the clock face at its airport and
  refuses anything claiming to be an instant, so this is a mapping question rather than an open
  contradiction.
- **Price freshness** — whether prices are cached, live or require revalidation before a click
  through, the quoted validity window, and how that lands on `observedAt` and on what the user is
  shown. Our own page cache holds a result for five minutes and displays its age; a vendor whose
  quotes expire sooner than that makes the TTL wrong.

#### Limits, budgets and observability

- Re-run the Phase 1.1 bounds against the real thing: the default limits imply up to 8 flight and
  48 hotel calls per search, a figure chosen with no vendor in mind.
- Split the single global `providerConcurrency` into a per-provider budget derived from
  `rateLimitPerMinute`, and give each search a call ceiling and a cost ceiling. The shared limiter
  is the seam: one per provider rather than one per search.
- Decide the per-provider observability required before go-live: call counts, latency percentiles,
  error and timeout rates by code, quota consumed, and cost per search — enough to tell a degraded
  search from a broken one without reading logs.

#### Degradation policy

1.1 degrades on a failed call. A live provider also fails in a way a mock does not: succeeding with
incomplete data. Decide, per provider kind, what happens when a response arrives but is thin —
which missing fields make an offer unusable, which merely make it an estimate, and what the user is
told in each case. An offer silently downgraded is exactly the surprise §31.5 exists to prevent.

- **Done when:** a vendor is chosen for flights and hotels with its terms recorded; every behaviour
  above has a documented, tested answer backed by a sandbox run or a committed HTTP fixture; the
  concurrency bound is proven under real latency rather than against instant mocks; per-provider
  budgets and observability are specified; and the full suite still passes with no network access.

# Master Frontend + Fable + Travel Discovery Specification

## Purpose

Build a **premium, highly interactive travel-discovery product**, not a generic travel booking website, SaaS dashboard, AI chatbot, or template.

The product should feel like an **interactive map of travel possibilities** where users can discover:

- Where they can go
- When they should go
- Why they should go
- What the destination is like during those dates
- How much the trip will cost
- How they can get there
- What they can do there
- Which hidden places are nearby
- Which events and seasonal experiences are happening
- How flexible dates change the price
- Which option best matches their preferences

The final experience should feel premium, visual, fast, playful and intelligent.

---

# 1. FABLE AS THE PRIMARY FRONTEND/DESIGN TOOL

Use **Fable as the primary frontend design and UI implementation environment** when creating and refining the product interface.

The frontend should be visually designed in Fable and then integrated with the existing application architecture.

Do not let the existing engineering architecture force the interface to look basic.

The backend/data architecture and the frontend experience should remain separate concerns.

The goal is:

**Existing robust backend architecture + Fable-quality frontend/design + carefully selected third-party technology = premium travel product.**

---

# 2. THIRD-PARTY LIBRARIES AND SERVICES

Use high-quality third-party libraries, APIs and open-source packages whenever they materially improve the product.

Do NOT unnecessarily rebuild complex functionality from scratch.

Potential categories include:

- 3D globe libraries
- Map libraries
- Geographic visualization
- Map clustering
- Geographic data
- Globe interactions
- Animation libraries
- Gesture libraries
- Page transition libraries
- Calendar libraries
- Flexible-date components
- Heatmaps
- Charts
- Price-history visualization
- Virtualized lists
- Image optimization
- Responsive image delivery
- Accessible UI primitives
- Icon libraries
- Typography systems
- Destination imagery APIs
- Weather APIs
- Event APIs
- National holiday APIs
- Geographic/location APIs
- Flight APIs
- Hotel APIs
- Transport APIs

Examples of appropriate technology may include Mapbox, MapLibre, Three.js, deck.gl, GSAP, Framer Motion/Motion, Radix UI, Lucide, TanStack tools or other comparable production-quality libraries.

These are examples, not mandatory dependencies.

Choose technology based on:

- Performance
- Reliability
- Accessibility
- Maintenance
- Licensing
- Mobile support
- Bundle size
- Visual quality
- Ease of integration
- Ability to replace the provider later

Do not add dependencies simply because they look impressive.

Do not turn the application into a collection of unrelated widgets.

Everything should feel like one coherent product.

---

# 3. IMPORTANT ARCHITECTURE RULE

Do not destroy or bypass the existing backend architecture.

The existing provider adapters, orchestration, repositories, queues, AI abstraction and normalized travel models should remain the source of truth.

Frontend code should consume normalized application data.

Do not put provider-specific logic directly into UI components.

Do not make the UI depend directly on individual travel providers.

Keep provider-specific integrations behind adapters.

Third-party frontend services should also be replaceable where practical.

---

# 4. DO NOT FAKE LIVE DATA

The visual experience can be designed before live providers exist.

However:

Never pretend mock data is live data.

Clearly distinguish between:

- Live
- Cached
- Estimated
- Historical
- Typical/seasonal
- Mock/demo
- AI-generated
- Unavailable

For example:

**€184 · Live price**

is different from:

**€184 · Estimated**

and different from:

**Typical price: €160–€220**

The UI must communicate this honestly.

---

# 5. OVERALL VISUAL DIRECTION

Avoid:

- Generic SaaS dashboards
- Basic booking websites
- Generic card grids
- Corporate enterprise styling
- Chatbot-first interfaces
- Excessive tables
- Flat pages
- Boring forms
- Template-looking layouts

Create:

- Premium editorial travel design
- Large destination imagery
- Strong typography
- Beautiful cards
- Layered surfaces
- Depth
- Subtle glass/blur where appropriate
- Smooth transitions
- Rich hover states
- Interactive maps
- Interactive globe
- Visual discovery
- Elegant data visualization
- Strong spacing
- Responsive layouts
- Cinematic destination presentation

The interface should feel closer to a **premium travel magazine + interactive map + intelligent trip planner** than a normal booking engine.

---

# 6. HOMEPAGE / DISCOVERY

The homepage should immediately communicate that this is a discovery product.

Instead of only:

Origin → Destination → Dates → Search

allow users to discover possibilities visually.

Examples:

- Beach escapes
- Mountain escapes
- Christmas trips
- Snow destinations
- Green/lush destinations
- Autumn colors
- Spring blossoms
- City breaks
- Romantic trips
- Road trips
- Nature
- Food & wine
- Adventure
- Events
- Hidden places
- Budget travel
- Warm escapes
- Northern lights
- Ski trips

These should be interactive visual categories rather than plain text links.

Clicking one should immediately affect the discovery/search experience.

---

# 7. SEARCH

The main search should support:

- Origin
- Destination
- Flexible destination
- Dates
- Flexible dates
- Travelers
- Budget
- Transport preferences
- Accommodation preferences
- Trip type
- Interests
- Seasonal preferences

The interface should progressively reveal complexity.

Do not overwhelm the user with every option immediately.

Simple search first.

Advanced controls appear naturally when useful.

---

# 8. FLEXIBLE DATES MUST BE A CORE FEATURE

Flexible dates should not be a hidden advanced option.

Support concepts such as:

- Exact dates
- ±1 day
- ±3 days
- ±7 days
- Weekend
- Long weekend
- Cheapest dates
- Best weather
- Best value
- Month
- Custom date range

Show the user visually how changing dates affects:

- Price
- Weather
- Events
- Holidays
- Availability
- Travel time
- Seasonal conditions

Use calendars, heatmaps and visual price differences.

Example:

**July 12–19 — €620**

**July 15–22 — €510**

**July 19–26 — €465**

Make the savings visually obvious.

---

# 9. RESULT CARDS

Travel results should be rich, visual and interactive.

Each result can show:

- Destination image
- Destination
- Dates
- Total trip cost
- Flight price
- Accommodation price
- Ground transport
- Number of stops
- Total travel time
- Weather
- Seasonal condition
- Events
- Deal information
- Price confidence
- Ranking score
- Why it is recommended
- Warnings
- Availability
- Save
- Watch
- Compare

Example explanation:

**Why this trip?**

> 18% cheaper than your usual budget, excellent hiking conditions and direct flights available.

Do not expose meaningless technical scoring.

Explain ranking in human terms.

---

# 10. TRAVEL RESULT FILTERS

Filters must be genuinely interactive.

Examples:

### Price

- Total budget
- Flight budget
- Accommodation budget

### Transport

- Flight
- Train
- Bus
- Car
- Ferry
- Mixed transport

### Flight

- Direct
- Maximum stops
- Departure time
- Arrival time

### Trip

- Round trip
- City trip
- Road trip
- Multi-city
- Scenic route
- Open jaw
- Flexible itinerary

### Experience

- Beach
- Mountains
- Snow
- Nature
- Food
- Nightlife
- Culture
- Events
- Adventure
- Hidden places

### Season

- Snowy
- Green
- Sunny
- Autumn
- Blossoms
- Ski season
- Christmas
- Hiking season
- Aurora

Filters should immediately update results with smooth transitions.

---

# 11. ANYWHERE / DISCOVERY GLOBE

The globe should become one of the signature features of the product.

It should not be a decorative 3D object.

It should answer:

**"Where can I go?"**

and eventually:

**"Where should I go during my dates?"**

The globe should be visually impressive and highly interactive.

---

# 12. GLOBE BEHAVIOR

The globe should support:

- Rotation
- Zoom
- Dragging
- Hover
- Click
- Destination selection
- Region selection
- Country selection
- City selection
- Clustering
- Animated transitions
- Search
- Filters
- Seasonal layers

At low zoom:

Show major destinations and cities.

As the user zooms:

Reveal progressively smaller destinations.

Further zoom:

Reveal:

- Smaller towns
- Nature
- Hidden places
- Scenic locations
- Events
- Attractions

Avoid displaying thousands of markers at once.

Use intelligent clustering and progressive disclosure.

---

# 13. GLOBE TRANSPORT FILTERS

Users should be able to choose:

- Flights
- Trains
- Buses
- Cars
- Ferries
- Mixed transport

The globe can visually show reachable destinations based on the selected transport method.

Examples:

**Flight only**

**Train + flight**

**Train only**

**Road trip**

**Multi-modal**

---

# 14. GLOBE OPTIMIZATION MODES

Allow users to switch between:

- Cheapest
- Fastest
- Fewest stops
- Best value
- Best weather
- Best season
- Most interesting
- Flexible

Do not hide the optimization logic.

Explain why a destination appears.

---

# 15. SEASONAL WORLD DISCOVERY

Seasonality must be a core discovery layer.

The same destination can be completely different depending on the date.

The system should understand concepts such as:

- Snow
- Green/lush landscapes
- Spring blossoms
- Autumn colors
- Warm weather
- Beach season
- Ski season
- Hiking season
- Rainy season
- Aurora season
- Flower season
- Christmas season
- Festival season
- Surf season

---

# 16. SEASONAL GLOBE

The globe should visually respond to the selected dates and season.

Examples:

Select January:

Show destinations with:

- Snow
- Skiing
- Aurora
- Winter events
- Christmas/winter experiences

Select April:

Show:

- Green landscapes
- Blossoms
- Mild-weather destinations
- Hiking opportunities

Select October:

Show:

- Autumn colors
- Mild destinations
- Seasonal events
- Food/wine experiences

The visual layer should feel alive.

However, do not falsely color entire countries if conditions vary significantly by region.

Use region-level or destination-level data where appropriate.

---

# 17. SEASONAL RECOMMENDATION ENGINE

Create a discovery layer such as:

### "What looks good during your dates?"

Then show:

**Snow**

Switzerland · Norway · Austria · Northern Sweden

**Green**

Slovenia · Scotland · Azores · Northern Italy

**Autumn**

Japan · Canada · Central Europe

**Warm**

Canary Islands · Southern Europe · North Africa

Recommendations should use explainable signals such as:

- Historical climate
- Current forecast where appropriate
- Snow probability
- Temperature
- Rain probability
- Daylight
- Seasonal attractions
- Events
- Holidays
- Transport availability
- Price
- User preferences

Historical conditions must be clearly presented as typical rather than guaranteed.

---

# 18. DESTINATION DISCOVERY

Selecting a destination should open an immersive destination experience.

Show:

- Large imagery
- Weather
- Typical seasonal conditions
- Current forecast when relevant
- Events
- National holidays
- Travel warnings
- Price level
- Typical accommodation price
- Transport options
- Recommended trip length
- Recommended trip styles
- Hidden places
- Popular places
- Food
- Nature
- Nightlife
- Activities

The page should feel like discovering a place rather than viewing a database record.

---

# 19. TRIP TYPES

Support different trip intentions.

Examples:

### City Escape

Explore one city.

### Road Trip

Multiple stops connected by road.

### Round Trip

Base destination with return.

### Scenic Route

Optimize the journey itself.

### Hidden Places

Prioritize less-obvious destinations.

### Food Trip

Optimize around restaurants, food regions and experiences.

### Nature Trip

Mountains, lakes, forests, national parks.

### Event Trip

Build around a concert, festival, sports event or holiday.

### Christmas Trip

Markets, winter cities, seasonal experiences.

The UI should adapt based on the selected trip type.

---

# 20. HIDDEN PLACES SYSTEM

Create a dedicated hidden-place discovery layer.

Categories can include:

- Hidden nature
- Secret beaches
- Waterfalls
- Mountains
- Villages
- Viewpoints
- Lakes
- Forests
- Food spots
- Historical locations
- Quiet towns
- Scenic roads
- Local experiences

Different categories can have distinct visual identities.

Hovering over a location should show:

- Photo
- Name
- Short description
- Distance
- Why it is interesting
- Best season
- Accessibility

Clicking opens more information.

Do not imply that something is genuinely "secret" if it is simply popular online.

Use labels such as:

**Less-known**

**Off the main tourist route**

**Local favorite**

where appropriate.

---

# 21. EVENTS AND CONTEXT

Travel recommendations should understand the world around the destination.

Include:

- Concerts
- Festivals
- Sporting events
- Christmas markets
- National holidays
- Cultural events
- Seasonal events
- School/public holidays where relevant
- Major closures
- Weather warnings
- Travel warnings

Events should influence recommendations when relevant.

For example:

**Vienna — July 12–16**

Music festival during your dates.

Or:

**Japan — late October**

Peak autumn colors in selected regions.

---

# 22. TRIP BUILDER

Once users choose an idea, transition from discovery into planning.

The trip builder should allow users to modify:

- Destinations
- Hotels
- Flights
- Ground transport
- Activities
- Hidden places
- Dates
- Order of destinations

Users should be able to drag/rearrange itinerary items.

Changes should immediately recalculate:

- Total price
- Travel time
- Number of stops
- Distance
- Weather
- Availability
- Warnings
- Trip score/explanation

The experience should feel dynamic rather than like filling out a form.

---

# 23. ANIMATION

Animation is important but must be intentional.

Use animation for:

- Page transitions
- Destination transitions
- Globe rotation
- Globe zoom
- Marker appearance
- Clustering
- Card entrance
- Filtering
- Sorting
- Calendar changes
- Price changes
- Trip-builder changes
- Loading
- Skeletons
- Save/watch actions
- Expanding details
- Image transitions

Animation should communicate:

- What changed
- Where something came from
- What the user selected
- What the system is calculating

Avoid animation simply for decoration.

Respect:

**prefers-reduced-motion**

---

# 24. RESPONSIVE DESIGN

The experience must work beautifully on:

- Desktop
- Laptop
- Tablet
- Mobile

Do not simply shrink the desktop UI.

Mobile should have its own interaction strategy.

Examples:

- Bottom sheets
- Swipeable cards
- Touch-friendly globe controls
- Collapsible filters
- Sticky search
- Full-screen destination imagery
- Mobile trip builder
- Simplified map layers

---

# 25. ACCESSIBILITY

Maintain:

- Keyboard navigation
- Visible focus
- Screen-reader support
- Semantic HTML
- Accessible dialogs
- Accessible filters
- Accessible maps
- Accessible calendars
- Good contrast
- Reduced motion
- Non-color-only information

The globe/map must never be the only way to access information.

Provide equivalent list/search interfaces.

---

# 26. PERFORMANCE

The visual experience must remain fast.

Use:

- Lazy loading
- Optimized images
- Responsive image sizes
- SSR where appropriate
- Code splitting
- Virtualized lists
- Marker clustering
- Progressive rendering
- Caching
- Efficient map layers
- Deferred heavy 3D functionality

Do not load the entire world at once.

Do not render thousands of DOM elements unnecessarily.

---

# 27. DESIGN SYSTEM

Create a consistent design system for:

- Typography
- Colors
- Spacing
- Cards
- Buttons
- Inputs
- Filters
- Tags
- Badges
- Maps
- Globe controls
- Calendars
- Dialogs
- Sheets
- Tooltips
- Loading states
- Error states
- Empty states

The product should feel like one carefully designed system.

---

# 28. PHASE 1.2 — FIRST MAJOR FRONTEND IMPLEMENTATION

The main visual implementation should begin here.

Build:

- Homepage
- Search experience
- Result list
- Rich result cards
- Filters
- Categories
- Destination detail
- Trip detail
- Cost breakdown
- Flexible dates
- Initial globe architecture
- Destination visualization
- Core animations
- Responsive experience

The globe does not need full production intelligence yet.

It should already have the correct visual architecture so it does not have to be bolted onto the product later.

---

# 29. PHASE 1.5–1.10

Progressively add the visual interfaces for:

- Saved searches
- Travel Watches
- Notifications
- Price history
- Deal detection
- Flight/hotel swapping
- Saved trips
- Monitoring states
- Price changes
- Watch status

These should feel like natural extensions of the main product.

---

# 30. PHASE 1.11 — LIVE TRAVEL DATA

When the provider architecture reaches the live-provider stage:

Connect the frontend to:

- Real flight inventory
- Real hotel inventory
- Other live providers where available

The frontend should not need to be redesigned.

The same normalized result components should work with:

**Mock data**

and:

**Live provider data**

Only the underlying adapter/provider should change.

---

# 31. PHASE 2 — INTELLIGENCE

Expand the experience with:

- Buy/Wait
- Price history presentation
- Deal score
- Restaurants
- Activities
- AI itinerary
- What-if simulator
- Flexible-date heatmaps
- Alternative airports
- Smarter notifications
- Seasonal discovery
- Events
- Weather-aware recommendations

This is where the globe becomes substantially more intelligent.

---

# 32. PHASE 3 — DISCOVERY AND PERSONALIZATION

Add:

- Anywhere
- Surprise Me
- Hidden Gems
- Travel profile
- Adaptive monitoring
- Budget allocation
- Group travel
- Richer PWA experience
- Personalized seasonal recommendations
- Personalized globe
- More detailed geographic discovery

The system should gradually understand what types of trips the user likes without making the experience feel invasive.

Preferences should remain transparent and editable.

---

# 33. GLOBE / WORLD EXPLORER FUTURE EXPANSION

Eventually support:

- Country selection
- Region selection
- Cities
- Hidden places
- Nature
- Food
- Nightlife
- Events
- Beaches
- Mountains
- Scenic locations
- Multi-country trips
- Ground transportation
- Cars
- Rail
- Ferries
- Multi-modal journeys

The globe should evolve into a true **world travel explorer**.

---

# 34. VISUAL HIERARCHY

Always prioritize:

1. Destination
2. Why it is interesting
3. When to go
4. Total cost
5. How to get there
6. What conditions to expect
7. What can be done there
8. Important warnings
9. Details

Do not bury the important information under technical metadata.

---

# 35. TRUST AND EXPLANATIONS

Every recommendation should be explainable.

Instead of:

**Score: 87.4**

prefer:

**Why this is recommended**

- €120 below your budget
- Direct flight available
- Excellent hiking conditions
- Mild weather during your dates
- Festival happening during your stay

Users should understand why something appears.

---

# 36. DO NOT OVER-AUTOMATE THE USER

The product should assist discovery and planning without taking control away from the user.

Users must be able to:

- Change filters
- Change dates
- Change budget
- Change destination
- Change transport
- Remove recommendations
- Modify preferences
- Rearrange trips
- Compare alternatives

The system should recommend, explain and adapt.

The user remains in control.

---

# 37. QUALITY BAR

Before considering the frontend complete, ask:

Does this look like a real premium travel product?

Does it feel better than a normal booking website?

Can a user discover destinations without already knowing where they want to go?

Can the user understand price, season, weather and transport?

Can flexible dates visibly save money?

Can the globe actually help discovery?

Can users understand why a recommendation appears?

Does everything work on mobile?

Does animation feel intentional?

Does the experience remain fast?

Does the interface clearly distinguish live information from estimates and mock data?

If the answer is no, continue refining.

---

# 38. MOST IMPORTANT PRODUCT PRINCIPLE

The final product should feel like:

**"Show me the world, tell me where I can go, show me when it is best, explain why, show me what it costs, and help me turn the idea into a real trip."**

Not:

**"Fill in a booking form and receive a list of flights."**

The product should progressively evolve:

**Explore → Discover → Compare → Understand → Select → Plan → Monitor → Travel**

The globe, seasonal intelligence, flexible dates, live travel inventory, hidden places, events and trip builder should all eventually become parts of the same coherent experience.

Build the frontend architecture early enough that these capabilities can be added progressively without redesigning the entire product.

### 1.11 First live provider

_In plain words: stop using pretend travel data and plug in one real flight source and one real hotel source._

One flight source and one hotel source behind the existing adapters.

- Nothing outside the adapter changes. That is the test of whether the abstraction was right.
- Gated on the live-provider readiness task above. Starting this first means discovering a vendor's
  pagination, rate limits and timezone conventions in production.
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
| Flight and hotel provider vendors | Live-provider readiness, and 1.11 behind it                    |
| LLM vendor                        | AI explanations going live                                     |
| Postgres hosting (local/managed)  | 1.4                                                            |
| Redis hosting                     | 1.6                                                            |
| Deployment target                 | Any deployment                                                 |
| Git remote / repo hosting         | CI actually running                                            |
| Monetisation model (§24)          | Fee, subscription or affiliate go-live — not the Phase 1 hooks |
