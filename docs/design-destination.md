# Destination page — design spec (second pass)

Owner brief (2026-11-15): the page is "nice, but needs a better design, more interactive", with
smooth transitions. Specific complaints: "Things to do in Rome lacks images", "A first plan for 7
nights is ugly plain text", "Getting in from the airport is nice but can be more visually
appealing". The 30-second slideshow the owner asked for is specified in
`docs/design-trip-builder.md` section 9 and is built here.

Rules that do not move: figures from `src/core`; places and photographs are real and credited; a
generated picture is labelled an illustration and is never used for a real hotel or a real place;
no provenance badges (D20); motion tokens from `DESIGN.md` only; every animation has a still
version under reduced motion.

## 1. Page as a sequence

The page reads top to bottom as one trip, with a sticky section nav so it never feels long:

1. Hero slideshow (30 seconds of the place)
2. Sticky bar: `Overview · Dates · Weather · Things to do · A first plan · Getting there · Extras`
   and, on the right, the price and `See trips` button
3. Dates and price (flexible-dates strip + the price panel)
4. Weather for those dates
5. Things to do
6. A first plan
7. Getting in from the airport
8. Sort the rest of the trip (partners)

Sticky bar: 56px, glass surface, sits under the site header (measured, not hard-coded). The
current section is underlined (2px accent, slides between items in 220ms `--ease-out-quart`) and
marked `aria-current="true"`. Links scroll smoothly (instant under reduced motion). On phones the
bar scrolls horizontally with an edge fade and the price button stays pinned at the right.

Sections alternate `surface` / `bg-alt`, 80px apart on desktop, 48px on phones, each with the
shared heading pattern (eyebrow, Playfair title, one line).

## 2. Hero slideshow

Per `design-trip-builder.md` section 9, at 72vh desktop / 60vh phone. Over the lower third: country
eyebrow, the name in `--text-display-xl`, dates and the season line. The caption of the current
frame (place name + credit) sits bottom-right in 12px muted type and cross-fades with the frame.

When fewer than 3 real photographs exist, the hero is the single illustration, still.

## 3. Things to do

- Every card has a picture or is not a card. Places without a photograph go to a compact
  "More places" list under the grid (name, kind, distance, link), not into the grid as empty tiles.
- Grid: featured first row of 2 large cards (16:10), then rows of 3 (4:3); phones: one large, then
  a horizontal rail per kind.
- Filter chips stay links (`?kind=`) but filtering animates: cards that leave fade and scale to
  0.96 in 150ms, the rest move to their new places with a FLIP transition (220ms); reduced motion:
  instant.
- Card hover (pointer only): image 1.04, a `Read more` row slides up 8px; press 0.97.
- Clicking a card opens a detail sheet (Radix Dialog, right side 440px desktop, bottom sheet on
  phones): larger photograph, the Wikidata description, distance from the centre, a locator on our
  own map, `Read on Wikipedia`, `Add to my plan`. The sheet is deep-linkable (`?place=<id>`).
- A small map above the grid (our own tiles) with a dot per place; hovering a card rings its dot;
  hovering a dot highlights its card.

## 4. A first plan (itinerary)

Replaces the block of plain text.

- A horizontal day selector: `Day 1 · Thu`, `Day 2 · Fri` … as tabs (Radix Tabs), with a thin
  progress line joining them. Arrow keys move between days.
- Each day is a vertical timeline: three stops (`Morning`, `Afternoon`, `Evening`), each a row
  with a 56px thumbnail of the place (its real photograph; a kind icon when there is none), the
  place name as a link that opens the same detail sheet as section 3, one line of what to do, and
  the walking distance from the previous stop when core can compute it.
- A `If it rains` line per day, collapsed behind a small cloud button.
- A day's stops are drawn from the real places in section 3, so the plan and the list agree.
  The model may order and word them; it may not add a place that is not in the list.
- `Add this day to my plan` and `Add the whole plan` for signed-in users.
- Changing day cross-fades the timeline (150ms out, 220ms in).
- When there are too few real places to fill a plan, the section is not shown.

## 5. Getting in from the airport

Today: four boxes with a price each.

- One comparison strip: each option (`Public transport`, `Shared shuttle`, `Taxi`, `Private
transfer`) is a row with an icon, the journey time as a horizontal bar on a shared scale (so the
  fastest is visibly the shortest), the price per person and for the party, and one line on when it
  suits (`Cheapest; runs every 20 minutes`): only facts the provider states.
- The cheapest and the fastest carry a small label in words.
- A simple route diagram above it: `Airport ── 13 km ── City centre`, the distance from core.
- The partner offer (`Book a transfer with Intui`) sits at the end of the `Private transfer` row.
- No transfer data (production today): the section shows the route diagram, the distance, and the
  partner row; no invented prices.

## 6. Weather

Keep the facts. Replace the bar blobs with a clean 7-column strip: weekday, a glyph, high and low
as two numbers joined by a short vertical range bar on a shared scale, rain likelihood as a small
droplet row. `Typical for these dates` stays verbatim when it is climatology. Hover or focus on a
day shows the detail line beneath the strip.

## 7. Price panel

Sticky on desktop as now. Add: the traveller count with a stepper (changes the URL, total follows
with the count-up from `design-trip-builder.md` section 3), and `Watch this price`.

## 8. Transitions between pages

- Card → destination: the card image morphs into the hero (view transition, already present for
  the featured card; extend to every destination card by naming only the clicked card at click
  time, so names never collide).
- Destination → explore (`See trips`): the hero image shrinks into the trip card's image.
- Unsupported browsers and reduced motion: plain navigation.
