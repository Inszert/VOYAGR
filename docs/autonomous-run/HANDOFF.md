# Handoff: MCP-only flights run (branch feat/mcp-only-flights)

Read this first. The run is NOT complete against the acceptance list in
VOYAGR-AUTONOMOUS-PROMPT.md. This file says what is done, what is verified, and what is not.
Nothing is pushed. `main` is untouched.

## How to review

- `git log --oneline main..feat/mcp-only-flights` (the run's commits)
- `npm run typecheck && npm run lint && npx vitest run --testTimeout=60000` (all pass at the last check:
  3175 tests passed, 3 skipped, which are the Postgres contract cases with no database)
- `npm run build` with `FLIGHT_PROVIDER=kiwi-mcp` (passes; see the note on `.env` below)
- Decisions and assumptions: `docs/autonomous-run/DECISIONS.md`. Progress: `PROGRESS.md`.

## Built (committed)

1. Kiwi MCP client (`src/providers/mcp/client.ts`): 5 s timeout, bounded retries with jitter,
   a circuit breaker, a fixed host. Tests use a fake transport.
2. Kiwi flight adapter (`src/providers/flights/kiwi-mcp.ts`), mapped with Zod, dropping and
   counting what cannot be mapped. Contract tests against a recorded real response
   (`src/providers/mcp/fixtures/kiwi-search-flight-vie-lis.raw.txt`, one live call on 2026-11-28).
3. 12-hour read path (`kiwi-read-path.ts`): cache, then Postgres, then MCP, then stale value
   labelled with its age, then an honest "no data". Single-flight in-process (a Redis lock
   is not wired in). Migration `0016_kiwi_offers.sql`.
4. Flight provider the app uses (`kiwi-cached.ts`, registry): `FLIGHT_PROVIDER=kiwi-mcp` is the
   default. Legacy providers (aviasales, liteapi, live) are refused in production unless
   `ALLOW_LEGACY_FLIGHT_PROVIDERS=true`.
5. Nightly cleanup of past-departure offers, with aggregates kept (`prune.ts`, job
   `cleanup.nightly`, 03:00 UTC by default). Migration `0017_route_graph.sql` (route graph and aggregates).
6. Hub and nearby-airport comparison maths (`src/core/hub/`): candidates, total cost with
   estimated transfers (labelled estimates), self-transfer warning. Pure, with property tests.
   Not yet shown in the UI.
7. Price-drop alerts (`src/core/alerts/`, `src/notifications/price-drop.ts`): baseline,
   thresholds, 24-hour de-duplication, delivery through the existing channels. Migration
   `0018_price_alerts.sql`. Not yet called from a lookup path.
8. Lazy recommendations (`src/search/recommendations.ts`, `src/core/recommendations/`): built only
   when older than 12 hours or missing, under a daily call budget. Migration `0019`. Not yet
   wired to a page.
9. Lazy globe (`stored-routes.ts`, `/api/globe-routes`, `/api/route-offers`): the globe draws
   stored routes only. Dragging makes no flight call (checked in the browser: only map tiles
   were requested). Clicking a route opens the offers panel and runs the read path once.

## Verified

- Typecheck, lint, all unit tests: pass at the last run.
- Production build with `FLIGHT_PROVIDER=kiwi-mcp`: compiles.
- Browser, once: dragging the globe made no request to mcp.kiwi.com or a flight endpoint; one
  click on the VIE to LIS route made one `/api/route-offers` request.

## Not done or not verified (the stop condition is not met)

- **End-to-end suite (`npm run test:e2e`) has not been run on this branch.**
- **`npm run verify` does not pass as a whole.** The format step fails on `docs/imagery-options.md`,
  which is an open editor file that this run does not own, so it was left alone.
- **Postgres is untested against a real database.** The migrations 0016 to 0019 and their Postgres
  repositories have only their memory-backend contract tests running.
- **Kiwi terms are unverified** (the prompt says so). Check them before any public launch; see
  `docs/provider-policy.md` (not yet updated by this run).
- **Not wired:** the hub comparison UI, the price-drop call from a lookup path, the
  recommendations on a page, the Redis lock and the daily budget held in Redis (both in memory
  now), the "refresh my watches on app open" option.
- **Docs not yet updated as the prompt requires:** README, `.env.example` (the Kiwi placeholders
  were appended without reading the file, so check for a duplicate `FLIGHT_PROVIDER` line),
  `docs/architecture.md`, `docs/provider-policy.md`, `docs/runbook.md`, `STATUS.md`.
- **Optimisation:** none measured yet.

## Note on the local `.env`

The local `.env` sets a legacy flight provider. Production refuses legacy providers, so a
production build with the local `.env` fails unless `FLIGHT_PROVIDER=kiwi-mcp` is set on the command
line. Set it in the real environment before deploying.

## Suggested next steps (for the owner)

1. Decide whether the Kiwi terms allow this use. If not, stop before any launch.
2. Run `npm run test:e2e` and fix what fails on this branch.
3. Run the migrations against a real Postgres and run the Postgres contract tests.
4. Wire the hub comparison, the alerts and the recommendations into pages, then update the docs.
