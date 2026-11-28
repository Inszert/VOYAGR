# E2E triage (N1, rebuilt for N8)

Evidence rules: every result below was produced by a command run for this file, in a clean worktree of `main`
(`39d2387`) outside the repo, with its own `npm ci` (no `node_modules` junction) and a fresh production build per
command. The commands are copied verbatim. Where a test was not run, this file says so. The worktree has been removed.

## Result in one line

Of the 29 tests that failed on `feat/mcp-only-flights` in the earlier full run (`e2e-run2-clean.log`: 29 failed, 270 passed,
1 skipped): **0 fail on main, 28 pass on main, 1 was not run** (the test does not exist on main). So none of the 29 is "already
failing on main". Nothing in this file is classified as a pre-existing main failure.

What "passes on main" does and does not mean: main runs main's own copy of each spec against main's own UI, and they agree.
The 29 failures were this branch's UI (a deliberate redesign, plus one real layout bug) meeting spec files written for the
old UI. So each is a change made on this branch, not a flaky or environment problem. All were handled by two commits
(below), and one further test was fixed later.

## Environment

- Main worktree: `git worktree add .../scratchpad/voyagr-main-check main` (HEAD `39d2387`), then `npm ci` (683 packages added).
- Env for every command: `NEXT_PUBLIC_APP_URL=https://www.voyagrfind.com PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=3200`.
  `PLAYWRIGHT_PORT=3200` because port 3100 already had a server running and `reuseExistingServer` is on outside CI.
- The Playwright `webServer` runs `npm run build && npx next start --port 3200` itself (Turbopack build, no `.env` in the worktree,
  providers are the mock ones). Nothing was run against production services: `NEXT_PUBLIC_APP_URL` is only a label for URLs.
- An earlier attempt of mine ran two copies of the script at once and collided on `.next`
  (`Could not find a production build in the '.next' directory`). Those outputs were discarded and the whole set was re-run
  alone. The results below are from that clean re-run.

## Commands run on main and their output

`<ENV>` stands for `PLAYWRIGHT_PORT=3200 NEXT_PUBLIC_APP_URL=https://www.voyagrfind.com PLAYWRIGHT_CHANNEL=chrome`.
Each command runs both projects (chromium and mobile-chrome) for the tests it selects, so it also ran some siblings that were not
in the failing 29; those are listed after the table.

1. `<ENV> npx playwright test tests/e2e/accounts.spec.ts -g "signs out and back in|refuses a duplicate email and keeps what was typed|a saved preference becomes a search default without becoming a filter" --workers=4` -> `6 passed (37.9s)`
2. `<ENV> npx playwright test tests/e2e/search.spec.ts -g "submits the form and returns ranked trips|picking a lens runs a search ranked that way|works with the keyboard and carries nothing hidden|explains why the top result ranks where it does|shows every cost line with its confidence|offers alternative hotels the same way, and swaps one in|offers alternative flights priced as whole trips, and swaps one in|explains a trip in words rather than as a score|changing a leg works from the keyboard, and keeps its place|narrows to one set of dates without running another search|offers the flexibility presets without opening anything|narrows results without searching again" --workers=4` -> `24 passed (1.3m)`
3. `<ENV> npx playwright test tests/e2e/shared-globe.spec.ts -g "is the same map and canvas through a search and a change of dates" --workers=4` -> `2 passed (43.0s)`
4. `<ENV> npx playwright test tests/e2e/things-to-do.spec.ts -g "has no accessibility violations, in a filtered view too, and reaches no third party" --workers=4` -> `2 passed (30.1s)`
5. `<ENV> npx playwright test tests/e2e/explore.spec.ts -g "puts the pointer on the planet, not on the box it sits in" --workers=4` -> `2 passed (27.5s)`
6. `<ENV> npx playwright test tests/e2e/trips.spec.ts -g "keeps a plan, splits what a group spent exactly, and knows the emergency numbers" --workers=4` -> `2 passed (32.7s)`
7. The stays-start test (`tests/e2e/stays-start.spec.ts`, "the destination field is the first control after the tabs"): **not run**.
   `git ls-tree main --name-only tests/e2e/` has no `stays-start.spec.ts`; the file was added on this branch (history: `78c0647`,
   then `a0409e1`). The stays page on main is covered by `tests/e2e/stays.spec.ts`, which was not part of the 29.

Total on main: 38 test runs, 38 passed, 0 failed (6 + 24 + 2 + 2 + 2 + 2). 28 of those are the 29 listed below; the other 10
are siblings in the other project that were not in the failing 29 (listed after the table).

## The 29, one by one

Main result is for the same file, test name and project as the branch failure. "Main output line" is the passing line from
the run (there is no failing line, because none failed). Category and fixing commit come from `DECISIONS.md` ("E2E triage after
the first full run") and `git log`; "not recorded" means that file does not say which of its categories the test fell in.

| #   | Project       | Test (file)                                                                             | Main result | Main output line                                         | Category on branch                     | Fixed by       |
| --- | ------------- | --------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------- | -------------------------------------- | -------------- |
| 1   | chromium      | accounts: signs out and back in                                                         | pass        | `accounts.spec.ts:47:3 ... signs out and back in (9.7s)` | load flake at 8 workers                | no code change |
| 2   | chromium      | accounts: refuses a duplicate email and keeps what was typed                            | pass        | `accounts.spec.ts:100:3 ... (5.3s)`                      | load flake at 8 workers                | no code change |
| 3   | chromium      | accounts: a saved preference becomes a search default without becoming a filter         | pass        | `accounts.spec.ts:166:3 ... (8.6s)`                      | b. test out of date                    | a0409e1        |
| 4   | chromium      | search: submits the form and returns ranked trips                                       | pass        | `search.spec.ts:242:3 ... (8.8s)`                        | b. test out of date                    | a0409e1        |
| 5   | chromium      | search: picking a lens runs a search ranked that way                                    | pass        | `search.spec.ts:184:3 ... (25.6s)`                       | b. test out of date                    | a0409e1        |
| 6   | chromium      | search: works with the keyboard and carries nothing hidden                              | pass        | `search.spec.ts:223:3 ... (24.0s)`                       | b. test out of date                    | a0409e1        |
| 7   | chromium      | search: explains why the top result ranks where it does                                 | pass        | `search.spec.ts:300:3 ... (5.5s)`                        | a. real bug (filter rail layout shift) | 74c84f9        |
| 8   | chromium      | search: shows every cost line with its confidence                                       | pass        | `search.spec.ts:312:3 ... (2.0s)`                        | a. real bug                            | 74c84f9        |
| 9   | chromium      | search: offers alternative hotels the same way, and swaps one in                        | pass        | `search.spec.ts:386:3 ... (3.7s)`                        | b. test out of date                    | a0409e1        |
| 10  | chromium      | search: offers alternative flights priced as whole trips, and swaps one in              | pass        | `search.spec.ts:363:3 ... (5.8s)`                        | b. test out of date                    | a0409e1        |
| 11  | chromium      | search: explains a trip in words rather than as a score                                 | pass        | `search.spec.ts:449:3 ... (2.3s)`                        | a. real bug                            | 74c84f9        |
| 12  | chromium      | search: changing a leg works from the keyboard, and keeps its place                     | pass        | `search.spec.ts:480:3 ... (4.4s)`                        | not recorded                           | not recorded   |
| 13  | chromium      | search: narrows to one set of dates without running another search                      | pass        | `search.spec.ts:570:3 ... (3.6s)`                        | a. real bug                            | 74c84f9        |
| 14  | chromium      | search: offers the flexibility presets without opening anything                         | pass        | `search.spec.ts:588:3 ... (4.2s)`                        | b. test out of date                    | a0409e1        |
| 15  | chromium      | shared-globe: is the same map and canvas through a search and a change of dates         | pass        | `shared-globe.spec.ts:64:3 ... (16.6s)`                  | b. test out of date                    | a0409e1        |
| 16  | chromium      | things-to-do: has no accessibility violations, in a filtered view too, ...              | pass        | `things-to-do.spec.ts:84:3 ... (7.1s)`                   | b. test out of date                    | a0409e1        |
| 17  | mobile-chrome | accounts: a saved preference becomes a search default without becoming a filter         | pass        | `accounts.spec.ts:166:3 ... (5.2s)`                      | b. test out of date                    | a0409e1        |
| 18  | mobile-chrome | explore: puts the pointer on the planet, not on the box it sits in                      | pass        | `explore.spec.ts:30:3 ... (5.4s)`                        | b. test out of date                    | a0409e1        |
| 19  | mobile-chrome | search: submits the form and returns ranked trips                                       | pass        | `search.spec.ts:242:3 ... (13.8s)`                       | b. test out of date                    | a0409e1        |
| 20  | mobile-chrome | search: picking a lens runs a search ranked that way                                    | pass        | `search.spec.ts:184:3 ... (25.3s)`                       | b. test out of date                    | a0409e1        |
| 21  | mobile-chrome | search: works with the keyboard and carries nothing hidden                              | pass        | `search.spec.ts:223:3 ... (24.1s)`                       | b. test out of date                    | a0409e1        |
| 22  | mobile-chrome | search: offers alternative hotels the same way, and swaps one in                        | pass        | `search.spec.ts:386:3 ... (4.1s)`                        | b. test out of date                    | a0409e1        |
| 23  | mobile-chrome | search: offers alternative flights priced as whole trips, and swaps one in              | pass        | `search.spec.ts:363:3 ... (4.0s)`                        | b. test out of date                    | a0409e1        |
| 24  | mobile-chrome | search: narrows results without searching again                                         | pass        | `search.spec.ts:414:3 ... (4.3s)`                        | test race on a phone (see below)       | 61bdf22        |
| 25  | mobile-chrome | search: offers the flexibility presets without opening anything                         | pass        | `search.spec.ts:588:3 ... (2.9s)`                        | b. test out of date                    | a0409e1        |
| 26  | mobile-chrome | shared-globe: is the same map and canvas through a search and a change of dates         | pass        | `shared-globe.spec.ts:64:3 ... (20.3s)`                  | b. test out of date                    | a0409e1        |
| 27  | mobile-chrome | stays-start: the destination field is the first control after the tabs                  | not run     | file does not exist on main                              | b. test out of date                    | a0409e1        |
| 28  | mobile-chrome | things-to-do: has no accessibility violations, in a filtered view too, ...              | pass        | `things-to-do.spec.ts:84:3 ... (8.3s)`                   | b. test out of date                    | a0409e1        |
| 29  | mobile-chrome | trips: keeps a plan, splits what a group spent exactly, and knows the emergency numbers | pass        | `trips.spec.ts:69:3 ... (10.6s)`                         | b. test out of date                    | a0409e1        |

Output lines are shortened with `...`; the full line in the log has the project tag and the full test title, for example
`✓  1 [chromium] › tests\e2e\accounts.spec.ts:47:3 › accounts › signs out and back in (9.7s)`.

Extra runs that were not in the failing 29 (10, all passed on main, because each `-g` selects both projects): accounts "signs out and
back in" and "refuses a duplicate email" on mobile-chrome (2); search on mobile-chrome "explains why the top result ranks where it
does", "shows every cost line with its confidence", "explains a trip in words rather than as a score", "changing a leg works from
the keyboard, and keeps its place" and "narrows to one set of dates without running another search" (5); search on chromium
"narrows results without searching again" (1); explore on chromium (1); trips on chromium (1). 28 + 10 = 38 runs.

## Which tests this branch broke, and the commit that fixed each

Because main passes all 28 it could run, every one of the 29 is something this branch changed, none is an inherited failure.

- Real product bug on this branch (4 tests, rows 7, 8, 11, 13, all chromium, per DECISIONS.md): the filter rail's `--rail-gap` started at 0 and
  shifted the layout after hydration. Fixed by `74c84f9` (`src/components/search/live-search.tsx`).
- Specs out of date with a deliberate redesign (rows 3-6, 9, 10, 14-23, 25-29; row 27 is the stays-start spec that only exists
  on this branch): tests were updated to wait for hydration, the document title and layout, and to follow the explore and stays
  redesign. Fixed by `a0409e1` (tests only); recorded in `9c88478`.
- Load flake (rows 1, 2): no code change; passed at `--workers=2` per `DECISIONS.md`. Both also pass on main at `--workers=4`.
- Row 12 ("changing a leg works from the keyboard") is in the 29 but `DECISIONS.md` does not say which category it was.
  It passes on main; the branch commit that made it pass is not recorded, and I did not bisect it.
- Row 24 (mobile-chrome "narrows results without searching again"): see the next section.

## Branch result after the fixes

- Full run `e2e-run2-clean.log` (before the fixes): 29 failed, 270 passed, 1 skipped.
- Full run `e2e-run3.log` (after `74c84f9` and `a0409e1`): **1 failed, 298 passed, 1 skipped.** The one failure is row 24.
  So it is not true that the latest full run had 0 failures. That test was then fixed in `61bdf22`, and verified only by the
  targeted repeat run below (no full run has been done since).

### Row 24: mobile-chrome "narrows results without searching again"

Seen once in the 4-worker run (`e2e-run3.log`): `locator.click` timed out on the "Narrow these results" heading, which resolved but
was "not visible" for the whole 30 s.

- Before the change, `NEXT_PUBLIC_APP_URL=https://www.voyagrfind.com PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/e2e/search.spec.ts -g "narrows results without searching again" --workers=2 --repeat-each=3 --project=mobile-chrome`: 3 passed, 0 failed. It did not reproduce at 2 workers.
- Cause (from the code, not reproduced): the test read `aria-expanded` once and clicked only when it was `false`. On a phone the first
  client render is open (`FiltersDisclosure` in `live-search.tsx` uses the server snapshot `true`), and it closes in a second render.
  Under load the test read `true`, skipped the click, and the panel then closed. A timing race in the test; the
  closed-on-phone behaviour is deliberate.
- Fix `61bdf22` (tests/e2e/search.spec.ts): wait for the state the viewport promises (`false` below 1024 px, `true` from it),
  click, expect `true`. No fixed sleep, assertions unchanged.
- After the fix, in a clean worktree of HEAD with that edit (webpack build, own port): `--workers=2 --repeat-each=3`: 3 passed;
  `--workers=4 --repeat-each=3`: 3 passed.
- Today's main run also shows this test passing on main (row 24 above), at 4 workers, once.

## State of main

No test is confirmed as already failing on main. The earlier note that the trips axe test passed 6 of 6 on a webpack main build
(command not recorded) is superseded by row 29 above, which has its command.

## Cleanup

The main worktree was removed with `git worktree remove` after the runs; `git worktree list` no longer shows it.
