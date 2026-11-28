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
