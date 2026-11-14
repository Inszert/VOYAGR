# The discovery map: renderer and basemap

Sections 11 to 14 of the 1.10.1 specification ask for a globe that answers "where can I go?".
Section 28 says it does not need production intelligence yet, but it must already have the right
visual architecture so it is not bolted on later.

Two decisions sit behind that, and they are separable. **The renderer is decided. The basemap is
deliberately not adopted.**

Retrieved 19 September 2026 from each project's or vendor's own documentation and licence text.
Marked **[vendor]** where an answer requires contacting them.

---

## Renderer: MapLibre GL JS

Adopted. `maplibre-gl` 6.10.0, BSD-3-Clause, verified from the package's own `license` field and
the licence header in its distributed bundles.

Why it, rather than the alternatives:

- **No account, no key, no terms of service.** It is a library, not a service. Mapbox GL JS from
  v2 onward requires a Mapbox access token even to render your own data, which makes the renderer
  itself a commercial dependency.
- **The hard parts are already in it**: rotation, drag, zoom, hover, click, a globe projection,
  and source-level clustering. Section 12 asks for all of them. Hand-rolling pan and zoom over an
  SVG projection is a week of work that ages badly.
- **It renders GeoJSON with no tile server at all.** This is the property that lets us ship a real
  map without adopting a basemap vendor, and it is why the two decisions are separable.

### What it cost us

Two things, both recorded here because both were surprising.

**Its worker does not survive bundling.** MapLibre resolves its worker relative to
`import.meta.url`, which after a Next build is a hashed chunk, so it requests a file that is not
there. It then renders its background, reports no error and never loads a source — a blank blue
rectangle that looks like a working map of an empty ocean. `scripts/copy-map-worker.mjs` copies the
worker out of `node_modules` on every build and the globe points at it explicitly. The component
also hides itself if the style has not loaded within eight seconds, because an empty ocean is worse
than no map: it looks like an answer.

**It would otherwise want `worker-src blob:`.** Serving the worker from our own origin means the
Content-Security-Policy stays at `worker-src 'self'`. A CSP entry avoided is one that cannot be
leaned on later for something else.

---

## Basemap: nothing adopted

**No tile provider has been chosen, and none is wired in.** The map today draws land and country
outlines from a Natural Earth vector file committed to this repository, and nothing else.

### What we ship

Four sets of files, all written by `scripts/build-geo.mjs` and all served from our own origin:
country outlines at globe zoom, finer ones fetched on zoom, a label point per country, and one
file of regions per country fetched when that country is opened. About 5.7MB in total, of which a
first visit downloads 210KB.

`public/geo/countries-110m.v1.json` — Natural Earth 1:110m admin-0 countries, 177 features,
rounded to two decimal places (about a kilometre, which is the resolution a marker at country zoom
can express), with a fixed allow-list of properties and a precomputed, antimeridian-aware bounding
box per country. About 190KB. Written by `scripts/build-geo.mjs`, which also writes
`src/discovery/countries.generated.json`, the same countries without geometry, for the server.

Keyed on `ADM0_A3`, not `ISO_A3`: Natural Earth sets the ISO code to -99 for France, Norway,
Kosovo and a few others, and `ADM0_A3` is always populated. The key is what makes a country
selectable — it becomes the feature id, so hover and selection are feature state rather than a
re-styled layer. The version in the filename is what lets the service worker cache the file first.

Licence: **public domain.** From the Natural Earth licence text: "All versions of Natural Earth
raster + vector map data found on this website are in the public domain… No permission is needed to
use Natural Earth. Crediting the authors is unnecessary." We credit it anyway, in the map's
attribution control, because a map that shows where its land came from is a map a reader can check.

This is enough for the product's actual question. At the zoom a flight search lives at — countries
and coastlines, not streets — a 1:110m outline is not a degraded basemap, it is the right one.

### What a tile provider would buy, and cost

Streets, place labels, terrain and satellite imagery. All of which matter for sections 15 to 22
(hidden places, scenic locations, walkable neighbourhoods) and none of which matter for placing
sixteen airports on a globe.

The cost is the same shape as the imagery decision in `docs/imagery-options.md`:

- **A third party in the render path of every map view**, reached directly from the user's browser,
  which is a privacy fact before it is a performance one.
- **Tile requests are metered.** A map view is dozens of tiles, and a user panning a globe
  generates them faster than any other interaction in the product.
- **Attribution is contractual** and, for OpenStreetMap-derived tiles, so is the ODbL share-alike
  obligation on derived data.
- **Labels need a glyph server**, which is a second endpoint with its own terms. This is why the
  current map draws no text at all: names and prices live in the list beside it, as ordinary DOM.

### Options, if and when that changes

|                                     | Licence / terms                                                                                     | Key required | Free tier                                                       | Self-hostable                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------- | ----------------------------- |
| **Natural Earth vectors** (current) | Public domain                                                                                       | No           | n/a — we ship the file                                          | Already is                    |
| **OpenStreetMap tile servers**      | ODbL data; the community tile servers have a usage policy that forbids systematic or commercial use | No           | Not for a product                                               | Yes, at real operational cost |
| **MapTiler**                        | Commercial                                                                                          | Yes          | Documented free tier; limits **[vendor]** for anything above it | Paid tier                     |
| **Stadia Maps**                     | Commercial                                                                                          | Yes          | Documented free tier; commercial terms **[vendor]**             | Paid tier                     |
| **Protomaps / PMTiles**             | Open data, BSD tooling; a single tile archive served from our own origin                            | No           | n/a                                                             | Yes — one large static file   |

**Protomaps is the option to look at first** when labels are actually needed: it keeps the
"no third party in the render path" property that the current approach has, at the cost of hosting
a multi-gigabyte archive. That is an infrastructure decision, not a rendering one, and it should be
made when sections 15 to 22 create a reason for it — not to decorate sixteen fixture destinations.

---

## The second pass: selection, routes, chips and what comes next

The discovery-first homepage (`docs/homepage-redesign.md`) made the globe the primary navigation
surface. The decisions from that pass that are about the map belong here.

**Countries are selectable, and the selection is a URL.** Hover and selection are MapLibre feature
state over the keyed country file. A click flies to the country's precomputed bounds and pushes
`?country=ESP`; the server narrows the rail and the search's destination field to that country's
airports. The same selection is reachable from a native `<select>`, so the canvas is never the
only way in.

**Routes are great circles, computed by us.** `src/discovery/geo.ts` interpolates the arc and
splits it at the antimeridian; the renderer draws a `MultiLineString` with a gradient from the
origin. Origins come from `src/providers/fixtures/airports.ts`, because until this pass nothing
placed a departure airport.

**Prices are DOM markers, not map text.** Each destination's price is a real link inside a
`maplibre.Marker` element, formatted on the server from `Money`, wearing its provenance badge. A
marker on the far side of the planet is hidden with `visibility: hidden` — MapLibre toggles the
covered class — so it also leaves the tab order. This is why the map still needs no glyphs.

**Chips are laid out by collision, not by zoom.** Sixteen places within thirty degrees of each
other are sixteen chips on top of one another. On each move the chips are measured in rank order
and any that would overlap one already placed is hidden, so the best-ranked place at any view is
always the readable one and zooming in reveals the rest. That is the progressive disclosure
section 12 asks for, decided by what actually fits rather than by a zoom threshold picked in
advance. The pass is throttled to about six a second while the globe moves and runs immediately
when it stops, because measuring an element after changing its class forces a reflow and doing
that for every chip on every frame of a spin is the one thing here that could cost frames.

**The globe waits for the page to be interactive.** Creating a WebGL context, compiling its
shaders and parsing the coastline is the heaviest main-thread work in the product, and none of it
is why somebody pressed a search button. Building is deferred to `requestIdleCallback` with a
one-second timeout, so the links, the form and the rail respond first and the planet arrives a
beat later. Measured on this machine: hydrated at 440ms, globe drawn at 920ms, chips at 2.2s, and
no long tasks once settled.

**The opening view is computed, not fitted.** MapLibre draws the globe with the mercator world's
width as its _circumference_, so the sphere is `512·2^zoom/π` pixels across — about 163px at zoom
zero. `fitBounds` over the destinations is the wrong tool: a regional set zooms in until the globe
is a flat map with rounded corners, and a planet-wide set leaves it small and off-centre. The
stage instead solves for the zoom at which the whole sphere fills its box and centres on the
departure airport. `fitBounds` is kept for zooming _into_ a selected country, which is what it is
good at.

---

## Inside a country: regions, detail and labels

Built in the redesign's Phase B. Three things arrive when a country is opened, and none of them
changes the property this document exists to defend: the map still reaches no origin but ours.

**Labels need no glyph server and no font file.** This was expected to cost one or the other.
MapLibre 6 rasterises a label on a canvas when the style declares no `glyphs` URL, using the
`text-font` stack as a CSS font family list — so `['Georgia', 'serif']` draws country and region
names from a font the machine already has. No PBF ranges to generate, no font committed here, no
second endpoint with its own terms, and no change to the Content-Security-Policy. The cost is that
a machine without Georgia falls back to whatever its browser picks for a serif, which is the same
bargain `--font-display` already makes in `docs/design-system.md`. **This supersedes the earlier
decision to commit a font under the SIL Open Font License.**

**Labels are placed at build time, one per feature.** MapLibre puts a symbol on every part of a
multi-part geometry, so Spain drawn with its islands is labelled three times and Italy four, which
reads as a bug rather than as a map. The build script therefore emits a label point per feature —
the centroid of its largest part — into `public/geo/country-labels.v1.json` and, for regions, as a
`Point` feature beside each outline in the same file, which the layers tell apart by geometry type.
Deciding it at build time keeps the renderer doing what the rest of this codebase asks of it:
drawing what it is handed.

**Regions come from the 1:10m admin-1 set** (`ne_10m_admin_1_states_provinces`, about 40MB raw,
4,596 features), which is the only admin-1 set that covers our destinations — the 1:50m set covers
nine large countries and none of ours. The build splits it into one file per country, 177 files and
4.4MB in total, the largest being Russia at about 400KB, and the globe fetches only the country
that was opened. **They are outlines and nothing else.** Natural Earth gives a region a name and an
ISO 3166-2 code; the product knows nothing else about one, so the layer draws boundaries and the
rail says in words that boundaries are all they are. Filling them with colour would be a claim
about places we have not priced.

**Coastlines that survive zooming in** come from `ne_50m_admin_0_countries`, 1.05MB after
reduction, added to the map only once the zoom passes 2.4. Below that a 1:110m outline is the right
resolution rather than a degraded one.

**Simplification is ours, not `mapshaper`'s.** The plan named it as a dev dependency; an iterative
Ramer-Douglas-Peucker is about forty lines in the build script and avoids a large dependency for
one build step, so it is written out instead. Two properties matter more than the size it saves.
Precision adapts: a shape that a one-kilometre grid would erase keeps a finer one, because Monaco
and Ceuta are real places. And the build fails rather than dropping a feature, because a region
that vanished from the map would be this product claiming a place does not exist.

## The third pass: making it look like a planet

The globe was correct long before it was convincing. It had every coastline, every border and a
seasonal model behind its ice, and it still read as a diagram of the Earth rather than the Earth.
Four things changed that, and none of them is a tile provider.

### Day and night

`src/discovery/terminator.ts` computes where the sun is from the date and the clock: a declination
from the same sunlight model the ice comes from, and a longitude from the hour, because the sun is
over the antimeridian at midnight UTC and moves fifteen degrees west an hour. From that come two
shapes - a dark cap around whichever pole is in polar night, and the terminator itself.

The cap is a fill. The terminator is a wide, heavily blurred warm line drawn on top of it, because
a fill has one colour and a hard edge and sunrise has neither. The stage recomputes both once a
minute, which is finer than anybody can see and enough that a page left open is never wrong.

**This is the single change that did the most.** A lit sphere is a diagram; a sphere with a night
side is a planet.

### The lights of the cities in it

Natural Earth's populated places above half a million, as small warm dots. Each one works out its
own brightness on the GPU from an expression that is the same formula as `solarElevationSine`,
rebuilt in the style language with the declination's sine and cosine folded in as constants - so
seven hundred points cost one paint property rather than seven hundred calculations on the main
thread. A test asserts the two agree, because if they drift the lights come on in daylight.

They carry no name, no price and no link. A city we cannot price must never look like a
destination we can.

### The continental shelf

Every photograph of the Earth has a pale band of shallow water around each landmass, and its
absence is most of why a vector globe looks drawn: land meets sea at a hard line that nothing in
nature makes. A wide blurred light line along the shore puts it back.

It needs the shore on its own, which is why `ne_50m_coastline` is built into its own file rather
than taken from the country outlines - those are _borders_, and drawing a continental shelf along
the France-Germany frontier would be absurd.

### Ground, not tint

A latitude band filled with one flat colour does not look like snow; it looks like the map has
been tinted, which was exactly the complaint it earned. `globe-textures.ts` generates three tiling
patterns on a canvas at runtime - snow grain, sand dunes and a land mottle - and the style uses
them as `fill-pattern`. No sprite sheet, no file and no request: the globe still reaches nobody.

They are deterministic, seeded from an integer hash rather than `Math.random`, so the planet looks
the same on every render and every screenshot.

### What moves

Three things, all slow, none of them a particle system over the canvas: the snow glitters, the sand
drifts, and dashes walk along each route. All three stop entirely under `prefers-reduced-motion` -
not slowed, stopped - and none of them starts until the style has loaded and a moment has passed,
because decoration waits for the map and never the other way round.

That last rule was learned rather than designed. A globe that animates never goes idle, and two
things were waiting on `map.once('idle')` to add the finer coastlines and an open country's
regions. They now poll for a loaded style instead, which is what they always meant.

## The fourth pass: the things a style cannot draw

Two of the properties that make the reference image read as a photograph of a planet cannot be
layers in a map style at all, for the same reason: **every layer in a style is painted on the
ground**, and both of these are about the sphere's silhouette on screen.

### The atmosphere

Four CSS circles over the canvas, sized from one number the stage writes on the container each
frame — `--globe-diameter`, the sphere's projected diameter in pixels. That number is not measured
or guessed: MapLibre draws the globe with the Mercator world's width as its circumference, so the
diameter is `512 · 2^zoom / π`, the same relation the opening view already used to fit a planet to
a box.

| Element            | What it is                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `voyagr-orb-limb`  | Limb darkening. You look through more of a sphere at its edge; without this the globe is a circular map |
| `voyagr-orb-shade` | The falloff away from the sun, centred on the sub-solar point. Illumination, where the limb is geometry |
| `voyagr-orb-sheen` | Glint off the ocean at the sub-solar point - small and hard, a few degrees across                       |
| `voyagr-orb-air`   | One soft haze just inside the limb and two very wide, very low bleeds outside it                        |

All four fade out through `--globe-shown` once the planet stops being a planet: zoomed past a
globe, or switched to the flat map. The two that need to know where the sun is fade separately,
through `--globe-sun-lit`, because a gradient anchored just off the disc is a directional ramp
across a world that is simply in darkness. They are optics, not geography, and nothing on them is
a claim about a place.

**There is no ring, and that was the whole correction.** The first version wrapped the sphere in
two tight bright shadows, with MapLibre's own `atmosphere-blend` at full strength behind them. Air
has no edge; a hard circle around a planet reads as an outline, a lens flare, a sticker - it was
the single thing giving the picture away as a graphic. The light that was in that ring now lives
in the sky itself, as a wash centred where the globe hangs, painted in the same declaration as the
rest of the stage background. It has no boundary anywhere, which is the point: a sky near a planet
is simply brighter.

Two traps came with it. MapLibre's `atmosphere-blend` draws a band of definite width at the limb,
so it is turned down to a suggestion and the edgeless version does the work. And the sheen started
as a wide soft wash, which read as frosted glass over the whole disc and took the colour out of
every continent under it - sun glint is a highlight, not fog.

The sphere is fitted to 86% of its box rather than 94%: the atmosphere is drawn outside the
silhouette and the box is clipped, so a sphere filling it had its air cut off square at the top
and bottom - the "planet in a window" look the frame was removed to avoid.

### Looking less like a map

Four changes, all of them removing something a cartographer would have added:

- **Borders fade at globe zoom.** A border is the most map-like thing that can be drawn on a
  planet, because no photograph of one has any. They are still there - a country is what somebody
  clicks - but at the weight of a hint until somebody is close enough to be choosing between two
  of them. A selected country keeps full strength at any zoom.
- **The land is browner.** The first pass used the green a cartographer uses for lowland, which is
  a legend colour. From orbit vegetation is dark and olive, drylands are more of the surface than
  anybody expects, and almost nothing is saturated.
- **Sand is mottled, not combed.** The dune texture was parallel streaks, which at the zoom you
  look at a whole planet from is hatching. Patches of lighter erg and darker rock carry it now,
  with the grain only faintly through - and every ground texture fades out towards globe zoom,
  because from far enough away to see the whole Earth you cannot see dunes at all.
- **The ice is a cap, not a veil.** Cooler, and much lighter at globe zoom, where a band of white
  across the top of a sphere seen at a grazing angle reads as fog over the picture.

### Flight arcs that leave the ground

`src/components/discovery/globe-arcs.ts`. The coordinates are the same great circles the server
computed and the style draws as ground tracks; what happens here is projection.

The lift is one line of arithmetic, and it is worth stating why it is correct. Under any central
projection of a sphere — orthographic or perspective — a point raised straight up from the surface
moves directly away from the centre of the projected disc, by the same fraction it was raised by.
A point in the middle of the disc is coming at the viewer and does not move at all; a point at the
limb moves outward past the silhouette, which is exactly what an arc rising over the horizon does.
So the whole of it is: **scale the screen vector from the disc's centre**.

Everything else follows from being honest about what MapLibre will vouch for. Ground positions come
from `map.project`, because that is the projection actually in use; visibility comes from the
cosine of the angle between each sample and the view centre, clipped slightly inside the geometric
limb because a perspective globe's horizon is a little closer than a hemisphere. Paths are
recomputed only when the view has moved; the light travelling each arc moves every frame along
points already worked out, and does not exist at all under `prefers-reduced-motion`.

The ground track stays, faint, underneath. Two lines for one journey is what a flight tracker looks
like, and it is the reason the arc reads as being _above_ the planet rather than on it — and it is
the only route drawing left when somebody switches to the flat map, where there is no limb to bow
over.

### Globe or flat map

`map.setProjection` switches between them: the same sources, the same prices, the same links,
unrolled. A globe is the honest shape of a planet and the wrong shape for comparing two places at
the same latitude.

The night cap does not come with it. A cap around the dark pole is the correct shape on a sphere
and a parabola three screens wide once unrolled onto Mercator, with a bright rim traced along it —
which reads as a shape somebody drew rather than as sunlight. The flat map keeps the city lights,
which fade with the sun's own elevation and say the same thing with no drawn edge anywhere.

Which projection you are reading is deliberately _not_ in the URL, unlike the country, the ranking
and the search. Those are answers, and an answer belongs in a link somebody can send. A preference
about how to look at them is not, and a link carrying it would be telling the recipient how to see.

## The fifth pass: a photographic surface

The flat vector fills read as a diagram, so the globe now draws a raster under
everything it computes.

- **Source.** NASA Earth Observatory, _Blue Marble Next Generation_ with
  topography and bathymetry, August 2004, 5400 x 2700 equirectangular.
  Public domain. Credit: "NASA Earth Observatory / Blue Marble", which the
  front page carries in its caption line.
- **Build.** `scripts/build-earth-texture.mjs` fetches it once into the
  git-ignored `.geo-cache/`, reprojects it to Web Mercator (the projection
  MapLibre's globe draws raster tiles in) and cuts 256px WebP tiles for zoom 0
  to 4 into `public/geo/earth/v1/{z}/{x}/{y}.webp`: 341 tiles, about 1.1 MB.
  The source image is not committed.
- **Immutable.** The service worker keeps `/geo/` for ever by URL. A rebuilt
  set goes into `v2` and `EARTH_TILES_URL` in `globe-style.ts` changes with it;
  `v1` is never rewritten.
- **Layering.** The `earth` raster sits over the flat land, relief, sand and ice
  fills - which stay in the style as the colour shown while tiles load - and
  under the country hit layer, the thin country borders (white, 12%), the
  night caps, the city lights and everything the product draws. Tiles are on
  our origin, so the globe still reaches nobody else.
- **What it is not.** It is August 2004 imagery. The season model's ice and
  snow bands are hidden under it, so the polar caps are NASA's, not the
  selected date's.

## What the map does not claim

Section 13 asks for transport filters: flights, trains, buses, cars, ferries, mixed. Only flights
have a provider. Section 14 lists "best season" and "most interesting" among the ranking modes;
both need the seasonal intelligence and place catalogue of sections 15 to 22.

None of these are rendered as empty controls. A transport filter offering "train" that quietly
returns flights is worse than no filter, and the map says in plain words what it can and cannot
currently compare.
