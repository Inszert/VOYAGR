# Explore search: how it works now

Observed on a local production build and on www.voyagrfind.com, 2026-11-17. Line numbers are from the working tree on branch feat/voyagr-autonomous-product-completion.

## Inputs and what each triggers

| Input | Where | Server effect |
| --- | --- | --- |
| Origin(s), place(s), dates, travellers | `origins`, `destinations`, `departureDate`, `returnDate`, `passengers` in the URL | `loadStagePage` (`src/discovery/load-stage.ts:198`) parses the form and runs `runSearch` (line 226-234), cached 5 minutes by query and data source |
| Flexibility | `flexibility` (default `plus-minus-3` from Discover) | widens the date windows priced |
| Part weights | `PartWeightsControl` (`explore/page.tsx:345`) | re-orders "Best match" only; prices and scores do not change |
| Sort, filters, picked date | `fSort`, `f*`, `fDates` | none; applied to the cached outcome in `search-results.tsx:132-137` |

A search exists only if `origins` is in the URL (`wasSubmitted`, line 138). `/explore` with no query shows no form: just a "Start a search on Discover" link (`explore/page.tsx:368-376`) and the destination rail. The search form lives on Discover (`/`).

## States

- Nothing searched: globe and rail. Locally the rail said "Prices are loading" (discovery cache empty, `load-stage.ts:436`); live showed 74 priced destinations.
- Searching: after an edit on /explore, old results stay, dimmed and `aria-busy` (`live-search.tsx:221-236`). The address changes only when the server answers. A new place took about 10-35 s locally; a cached one was near instant live.
- Results: "N trips match", toolbar, collapsed filters, flex strip, calendar, trips.
- No results: `EmptySearch` (`search-results.tsx:523`). Error: redirect to `/?edit=1` (`explore/page.tsx:156`).

## Controls and when they render

- Sort: always, once there is an outcome (`search-results.tsx:248-261`, `sort-select.tsx`). It sits in a toolbar under the header, not beside the search.
- Filters: only if `eligibleCount > 0` (`search-results.tsx:288`), and inside a closed disclosure "Narrow these results..." (line 289-297). Open it and the panel is there (`result-filters.tsx`).
- Price shown toggle (Whole trip / Flights only): `search-results.tsx:262`.

## The globe and the map

The big picture is a real MapLibre canvas (`globe-stage.tsx:701-714`), globe by default with a Globe/Map toggle. It is mounted once for the page, and pins come from `stage.chips` (`explore/page.tsx:387`). It has a worker and tiles under `/geo/`, all same-origin.

"What to see" is different. It is on the destination page (`/destinations/lis#things`, `things-to-do-section.tsx:59`), not on /explore. Its "map" is `PlacesMap` (`places-map.tsx:118-296`): a hand-drawn SVG plan, not a map library. It draws a cross, up to three dashed distance rings and one dot per place, placed by a flat-earth offset from the city centre (`offsets`, line 42). There are no streets, tiles or coastline. Dots come from `loadThingsToDo` (`src/discovery/things-to-do.ts`) via the places provider; for Lisbon it was 30 places, both locally and live, no "samples" notice. The "What to do" box inside Your trip on /explore (`what-to-do.tsx`) is a text list with no map. This matches the owner's "not a map".

## Where prices come from

- Flights: `FLIGHT_PROVIDER` (`src/lib/env.ts:95`): `mock`, `aviasales` (indicative cached fares, labelled so), or `liteapi`. Local and live showed identical Lisbon fares (for example 346 EUR on 5 Dec), so the local build was on the same flight source as live, not mock. I did not read `.env`.
- Stays: `HOTEL_PROVIDER` (`env.ts:119`). Some trips say "Stay not included" and get a "Find a stay" link (`explore/page.tsx:168`). Whether the stay prices are sandbox or production LiteAPI was not verified; `env.ts:411-427` refuses a sandbox key in production unless `LITEAPI_SANDBOX_IN_PRODUCTION=true`.
- Mock fixtures only apply when the provider is `mock`.
- Totals come from `src/core/trip/cost.ts`; the page does not compute any.

## Return step shows one option

In the price calendar, choosing a leaving day shows exactly one return day (`price-calendar.tsx:391`, filter at 369, grouping at 371). Reproduced locally and live: 2 Dec to 10 Dec only, 3 Dec to 10 Dec, 5 Dec to 8 Dec, 7 Dec to 10 Dec, 11 Dec to 13 Dec; one each. Cause is the data, not the calendar:
- The server keeps one fare per departure day: `keepCheapest` (`src/search/day-prices.ts:182`), used by `cheapestPerDay` (201-224) and `mergeDayFares` (248).
- The page maps that to one option per departure (`price-calendar.tsx:302-321`).
- The search's own options are one per sampled date pair.
The calendar would list several returns if `options` held several for a departure. It does not.

## Also fly from

- Renders: yes, in the closed filters disclosure (`search-results.tsx:313-318`, `nearby-airports-panel.tsx`), as `nearbyOrigins(...).slice(0,5)` within 250 km (`destination-names.ts:482`). From VIE: BTS, BRQ, GRZ, SOB, LNZ. Local and live.
- Adding: yes. The link rewrites `origins` to "VIE, BTS" and re-searches (live: 6 to 8 trips; header read "VIE, BTS").
- Cheapest airport: no. No label, no filter, no grouping by origin. Cards (`trip-row.tsx`) show no origin code; only the built trip's flight rows do (`itinerary-rows.tsx:30`). The panel itself says it claims nothing (line 6-9).

## Symptom table

| Symptom | Reproduced? | Cause |
| --- | --- | --- |
| Place search shows nothing until a date click | Yes, in the /explore edit form | `choose()` re-focuses the field (`airport-input.tsx:155-158`), and `settled()` refuses while a combobox has focus (`live-search.tsx:91-98`). Tab or Enter-to-pick never applies; only a later blur does (`:192-193`). Slow searches add a dimmed wait. Discover's submit works at once. |
| No filter | Partly | Hidden in a closed disclosure, only when trips exist (`search-results.tsx:288`) |
| Map is not a map | Yes for What to see | SVG plan, `places-map.tsx`. The globe is a real map. |
| No prices | No | Prices present local and live; empty only in the no-search rail locally |
| No sort | No | `search-results.tsx:249`; low in the page |
| One return option | Yes | `day-prices.ts:182` |
| Nearby airports | Panel yes, cheapest no | `search-results.tsx:313` |

## Console and network

Live: no console errors or warnings; all calls 200. Local: the first load raced the server start (connection refused, React error 418 on the offline page); none after. Horizontal overflow of 8 px at 390 and 1440 on both, `scrollWidth` 1433 against 1425.
