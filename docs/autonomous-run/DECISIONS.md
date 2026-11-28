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
