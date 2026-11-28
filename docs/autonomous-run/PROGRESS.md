# Progress (autonomous run: MCP-only flights)

Branch: feat/mcp-only-flights (created from feat/voyagr-autonomous-product-completion @ 21cb1e7).
Not pushed. `main` is untouched.

## Acceptance items
- [ ] Kiwi MCP adapter with recorded-fixture contract tests; FLIGHT_PROVIDER=kiwi-mcp default
- [ ] 12 h read path (Redis, Postgres, MCP, stale fallback), single-flight, limiter, circuit breaker, daily budget
- [ ] Nightly cleanup of past-dated rows, with aggregates kept
- [ ] Route graph and offers in Postgres with migrations and contract tests
- [ ] Hub and nearby-airport comparison, total-cost maths, self-transfer warning
- [ ] Price-drop detection and notification (existing channels), tests
- [ ] Globe makes zero MCP calls while rotating; click opens prices; e2e
- [ ] Lazy recommendations under the 12 h rule
- [ ] npm run verify and test:e2e pass; docs updated
- [ ] DECISIONS.md complete (this file exists)

## Iteration log
- Iteration 0: branch created, DECISIONS.md and PROGRESS.md written.
- Slice 1: Kiwi MCP client (timeout, retry, circuit breaker, budget) and kiwi-mcp flight adapter with fixture contract tests; env default kiwi-mcp. Docs and cache not yet.
- Slice 2: 12 h flight freshness policy and "checked N h ago" label; Kiwi read path (cache, Postgres `kiwi_offers` via migration 0016, MCP, stale fallback, no_data) with single-flight (in-process map, optional Redis lock); memory/Postgres contract test. Not yet: nightly cleanup, Redis daily budget, wiring into visitor pages.
- Slice 4: pure hub and nearby-airport comparison in src/core/hub (candidate table with distance-banded transfer estimates, total-cost compare with exact integer thresholds, self-transfer warning key); seeded property tests. No UI, no MCP calls.
- Slice 3: migration 0017 (route_graph, route_aggregates); route graph, aggregates and past-departure delete in memory and Postgres repositories with a contract test; pure prune (src/core/cleanup/prune.ts); job cleanup.nightly with a daily UTC scheduler (CLEANUP_UTC_HOUR, default 3), zero provider calls. Postgres contract not run against a real database.
- Slice 5: pure price-drop baseline and detection (src/core/alerts), migration 0018 price_alerts with memory/Postgres repos and contract test, delivery via in-app, web push and console email (src/notifications/price-drop.ts). Not yet wired into a lookup path.
- Slice 8a: kiwi-mcp now resolves to the 12 h read path (KiwiCachedFlightProvider) in the registry; legacy flight providers refused in production without the opt-in. One orchestrator freshness test still expects the old 30 min limit.
- Slice 7: lazy recommendations: `RecommendationService` (src/search/recommendations.ts) serves a stored list under 12 h with zero MCP calls, else one `anywhere` + `one_for_city` call guarded by a daily call budget; pure list build in src/core/recommendations; migration 0019 `recommendation_lists` (memory/Postgres); `RecommendationsList` UI with fixed min-height and skeleton rows. Not yet wired into a page or API route.
