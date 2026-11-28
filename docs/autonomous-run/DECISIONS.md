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
