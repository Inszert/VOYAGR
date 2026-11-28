# Decisions and assumptions (autonomous run: MCP-only flights)

Each entry: the decision, why, and what would change it.

## Conflicts with earlier agreements (owner must confirm)

- **Flights only from Kiwi MCP.** Earlier the owner chose Aviasales for flights and Nuitee flights
  only once Nuitee approves production. This run makes `FLIGHT_PROVIDER=kiwi-mcp` the production
  default and turns Aviasales and Nuitee flights off by configuration (kept in the tree).
  Why: the owner's prompt says so explicitly. Change: set `FLIGHT_PROVIDER` back.
- **Kiwi terms are unverified.** The prompt itself says the terms for commercial or automated use
  have not been checked. The adapter ships behind the default, but the owner must check the terms
  before any public launch. Recorded in `docs/provider-policy.md`.
- **No live provider on visitor pages** (the earlier owner rule) is relaxed for the Kiwi MCP path
  only, as section 4 of the prompt requires: a visitor's click may trigger one MCP call when no fresh
  stored data exists (12-hour rule). The globe never calls the MCP (section 8).

## Assumptions from the prompt (named in the prompt as assumptions)

- "5 sec" means a 5-second timeout per MCP call. One constant.
- Thresholds: hub saving at least 15 EUR and 10 percent; price-drop alert at 85 percent of the
  median and at least 15 EUR less. Both configurable.
- Nearby-airport radius default 250 km.
- "The rest off" means the other flight sources. Keyless weather, FX and places stay on.
- Aggregates kept after the nightly cleanup: per route and month, median, min and sample count.

## Facts still to verify (recorded fixture, then owner check)

- The Kiwi response shape (recorded in `src/providers/mcp/fixtures/`, see the next entry).
- Whether the documented date flexibility and the hidden rate limit hold in practice.

## Slice 1: the Kiwi MCP adapter

- **One-way fixture, round-trip domain type.** The recorded answer is a one-way search
  (`inbound: null`) but `FlightOffer` requires both legs. So the 15 recorded itineraries map to
  `OneWayFare` through `searchOneWay` (month window, `departureDate..departureDateTo`), and
  `searchFlights` (return) maps only itineraries that have an inbound, counting the rest as
  `no_inbound`. The prompt did not say which; nothing is invented to fill an inbound. The return path
  is covered by a hand-made itinerary, not by a recording: a recorded return answer is still needed.
- **Price is the party's total.** The server does not document whether `price` is per adult or for
  all passengers. It is taken as the total for the `adults` asked for. Verify with a recorded 2-adult call.
- **Self transfer is `true` or unknown, never `false`.** The answer has no such field. It is `true`
  only when the next segment leaves from another airport than the last one reached (the recorded
  VIE-MXP / BGY-LIS). A `|` in the itinerary id looks like separate tickets but is undocumented, so it is not used.
- **Baggage** counts are stated: `cabinBag > 0` and `checkedBag > 0`; absent block means `null`.
- `bookingUrl` is accepted only as https on a kiwi.com host and is otherwise dropped as malformed.
- Times with a zone suffix are dropped (`unparsable_time`), not converted.
- **Budget, concurrency (2) and pacing (about 1 a second, jittered)** live in the MCP client, per
  process, in memory. Redis-backed counters and single-flight come with the cache slice. A retry counts as a call.
- **Env.** `FLIGHT_PROVIDER` default is now `kiwi-mcp`; `ALLOW_LEGACY_FLIGHT_PROVIDERS` (default
  false) is the production switch for `aviasales`, `liteapi`, `live`. `mock` is still governed by
  `ALLOW_MOCK_IN_PRODUCTION`. `.env.example` was appended with placeholders only (could not read it
  first in this run, so check it for a duplicate `FLIGHT_PROVIDER` line).
- `docs/provider-policy.md`, `README.md` and `data-source.ts` are not updated yet (not in this slice).

## Slice 2: the 12-hour read path

- **Flight freshness is 12 h** (`FLIGHT_MAX_AGE_MS`). Changed test: `flex-dates.test.ts` "30 minutes is the edge" now tests the 12-hour edge (it reads `DEFAULT_FRESHNESS.flights`). `freshness.test.ts` keeps its own 30-minute limits for the generic function; a 12-hour policy block and the label were added. Label: whole hours rounded down, "checked less than 1 h ago" under an hour.
- **The observation time travels inside the cached value** (`{offers, observedAt, v}`), because `CacheStore.set` stamps the write time; warming Redis from a 10-hour-old Postgres row must not make it look new. Cache TTL is the remaining fresh time, so a cache entry is never stale; stale data lives only in Postgres (`kiwi_offers`, never expired by the database).
- **Postgres table is new (`kiwi_offers`), not the LiteAPI snapshot**, whose rows vanish at `expires_at`; the stale fallback needs old rows to survive. Key: origin, destination, dates, adults, currency. No cabin (the Kiwi call has none).
- **A process that loses the Redis lock waits (6 s, polling the cache) and never calls the MCP itself**; on timeout it serves stored data or `no_data`. Redis down means the lock is treated as held (proceed alone). Nothing wires the lock to a real Redis client yet.
- **An empty successful answer is stored** (it is a fact: no flights), and counts as fresh.
- Not done: nightly cleanup, the daily budget in Redis, wiring the read path into pages or the provider factory.

## Slice 4: hub and nearby-airport comparison (all figures are ESTIMATES or thresholds)

- **Candidates are data** in `src/core/hub/candidates.ts` (`ORIGIN_TABLE`): BUD, VIE, KSC, FRA, IST, PRG, WAW, MUC, MXP, BCN, each with listed low-cost hubs. Positions come from the repo's OurAirports data; distance is the great circle from `src/core/distance.ts` (whole km). Nearby = `large` airports within 250 km (configurable `maxGroundKm`) plus the listed hubs.
- **Ground transfer ESTIMATE (EUR, one way, by straight-line km):** up to 60 km 15.00 EUR / 60 min; up to 120 km 25.00 / 105 min; up to 180 km 35.00 / 150 min; up to 250 km 45.00 / 200 min; up to 400 km 65.00 / 290 min. Beyond 400 km no estimate, so the candidate is left out. Labelled `basis: 'estimate'`. Not quotes.
- **Materiality thresholds:** saving at least 1500 minor units AND at least 10 percent of the requested total (both configurable). The percent test is cross-multiplied in integers, exact at the boundary. A candidate with no price is never compared.
- **Self-transfer:** more than one separate ticket returns the key `hub.selfTransfer.separateTickets`; copy is the UI's job.
- fast-check is not installed: properties use a seeded LCG loop (500 cases).
- Comparison assumes one currency; converting is the caller's job (`src/core/fx.ts`).

## Slice 3: nightly cleanup and the route graph

- **What is aggregated.** Per route (origin, destination), month of departure (YYYY-MM) and currency: the median and minimum of the cheapest offer price of each stored lookup (one sample per `kiwi_offers` row, rows with no readable price are skipped), and the sample count. Integer minor units only; an even-count median is the floor of the mean of the two middle values. Computed from the rows about to be deleted, written before the delete.
- **What is deleted.** `kiwi_offers` rows with departure date before today (UTC day, passed in the job payload; the pure code never reads a clock). Today's departures are kept. `route_graph` has no dates of travel and is never pruned.
- **Observation rows.** `price_observations` is keyed by watch and carries no departure date, and has its own retention (`pruneOlderThan`, keeps each watch's cheapest). The cleanup does not touch it; the only departure-dated table today is `kiwi_offers`. Calendar days and watch snapshots are not stored separately yet.
- **Merging across nights.** A month is cleaned over many nights, so a write into an existing bucket merges: min and count exact, median becomes the count-weighted mean of old and new medians (a true median cannot be rebuilt from two medians). An approximation, documented in the repository interface.
- **Schedule.** The worker checks every minute and enqueues `cleanup.nightly` once per UTC day from `CLEANUP_UTC_HOUR` (default 3, 0 to 23). A restart later the same day enqueues once more; harmless since the delete is idempotent, though the merge could double-count only if a run failed between writing aggregates and deleting. Aggregates are written first on purpose: losing a baseline is worse than counting one twice. The job never calls the MCP.

## Slice 5: price-drop detection

- **Observations are recorded only when a lookup actually happened** (a user request or the lazy recommendation generation). There is no background polling, so alert quality depends on usage: a route nobody looks up gets no baseline and no alert. An optional, rate-limited "refresh my watches on app open" step (12 h rule applies) is suggested and not built.
- **Baseline** (`src/core/alerts/baseline.ts`): median of cheapest-price observations of one route, month and currency in the last 30 days; fewer than 5 means `null` (no guess). Even count: floor of the mean of the middle two. Future-dated observations are ignored. The observation being judged is excluded from its own baseline.
- **Material drop** (`detect.ts`, constants in `constants.ts`): new price at most 85 percent of the median (cross-multiplied, exact) AND at least 1500 minor units below it. Results carry a reason code: no_baseline, invalid_price, currency_mismatch, not_material, duplicate_observation, duplicate_window.
- **De-duplication:** same watch and route not twice within 24 h (exactly 24 h is allowed again); never twice for the same observation id, also enforced by `UNIQUE (watch_id, observation_id)` in the new table.
- **Persistence:** additive migration `0018_price_alerts.sql` (`price_alerts`), memory and Postgres repositories, contract test (Postgres cases skip without a database; not run against a real one). The alert text is a normal `notifications` row.
- **Delivery** (`src/notifications/price-drop.ts`): in-app notification always, web push through the existing `deliverNotification` when the channel is configured, and email through the injected `EmailProvider` (console driver in dev and tests). Honours `priceDropAlerts` preference. The email carries a `List-Unsubscribe` header to `/account`; the layout's note that Voyagr sends no alert mail is now out of date. Nothing calls this yet from a lookup path (not wired).

## Slice 8a: the read path is the flight provider

- `FLIGHT_PROVIDER=kiwi-mcp` now builds `KiwiCachedFlightProvider` (`src/providers/flights/kiwi-cached.ts`): a `FlightProvider` that runs each origin x destination pair through `KiwiReadPath`. Same `metadata.id` (`kiwi-mcp`), so provenance and orchestrator code are unchanged. Cache and Postgres are resolved on first search, so building the registry opens no connection.
- **Stale is labelled on the offer**: it keeps its original `observedAt` (the freshness engine judges that) and its `source.displayName` becomes "Kiwi.com, checked 14 h ago". All pairs with no stored data and a failed call returns the error, not an empty page.
- **No `searchOneWay` / month sources on this provider**: they would be MCP calls outside the cache and the 12 h rule. The orchestrator already treats their absence as "not offered", so one-way pairing is off under kiwi-mcp. Revisit if wanted, through the read path.
- `directOnly` is applied after the lookup (the cached key has no such flag); results are sorted cheapest first and cut to `maxResults`.
- Registry also refuses `aviasales`, `liteapi`, `live` in production unless `ALLOW_LEGACY_FLIGHT_PROVIDERS=true` (same rule as `parseEnv`, for an Env that bypassed it). Outside production they stay selectable, as before.
- Changed test setup: the "production serves no fixtures" fixture used `aviasales`; it now uses `kiwi-mcp`, the only production-valid value.
- Existing failure, not from this slice: `orchestrator.test.ts` "calls the same quote stale once it has aged past the limit" expects a 30-minute limit; flights are 12 h since slice 2.

## Slice 7: lazy recommendations

- **One MCP call per generation**: `search-flight` with `flyTo: "anywhere"` and `one_for_city: true` plus the date window and a nights range. The brief's "anywhere plus one_for_city" is read as one combined call, not two; it keeps a generation at 1 call.
- **Budget**: this feature has its own daily allowance (`RECOMMENDATION_DAILY_CALLS`, 20 per UTC day, in memory per process) checked before the call, on top of the MCP client's global budget. A spent allowance keeps the stored list and reports `refreshFailed: 'budget'`. A failed call, an unusable answer or an answer with no usable destination also keeps the stored list (`'error'`) and the age label; an empty answer never overwrites a good list.
- **Freshness**: the stored list's `generatedAt` is the instant the MCP answered; fresh means 12 h or less (`FLIGHT_MAX_AGE_MS`). `peek` reads storage only and never calls the MCP. Simultaneous requests for one key share one generation.
- **Deterministic build** (`src/core/recommendations/build.ts`): cheapest return per destination in the requested currency, cheapest first, 12 lines; prices are the offers' own integer minor units. No score is invented: ranking is by price only. The candidates are the offers of that generation, which are also written to `kiwi_offers` (cheapest per destination) and, for nonstop routes, to `route_graph`. The list is not filtered by the graph, since that would hide every new destination forever.
- **Storage**: migration 0019 `recommendation_lists`, keyed by origin, date window, adults, currency; memory and Postgres repositories. The Postgres one was not run against a real database.
- **UI**: `RecommendationsList` shows the stored list at once, runs the injected `refresh` once when the list is not fresh, and keeps a fixed minimum height of five rows with skeleton rows for unknown ones. Not done: the server action or route that builds the service and the page that mounts it, a per-origin warm-up, and a contract test for the Postgres repository.
- `src/search/orchestrator.test.ts` "calls the same quote stale once it has aged past the limit" fails in the working tree and is not caused by this slice (it expects the old 30-minute limit).

## Slice 6: lazy globe

- **What the globe shows.** Arcs from the home airport to destinations present in `route_graph` (a route exists because an earlier lookup stored it), drawn through the existing `routes` GeoJSON so `globe-arcs.ts`, camera, data model and rendering are untouched. An airport with no stored edge or no known position is not drawn. Merged in `stage-host.tsx` by `withStoredRoutes`: routes the page already draws win; at most 25 stored lines are added, unranked (`stops: null`).
- **Why stored only while moving.** `loadStoredRoutes` takes a `RouteGraphRepository` and nothing else, and `/api/globe-routes` imports no provider; the zero-call test mocks the provider registry and MCP client modules and fails on any call. The browser loader can only reach `/api/globe-routes`, debounced (350 ms) with the previous request cancelled.
- **Click is the only paid path.** `RouteOffersPanel` calls `/api/route-offers` (one `KiwiReadPath.lookup`, single-flight per process). Prices are formatted server-side from `Money`. Unmounting aborts the request; `no_data` shows "nothing is saved for this route yet".
- **Limits.** Only edges exist in the route graph, so stored routes carry carriers and last-seen but no price; prices appear after a click. The globe does not report its viewport, so stage-host asks for the whole world; the endpoint already accepts a box. Mounting the panel from a globe click and its dates (from the search) is not wired.
- **Test changed on purpose.** "calls the same quote stale once it has aged past the limit" in `orchestrator.test.ts` now uses `FLIGHT_MAX_AGE_MS` from `src/core/freshness.ts` (12 h, the flight policy since slice 2) instead of the old 8-hour probe against a 30-minute expectation; it still asserts a quote just inside the limit is fresh and one just past it is stale.
- **Slice 9: click-to-panel.** The arc SVG stays `pointer-events: none`; only each arc's 5px glow stroke takes the pointer (`globe-stage.tsx`), and an arc faded to under 0.3 opacity is not a target. `ArcRun` gained optional `origin`/`destination`. `GlobeStage` takes `onRouteSelect`; `stage-host.tsx` keeps the open route in state and mounts `RouteOffersPanel` in a dialog with the dates from `departureDate`/`returnDate` in the address at click time (no dates: it says to choose dates and makes no call). Camera, data and rendering model untouched. Build note: `.env` sets a legacy FLIGHT_PROVIDER, so the production build needs `FLIGHT_PROVIDER=kiwi-mcp` in the environment.

## Slice 5b: price-drop wired to the lookup path

- **Hook point.** `KiwiReadPath.fetch` (src/providers/flights/kiwi-read-path.ts) calls `onFreshObservation` once, after a successful MCP answer is written to both stores. Cache hits, row hits, stale fallbacks and lock losers never reach it, so an observation exists only when a lookup really happened. Its failure is logged and never changes the lookup answer. No timer anywhere.
- **Observer** (`src/watches/price-drop-observer.ts`): cheapest positive offer in the lookup currency, per route and departure month, into a `RouteObservationStore`; then every active watch whose saved search has that origin and destination gets `raisePriceDropAlert` (delivery: in-app, push channel when configured, email through the registry provider, console driver in dev). Registered in the provider registry for `kiwi-mcp`.
- **Watches** come from `src/watches` records via a new `TravelWatchRepository.listActive()` (memory and Postgres; Postgres not run against a real database).
- **Known limit.** The observation store is in process memory: a restart loses the baseline until five lookups accumulate again, and a multi-instance deployment keeps one baseline per instance. A durable table is a later slice. A watch matches a route by origin and destination only, not by its date window.
