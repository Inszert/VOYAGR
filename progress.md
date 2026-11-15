# Progress

**Last updated:** 2026-11-15 (the current state is the "Finish-the-product run" report at the end of
this file; the paragraph below and the sections between are history from 2026-11-04 and earlier)
**Stage at 2026-11-04:** Zero-paid-search-cost constraint in place (see 11-03 below); this session added email
verification and, while testing it by hand against the zero-config in-memory backend, found and
fixed a real, significant pre-existing bug: `getRepositories()`'s singleton was a plain
module-level `let`, which is not actually process-wide across a Route Handler/Server Action
boundary in Next.js's App Router - a Route Handler could silently get a _different_, empty
in-memory store than the one a Server Action had just written to. Fixed by caching on `globalThis`
instead (`src/db/index.ts`), the standard fix for this exact class of problem. This was already
silently breaking `/api/account/export` and `/api/push/subscribe` in the zero-config default
experience the README promotes - not something this session introduced, but something it would
have shipped a second instance of (`/api/verify-email`) without noticing, had the feature not been
tested by hand in a real browser rather than trusted on "the tests pass" alone.
Password reset shipped the same day, reusing the exact token pattern (see below) - verified by
hand the same way, this time clean on the first real-browser pass because the singleton bug above
was already fixed. Sign-out-everywhere and email change followed the same day, same pattern.
**Next:** resolve the Postgres `ECONNRESET` issue for real (try `DATABASE_SSL=true` first); decide
whether hotels stay demo-only or get dropped to an explicit `excluded` cost line when a real flight
provider is active (the hard constraint - never show a mock price as real - is already enforced by
`combineProvenance()`, so this is a UX choice, not a defect); get a written answer from
Travelpayouts on background polling before Travel Watch polls it unattended; evaluate a static
OSM/Wikidata extract for real places/attractions data (the live Overpass API was researched and
rejected for production use - see phase 3 below).

---

## 2026-11-04 (phase 3) — real exchange rates, real airport coverage, overnight autonomous session

**European Central Bank exchange rates, genuinely real.** The orchestrator's
`SearchDependencies.rates` had defaulted to `fixedRates([])` since phase 2's audit found it -
correct (never invent a rate) but disconnected. Researched the ECB's own reuse policy directly
(`ecb.europa.eu/home/disclaimer`), not a search summary: commercial use and redistribution are
permitted, conditioned on citing the ECB as the source. Free, no key, no account, no card,
published once a day as a static XML file. `APPROVED`, not `PENDING` - every point on the
zero-billing checklist has a sourced answer, unlike Aviasales and Open-Meteo below. Implemented as
`src/providers/fx/ecb.ts` (parses the real feed into the `fixedRates(...)` primitive
`src/core/fx.ts` already had) and `src/providers/fx/index.ts` (a `globalThis`-cached table,
refreshed once a day, falling back to the last good table on a failed refresh rather than going
empty). `FX_PROVIDER=ecb` is the new default. 12 new tests against a real, dated fixture. Caught a
real hermeticity gap by actually running the e2e suite: the webServer made one live ECB request on
first use, because `playwright.config.ts` had not yet blanked the new provider the way it already
blanks every other one - fixed the same way.

**Real airport coverage for nearby-origin suggestions.** `nearbyOrigins`/`resolveOriginGeo`
(`src/search/destination-names.ts`) drew only from the small, hand-picked `AIRPORT_FIXTURES` set -
parked twice across two prior sessions over a risk of changing tested distances. Wired the real
OurAirports dataset in as a strictly _additive_ fallback, behind both existing fixture sources in
both functions: an origin the fixtures already cover produces the exact distance it always did,
verified empirically rather than assumed safe. What changes is coverage - a real-world departure
airport the demo catalogue never had (proven with `JFK`, suggesting real neighbours `EWR`/`LGA`,
none of which are fixtures) now works.

**Places/attractions, researched and correctly left undone.** The public Overpass API's own
fair-use policy says production/commercial applications should use a self-hosted or paid instance -
using the shared instance from Voyagr's backend would be exactly the "public community endpoint as
unlimited production infrastructure" the zero-billing policy rules out. A downloadable static
extract (the same shape `scripts/build-airports.mjs` already uses) is a real option, not attempted
this session - a new build script, a real places data model and real scope decisions, not safe to
rush alongside everything else in one night.

**The two registry caches flagged but not fixed in phase 2** (`src/providers/registry.ts`,
`src/providers/stays/registry.ts`) were reviewed for actual consequence rather than fixed on
pattern alone: each search already builds its own `LimiterPool` fresh per call
(`src/search/orchestrator.ts`), so a split registry would not double real provider concurrency the
way the imagery singleton's split limiter would have - lower stakes, confirmed by tracing the code,
not assumed. Moved to `globalThis` anyway.

**Weather, flights, hotels, transfers, Travel Watch** - reviewed, nothing changed. Weather's
provenance boundaries (forecast vs. climatology vs. mock) were already correct. Flight indicative
pricing already cannot read as a live quote (`combineProvenance`). Hotels and transfers are
already structurally prevented from disguising a mock price as real, for the same reason. Travel
Watch's job deduplication is real (a BullMQ job id derived from a dedupe key) and was already
proven against live Redis in an earlier phase; it inherits the same fail-closed provider registry
a normal search does, so a `PENDING` provider still cannot be polled from there either.

Full `docs/agent-coordination/PHASE-3-OVERNIGHT-REPORT.md` has the complete checklist, evidence and
test commands. No regressions: unit suite stayed at the same 53 pre-existing Postgres failures
throughout every change; e2e suite re-run in resource-conscious batches after the hermeticity fix.

---

## 2026-11-04 (phase 2) — zero-billing enforcement, singleton sweep, Postgres diagnosis

**The audit that started this phase found the zero-paid-API policy below was not actually true in
code.** `docs/provider-evaluation.md` already said Duffel was ruled out (3 November); a real
production build's own startup log showed `FLIGHT_PROVIDER=duffel` active anyway. Fixed: Duffel
has no selectable value left in `FLIGHT_PROVIDER` (`src/lib/env.ts`), the registry has no code
path that can build the adapter (`src/providers/registry.ts`), and the adapter file is retained,
unimported, as a historical reference only. **Proved the fix with the real, previously-broken
configuration**: rebuilding against this environment's actual `.env` now refuses to boot with a
named `EnvValidationError` naming `FLIGHT_PROVIDER` - not a theoretical guarantee, the exact
build that used to silently activate Duffel now cannot. `src/providers/registry.test.ts` proves
zero outbound calls (a `fetch` spy, not an assumption) for Duffel, an unknown provider, and a
provider missing its credential. New `docs/provider-policy.md` is now the single, code-synced
source of truth for every provider's status; `docs/provider-evaluation.md` and `docs/security.md`
point to it.

**Singleton sweep.** The `getRepositories()` `globalThis` fix (above) was reviewed for whether the
same bug class existed elsewhere, rather than assumed fixed everywhere. Five named candidates,
plus the pool that bug class would hit hardest:

- `src/db/client.ts` - **the real `pg.Pool` itself** was still a plain module-level `let`. Fixed.
  This is the one worth re-reading if Postgres connectivity is revisited: two independent pools of
  up to `DATABASE_POOL_MAX` connections each, against the same database, would not show up by
  inspecting that setting alone, and is a plausible contributor to the `ECONNRESET` symptom this
  project has been fighting - not confirmed as _the_ cause, but a real possibility this session
  removed regardless. New `src/db/client.test.ts` (9 tests) proves the lifecycle without ever
  touching a real network - `pg.Pool` is lazy, so a never-queried pool costs nothing to construct
  and tear down.
- `src/auth/throttle.ts`, `src/search/cache.ts` - traced their actual call sites rather than fixing
  on pattern alone. Both currently have every mutating call confined to one Next.js module graph
  (Server Actions / Server Components only, no Route Handler), so the specific exploit the
  repository bug had is not currently reachable for either - fixed anyway, since both are cheap to
  fix and the alternative is trusting "safe because of how it happens to be called today."
- `src/providers/imagery/index.ts` - **the one where the risk is real, not theoretical.** Its
  callers already span a Route Handler (`/api/imagery/[code]`) and several Server Components, the
  exact split proven for the repository singleton. A split here would have doubled the concurrent
  request rate against Wikimedia, breaking this module's own documented "one request at a time"
  promise to a free service. Fixed, with a dedicated test.
- `src/queue/index.ts` - has zero callers anywhere in the app today (the worker calls the
  uncached factory function directly); fixed anyway as a precaution for whenever something does
  wire it in.
- Noted, not touched: `src/providers/registry.ts`'s own registry cache and
  `src/providers/stays/registry.ts`'s adapter-list cache are the same shape of module-level `Map`.
  Out of this round's named scope; flagged for whoever picks up the next pass.

**Postgres diagnosis.** Confirmed, without reading `DATABASE_URL` or any credential: the real
`postgres.exe` is genuinely the process listening, a raw TCP connection is accepted, and the reset
happens before any protocol-level response - consistent with the server itself ending the
connection rather than a network path failure. `DATABASE_SSL` defaults to `false`
(`src/lib/env.ts`) and this project's own earlier notes (Railway-hosted Postgres,
`verification-status.json`) plus a second tool in this environment separately reporting "connection
is insecure (try using sslmode=require)" for what may be the same real host both point the same
way: **try `DATABASE_SSL=true` first.** Not verified - that needs the real connection string, which
this pass could not and did not read. Marked BLOCKED, not fixed; see `docs/deployment-checklist.md`.

---

## 2026-11-04

**Email verification.** Sign-up now sends a one-time, 24-hour link (`src/auth/email-verification.ts`,
mirroring the session-token pattern exactly: SHA-256 of a 256-bit token, never the token itself,
stored). `src/email/` is a new, minimal provider abstraction - `EMAIL_PROVIDER=console` (the only
option, and the default) logs the link instead of sending anything, clearly labelled as dev-only.
No real email provider has been researched or wired in; that is next, if wanted. The account page
shows an unverified banner with a resend button; `/api/verify-email` consumes the link. Failing to
send never fails the sign-up that triggered it. 23 new tests, including one that closes a gap found
along the way: `users.erase()` had no test anywhere in the suite before this change touched it.

**Found and fixed while testing the above by hand:**

- **The `getRepositories()` singleton bug**, above - the most consequential finding of the two.
- **Next.js 16.4.5 deprecates the `middleware.ts` file convention** in favour of `proxy.ts`. Since
  `src/middleware.ts` (the CSP-nonce proxy from 11-03) was only one day old, renamed it immediately
  rather than carrying a deprecation warning forward. Also narrowed its matcher to exclude every
  `/api/` route - none of them render HTML or a script, so a CSP nonce is pure overhead for them.
  (Checked directly: excluding `/api/` did _not_ fix the repositories bug, so that exclusion is a
  tidy-up, not the fix - the two are unrelated.)
- A route handler's own redirect, built from `request.url`, reported a different host
  (`localhost`) than the one actually requested (`127.0.0.1`) - and the session cookie is scoped to
  the exact host it was set on, so the mismatch made a just-verified account look signed out.
  Fixed `src/app/api/verify-email/route.ts` to build the redirect from the literal `Host` header
  instead.

Verified by hand in a real browser against the production build, not only by the test suite: signed
up, read the real token out of the console-provider's log, visited the real link, watched the
unverified banner disappear and "Email confirmed." appear, re-ran the same flow after each fix
until all three were gone. `npm run verify` and the full Playwright suite both stayed green
throughout.

**Password reset.** Same day, same pattern: `src/auth/password-reset.ts` mirrors
`email-verification.ts` exactly (SHA-256 of a 256-bit token, one-time use), with one deliberate
difference - the link expires in 1 hour, not 24, because a working link that changes a password is
more sensitive than one that only confirms an address. `/forgot-password` requests it and always
answers with the same sentence regardless of whether the address is registered - the same
account-enumeration discipline `signIn` already holds, now held in a second place rather than
re-invented differently. `/reset-password?token=...` consumes it, invalidates every session (same
as a voluntary password change), and redirects to sign-in with a notice. Also wired up a
dangling, pre-existing gap found while doing this: `changePassword` already redirected to
`/sign-in?passwordChanged=1`, but nothing ever read that flag - the sign-in page now shows a
notice for both `?passwordChanged=1` and `?reset=1`. 22 new tests. Verified by hand in a real
browser the same way as email verification, and clean on the first pass this time, because the
`getRepositories()` singleton bug above was already fixed before this feature existed to be broken
by it.

**Sign out everywhere.** The account page already invalidated every session on a password change;
there was no standalone control for a user who just wants that without changing anything.
`AuthService.signOutEverywhere` and a button on the account page do only that - deliberately
all-or-nothing (including the session that asked), matching the precedent `changePassword` and
`resetPassword` already set, rather than adding "every device but this one" tracking that nothing
else in the repository layer needs. 2 new tests. Its button was first labelled "Sign out
everywhere" and broke four pre-existing e2e tests: Playwright's `getByRole(..., {name: 'Sign out'})`
matches by substring without `exact: true`, so the new button's accessible name collided with the
existing one's. Renamed to "End every session" rather than touching the (correct) existing tests.

**Email change.** Same token pattern again (`src/auth/email-change.ts`), with two deliberate
departures from password reset's precedent, both because the two actions start from a different
footing. First, the token row carries the new address (`email_change_tokens.new_email`) - the
account only moves once the link in that address's inbox is clicked, so nothing changes at request
time. Second, `requestEmailChange` reveals a conflict when the new address is already taken,
where `requestPasswordReset` and `signIn` both refuse to say whether an address exists at all -
not an inconsistency: calling this at all already requires a live session and the current
password, the same higher bar `register` stands behind when it makes the identical call for the
identical reason. Confirming moves the address with a new `UserRepository.updateEmail()` (kept
separate from the general `update()` because it alone needs the uniqueness check and the reset of
`emailVerifiedAt` back to `null` - a new address is an unconfirmed one again), then invalidates
every session the same way a password change does. 17 new tests across the token helpers, both
repository backends and `AuthService`. Verified by hand in a real browser against the production
build: signed up, requested the change, read the real confirmation link out of the console
provider's log, visited it, watched the redirect land on sign-in with the old session gone, signed
in with the new address, confirmed the account page showed it as unverified. Also exercised the
invalid-token path the same way.

_Found while doing this, unrelated to the feature:_ the local Postgres backend still answers with
`ECONNRESET` on every query (see 2026-10-xx below) - re-confirmed, not re-investigated, and worked
around for manual verification the same way `test:e2e` already does, by starting the server with
`DATABASE_URL=''` so it falls back to the in-memory backend. The full `npm test` suite passed
clean otherwise (1235/1288; the 53 failures are exactly that same pre-existing Postgres
connectivity issue, nothing this feature touched). The `npm run test:e2e` run itself was killed
this session by the harness over host memory pressure before it finished - not a result either
way, and not retried automatically per the harness's own guidance. Still owed before this can be
called fully verified: a clean full e2e run.

---

## 2026-11-03

**Zero-cost provider research.** Full write-up in `docs/provider-evaluation.md`. Short version:
live bookable flights and any hotel price are not obtainable for free without violating a ToS the
owner already ruled out. What is: Travelpayouts (flights, cached/indicative only), Open-Meteo
(weather, genuinely free and keyless), OurAirports (airport reference data, public domain).

**Fixed: Aviasales prices were about to be mislabelled "Live price".** The registry's fallback
(`metadata.mode ?? (isMock ? 'mock' : 'live')`) had no case for "a real vendor answered, but not a
quote for this search" — exactly what Travelpayouts' cached price points are. `DataProvenance`
gained an `indicative` case (`src/core/trip/provenance.ts`); the Aviasales adapter now sets
`metadata.mode: 'indicative'` explicitly. TypeScript's `Record<DataProvenance, …>` exhaustiveness
caught every place that needed updating the moment the case was added.

**Added: a real airport reference dataset.** `scripts/build-airports.mjs` builds
`src/providers/reference/airports.generated.json` from OurAirports — ~4,100 airports with
scheduled commercial service and an IATA code, public domain, no attribution burden. Separate from
the hand-picked fixtures in `src/providers/fixtures/`, which remain explicitly mock/demo data for
the globe and the mock providers.

**Added: a real weather provider.** `src/providers/weather/open-meteo.ts`, `WEATHER_PROVIDER=open-meteo`.
Forecast within 15 days; beyond that, a genuine climatology normal averaged from three real past
years via the archive API — not an invented seasonal guess. Deliberately does not attempt a sea
temperature: no signal exists yet for whether a destination is coastal, and guessing would show a
confident-looking number for a landlocked city. Tested against real recorded response bodies in
`tests/fixtures/providers/open-meteo/`.

**Fixed: a shipped bug from the last session.** `trip-card.tsx` called a `roomsNote()` helper that
was never written (commit `7eacb15`, "push to git while im off") — every trip card with hotel
pricing crashed on render. 57 tests were failing because of it; all fixed by writing the helper.

**Found and not yet acted on:** `npm run format:check` fails on 142 files, predating this session —
looks like a `prettier`/`prettier-plugin-tailwindcss` version bump reformatted class ordering
rather than genuine drift from hand-editing. Not mass-reformatted yet; that is a large, separate
diff and deserves its own pass rather than riding along with unrelated changes. Also: the Postgres
repository-contract tests fail locally with `ECONNRESET` — Postgres is listening on 5432, but
something in the connection (auth/db-name/SSL) resets it. Local environment issue, not investigated
further since `.env` is correctly outside what this session can read.

---

## 2026-09-23

**Readiness gate, Duffel.** A real sandbox search is recorded (`scripts/record-duffel.ts`, redacted)
and replayed offline in `duffel.test.ts`. It settled pagination (two calls, one page of 60), rate
limits (per endpoint: 30 and 120 a minute, in `ratelimit-*` headers), timezone (local wall clock,
as modelled) and freshness (a stated 30-minute window). Offers now carry `expiresAt`; a quote past
it is stale, and the results say so before the trips.

**Per-provider observability.** Every provider call from a search or a watch is recorded in
`provider_requests` and summarised per provider (calls, errors, timeouts, rate limits, p50/p95)
on `/status` for the last 24 hours. Pruned after 30 days.

**The product around it.**

- **Discover and Explore:** Discover is the front door. Every valid search continues to Explore,
  which shows it as a one-line summary with "Change search" (no form of its own), the globe, and
  the results.
- **Results:** results have a side column for the dates and the filters. The trip being built
  sits on top (swap its flight, hotel or dates; each option shows the change to the whole-trip
  total). Every other result is a compact row.
- **Stays:** stays gained a destination header, redesigned cards, a date strip and a property
  page with a locator map.
- **Watches:** watches can be added by hand, checked on demand and deleted.
- **Destination pages:** they describe the weather week by week in words.
- **Look and legal:** one leather-and-night palette with a per-place tint. Privacy and terms pages
  (drafts for legal review).

**Found and fixed on the way:**

- **Radius tokens:** 76 radius classes in the old Tailwind v3 form compiled to nothing.
- **Class merging:** `cn` dropped the display font sizes when merged with a colour.
- **Budget fields:** two budget fields rejected round numbers (`step` against `min`).
- **Account page:** the account export and deletion existed but were not reachable.

**Known and not changed:** MapLibre can exhaust its dash atlas after a globe page lives through
many resizes (`LineAtlas out of space`, then an error per frame). Globe code; reported, not
patched.

---

## Where things stand

_Written 2026-09-23. Superseded: flights, weather and FX can now be live, and production refuses
mocks. See the report at the end of this file._

Voyagr runs end to end against deterministic mock providers: a person can search, understand why a
trip ranks where it does, see what moving their dates is worth, discover destinations on a globe,
read about a place, create an account, save a Travel Watch, have a worker re-price it in the
background, and receive a browser push when a materially better combination appears.

**Nothing here is a real price.** Every provider is a mock, and the UI says so on every surface
that shows money. That is a product decision, not a gap left open: see `docs/provider-evaluation.md`
for what choosing a vendor requires and why it has not been done.

`npm run verify` is clean: 812 unit and component tests, plus 148 end-to-end tests with axe
assertions on every user-facing surface.

The repository still runs with **no database, no Redis, no provider credentials and no AI key** —
each of those turns a feature on rather than being required to boot.

---

## Complete

### Deterministic core — `src/core/`

The part that carries the product's credibility. Pure: no clock, no randomness, no I/O.

Integer money with an explicit currency. Trip cost, with every line tagged `known`, `estimated` or
`excluded` and nothing silently dropped. Hard eligibility rules, including day-of-week rules so
"a weekend" means one. Scoring with declared weights, per-factor contributions and a separate
evidence-strength figure. Usable time. Calendar-date arithmetic in UTC, and wall-clock local times
that never pretend to be instants.

### Search — `src/search/`

Planning that bounds the fan-out and reports what it sampled. Orchestration across five adapter
kinds behind one shared concurrency limiter, where a provider failing degrades a search rather than
aborting it. Assembly, costing, ranking, near-misses with their violations attached, component
swap options priced as whole trips, and per-destination summaries drawn from every eligible trip
rather than from the page of results.

A five-minute page cache absorbs reloads and duplicate tabs, collapses identical concurrent
searches, never caches a failure, and reports the age of what it served. `runSearch` itself is not
wrapped: a Travel Watch exists to find out whether the price moved.

Date flexibility presets — exact, plus-or-minus one, three and seven days, weekend, long weekend,
month, custom — as pure functions from two typed dates to the four fields the planner needs. Result
filters that narrow what the search already found rather than re-running it.

### Accounts, persistence and monitoring

Accounts with throttled sign-in scoped per client, saved preferences and plan entitlements the
search actually applies. Repository interfaces with an in-memory implementation and a PostgreSQL
one, both held to a single shared contract suite — 26 tests, run against a live database.

A BullMQ and Redis worker, proven against real Redis and real Postgres, that re-prices watches on a
schedule, records price history, detects materially better deals against what was seen before, and
sweeps expired sessions.

### Notifications — `src/notifications/`

Web Push behind a channel abstraction, proven end to end in a real browser: a genuine
worker-detected deal produced a real push notification. Dead subscriptions are dropped on 404 and
410 rather than retried forever.

### Frontend — Phase 1.10.1

- **Design system.** Radix primitives on OKLCH Tailwind tokens, with elevation, motion and an
  editorial display face as tokens rather than per-component choices.
- **Homepage discovery.** Ten categories as presets over the existing search schema, which can
  never override what the user themselves set. No photographs — see `docs/imagery-options.md`.
- **Rich result cards.** "Why this trip?" in words before any score, an at-a-glance summary, and
  the factor breakdown one disclosure down for anyone who wants it.
- **Filters.** Only the ones backed by real data, and an unknown fact never silently passes or
  fails one.
- **Flexible dates.** Presets in the open, and a price comparison across every date window the
  search priced, with the saving stated and the sampling admitted.
- **The stage (second pass).** The homepage opens on the planet: a dark stage with the globe
  filling its box, great-circle routes from the traveller's origin to every priced destination,
  and a price on each as a real link wearing its provenance. Countries are hoverable and
  selectable, on the canvas and from a native select; a selection is a URL (`?country=ESP`), the
  rail narrows to it and the search's destination field follows. Chips that would overlap are
  hidden by rank and reappear on zoom. Idle rotation until touched, off under reduced motion.
  Still no tile server, no API key, no glyph server and no third party in the render path,
  asserted by a test. `/explore` is the same globe on its own page.
- **The discovery snapshot.** Prices on the front page come from one system-limited,
  hour-cached search of the whole catalogue, with its assumptions stated above the rail.
  `DiscoverySource` is the seam for feeding it from price history once providers are live.
- **The compact search.** Seven controls in the open and the rest behind a native disclosure,
  one GET form, sharing its fieldsets with the full form so the two cannot drift.
- **The rail.** The globe in words: every destination, in the same order, with the same figure
  and the same reason. A country with nothing priced says so.
- **Inside a country.** Opening one fetches its states and provinces and draws them, adds finer
  coastlines once the zoom warrants them, and writes country and region names on the globe. The
  labels are rasterised from a font the machine already has, so there is still no glyph server and
  no font file here. The rail says what is actually known about an open country: where it is, how
  many regions the globe can outline, and how many of its airports we can price. The outlines are
  only outlines, and it says so.
- **Geo data.** Natural Earth countries keyed on `ADM0_A3` with precomputed bounds, plus finer
  coastlines, a label point per country and 4,138 regions in a file per country — 5.7MB in all, of
  which a first visit downloads 210KB. Written by `scripts/build-geo.mjs`, which reduces geometry
  with its own Douglas-Peucker, adapts precision so a small place is never rounded away, and fails
  rather than dropping a feature. Departure airports placed in `airports.ts`; eight far
  destinations added to the fixtures so the routes cross the planet rather than a corner of it.
- **Result cards that lead with the journey.** Each flight is a line with the clock times at either
  end, the airports, the duration and where it stops — the globe's arc, flattened. The price sits
  opposite at display size with its provenance and what it is worth against the traveller's
  ceiling. "Why this trip?" is a panel rather than a row. The duration shown is always the
  provider's, never the gap between two local clock times, which would overstate every eastbound
  flight; there is a test for that.
- **Destination pages.** Built from the same adapters, naming what they cannot tell you, and
  opening on the globe framed on the country the place is in — with no price on the marker,
  because the page knows where a place is and not what a trip there costs.
- **Data provenance.** Every surface that shows money says where it came from, and mock data never
  visually masquerades as a real price.
- **Destination photography.** `src/providers/imagery/` fetches each destination's picture from
  Wikimedia and serves it from `/api/imagery/[code]` on our own origin, so `img-src` stays `'self'`
  and no reader's browser contacts a third party. The association between a place and an article is
  hand-written and never searched for, because a photograph of the wrong beach is the same class of
  error as a wrong price. The lookup is bounded by a clock and a limiter and caches its misses as
  well as its hits, so a cold cache or an outage renders the gradient the cards were designed
  around. Attribution is per photographer, on the page. `IMAGERY_PROVIDER=none` turns it off.
- **One night, one accent.** The globe's biome still tints the page's accent as the planet turns,
  but no longer its background: a site that went brown over the Sahara was a theme changing under
  the reader. Controls keep the brand's purple throughout for the same reason.
- **A planet, not a diagram of one.** The globe has a night side computed from the date and the
  clock, a blurred warm terminator where the sun is setting, the lights of six hundred cities that
  come on only where it is dark, a continental shelf glowing along every shore, and snow, sand and
  land drawn as generated textures rather than as flat tint. Three things move slowly - the snow
  glitters, the sand drifts, dashes walk along each route - and all three stop under
  `prefers-reduced-motion`. See `docs/map-options.md`.
- **A page that ends.** Below the rail: the invitation to the explorer, the best trip in the
  snapshot already on the page, and the way back to the globe. The recommendation is not a second
  search — it is `loadStagePage`'s `recommended`, the top result of the snapshot the globe's own
  figures came from, and it disappears the moment a real search runs.

### Provider readiness — `src/providers/`

Adapter interfaces for flights, hotels, weather, transfers and places, five deterministic mocks,
and a registry where selecting an unimplemented live provider is a hard error rather than a silent
fallback to fixtures.

Encoded from the vendor research: provider-specific pagination cursors nothing outside an adapter
may parse; an operation-aware retry policy where "never retry an order creation" is a property of
the operation and not overridable by a provider; per-operation, per-provider timeouts. Plus a
vendor-agnostic recorded-HTTP fixture harness that replays completely offline.

---

## Not started, deliberately

**Live providers (1.11).** Gated on the readiness task in `docs/implementation-plan.md`. One
question is still outstanding with every candidate vendor: whether background polling for price
monitoring is permitted under their terms. Until that has an answer in writing, choosing a vendor
would be choosing one that might forbid the product's central feature.

**Specification sections 15 to 22** — seasonal intelligence, seasonal globe layers, hidden places,
events and national holidays, trip types, the trip builder. Each needs data the product does not
have. They are named in the interface where a user might expect them rather than rendered as
controls that silently match everything.

**Booking and payments.** Nothing here books anything.

**Per-destination cost of living.** A candidate carries no food, activities or local-transport
estimate. `TripCandidate.extraCosts` is the seam; a guessed line would be worse than an absent one.

**A standalone trip detail route.** The card carries the breakdown, the score, the warnings and the
swaps. A separate route would need to re-run the search and would then show different prices than
the list it was opened from.

Also absent and noted in `docs/security.md`: rate limiting beyond sign-in, CSRF protection, audit
logging, a nonce-based CSP, and a data retention policy beyond session and price-history sweeps.

### 1.10.2 — the reference image, all the way down

The product is one night from the hero to the footer: the stage's palette became the semantic
palette, there is no light colour scheme left, and the account, watches, sign-in and status pages
sit in the same sky as the globe. The globe itself gained the two things a map style cannot draw,
because both are about the sphere's silhouette rather than about the ground - an atmosphere (limb
darkening, the sun's sheen on the ocean, the rim, the halo beyond it) and flight arcs that leave
the surface, bow over the limb and come back down, with a light travelling each one. A `Globe /
Map` toggle switches the projection. The search became one pane of glass with a swap control
between its endpoints; a price on the globe became a light and some words rather than a bordered
pane, and turns round near the edge of the view so it still fits. See
`docs/homepage-redesign.md` section 11 and `docs/map-options.md` under "the fourth pass".

---

## Known constraints

| Item                      | Detail                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint pinned to 9.x      | `eslint-config-next@16` bundles an `eslint-plugin-react` incompatible with ESLint 10. Dev-only dependency. Revisit when Next ships support.                                                                                                                                                             |
| Playwright browser binary | Could not be downloaded in this environment. The suite was verified against locally installed Chrome via `PLAYWRIGHT_CHANNEL=chrome`. CI installs bundled Chromium normally.                                                                                                                            |
| CSP `'unsafe-inline'`     | Required by Next.js streaming injection. Worth replacing with a nonce-based CSP before handling payments.                                                                                                                                                                                               |
| MapLibre worker is copied | `scripts/copy-map-worker.mjs` copies it out of `node_modules` on every build, because MapLibre resolves it relative to `import.meta.url` and a bundled chunk is the wrong place. See `docs/map-options.md`.                                                                                             |
| Node 24.15 or newer       | `engine-strict=true` in `.npmrc` makes an engine mismatch a hard failure, deliberately. `jsdom@30` needs Node 22.22.2+, and Railpack picks the **floor** of the `engines` range - so `>=20.9.0` selected an EOL Node 20 and the install refused. `engines.node`, `.node-version` and CI now all say 24. |

---

## Next step

The live-provider readiness gate, and what is left of it is now **vendor questions only**.

The vendor-independent half is built and tested (990 unit tests):

- **Provider responses are schema-checked** at the boundary (`src/providers/schema.ts`). A
  malformed offer is dropped and reported; the search degrades rather than aborting. An unstated
  fact must arrive as an explicit `null` — an absent field is an adapter bug and fails.
- **Quotes have an age** (`src/core/freshness.ts`). `fresh` / `stale` / `unknown`, with `unknown`
  its own case and a future-dated observation not believed. Tallied in
  `SearchDiagnostics.quoteFreshness`. Reported, not acted on: the policy needs a vendor's validity
  window.
- **Currencies convert** (`src/core/fx.ts`), in integer minor units, half-even, honouring the
  minor-unit exponent difference. `RateSource` is the interface a real feed will sit behind. It
  never invents a rate — no reciprocal, no identity across currencies, no default — so with no
  feed configured a foreign quote is still dropped, but the diagnostic names the missing pair.
- **Rate limits do something.** One limiter per provider sized from `rateLimitPerMinute`, plus a
  per-search call ceiling (`maxProviderCalls`).

What is still open, and all of it needs a human:

1. **Background polling** for Travel Watch — whether a vendor's terms permit it. No vendor should
   be selected while that is open.
2. A flight vendor and a hotel vendor chosen, with licensing, quotas and attribution recorded.
3. **A rate source** for FX, and its licensing.
4. Sandbox credentials, so the remaining behaviours (pagination stability, real rate limits,
   `Retry-After`, timeout figures, price validity windows) can be confirmed against something
   real rather than assumed.

---

## Finish-the-product run, report of 2026-11-15

Plan and decisions: `docs/finish-plan.md` (D1 to D20). What the owner must supply:
`WHAT-I-NEED-FROM-YOU.md`. Go-live checklist: `SETUP-CHECKLIST.md`. Operations: `docs/runbook.md`.
Decision of record (2026-11-14): production goes live and never serves mock data.
This replaces the earlier "RESUME HERE" table and checkpoint, which were stale. State at commit
`0093bcb`, working tree clean at the start of this report.

Numbers reported for this commit (taken from the lead's run, not re-run while writing this report):
1887 unit and component tests; 248 end-to-end tests passing on `chromium` and `mobile-chrome`
through the local Chrome channel, 0 failed.

### By phase

| Phase                       | State                   | What exists, and what does not                                                                                                                                                                                                                  |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Plan                      | Done, partly            | `docs/finish-plan.md`, `WHAT-I-NEED-FROM-YOU.md`. The design audit (`docs/design-audit.md`) was never written                                                                                                                                   |
| 2 Data foundation           | Done                    | `src/cache/` (memory, Redis, read-through with stale-while-revalidate), `cache.refresh` job and `PRICE_REFRESH_MINUTES`, `UpdatedAgo`, Open-Meteo weather with "typical for these dates", production no-mock guard and its test, `absent` slots |
| 3 Hotels                    | Done, partly            | Trips work with no priced stay (`hotel: null`, `excluded` line, honest "all in"); `travelpayouts-links` adapter and "Find a stay". No priced hotel feed exists. The Booking.com URL parameters were not verified on a live click                |
| 4 Accounts, email, alerts   | Done, as changed by D14 | Resend driver; three transactional mails; in-app bell; Web Push; alert preferences (migration 0008). The digest and unsubscribe were dropped. Real delivery not verified                                                                        |
| 5 Flexible dates            | Done                    | `src/core/flex-dates.ts`, strip, shared `day-prices` loader, price calendar loads every day of both visible months (two calls per destination per month for Aviasales)                                                                          |
| 6 Design direction, imagery | Done, partly            | `docs/design-direction.md`; 16 generated destination illustrations. No hero video                                                                                                                                                               |
| 7 Design build              | Partly                  | See below                                                                                                                                                                                                                                       |
| 8 Polish, review, docs      | Partly                  | End-to-end and accessibility suite green; 8 real bugs fixed; README, architecture, runbook, setup checklist and design docs rewritten. No security review, no impeccable polish pass, no cookie consent                                         |

### Design build (phase 7)

- Done: shared persistent globe for home and explore (`(stage)` route group, stage store, client-side
  navigation); NASA Blue Marble surface and city lights; arcs follow drag; phone header and menu;
  home below the hero (cards, mosaic, rail, full-bleed moment); explore results and calendar;
  destination page; sign-in and account pages, trips hub, watches, stays, status, legal, offline and
  error pages; provenance badges removed (D20).
- Not done: pinned full-bleed section, hero scroll choreography, view-transition morphs beyond the
  card-to-destination image, clouds, hero video, upscaled masters, email visuals.
- Most new screens have not been reviewed in a browser by a person. Screenshots in `docs/screenshots/`
  are fixture data.

### Other decisions

| Decision                                | State                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D13 "up to 30 things to do"             | Not done. No places data source; places are `absent` in production                                                                                                     |
| D15 Travelpayouts Drive script          | Done, production only. No consent gating (owner decision open)                                                                                                         |
| D16, D18 partner hub, native components | Partly: four partners (Intui, AirHelp, Yesim, GigSky). Hotels, car rental, tours, insurance, trains, luggage not registered                                            |
| D17 trip hub                            | Partly: plan, shared expenses, emergency numbers, migration 0009. Invites, edit-expense, currency picker not built; promo codes supported in the type, none registered |
| D19 globe catalogue                     | Done as dots from a static airport catalogue; a dot has a price only when the cache has one                                                                            |

### Not verified

- Real email delivery through Resend, with a verified domain.
- Live Aviasales calendar calls from a deployed host, and the real quota behaviour.
- Migrations 0008 and 0009 against a real Postgres.
- `/api/health` in production: by reading the code it answers 503 because the `absent` slots report
  `unavailable`. Not run.
- The cache key roll-over at 00:00 UTC on a live deployment.

### Found while writing the docs

- `DESIGN.md` described a violet accent; `globals.css` has leather. Corrected.
- `HOTEL_REFRESH_MINUTES` and the five `*_PROVIDER_API_KEY` variables are read by no code.
- `AI_PROVIDER=anthropic` is accepted by the schema and fails at startup; no adapter exists.
- `WHAT-I-NEED-FROM-YOU.md` names `VAPID_PUBLIC_KEY` (the code reads `NEXT_PUBLIC_VAPID_PUBLIC_KEY`),
  `OPEN_METEO_API_KEY` (nothing reads it), and says Resend unlocks price-drop alerts and a digest
  (D14 removed both). Not edited here.
- `.env.example` could not be read or written in this session; the proposed content is in
  `docs/env-example-proposed.md`.

### Next

Owner: production host and env, Resend domain, Redis, Postgres, the cookie-consent decision, a
priced hotel feed key. Code: places data and "things to do", more partners, trip invites, cookie
consent, hero video, a browser review of every screen, security review.
