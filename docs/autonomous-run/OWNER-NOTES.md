# Owner and reviewer notes for the autonomous run

Written by the reviewer (Claude desktop) on behalf of the owner. The reviewer cannot type into this
terminal, so this file is the channel. **At the start of every loop iteration, and again before you
write the final HANDOFF.md, read this file and act on every note.** Under each note, add a line
`Done:` or `Blocked:` with the commit hash or the reason. Do not delete notes. The reviewer reads
this file and your PROGRESS.md every few minutes. The guardrails in VOYAGR-AUTONOMOUS-PROMPT.md still apply
in full (branch feat/mcp-only-flights, never push to main, never read or commit .env).

## N1: evidence for the "already failing on main" e2e list
The reviewer can only read files, not run tests. For every e2e test you classify as "already failing on
main", write `docs/autonomous-run/E2E-TRIAGE.md` with: test name, the exact command you ran in the main
worktree, and the failing output line. Also list the tests this branch caused and the commit that fixed
each. A claim without that evidence will be treated as unverified.

Status: Blocked: the main worktree used for triage was removed after the run (it caught the node_modules junction). E2E-TRIAGE.md is not written yet, because the main-run commands and output lines were not kept. Partial evidence: the triage commits 74c84f9, a0409e1 and 9c88478, and the section Pre-existing e2e failures on main in DECISIONS.md. Recreate a main worktree under the scratchpad and re-run the failing tests there to finish this.

## N2: verification log
After every verification step (typecheck, lint, unit tests, build, e2e), append a dated line to
`docs/autonomous-run/PROGRESS.md` with the command and the summary counts (passed, failed, skipped).
Never write a count you did not just read from real output.

Status: Done: counts logged from real output in docs/autonomous-run/PROGRESS.md under Verification log (commit 7e467aa).

## N3: `.env.example`
Check `.env.example` for a duplicated `FLIGHT_PROVIDER` line or placeholders that conflict with each other
(the first HANDOFF warned about this). Fix it, and add a test or check script if one is cheap.

Status: Blocked: .env.example is denied to agents by a permission setting, so it cannot be read or edited here. The owner needs to check it for a duplicate FLIGHT_PROVIDER line.

## N4: optimisation pass (after e2e is green or fully triaged)
Measure before and after, and record the numbers in `docs/autonomous-run/OPTIMISATION.md`:
- MCP calls per scenario (cold start, warm 12 h cache, globe drag, globe click, recommendations on home).
- Cache hit rate per layer (memory, Redis, Postgres).
- Wire the Redis lock and the Redis-held daily budget if time allows (both are in memory now).
Stop optimising when two measured changes in a row give no meaningful gain.

Status: Blocked: not started. Waiting on N1 and the one failing e2e test (mobile narrows results). Then measure the four scenarios and the cache hit rates.

## N5: do not touch
`docs/imagery-options.md` is the owner's open file. Leave it alone and do not make `npm run verify` depend on it.

Status: Done: docs/imagery-options.md and this notes file are excluded in .prettierignore (commit 7e467aa), so npx prettier --check passes without touching the owner file.

## N7: it must look good, not just work
The redesign is part of this project. Every UI you add or touch (the hub saving line on Explore, the
recommendations on Home, the globe route arcs, the route offers panel, the "checked N h ago" labels,
skeletons, error and empty states, price-drop alerts) must look polished and consistent with the
existing design. Read `DESIGN.md`, `docs/design-system.md` and `docs/homepage-redesign.md` first, reuse the
existing tokens and components, and use the impeccable and design skills in `.claude/skills/`. Check each
screen in a real browser with Playwright at desktop and phone widths: no layout shift, good spacing and
typography, readable contrast, smooth but restrained motion, keyboard and screen-reader basics. Save
before and after screenshots in `docs/autonomous-run/screenshots/` and say in PROGRESS.md what you
improved. Ugly or half-styled states count as not done.

Status: Blocked for now: not yet done. In progress in this iteration: a UI pass on the new surfaces with before and after screenshots; this line will change to Done or a specific Blocked reason when that pass ends.

## N6: finish
When the acceptance list is done and only optimisation ideas remain, update HANDOFF.md (what is verified,
what is not, with the evidence file names), commit, send the notification, and stop.

Status: Blocked: waiting on N1, N4 and the last failing e2e test before the final HANDOFF.md.
