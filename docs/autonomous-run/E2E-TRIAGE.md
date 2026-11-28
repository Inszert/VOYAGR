# E2E triage (N1)

Evidence rules: everything here is either copied from `DECISIONS.md` ("E2E triage after the first full run"), read from `git log`, or
output from a command that was run for this file. Where a command was not recorded, this file says so.

## (a) The 29 tests from the first full run (8 workers) and their category

The earlier triage records 29 failures but names only some of them. The categories below are the ones it recorded; the load flakes
were not listed test by test, so they are not listed here either.

| Category                                                                                         | Tests (as named in DECISIONS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Fixing commit                                     |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| a. Real bug on this branch (filter rail `--rail-gap` started at 0, layout shift after hydration) | "explains why the top result ranks where it does", "shows every cost line with its confidence", "explains a trip in words", "narrows to one set of dates" (desktop)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 74c84f9 (`src/components/search/live-search.tsx`) |
| b. Test out of date with a deliberate redesign                                                   | search.spec: "picking a lens...", "works with the keyboard...", "submits the form and returns ranked trips", "offers alternative flights/hotels ... swaps one in", "offers the flexibility presets without opening anything"; accounts.spec: "a saved preference becomes a search default..."; shared-globe.spec: "is the same map and canvas..."; things-to-do.spec: "has no accessibility violations ... reaches no third party"; explore.spec: "puts the pointer on the planet"; stays-start.spec: "the destination field is the first control after the tabs"; trips.spec: "keeps a plan, splits what a group spent exactly, and knows the emergency numbers" (waits for a document title before axe) | a0409e1 (tests only); recorded in 9c88478         |
| c. Already failing on main                                                                       | none confirmed (see section d)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | n/a                                               |
| Load flake (8 workers)                                                                           | accounts.spec "signs out and back in" and "refuses a duplicate email", the cost-line and swap tests in the 8-worker run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | no code change; passed at `--workers=2`           |

## (b) Evidence for category c

No test is classified as already failing on main, so there is no failing line to quote.

The one test the earlier triage says it checked on a main build is trips.spec "keeps a plan, splits what a group spent exactly, and
knows the emergency numbers" (the axe title test): 6 of 6 passed, on a webpack build (the junctioned `node_modules` breaks
Turbopack's root). **The command for that run was not recorded.** The main worktree was removed after the run. It was not re-run for
this file.

## (c) The last failure: mobile-chrome "running a search > narrows results without searching again"

Seen once in the 4-worker run (`e2e-run3.log`): `locator.click` timed out on the "Narrow these results" heading, which resolved but
was "not visible" for the whole 30 s.

What was run and what it showed:

- Before the change, `NEXT_PUBLIC_APP_URL=https://www.voyagrfind.com PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/e2e/search.spec.ts -g "narrows results without searching again" --workers=2 --repeat-each=3 --project=mobile-chrome`: **3 passed, 0 failed.** The failure did not reproduce at 2 workers.
- Cause (from the code, not reproduced): the test waits until the Filters button has React props, then reads `aria-expanded` once and clicks only if it is `false`. On a phone the server HTML is open and the first client render is also open (`FiltersDisclosure` in `live-search.tsx` uses the server snapshot, `true`, on hydration and closes in a second render). A button can therefore have React props while still showing `aria-expanded="true"`. Under load the test read `true`, skipped the click, the panel then closed, and the heading stayed hidden. That is a timing race in the test, not a product bug: the closed-on-phone behaviour is deliberate.
- Fix (tests/e2e/search.spec.ts): wait for the real condition. After hydration the test now expects `aria-expanded` to be the state the viewport promises (`false` below 1024 px, `true` from it), clicks, and expects `true`. No fixed sleep, assertions unchanged.
- After the change, in a clean worktree of HEAD with the same test edit (webpack build, own port): `--workers=2 --repeat-each=3`: **3 passed**; `--workers=4 --repeat-each=3`: **3 passed**.
- Environment note: runs in the shared working tree after that were unusable, so they are not counted. Port 3100 already had a server (`reuseExistingServer` is on outside CI, so the suite tested it instead of a fresh build); on another port the build failed on typed-route errors from uncommitted changes in other files. Neither relates to this test. Because the original failure never reproduced here, the cause above is the best explanation, not a proven one.

## (d) State of main

No test is confirmed as already failing on main. The only main check on record is the unrecorded-command trips run above.
