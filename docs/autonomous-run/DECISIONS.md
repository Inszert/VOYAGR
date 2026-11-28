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
