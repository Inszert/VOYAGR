# Voyagr — design direction (finish run)

Status: **proposed 2026-11-14, shown to the owner before build.** Built in slices; each slice is
shown (before/after at 1440×900 and 390×844) before the next starts.

The idea in one line: **the planet is the page.** Today the globe is a picture beside a form, and
below it the site turns into a card grid. The direction makes the globe the thing you act on, and
makes everything below it read like a travel magazine at night.

Unchanged: night-only theme, Inter + Playfair Display, Radix primitives, every fact in the DOM,
numbers from `src/core/`, axe at zero.

## 1. What is wrong now (from `home-1440.png`)

1. The globe is cropped into the top-right corner, about 40% of the hero, and competes with a
   date-picker that opens over the headline.
2. Selecting a place changes a small card; the planet barely reacts. No sense of travel.
3. Arcs and chips are static. Nothing says "these prices are alive".
4. Below the fold: four equal cards and an orphan fifth. Then three unrelated panels. No rhythm.
5. Demo banners and stacked label chips cover the photographs (already being removed).
6. Motion is limited to hover and popovers; scroll does nothing.

## 2. Layout

### Hero (0–100vh), "the stage"

- Globe is centred and large: diameter `min(92vh, 78vw)` desktop, `118vw` on phones (bleeds off
  both sides, top of the sphere at 38vh). It sits behind the headline, not beside it.
- Headline bottom-left over the dark limb: `--text-display-lg` → new `--text-display-xl`
  (4.5rem / 1.0 / -0.03em, 2.75rem on phones). Max 3 lines.
- Search collapses to one glass bar (origin · dates · travellers · Search), 64px tall, pinned to
  the bottom of the hero; expands in place. The calendar opens as a sheet from the bar, never over
  the headline.
- Right edge: a vertical rail of 5 live destinations (name, country, price, weather glyph),
  each tied to its pin on the globe.

### Below the hero

1. **"From {city} tonight"**: horizontal snap rail, cards 320×420, image-led.
2. **Editorial mosaic**: 12-col grid: one 7-col × 2-row lead tile, two 5-col tiles, then a
   4/4/4 row. No orphan card: the mosaic takes 3, 5, 6 or 8 items; other counts fall back to rail.
3. **Full-bleed destination moment**: one destination, image edge to edge at 80vh, price, savings
   and weather set in the lower third.
4. **Flexible-dates strip**, then trust band, then footer.

### Card (where cards remain)

Image 3:2 fills the card, 14px radius, gradient scrim on the lower 55%
(`transparent → rgba(5,7,14,.88)`). Over it: destination (Playfair 1.5rem), country in full,
price (tabular, 1.25rem) with "from", one savings line in `--color-positive-ink` when core says
so, weather glyph + temperature. One label chip maximum, top-left. No stacked chips on the photo.

## 3. The globe

- **Fly-to on selection:** `easeTo` centre on destination, 1400ms, `--ease-out-expo`, zoom +0.6,
  pitch 0→18°. Then the arc from the home airport draws (below). Deselect returns in 900ms.
- **Idle rotation:** 360° in 240s, pauses on pointer-down, hover of a chip, focus within, or tab
  hidden; resumes 3s after the last interaction with a 1200ms ramp.
- **Arcs:** route from the home airport draws with `stroke-dashoffset` over 900ms ease-out-quart;
  a 6px light travels the arc once per 4s (linear), staggered 600ms per route. Max 6 arcs.
  Uses the bounded dash-pattern set (`routeDashPattern`), never a free-running dasharray.
- **Price pins:** a pin whose cached price changed since the last view pulses once
  (scale 1→1.35→1, 600ms, plus a ring fading 0.5→0 over 900ms). No perpetual pulsing.
  Hover/focus lifts the chip 2px and raises its halo. Pins stay DOM links.
- **Light:** warmer terminator edge, slightly brighter city lights (+15%), atmosphere rim 1.5× on
  the lit side. Achieved with the existing stage tokens and orb layers; no texture download.
- **Performance budget:** 60fps on a mid-range phone; idle rotation and arc light stop when the
  hero is less than 20% visible.

## 4. Scroll choreography (CSS scroll-driven animations; no library)

| Range                      | What happens                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Hero 0→60% scrolled        | Globe scales 1→0.82, translates up 6vh, dims to 70%; headline fades 1→0 and rises 24px                   |
| Rail enters (entry 0→40%)  | Cards rise 32px and fade in, 60ms stagger by index (max 6 staggered)                                     |
| Mosaic tiles               | Image inside each tile parallaxes -6%→+6% over the tile's view range (`animation-timeline: view()`)       |
| Full-bleed moment (pinned) | Section sticks for 150vh: image scales 1.12→1, scrim deepens, price/savings/weather reveal in 3 steps     |
| Page → destination         | View Transition: the card image morphs into the destination header image (`view-transition-name`), 420ms |

Where `animation-timeline` is unsupported, content is simply visible (no JS fallback).

## 5. Motion system

| Token                   | Value                             | Use                               |
| ----------------------- | --------------------------------- | --------------------------------- |
| `--ease-out-quart`      | `cubic-bezier(0.25, 1, 0.5, 1)`   | Default enter                     |
| `--ease-out-expo`       | `cubic-bezier(0.16, 1, 0.3, 1)`   | Camera, large surfaces            |
| `--ease-in-out-soft`    | `cubic-bezier(0.65, 0, 0.35, 1)`  | Things that move and stay on screen |
| `--duration-quick`      | 120ms (kept)                      | Press, hover                      |
| `--duration-settled`    | 220ms (kept)                      | Popovers, chips                   |
| `--duration-deliberate` | 420ms (kept)                      | Sheets, view transitions          |
| `--duration-cinematic`  | 900ms (new)                       | Arc draw, reveal steps            |

`--ease-emphasis` (overshoot 1.2) is retired in favour of `--ease-out-quart`; this closes the
standing bounce-easing finding. Press feedback: `scale(0.97)` 120ms. Hover on cards: image
`scale(1.04)` 420ms, gated behind `@media (hover: hover)`.

**Reduced motion:** no rotation, no parallax, no pinning, no arc light. Fly-to becomes a 0ms jump,
arcs appear drawn, reveals are plain opacity 150ms. Every state is still reachable.

## 6. Imagery

Art direction approved by the owner on 2026-11-14 (style test: Faro, Larnaca, Bangkok).

- **A "blue hour"** (cities, coasts): just after sunset, deep navy sky, thin amber horizon, warm
  tungsten lights, 35mm, f/8, slightly elevated vantage, muted film grade, fine grain.
- **B "last light"** (beaches, nature): same lens, vantage and grade, 20 minutes before sunset.
- No people in the foreground, no text, no logos. 3:2 master; crops 3:2, 4:5, 21:9.
- Export AVIF + WebP at 480/960/1600w with a blurred 24px poster; lazy below the fold; hero image
  preloaded. LCP budget 2.5s.
- **A generated image is an illustration, not a photograph of the place.** Credits read
  "AI-generated illustration" per image; a good real photo always wins over a generated one.

## 7. Build slices (each shown before the next)

1. Hero + globe behaviour (sections 2-hero, 3).
2. Cards, rail, mosaic (section 2).
3. Scroll choreography + view transitions (section 4).
4. Destination page full-bleed + flexible-dates strip.
5. Imagery batch + email visuals.
