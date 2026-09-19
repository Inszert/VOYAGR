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

`public/geo/world-countries-110m.json` — Natural Earth 1:110m admin-0 countries, 177 features,
stripped to geometry plus country and continent names and rounded to two decimal places (about a
kilometre, which is the resolution a marker at country zoom can express). 171KB.

Licence: **public domain.** From the Natural Earth licence text: "All versions of Natural Earth
raster + vector map data found on this website are in the public domain… No permission is needed to
use Natural Earth. Crediting the authors is unnecessary." We credit it anyway, in the map's
attribution control, because a map that shows where its land came from is a map a reader can check.

This is enough for the product's actual question. At the zoom a flight search lives at — countries
and coastlines, not streets — a 1:110m outline is not a degraded basemap, it is the right one.

### What a tile provider would buy, and cost

Streets, place labels, terrain and satellite imagery. All of which matter for sections 15 to 22
(hidden places, scenic locations, walkable neighbourhoods) and none of which matter for placing
eight airports on a map of Europe.

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
made when sections 15 to 22 create a reason for it — not to decorate eight fixture destinations.

---

## What the map does not claim

Section 13 asks for transport filters: flights, trains, buses, cars, ferries, mixed. Only flights
have a provider. Section 14 lists "best season" and "most interesting" among the ranking modes;
both need the seasonal intelligence and place catalogue of sections 15 to 22.

None of these are rendered as empty controls. A transport filter offering "train" that quietly
returns flights is worse than no filter, and the map says in plain words what it can and cannot
currently compare.
