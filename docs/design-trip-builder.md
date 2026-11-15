# Trip builder — design spec (explore, below the calendar)

Owner brief (2026-11-15): the selected-trip block on `/explore` is "mid": a column of facts,
"Severity: Check this" labels and a raw score table. Redesign it, let people change the hotel and
the flights and see the price move (as Kiwi does), and show the chosen hotel properly: pictures,
location, stars.

Rules that do not move: every figure comes from `src/core` (totals `cost.ts`, swaps
`src/search/swap.ts`, score `scoring.ts`); a fact the provider did not state is shown as unknown,
never filled in; no provenance badges (D20).

## 1. Structure

One section, "Your trip", replacing the featured card's body. Two columns from 1024px
(`grid-cols-[minmax(0,1fr)_360px]`, gap 32px); one column below, with the summary as a bar pinned
to the bottom of the viewport.

```
┌ Your trip to Rome ─ Thu 26 Nov → Mon 30 Nov · 4 nights · 2 travellers ───────────┐
│  LEFT: the itinerary, three legs                │  RIGHT: summary (sticky, top =  │
│  ① Outbound flight            [Change]          │  header height + 24px)          │
│  ② Stay                       [Change]          │  Total for 2 travellers         │
│  ③ Return flight              [Change]          │  €419.56   €209.78 per person   │
│  ── Good to know (checklist)                    │  Flights €139.00 · Stay €271.32 │
│  ── Why this trip (3 reasons + score)           │  Not included: airport transfer │
│                                                 │  [ Continue to book flights → ] │
└─────────────────────────────────────────────────┴─────────────────────────────────┘
```

A vertical 1px rail (`--color-border-strong`) joins the three leg cards on the left, with a 10px
node at each card: the trip reads as one journey.

## 2. Leg cards

Card: `surface-raised`, hairline border, `--radius-card`, padding 20px (16px on phones).

**Flight leg** — one row:

- Left: eyebrow `OUTBOUND · Thu 26 Nov`; then times in tabular 1.5rem `06:10 — 07:55`, with the
  airports under each time (`VIE Vienna`, `FCO Rome`), and between them a thin line with the
  duration above it and the stops in words under it (`1h 45m`, `Direct`).
- Right: airline name when the provider states it (omit the line when it does not), and the
  `Change` button (ghost, 44px).
- The arrival time must be the arrival time. (The pasted block shows `06:10 VIE → 06:10 FCO`:
  departure printed twice. Find the cause and fix it; it is a defect, not a style.)

**Stay leg** — the hotel, shown properly:

- Gallery left, 200×150 (full width 16:10 on phones): up to 5 provider photos, scroll-snap, dots,
  `1 / 5` counter; when the provider gives none, a neutral tile with a bed icon. Never a generated
  picture of a real hotel.
- Name (Playfair 1.25rem); star class as `★★★★` plus the words `4-star hotel` (unknown: no stars,
  no words); guest score with its count when stated (`8.6 · 1,204 reviews`).
- Location line: `Old Town · 600 m from the centre` (distance from core), and a small static
  locator: 96px circle crop of our own map tiles centred on the hotel with one pin. No third-party
  map request.
- Facts row, only those the provider stated: free cancellation, breakfast, taxes included.
  Unstated ones are listed once under "Good to know" as things to check.
- Price for the stay: `€271.32 for 4 nights · €67.83 a night`, and `Change` button.
- No priced stay (production today): the card says `No stay priced yet` with the partner row
  "Find a stay in Rome" and nothing else.

## 3. Changing a leg (the Kiwi part)

`Change` expands the card in place (Radix Collapsible, 220ms, `--ease-out-quart`); the other two
legs stay visible.

- A list of alternatives (max 6, then "Show more"), each a row that is one radio:
  the same facts as the leg in compact form, and on the right the **price difference against the
  current choice**: `+ €24.00` (muted ink), `− €12.40` (positive ink), `same price`. Under it the
  new trip total in small type: `trip €443.56`.
- Sort chips above the list: `Cheapest`, `Earliest`, `Fastest` for flights; `Cheapest`,
  `Best rated`, `Closest to the centre` for stays.
- Choosing a row updates the leg, the summary total and the URL (existing swap params), with the
  total counting from the old to the new figure in 420ms (tabular digits, no layout shift);
  reduced motion: the number just changes. `aria-live="polite"` announces
  "Trip total is now €443.56 for 2 travellers".
- The current choice is marked with a tick and the word `Selected`, not colour alone.
- While alternatives load: three skeleton rows. None available: one line, "No other flights for
  these dates", and a link to the calendar.

## 4. Summary panel

- `Total for 2 travellers` (eyebrow) → total, tabular 2.25rem → `€209.78 per person`.
- Breakdown lines with dotted leaders: Flights, Stay, each with its amount; estimated lines carry
  the word `estimate`.
- `Not included`: the excluded categories in words, from `describeExclusions`. Said here once and
  nowhere else on the card.
- Budget line when a budget was given: a 6px bar, filled to the share of the maximum, with
  `€230.44 under what you planned` beneath it.
- Primary button: `Continue to book flights` (accent); secondary rows: partner offers
  (`Find a stay`, `Airport transfer with Intui`), `Add to my plan`, `Watch this price`.
- Phone: the panel collapses to a bottom bar, 64px: total + per person on the left, the primary
  button on the right; tapping the total opens the full panel as a sheet.

## 5. Good to know

Replaces "Before you book / Severity: Check this". A plain checklist, one line each, icon by kind
(bag, ticket, clock, cloud), sentence in ink, no yellow blocks:

- `Check the baggage allowance: the airline did not state it.`
- `Check that both flights are on one ticket.`

A `Why we flag these` link opens a two-sentence explanation.

## 6. Why this trip

- Three reasons as a row of quiet chips with a tick, in the order core gives them.
- Score: a 72px ring, the number inside (`74`), `out of 100` beside it, and one sentence of what
  it means.
- `How the score adds up` (disclosure): each factor as a row: name, a 4px bar filled to the
  factor's own value, and its contribution at the right (`+19`). Sorted by contribution. The
  confidence sentence stays, in muted ink. No table borders.

## 7. Weather line

One line under the header: season in words from climate normals for those dates
(`Late November in Rome: mild days, cool evenings, 12–19°C`), labelled `typical`. The model may
word it; the numbers come from the weather provider.

## 8. Explore page around it

Order: results header → sticky toolbar → `Pick your dates` (calendar) → **Your trip** → `Other
ways to do this trip` (the compact rows, 2 columns from 1280) → slideshow (section 9) → things to
do → partner offers.

Section headings share one pattern (eyebrow, Playfair title, one line). 64px between sections on
desktop, 40px on phones. Background alternates `surface` and `bg-alt` so the sections separate
without boxes.

## 9. Destination slideshow ("30 seconds of …")

A 30-second, auto-advancing sequence at the top of the destination page and above "Things to do"
on explore: 6 frames × 5s, 21:9 on desktop (4:5 on phones), slow Ken Burns move
(scale 1.00 → 1.06, 5s linear) with a 600ms cross-fade.

- Frames: the destination illustration first, then real photographs of the top places from
  "Things to do" (Wikimedia Commons, through our image route), each captioned with the place name
  and credited.
- Controls: play/pause button (visible, 44px, labelled), six progress segments that are also
  buttons, swipe on touch, arrow keys when focused. Pauses when offscreen, on hover and on focus.
- Reduced motion: no auto-advance and no zoom; a manual carousel.
- Fewer than 3 real photographs: the slideshow is not shown.
