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
- Slice 6: lazy globe. `/api/globe-routes` reads only the stored route graph (zero-provider/MCP test); stored arcs merge into the existing arc layer via stage-host; clicking a route runs the 12 h read path through `/api/route-offers` in `RouteOffersPanel` (skeleton, Kiwi link, "checked N h ago", honest failure, cancel on click-away). Not yet: the panel is not mounted from a globe click, viewport bounds not sent, no browser check.
- Slice 9: typecheck clean. A click on a route arc opens `RouteOffersPanel` (stage-host dialog, dates from the URL); stage-host test proves zero price calls before the click and one after. Browser check on a production build: a drag made only tile requests, none to mcp.kiwi.com or route-offers; the click made one `/api/route-offers` call and opened the dialog.
- Slice 5b: price-drop detection wired into the 12 h read path (fresh MCP answer only, no timer); observer in src/watches/price-drop-observer.ts, in-memory baseline store, listActive on watches.
- Slice 10: hub saving and lazy recommendations wired into pages. Explore shows "Cheaper from X: save ... including a ... transfer (estimate)" from stored prices only (`src/search/hub-saving.ts`, EUR only, material thresholds from `src/core/hub`); home shows `RecommendationsList` fed by `peek` on render and a server action that builds through the service only when stale. Test: fresh list makes zero MCP calls; no page or loader imports the MCP client. Not verified in a browser.
- E2E triage: 29 failures from the first full run classified (1 real layout-shift bug in the filter rail, 9 tests updated to the explore/stays redesign, the rest load-induced at 8 workers). Fixed and re-run at `--workers=2 --repeat-each=2`: all pass. See DECISIONS.md "E2E triage".

## Verification log (N2; counts copied from real output)

- 2026-11-28 `npm run typecheck`: exit 0.
- 2026-11-28 `npm run lint`: exit 0.
- 2026-11-28 `npx vitest run --testTimeout=60000`: 271 files passed; 3192 tests passed, 3 skipped.
- 2026-11-28 `npx prettier --check .`: exit 0 after excluding docs/imagery-options.md and docs/autonomous-run/OWNER-NOTES.md (owner-owned files, see .prettierignore).
- 2026-11-28 `npx playwright test --workers=4` (production build, chrome): 298 passed, 1 failed (mobile-chrome 'narrows results without searching again'), 1 skipped. Failing test not yet fixed; see E2E-TRIAGE.md.
- 2026-11-28 `npx playwright test tests/e2e/search.spec.ts -g "narrows results without searching again" --project=mobile-chrome --repeat-each=3` (production build, chrome, clean worktree of HEAD with the test fix): 3 passed at --workers=2 and 3 passed at --workers=4. Before the fix it was 3 passed at --workers=2 (did not reproduce). See E2E-TRIAGE.md.

## N7 UI pass (new surfaces)
Checked in Chrome at 1440, 768 and 390 on a throwaway preview page of each state (not committed). No horizontal overflow at any width. Screenshots: `docs/autonomous-run/screenshots/before-preview-{1440,768,390}.png` and `after-preview-{1440,768,390}.png`.
- Hub saving line: now a bordered sunken row; "(estimate)" in caution ink (still a word).
- Recommendations: fixed a real bug where the background refresh never finished under React strict mode (skeletons stuck on "Updating"); a finished empty list shows a message instead of skeleton rows; prices read "from X".
- Route offers panel: dates formatted ("4 Mar 2027, 07:15"), "direct / 1 stop" instead of "0 stops", legs as a labelled list, tabular price, 44px booking link, skeleton height matches an offer, unrefreshed note in caution ink, failure message in a bordered note. Dialog uses card radius and floating shadow; Close button had a nonexistent focus-ring token with the outline removed, now a 44px target with the global focus ring.
- Not done: Home and Explore pages in the real app could not show these surfaces (no database reachable, no stored prices); the globe arcs, camera and price-drop email were left alone.

- 2026-11-28 N1/N8: reran the 29 earlier e2e failures on a clean worktree of main (39d2387, own npm ci, 4 workers): 0 failed, 28 passed, 1 not run (stays-start spec does not exist on main). None is a pre-existing main failure; branch fixes are 74c84f9 (real layout bug), a0409e1 (specs updated for the redesign) and 61bdf22 (mobile filters race). e2e-run3 had 1 failure, not 0. Worktree removed. See E2E-TRIAGE.md.
