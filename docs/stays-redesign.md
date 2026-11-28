# /stays redesign (Opus design, 2026-11-18)

Binding for the build. Money, data and freshness rules come from the existing code and must not change.

## Journey

1. Opens /stays: one question, "Where are you staying?", destination, dates, guests, rooms. Below it, the cities we hold hotels for.
2. Searches a city: sees what nearby date ranges cost before any hotel. Picks dates. Dates before hotels.
3. Sees hotels: priced first (cheapest first), then listed-only (nearest first). Each row says how fresh the price is, in words. Map beside the list (a sheet on phones).
4. Opens one hotel: photos, facts, every stored rate compared with the picked rate. Side card: the stay, the picked rate, "Check this price".
5. Checks the price: one live, rate-limited call. Answer appears in place with the time checked. Guest details and Pay are visible but switched off.
6. Back button walks back, because every step is in the URL.

## Layout

- 390 px: one column. Compact search summary that opens the form. Then the step's h1, status line, content. Results have a fixed "Map" button opening a dialog. Hotel page: side card right after the photos.
- 768 px: one column. Form in a 2x2 grid. Rows get a 6 rem photo, price on the right.
- 1440 px: wide container, 12 columns.
  - Top bar: full-width search form, one row.
  - Nothing searched: a centred column; the form is the content.
  - Dates: main 8 (date grid). Side 4 (trip flight card if any, freshness line, one plain paragraph on what the prices are).
  - Results: main 7 (list). Side 5 (sticky map, viewport height minus header).
  - Hotel page: main 8 (photos, facts, amenities, price comparison). Side 4 sticky: dates and party, picked rate total, tax lines, Check this price, booking steps, locator map.
  - with=flights: Flights and Stay sections stack in main, side as on dates.

## States

| State                | Visitor sees                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing searched     | h1 "Find a place to stay". Form. City shortcuts. Field errors inline.                                                                 |
| Searching            | Skeleton of the next step's shape, sr-only "Loading stays".                                                                           |
| Dates                | h1 "Which dates are cheaper in {city}?". Grid. "Your dates" and "Cheapest found" in words.                                            |
| Results, priced      | h1 "{n} places for {nights} nights in {city}". "Updated N hours ago". Rows: "€X total · N nights".                                    |
| Results, no prices   | Same h1. "Hotel prices are not loaded for these dates yet." Rows: "No stored price", "See price on {host}" (new tab). Never a figure. |
| Sandbox              | "Test prices." in words, on the status line and on each priced row.                                                                   |
| Hotel page           | h1 hotel name. "Compare prices". Side card.                                                                                           |
| Check: ok            | "Current price €X". Taxes-included and payable-at-hotel lines. Changed-terms line if needed. "Checked at HH:MM UTC".                  |
| Check: limited       | Server message (try again in N minutes). Button stays usable.                                                                         |
| Check: failed        | Server message, plus "The stored price above is unchanged."                                                                           |
| No hotels for a city | Existing EmptyState messages and the partner hand-off card.                                                                           |
| Provider failures    | "N providers could not answer..." status line.                                                                                        |

## Components

Keep: src/search/stays/load-stays.ts (stayHref), rate-words.ts, snapshot-status.tsx, stay-photo.tsx (host allow-list), stay-map.tsx, pin-clusters.ts, locator-map.tsx, find-stay-link.tsx, trip-flight-card.tsx, src/app/actions/liteapi-check-price.ts.
Change: src/app/stays/page.tsx (routes steps and lays out columns only), load-page.ts (also covered cities and the hotel photo), loading.tsx (skeleton per step), stay-search-form.tsx (full form and collapsible summary), date-price-grid.tsx (title becomes the step h1), stay-header.tsx (thin city band, no heading), stay-rows.ts (adds `cheapest`; partner link wording), stay-result-row.tsx (one row for every case), stay-property.tsx (main column, keeps its h1), rate-comparison.tsx (drops the per-rate check), check-price.tsx (becomes the side card's check, own live region).
New: stay-start.tsx (nothing-searched screen), stay-results.tsx (list plus map split), stay-side-card.tsx (hotel side card).
Remove: stay-card.tsx, stay-explorer.tsx.

## Data

- Dates and results: the snapshot reader (our database) through getStayProviders. Listings from the build-time OpenStreetMap extract.
- Partner links: built from config, no network call.
- Status line: readSnapshot status.
- Hotel page: stays, rates and compareAgainst from the snapshot; locator from local geo files.
- The only live call on a visitor path: checkPriceAction (five checks an hour per visitor).

## Rules that must not change

- Money: Money in integer minor units, formatted only by format(). No arithmetic in components.
- Cheapest: set inside buildStayRows, only for hotels priced in the same currency, by minor units. Components never decide it.
- Taxes payable at the hotel are never added to a total; their own line "(not part of the price shown)".
- Taxes unknown reads "Taxes not stated". Never "none".
- A hotel with no price never shows a figure.
- Photos: https only, hosts from IMAGE_HOSTS.
- Freshness wording only from stalenessLine.
- "Test prices" always in words.

## Accessibility

- One h1 per step. Sections h2, rows h3.
- Every input a real label (Field, DateRangeField). Errors tied with aria-describedby.
- Every control min-h-11 (44 px), including "Show on map" and date cells.
- Visible focus everywhere. Map pins open their card on focus; Escape closes it.
- Colour never alone: "Cheapest", "Selected", "Test price", star counts, changed terms in text.
- Check results in a polite live region that stays in place; the button shows busy and is never removed.

## URL steps (unchanged)

?destination= -> dates; + checkIn, checkOut, adults, rooms -> dates; + dates=confirmed -> results; + property= -> hotel; + reference= -> picked rate. with=flights and trip-carry keep their meaning. Old bookmarks open on the same step.

## Wording changes

- List: "Check price" becomes "See price on {host}" (so it does not collide with the live check).
- "No price available" becomes "No stored price".

## Build order (no file in two tasks)

Done earlier: T1 words/rows, T2 loader, T3 result row, T5 hotel page, T7 search bar and dates (reviewed against this design, not redone).
Wave 2: T4 results and map (stay-results.tsx and test, stay-map.test.tsx, pin-clusters.ts; delete stay-explorer.tsx). T6 side card and check (stay-side-card.tsx and test, check-price.tsx and test).
Wave 3: T7 page (page.tsx, load-page.ts and its test, loading.tsx; delete stay-card.tsx). T8 e2e (tests/e2e/stays.spec.ts): nothing searched, no stored prices, check limited and failed (stubbed action), one h1 per step.

## Test first

1. One h1 per step.
2. A row priced in another currency is never flagged cheapest.
3. A rate with only payableAtProperty never shows in a headline total.
4. Sticky map plus the e2e suite: --workers=4; the map sheet still opens at 390.
5. Visual QA at 390, 768 and 1440 on every state.
