# Progress

**Last updated:** 2026-11-03
**Stage:** The product owner set a hard constraint Duffel/Amadeus/Booking.com/Hotelbeds cannot
meet at any price: zero paid search cost, ever. `docs/provider-evaluation.md` now has a dated
update researching free alternatives. Shipped this session: a real (keyless, free) weather
provider, a real airport reference dataset, and a correctness fix to the Aviasales adapter that
was about to mislabel cached prices as live.
**Next:** wire the new airport reference data into flight search/nearby-airports so it is not only
weather that benefits; get a written answer from Travelpayouts on background polling before Travel
Watch polls it unattended; decide whether hotels stay demo-only or get dropped to an explicit
`excluded` cost line when a real flight provider is active.

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
