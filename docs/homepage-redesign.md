# 1.10.1, second pass: the discovery-first homepage

**Status:** Built on 2026-09-20, all three phases, after sign-off on the four decisions in
section 9.

**Decision 4 turned out to be unnecessary and was not taken.** Committing a font under the SIL Open
Font License was the price expected for country labels. MapLibre 6 rasterises labels on a canvas
from a font the machine already has when the style declares no glyphs URL, so the globe carries
text with no glyph server, no font file in this repository and no change to the
Content-Security-Policy. `docs/map-options.md` records it. Decision 3 was also not taken: the
simplification `mapshaper` would have done is forty lines in the build script, which is a smaller
thing to own than a large dev dependency used once. Three things differ from the breakdown below, each for a reason:

- **"More options" is a native disclosure inside the one form, not a sheet.** A Radix dialog
  renders nothing before JavaScript and its contents would not submit; a `<details>` does both.
  `SearchForm` was refactored into exported fieldsets so the compact form and the full form share
  one set of field markup rather than drifting.
- **There is a separate explorer at `/explore`**, the "Map" item in the reference: the same stage
  over the same data, composed for looking rather than reading. Asked for after this was written.
- **The map instance persists across selections.** Only the compact form remounts on a new
  search; the globe receives the selection as a prop and flies, which is what makes a click feel
  like the globe answered.
- **The globe builds on the first idle moment**, and chips are hidden by collision rather than by
  a zoom threshold. Both are recorded in `docs/map-options.md`; both came out of looking at the
  thing rather than out of the plan.
- **The catalogue grew from eight fixtures to sixteen.** Eight Mediterranean airports on a sphere
  are a cluster, not a world: the routes have to cross the planet for the globe to be one.

The reference image (`docs/ref_img.png`) arrived after this was written. The composition was
checked against it: dark stage, globe right of centre with price chips and arcs, serif headline
with an accent on its last phrase, compact search with the trust items below. No imagery, still,
for the reasons in `docs/imagery-options.md`.

**The brief, in one line:** the 1.10.1 frontend is an incremental restyle of the old site. Redesign it
so that opening Voyagr feels like opening an interactive map of the world, with the real search,
watches and cost engine untouched underneath.

> The reference image was not attached to the session this was written in, so the composition below
> is taken from the brief's text alone. When the image is available, section 2 is the part to check
> against it; nothing in sections 3 to 9 depends on it.

---

## 1. What changes, and what does not

The homepage stops being a form with a globe somewhere in the results, and becomes a globe with a
form in the corner. Every number, every rule about numbers, and every piece of working behaviour
stays where it is. What changes is composition, hierarchy, and what the globe is allowed to do.

**Untouched, by construction:** `src/core/`, `src/search/`, `src/providers/`, `src/db/`,
`src/queue/`, `src/notifications/`, `src/watches/`, `src/auth/`, `src/booking/`, `src/ai/`. The
GET-form-as-URL model, so a search, a filter and a globe selection all remain shareable links. The
provenance system, so demo data never looks like a price. MapLibre with Natural Earth, and no third
party in the render path. The accessibility rules in `docs/design-system.md`.

**Rewritten:** the homepage composition, the globe component, the root layout's width model, and the
theming for one deliberately dark stage. Later, the results list and the destination page, so they
read as a continuation of the stage rather than as a different website underneath it.

**The one rule that still matters most** applies to the globe exactly as it applies to a card. The
renderer draws what `src/discovery/` hands it. It never decides what a point means, what it costs,
or where it ranks. A price on the globe is a `Money` the cost engine produced, formatted on the
server, delivered as a string.

---

## 2. The homepage, top to bottom

### Desktop

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Voyagr                                                  Watches · account  │  header: transparent over
│                                                                            │  the stage, glass on scroll
│   See where you can go,                 ╭───────────────────────────╮      │
│   priced as a whole trip.               │       ✦ Split  from €612  │      │  STAGE  ~88vh, full bleed
│                                         │    ╱──────────✦ Tbilisi   │      │  night-side globe, right of
│   Flights, a hotel and the ride from    │  VIE ●────────✦ Antalya   │      │  centre, ~55% of the width
│   the airport, priced together and      │    ╲──✦ Palma   ✦ Larnaca │      │  arcs from the origin
│   watched after you close the tab.      │        ✦ Faro             │      │  price chips are real DOM
│                                         │            Demo data      │      │
│   [From  VIE ] [When  ±3 days ▾ ]       ╰───────────────────────────╯      │
│   [2 travellers] [Budget €850]  [ Search trips ]   More options            │  compact search (GET /)
│                                                                            │
│   Lenses  Beach · City breaks · Food and wine · Culture · Warm escape …    │  presets, still links
│   Rank by Best value · Cheapest · Fastest · Fewest stops · Best weather    │  pure re-sort of the snapshot
├────────────────────────────────────────────────────────────────────────────┤
│  Where you can go from Vienna     priced for 2, 4 to 7 nights, Oct to Nov  │  DESTINATION RAIL
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐              │  one card per point, in the
│  │ Split   │ │ Antalya │ │ Faro    │ │ Tbilisi │ │ Palma   │   →          │  same order as the globe
│  │ from €612│ │ from €401│ │ …       │ │ …       │ │ …       │              │  same figures, same reason
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘              │
├────────────────────────────────────────────────────────────────────────────┤
│  How a trip is priced · what a Travel Watch does · nothing here is real    │  TRUST STRIP
└────────────────────────────────────────────────────────────────────────────┘
```

### Mobile

```
┌────────────────────────┐
│ Voyagr             ≡   │
│ See where you can go,  │
│ priced as a whole trip │
│   ╭────────────────╮   │  STAGE  ~62vh; globe fills the width
│   │   ✦     ✦      │   │  two-finger pan (cooperative gestures)
│   │ ●────✦    ✦    │   │  so one finger still scrolls the page
│   ╰────────────────╯   │
│ [ From VIE · ±3 days · 2 · €850 ]   ← one tappable bar, opens a
│ Lenses ▸ ▸ ▸           │    bottom sheet holding the full form
├────────────────────────┤
│ Where you can go       │
│ ▢ ▢ ▢ ▢  → (snap)      │  rail becomes a horizontal snap scroller
├────────────────────────┤
│ trust strip            │
```

### The regions

| Region             | What it is                                                                                                                                                                                         | New or retained                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Stage**          | The hero. Headline and explanation on the left, the globe on the right, the compact search below the headline. Full-bleed, dark in both colour schemes (section 5).                                | New: `GlobeStage`, `Hero`                                           |
| **Compact search** | Origin, date flexibility, travellers, budget, submit. Every other field of the search rides along as a hidden input with its default, so a compact submit is a complete, valid search.             | New: `CompactSearch`. Wraps the retained `SearchForm` for "More"    |
| **Lenses**         | The ten discovery categories as a chip row. Still links to preset queries, still unable to override a user's own defaults.                                                                         | Retained logic (`categories.ts`, `preset.ts`); new `LensRow` chips  |
| **Rank by**        | The five map modes. Reorders the rail and restyles the globe. Pure over data already on the page; never a provider call.                                                                           | Retained (`map-model.ts`); moves from the results card to the stage |
| **Rail**           | The accessible content of the globe: one card per destination, same order, same figures, same reason. States the assumptions the prices were made under. Each card narrows or reads about a place. | Replaces the list inside `DestinationMap`                           |
| **Trust strip**    | Three sentences: how a total is built, what a watch does, and the demo-data notice when providers are mocks.                                                                                       | New, small                                                          |
| **Results**        | Appear below the rail once a search has run, as today. The stage stays, shrinks, and shows only the destinations the search found (section 7, Phase C).                                            | Retained components, recomposed                                     |

---

## 3. The stage

### 3.1 Layers, bottom to top

| Layer                | Source                                                         | Purpose                                                                                                                                                                             | Phase |
| -------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Space and atmosphere | CSS behind the canvas; MapLibre `sky`/fog on the globe         | Depth without a tile server                                                                                                                                                         | A     |
| Sea                  | `background`                                                   | Night-side ocean                                                                                                                                                                    | A     |
| Countries, fill      | `public/geo/countries-110m.json`, `promoteId: 'adm0'`          | Hover and selection via `feature-state`; the selected country lifts, the rest dim                                                                                                   | A     |
| Countries, line      | same source                                                    | Borders; brighter where a country is hovered or selected                                                                                                                            | A     |
| Regions              | `public/geo/regions/{adm0}.json`, loaded when a country opens  | Admin-1 outlines inside the selected country. Data only, no product meaning until Phase 3 has place data                                                                            | B     |
| Routes               | GeoJSON lines from `src/discovery/geo.ts`, `lineMetrics: true` | Great-circle arcs from each origin to each priced destination. `line-gradient` origin to destination                                                                                | A     |
| Route, selected      | same source, filtered                                          | The selected destination's arc, full brightness; others fall back                                                                                                                   | A     |
| Origins              | `circle`                                                       | The departure airports                                                                                                                                                              | A     |
| Destinations         | clustered `circle` source (as today)                           | Points at every priced destination, tiered by zoom                                                                                                                                  | A     |
| Price chips          | `maplibre.Marker` with a DOM element per destination           | "Antalya · from €401 · Demo data". A real link. Faded and taken out of the tab order on the far side of the planet, via `opacityWhenCovered` and the covered class MapLibre toggles | A     |
| Labels               | `symbol` layer over self-hosted glyphs                         | Country names at globe zoom. Needs the glyph decision in section 4.3                                                                                                                | B     |

No sprite, no glyphs and no tile URL in Phase A. That keeps the existing end-to-end test true: the
stage reaches nobody but our own origin.

### 3.2 Interaction model

Everything the globe can do resolves to a URL, because everything the rest of the product does
already does. That is what makes a globe selection shareable, undoable with the back button and
reachable without the globe.

| Gesture                              | What happens                                                                                                                                                        | URL                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Drag, scroll, pinch                  | Rotate and zoom. Idle rotation stops the moment the user touches it and does not resume                                                                             | none                  |
| Hover a country                      | Fill lifts, border brightens, a DOM tooltip names it and says how many priced destinations it holds                                                                 | none                  |
| Click a country                      | Globe flies to its bounds, the country is highlighted, the rail narrows to its destinations, the compact search's destination field becomes that country's airports | `?country=ESP`        |
| Click a country with no destinations | Same flight. The rail says "Nothing priced in Kazakhstan yet, and here is what it would take", rather than an empty region                                          | `?country=KAZ`        |
| Hover a destination point or chip    | Arc brightens, the matching rail card lifts                                                                                                                         | none                  |
| Click a chip                         | Before a search: narrows the rail to that place. After a search: the existing `fDest` filter, which narrows results without a provider call                         | `?fDest=AYT`          |
| Rank-by chip                         | Rail reorders, chips re-tint, arcs re-weight. Pure over the snapshot                                                                                                | `?mapMode=cheapest`   |
| Lens chip                            | Navigates to that preset's search, exactly as the tiles do today                                                                                                    | preset query          |
| Escape, or "Show the whole world"    | Clears `country`, flies back out                                                                                                                                    | `?` without `country` |

The `country` parameter is new. `fDest`, `mapMode` and the lens queries already exist.

### 3.3 What is canvas and what is DOM

The current globe is `aria-hidden` in its entirety and tabs past. That was right for decoration and
is wrong for a primary navigation surface. The contract becomes:

- **The canvas is decoration.** It is `aria-hidden`, `tabindex="-1"`, and nothing is reachable only
  through it. The `aria-hidden` moves from the container to the canvas element, because the
  container now holds content.
- **The price chips are content.** They are `<a>` elements inside `Marker`s, in the accessibility
  tree, focusable, named "Antalya, from €401, demo data. Show trips." They are the same links as the
  rail cards, so a screen-reader user meets each destination twice at most, never zero times.
  A chip on the far side of the planet is `visibility: hidden`, which also removes it from the tab
  order; the rail still lists it.
- **The rail is the equivalent surface.** Same order, same figures, same reason. Country selection
  has a DOM equivalent too: a combobox in the compact search listing every country the catalogue can
  place, which sets the same `country` parameter.
- **The globe never carries a fact the page does not.** No price, warning or ranking exists only as
  pixels.

Playwright's axe run covers the stage in both viewports, as it covers everything else.

### 3.4 Motion

Sophisticated motion here means motion that says what changed. Six things move, each for a reason,
each on the existing duration and easing tokens, all neutralised by the one reduced-motion rule:

1. **Idle rotation** while nobody has touched the globe, slow enough that a chip can be read.
   Stops on first interaction and does not resume.
2. **Fly-to** on country selection, MapLibre's own easing. Under reduced motion it jumps.
3. **Arc draw-in** when a snapshot or search result arrives, staggered by rank, so the eye is led
   from the origin outward. Implemented with `line-gradient` stops, not a JavaScript loop per frame.
4. **Chip stagger** on the same schedule as the arcs.
5. **Rail card entrance** as a plain CSS transition on mount.
6. **Header** from transparent to glass as the stage scrolls under it.

No animation library in Phase A. If Phase C's results transitions need orchestration that CSS cannot
express, `motion` is the candidate the specification already names, and it is added then with a
reason.

### 3.5 Failure and no JavaScript

Before hydration the stage renders the headline, the compact search, the lenses and the rail. The
canvas area shows a CSS sphere with no data on it, because the data is in the rail below. If MapLibre
fails to load, or the style has not loaded within eight seconds, the sphere stays and a one-line
note says the map did not load. The existing blank-ocean guard is kept for the reason it exists.

---

## 4. Where the data comes from

### 4.1 The discovery snapshot

The globe needs destinations, routes and prices before anyone has searched. There is exactly one
honest source for a price on this product, and it is the search engine. So the homepage runs one:

- `src/discovery/snapshot.ts` defines `DiscoverySource`, an interface with one method that takes
  an origin, a currency, a passenger count and today's date, and returns a `DiscoverySnapshot`:
  points, routes, the assumptions they were priced under, a provenance and an observation time.
- Phase A's implementation builds a **default discovery profile**: the user's saved origin or `VIE`,
  every destination the catalogue can place, the next sixty days, four to seven nights, the user's
  default budget as the target and a ceiling high enough to exclude nothing. It runs that through
  the existing page cache and `runSearch`, and the snapshot is `buildMapPoints` over the outcome.
- The rail states those assumptions in words above the cards, because a price with hidden
  assumptions is a price the reader cannot judge.

Two properties are deliberate. The discovery search is a **system search**, so its limits come from
a constant in the snapshot module and not from the visitor's plan; an anonymous plan that allows two
destinations must not produce a globe with two dots. And it gets **its own cache with a longer
TTL** than a user's search, keyed on origin and currency, because a homepage that ran a full search
per visit against a live provider would be the product's most expensive page.

That second point is also the architecture the brief asks for. When live providers arrive, the
homepage must not become a provider-call amplifier. The seam is the interface: a second
`DiscoverySource` reads the latest observed prices from the price-history table, tagged
`historical`, refreshed by a scheduled job that is a Travel Watch with no owner. Nothing above the
interface changes. Neither of those is built now.

### 4.2 A price on the globe

```
runSearch → destinationSummaries → buildMapPoints (src/discovery/map-model.ts)
  → page.tsx formats each cheapestTotal with format() from src/core/money.ts
  → GlobeStage receives { points, routes, labels: Record<code, string>, provenance }
  → Marker element renders the string and a ProvenanceBadge
```

The client component receives strings and never sees a `Money`. Provenance comes from
`diagnostics.provenance`, so a mock snapshot reads "Demo data" on every chip, in the intrusive style
the badge already uses for it.

### 4.3 Geographic data

**What is shipped today.** `public/geo/world-countries-110m.json`: Natural Earth 1:110m admin-0,
177 features, `name` and `continent` only, 171KB, public domain. Right resolution for a globe.
Wrong properties for interaction: a name is not a stable key, and "W. Sahara" and "Dem. Rep. Congo"
are abbreviations rather than names.

**What the brief needs, and the source for each.** All from Natural Earth, all public domain,
fetched from the maintained GeoJSON mirror at `github.com/nvkelso/natural-earth-vector`
(`geojson/` directory) rather than from the download site, which has had reliability problems.

| Need                                             | Dataset                               | File                                                                           | Size as shipped                                                                                       | Phase |
| ------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----- |
| Clickable countries on the globe                 | `ne_110m_admin_0_countries`           | `public/geo/countries-110m.json`                                               | ~180KB. Keyed on `ADM0_A3`, with `ISO_A2_EH`, `NAME`, `CONTINENT`, `SUBREGION` and a precomputed bbox | A     |
| Coastlines that survive zooming into one country | `ne_50m_admin_0_countries`            | `public/geo/countries-50m.json`, loaded on zoom                                | ~700KB after rounding                                                                                 | B     |
| States and regions                               | `ne_10m_admin_1_states_provinces`     | `public/geo/regions/{ADM0_A3}.json`, one file per country, loaded on selection | 4,600 features in total; per country 5KB to 400KB after simplification                                | B     |
| Country labels                                   | glyph PBFs generated from an OFL font | `public/fonts/glyphs/{font}/{range}.pbf`                                       | ~1MB for Latin ranges                                                                                 | B     |

Notes that matter:

- **Key on `ADM0_A3`, not `ISO_A3`.** Natural Earth sets `ISO_A3` to `-99` for France, Norway,
  Kosovo and a few others. `ADM0_A3` is always populated.
- **The 10m admin-1 file is the only one that covers our destinations.** The 50m admin-1 set covers
  a handful of large countries and none of Spain, Greece, Turkey, Croatia, Portugal, Georgia or
  Cyprus. So regions come from 10m, split per country and simplified, and are fetched only for the
  country that was opened.
- **A build script, not a download.** `scripts/build-geo.mjs` fetches the three sources, keeps a
  fixed allow-list of properties, rounds coordinates to two decimals, simplifies admin-1 with
  `mapshaper` (a dev dependency used only here), precomputes an antimeridian-aware bbox per country,
  and writes the outputs with a version in the filename so the service worker can cache them
  first. Outputs are committed, as the current file is; the script is what makes them
  reproducible.
- **Labels need glyphs, and glyphs need a decision.** MapLibre draws text from PBF glyph ranges,
  which is the "second endpoint with its own terms" that `docs/map-options.md` refused. The way to
  keep the no-third-party property is to generate the ranges once from a font under the SIL Open
  Font License and serve them from `public/`. That commits a font file to the repository. It is
  the right call, and it is Phase B, because Phase A does not draw text on the map: destination
  names and prices are DOM chips, which is better for them anyway.
- **A basemap is still not adopted.** Nothing here changes the conclusion in `docs/map-options.md`.
  Streets and terrain are a Phase 3 question, and Protomaps remains the first option to look at.

**Origins have no coordinates today.** The fixture catalogue places destinations only. Phase A adds
an `airports.ts` fixture beside it with positions for the origins the mocks accept, starting with
`VIE`, and `resolveDestinationGeo` gains a sibling for origins. Same rule as everywhere: an origin
the catalogue cannot place draws no arc rather than an invented one.

---

## 5. Layout and theming

**The main column goes.** `layout.tsx` currently constrains `<main>` to `max-w-5xl`. The stage
must bleed, so `<main>` stops constraining and a `Container` primitive in `src/components/ui/`
provides the column for pages that want one. Every other page gains one wrapping element and is
otherwise untouched.

**The header floats.** Transparent over the stage, `surface-overlay` glass once the stage has
scrolled under it. A small client component toggles a data attribute on scroll; the markup and
landmarks are unchanged.

**The stage is dark in both schemes.** This is the one real amendment to `docs/design-system.md`,
and it should be written there as a carve-out rather than quietly contradicted. The stage is a
photograph of the night side of the planet: it does not change with the reader's colour scheme, any
more than a photograph would. It gets its own six tokens, defined once, not per scheme:

| Token             | Role                                                               |
| ----------------- | ------------------------------------------------------------------ |
| `stage`           | The space behind the globe                                         |
| `stage-sea`       | Ocean                                                              |
| `stage-land`      | Land at rest; `stage-land-lit` when hovered or selected            |
| `stage-ink`       | Text on the stage. 4.5:1 against `stage` and against `stage-glass` |
| `stage-ink-muted` | Secondary text. Still 4.5:1                                        |
| `stage-glass`     | Chips and the compact search over the globe                        |

Everything outside the stage keeps the existing scheme-aware tokens, so the results, the forms and
every other page are unaffected. The rule is one cinematic surface, not glass everywhere: the
"deliberately avoided" list in the design-system document stays true for every component that is
not the stage.

**Type.** The system serif display face carries the headline at `text-display-lg` and larger on
wide screens. No web font is added. If a licensed display face is ever adopted, the token swap
already exists.

---

## 6. Replaced versus retained

| File or component                                                                                                                                                    | Fate         | Note                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `src/app/page.tsx`                                                                                                                                                   | Recomposed   | The parsing, caching, entitlement and `runSearch` logic stays line for line; the JSX is new            |
| `src/app/layout.tsx`                                                                                                                                                 | Changed      | `<main>` no longer constrains width; header floats                                                     |
| `src/components/discovery/destination-globe.tsx`                                                                                                                     | **Replaced** | by `globe-stage.tsx`. The worker URL, the blank-ocean guard and the Natural Earth source carry over    |
| `src/components/discovery/destination-map.tsx`                                                                                                                       | **Replaced** | by the stage plus `destination-rail.tsx`. The "Flights only for now" honesty moves to the rail         |
| `src/components/discovery/category-grid.tsx`                                                                                                                         | **Replaced** | by `lens-row.tsx`. Same links, same test of "picking one changes the ranking"                          |
| `src/discovery/map-model.ts`                                                                                                                                         | Extended     | Gains routes, country grouping and selection. `buildMapPoints`, modes and `toGeoJson` unchanged        |
| `src/discovery/categories.ts`, `preset.ts`                                                                                                                           | Retained     |                                                                                                        |
| `src/discovery/geo.ts`                                                                                                                                               | **New**      | Pure: great-circle interpolation, antimeridian splitting, bbox. Tested like `dates.ts`                 |
| `src/discovery/snapshot.ts`                                                                                                                                          | **New**      | The `DiscoverySource` seam and its search-backed implementation                                        |
| `src/discovery/countries.ts`                                                                                                                                         | **New**      | Country code to name, continent, bbox, and which catalogue airports it holds                           |
| `src/components/search/search-form.tsx`                                                                                                                              | Retained     | Becomes the "More options" form, inside a sheet on mobile and an expansion on desktop                  |
| `src/components/search/compact-search.tsx`                                                                                                                           | **New**      | Four fields and a submit; hidden inputs carry the rest                                                 |
| `search-results.tsx`, `trip-card.tsx`, `result-filters.tsx`, `date-options.tsx`, `cost-breakdown.tsx`, `score-explanation.tsx`, `swap-panel.tsx`, `warning-list.tsx` | Retained     | Recomposed in Phase C; behaviour and tests unchanged until then                                        |
| `src/components/watches/save-search-form.tsx`                                                                                                                        | Retained     |                                                                                                        |
| `src/app/destinations/[code]/page.tsx`, `destination-detail-view.tsx`                                                                                                | Retained     | Phase C gives the page a stage header framed on its country                                            |
| `account`, `sign-in`, `sign-up`, `watches`, `status`, `offline`, `not-found`, `error`                                                                                | Retained     | One `Container` wrapper each                                                                           |
| `src/components/ui/*`                                                                                                                                                | Retained     | Plus `Container`, `Sheet` (Radix Dialog), `Chip` for the stage, and the stage tokens in `globals.css`  |
| `src/providers/fixtures/destinations.ts`                                                                                                                             | Retained     | Plus `airports.ts` for origin positions and `ADM0_A3` per destination                                  |
| `public/geo/world-countries-110m.json`                                                                                                                               | **Replaced** | by `countries-110m.json` with stable keys, produced by `scripts/build-geo.mjs`                         |
| `scripts/copy-map-worker.mjs`                                                                                                                                        | Changed      | Copies into a versioned directory so the service worker can cache the worker first without going stale |
| `public/sw.js`                                                                                                                                                       | Changed      | `/geo/`, `/maplibre/` and later `/fonts/` become cache-first static assets                             |
| `next.config.ts`                                                                                                                                                     | Unchanged    | `worker-src 'self'` still holds; nothing new is fetched from anywhere                                  |
| `docs/design-system.md`, `docs/map-options.md`                                                                                                                       | Amended      | The stage carve-out; the glyph and admin-1 decisions                                                   |
| `tests/e2e/search.spec.ts`, `smoke.spec.ts`                                                                                                                          | Updated      | Section 8                                                                                              |

Everything under `src/core/`, `src/search/`, `src/providers/*/mock.ts`, `src/db/`, `src/queue/`,
`src/notifications/`, `src/watches/`, `src/auth/`, `src/booking/` and `src/ai/` is not in this table
because none of it changes.

---

## 7. Phasing

Three phases, each leaving `npm run verify` clean and each shippable on its own.

### Phase A: the stage and the homepage

The geo build script and the re-keyed country file. `geo.ts`, `countries.ts`, `snapshot.ts` and
the `map-model` extensions, with unit tests. `GlobeStage` with interactive countries, arcs, origins,
clustered destinations and DOM price chips. The compact search, lens row, rail and trust strip. The
full-bleed layout, floating header and stage tokens. The mobile composition with cooperative
gestures and the bottom sheet. The service-worker and worker-copy changes. Test updates.

**Done when:** a visitor with no idea where to go opens the homepage, sees eight priced destinations
on a globe with arcs from Vienna, clicks Spain, sees the rail narrow to Palma and the search field
follow, presses Search, and gets the same results the old form would have produced. Axe is clean in
both viewports. The stage reaches no origin but ours. No number on the stage was produced outside
`src/core/`.

### Phase B: inside a country — built

The 50m coastlines added on zoom, admin-1 regions fetched for the selected country, and country and
region labels drawn from a font the machine already has. The rail gained a panel saying what the
product knows about an open country, which today is where it is, how many regions the globe can
outline, and how many of its airports we can price — stated as such, because geometry is not
knowledge about a place.

**Done, and asserted:** opening a country fetches its regions and draws them with its name on the
globe, reaching no origin but ours; the finer coastlines are not downloaded until somebody zooms
in; and the rail says the outlines are only outlines.

### Phase C: results and destinations as a continuation — built

The stage persists above results, narrowed to the destinations the search found, with the selected
one highlighted and `fDest` driven from it — that part arrived with Phase A. Phase C recomposed
what sits under it.

**The result card leads with the journey.** Each flight is drawn as a line with the clock times at
either end, the airports, the duration and where it stops — the globe's arc, flattened. The price
sits opposite at display size with its provenance beside it, the per-person and per-night figures
under it, and what it is worth against the traveller's ceiling in words and colour. "Why this
trip?" moved into a panel of its own with the score and usable-time badges, so the explanation
reads as the answer rather than as one more row. Warnings stay above the fold; the breakdown, the
score's factors, the swaps and the details stay one disclosure down.

Every figure on it still comes from an engine. The route line is the case worth naming: it shows
`durationMinutes` from the provider and never the gap between two local clock times, because
subtracting one wall-clock time from another overstates every eastbound flight by the offset
between its airports. There is a test for exactly that.

**The destination page opens on the globe**, framed on the country the place is in, with its
regions drawn and the place marked — and no price on the marker, because the page knows where
Antalya is and not what a trip there costs.

**Done, and asserted:** the card draws both legs with real clock times and routing, the destination
page opens on its country reaching no third party, and every existing search, filter,
flexible-date and swap test passes unchanged in what it asserts.

---

## 8. Tests

**Unit.** `geo.ts`: a great circle from Vienna to Tbilisi has its midpoint north of the straight
line; an arc across the antimeridian splits into two; a bbox for Fiji does not span the world.
`snapshot.ts`: the default profile is deterministic for a given day, uses the system limits and not
the plan's, and goes through the cache. `countries.ts`: every catalogue destination resolves to a
country that exists in the shipped file. A data test that the committed country file has 177
features, unique `adm0` keys and a bbox on each, as the current test asserts the map reaches nobody.

**Component.** `CompactSearch`: every visible field has a label, the hidden inputs carry every
other search field, submitting produces a URL the schema accepts. `DestinationRail`: cards are
links, the selected one is `aria-current`, the assumptions line is present. `LensRow`: ten links,
none overriding a user-owned field.

**End to end.** The homepage h1 changes, so `smoke.spec.ts` changes with it. In `search.spec.ts`,
"Not sure where yet?" becomes the lens row, and the discovery-map block is rewritten against the
stage: chips are links with a price and "Demo data"; choosing a country from the combobox narrows
the rail and the destination field; the stage makes no request off-origin; axe passes in both
viewports with the stage on screen. Every assertion about results, filters, dates and swaps is kept
verbatim.

---

## 9. Decisions this needs a yes on

1. **The homepage runs a discovery search.** It is the only honest source of a price, and it is
   cached and system-limited as described. The alternative is a globe with dots and no prices until
   the user searches, which is the old website with a bigger globe.
2. **The stage is dark in light mode.** One surface, six tokens, written into the design-system
   document as a carve-out.
3. **`mapshaper` as a dev dependency**, used only by the geo build script, with outputs committed.
4. **A font file in the repository, in Phase B**, under the SIL Open Font License, so country labels
   need no glyph server. Phase A draws no map text and does not need it.

---

## 10. Phase D, as built: the page the reference actually asks for

Phases A to C put a real planet on the front page. This phase is about everything around it, and
about the two things a reviewer of the reference image kept pointing at: photographs, and a page
that looks designed all the way down rather than for its first screen.

### The night stays one night

The accent follows the globe - violet over temperate land, amber over the deserts, cyan over ice,
blue over ocean. It used to take the page background with it, which meant the whole site turned
brown over the Sahara. That is a theme changing under the reader, not a product with a personality.
**Only the accent moves now**; ink, surfaces, glass and the background are fixed, so every contrast
pairing in `design-system.md` holds whichever way the world is facing.

**The controls keep the brand's purple** for the same reason, one level down: a button that changes
colour as the planet turns looks like it means something different each time.

### Photographs

`src/providers/imagery/`, a provider like any other: an interface, a `Result`, a limiter, a clock.
The full argument is in `imagery-options.md`. The two rules that matter here:

- **The association is curated, the picture is live.** One hand-written article per destination.
  Nothing searches for "Bali".
- **Decoration never blocks a price.** Bounded by a timeout, cached both ways, and every failure
  path ends at the gradient the cards were designed around.

Served from `/api/imagery/[code]`, so `img-src` stays `'self'` and no reader's browser talks to
Wikimedia.

### What moved

| Was                                                       | Is                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Ranking fieldset and country form stacked under the globe | One caption under the globe; both controls beside the rail they reorder |
| Six-cell bar with a double-height date cell               | Three by two, every cell one control, the action full width             |
| Rail on the page background, light in light mode          | The same night as the stage, continuous from the hero                   |
| Gradient card with the name below it                      | Photograph, badge, source, name on the picture, figures under it        |
| Nothing after the rail                                    | Three panels: the invitation, the best trip, the way back               |
| Results that flipped to parchment below the fold          | One continuous night: the results band is in the stage's palette too    |
| A trip card headed by a rank label and five grey bars     | A photograph, the price on it, four figure tiles, one grouped panel     |

### The best trip, before anyone searches

The front page already runs a discovery snapshot - that is where the figures on the globe come
from - and it already prices whole trips. Showing the best of them is the page repeating itself,
not a second search dressed as a recommendation, and `loadStagePage` now returns it as
`recommended`. It disappears the moment a real search runs, because the results below answer the
same question better.

### The results, and the card that was called ugly

The trip card kept every figure and every disclosure it had - nothing was removed, because the
information was never the problem. What changed is that it now opens on a photograph of the place
with the total written on it, the four components of that total are tiles rather than small print,
and the five things that can be opened are one panel with rules between them rather than five
separately bordered slabs stacked down a card.

The results band moved into the stage's palette with it. The hero, the rail and the closing band
are all night; a results list that turned to parchment in a light colour scheme was a different
website below the fold. `stage-scope` does the remapping, so every component inside keeps the
contrast pairings it was checked against, and axe confirms it in both viewports.

### The globe, again

Two rounds of "closer, but the globe is not even close" came back after the first pass, and both
were right: a correct globe was still a drawn one. What closed the gap is in `map-options.md` under
"making it look like a planet" - a real night side, city lights in it, a continental shelf along
every shore, and snow and sand as generated texture rather than as tint. The time of day became a
dependency after all, which the note below had listed as the reason not to do it. It was the right
thing to spend it on.

### What this phase deliberately did not do

- **Seasonal set dressing** - Christmas markets behind a flag, a volcano over Hawaii, sand rolling
  across the Sahara. The seasonal model that would gate them exists in `seasons.ts`; the ornaments
  do not.
- **Trains, buses and ferries.** The icons are drawn and the rail says the gap out loud. No provider
  answers for them, and an icon for a mode we cannot price would be the first lie on the page.

---

## 11. Phase E, as built: the reference image, all the way down

The brief for this pass was the reference image itself — `docs/ref_img.png` — with the globe named
as the thing that had to close the gap. Four things changed, and one of them is most of the work.

### The product is one night now

There is no `prefers-color-scheme` block left in `globals.css`. The stage's palette became the
product's palette: `surface`, `ink`, `border` and `surface-raised` are the night values, and
`color-scheme: dark` is on the root so scrollbars, date pickers and autofill agree. Sign-in, the
account page, Travel Watches and the status page sit in the same sky as the hero, with the same
soft wash and ruled field behind them.

This is a deliberate reversal of the carve-out recorded in section 5 and in `design-system.md`.
The carve-out existed because the stage was an island in a light product; the reference is not a
light product with a dark hero, it is a dark product, and keeping a parchment half meant the site
changed identity halfway down its own front page.

`.stage-scope` survives, but it no longer repaints anything. What is left in it is the difference
between an interface panel and a pane of glass over a photograph.

### The accent stopped moving

`--color-stage-accent` used to follow the biome under the middle of the globe. Over the Sahara
that made the headline, the eyebrow, the icon tiles and the bullet dots amber — a brand changing
under the reader. Only `--color-stage-route` follows the planet now, at low chroma, so the arcs
stay near-white with a hint of the ground beneath them, and the interface keeps one violet.

### The globe

Detailed in `map-options.md` under "the fourth pass". Two of the four properties that closed the
gap could not be map layers at all, because every layer in a style is painted on the ground and
both of these are about the silhouette on screen: **the atmosphere** (limb darkening, the sun's
sheen on the ocean, the rim, the halo) and **flight arcs that leave the surface**, bow over the
limb and come back down, with a light travelling each one.

The rest was the style admitting what a planet looks like from orbit: a darker ocean, a wider
shelf along every shore, a bloom under each city light, a night side dark enough for those lights
to be bright against, and ground textures that fade out at globe zoom — from far enough away to
see the whole planet, dunes and snow grain are hatching drawn on a map.

A `Globe / Map` toggle switches `map.setProjection` between the sphere and Mercator. It is
component state rather than a query parameter, and the reasoning is in `map-options.md`.

### The search, the chips and the chrome

- **One pane of glass**, with the lenses along the top, a segmented bar under them and the action
  at its right-hand end. Six fields split by subject — the party and its endpoints on one row, the
  three questions about dates on the next — rather than six cells that happened to wrap.
- **A swap control** between the endpoints, which is the only part of the bar that cannot be
  markup: both fields are React-controlled, so it writes through the native setter and dispatches
  an `input` event, the way a person typing would.
- **A price on the globe is a light and some words**, not a bordered pane. The legibility comes
  from a halo, the way a map label's always has, because what is behind a given chip depends on
  which way the world is facing. A chip on the far side of the view turns round so its words read
  back towards the middle rather than off the edge of the box.
- **Chips keep out from under whatever is laid over the globe.** The controls, the projection
  toggle and the card the stage floats over the planet are marked in the markup, and the collision
  pass that already hides overlapping chips seeds itself with their boxes.
- **The rail is a rail** at every width. It used to become a four-row grid on a desktop, which
  showed sixteen destinations at once and turned the section into a wall; every one of them is
  still in the markup, in order, which is the property the globe depends on.

### What this phase deliberately did not do

- **A fourth navigation tab.** The reference has one. Every destination in the header is a page
  this product actually has, and a "Deals" tab that led nowhere would be the first thing anybody
  clicked.
- **The reference's headline.** "The world is more affordable than you think" is a claim about
  prices that no engine produced. The headline says what the product does instead, in the same
  shape and at the same weight.
- **The reference's brighter violet on the primary button.** White type on it fails 4.5:1. The
  gradient stops are the darkest violet that still reads as the same colour.
- **Clouds.** They would have closed most of the remaining distance to a photograph, and every
  one of them would have been an invented fact drawn over a real country.

### The ring, and the second realism pass

The first pass wrapped the sphere in a bright cyan ring. It was the thing everybody's eye went to,
and it was wrong for one reason: **air has no edge.** A hard circle around a planet reads as an
outline drawn on it. The light was worth keeping; the boundary was not, so it moved into the sky -
a wash centred where the globe hangs, painted in the same declaration as the rest of the stage
background, with no boundary anywhere.

With the ring gone, everything it had been covering for showed. The rest of the pass was removing
what a cartographer would have added: borders faded to a hint at globe zoom, land pulled browner
and less saturated, the dune texture changed from parallel streaks to patches, every ground texture
faded out towards globe zoom, and the polar ice cooled and lightened so it reads as a cap rather
than a veil. Two layers replaced the ring: a falloff away from the sun, which is what makes a lit
sphere read as lit, and glint on the ocean small enough to be a highlight rather than fog.

`map-options.md`, "the fourth pass", has the detail and the two traps.
