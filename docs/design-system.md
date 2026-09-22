# Design system

## The choice: Radix UI Primitives + Tailwind CSS v4

Voyagr uses **Radix UI Primitives** for component behaviour and **Tailwind CSS v4** for styling,
composed into a small owned component set in `src/components/ui/`.

This is the shadcn/ui pattern — copy-in components rather than an installed component library — but
without the dependency, so the set stays exactly as large as this product needs.

### Why Radix

Accessible interactive components are genuinely hard. Focus trapping, roving tabindex, `aria-*`
wiring, dismissal semantics, scroll locking, typeahead in a listbox — each has years of browser and
screen-reader edge cases behind it. Getting one wrong is not a styling bug; it is a lockout.

Radix has solved these, is maintained, is unstyled, and is widely deployed. The primitives compose
rather than dictating structure, which matters because trip comparison tables and cost breakdowns
are not shapes a generic component library anticipates.

### Why not the alternatives

| Option                    | Why not                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Material UI**           | Strong accessibility, but a heavy opinionated visual identity. Voyagr would look like Google's.                                                                     |
| **Mantine / Chakra**      | Good, but bring their own styling runtime and theme system, duplicating what Tailwind already does.                                                                 |
| **React Aria Components** | Excellent accessibility, arguably better than Radix. Rejected narrowly: a smaller ecosystem and more verbose composition. A defensible alternative if Radix stalls. |
| **Build from scratch**    | The instruction was explicit, and it is right. Hand-rolled dropdowns and dialogs are where accessibility goes to die.                                               |

### Why Tailwind v4

Tokens are defined once in `@theme` and become first-class utilities, so `bg-surface` and
`text-ink-muted` work like built-ins. Dark mode becomes a token swap rather than a component
rewrite. No runtime CSS-in-JS cost, and it composes cleanly with server components.

---

## Tokens

Defined in `src/app/globals.css`. Components reference **semantic** names, never raw colours.

| Group     | Tokens                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface   | `surface`, `surface-raised`, `surface-sunken`, `surface-overlay`                                                                                                                                                                                                                                                                                                                                                                                  |
| Elevation | `shadow-raised`, `shadow-floating`, `shadow-lifted`                                                                                                                                                                                                                                                                                                                                                                                               |
| Motion    | `duration-quick`, `duration-settled`, `duration-deliberate`, `ease-standard`, `ease-emphasis`                                                                                                                                                                                                                                                                                                                                                     |
| Display   | `font-display`, `text-display-sm`, `text-display-md`, `text-display-lg`                                                                                                                                                                                                                                                                                                                                                                           |
| Ink       | `ink`, `ink-muted`, `ink-inverse`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Border    | `border`, `border-strong`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Brand     | `brand-50` … `brand-900`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Accent    | `accent-300`, `accent-500`, `accent-700`                                                                                                                                                                                                                                                                                                                                                                                                          |
| Status    | `positive-*`, `caution-*`, `critical-*`                                                                                                                                                                                                                                                                                                                                                                                                           |
| Tint ink  | `brand-ink`, `positive-ink`, `caution-ink`, `critical-ink`                                                                                                                                                                                                                                                                                                                                                                                        |
| Stage     | `stage`, `stage-deep`, `stage-sea`, `stage-sea-deep`, `stage-atmosphere`, `stage-atmosphere-outer`, `stage-land`, `stage-land-lit`, `stage-border`, `stage-shelf`, `stage-night`, `stage-twilight`, `stage-city-light`, `stage-ink`, `stage-ink-muted`, `stage-glass`, `stage-glass-border`, `stage-accent`, `stage-accent-strong`, `stage-accent-deep`, `stage-route`, `stage-origin`, `stage-chip`, `stage-chip-ink` — the planet's own palette |
| Radius    | `radius-card`, `radius-control`, `radius-surface`, `radius-pill`                                                                                                                                                                                                                                                                                                                                                                                  |

Colours are authored in **OKLCH**, which keeps perceived lightness consistent across hues — a
caution amber and a positive green at the same lightness actually look equally prominent.

### Depth is a hierarchy, not a decoration

Four elevation steps and no free-form shadows. Elevation says what is on top of what, and a product
where any component can invent its own depth has no hierarchy — just a lot of shadows.

Each step is two shadows: a tight one for the contact edge and a wide, soft one for the cast. One
shadow at that size reads as a grey smear rather than as height.

In the dark scheme the shadows are nearly inert, because a black cast on a dark surface is
invisible. Lift there comes from the surface colour, which is why `surface-raised` is _lighter_
than `surface` in dark mode rather than darker.

`surface-overlay` is a fourth layer rather than a translucent `surface-raised`, because glass over
arbitrary content needs its own value per scheme to stay legible. The backdrop blur is progressive:
where it is unsupported the surface colour alone still meets contrast.

### Motion is three durations and two curves

Anything longer than `duration-deliberate` is an animation the user is waiting for rather than one
that helps them. `ease-emphasis` overshoots very slightly, which is what makes a panel feel like it
arrived rather than appeared.

All of it is neutralised under `prefers-reduced-motion`, in one base-layer rule, so no component
has to remember to opt out.

### The display face is a system serif

No web font. No third-party request, no layout shift while it loads, and it still works offline
behind the service worker. A licensed display face can replace `--font-display` without touching a
single component.

### The tint-ink tokens exist for a reason

Text on a tinted status background uses `*-ink`, **not** a value from the colour ramp. A `-700` ink
that reads well on a light chip drops to about 2:1 once the surface behind it is dark.

This was not theoretical. The axe check in the Playwright suite caught exactly that: status badges
at 2.04:1 in dark mode. The `*-ink` tokens are redefined inside the dark-scheme block; the ramp
values are not.

### Dark mode

Follows `prefers-color-scheme`. Surfaces **lift** rather than invert, so elevation still reads
correctly. Every ink/surface pairing meets WCAG 2.2 AA in both schemes — changing a value means
re-checking its pairing.

---

## Components

In `src/components/ui/`, exported through `index.ts` so the approved set is visible in one place.

| Component   | Notes                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`    | Variants and sizes; `asChild` renders a link as an anchor; `loading` sets `aria-busy` and keeps the accessible name                              |
| `Field`     | Label, hint and error wired through `htmlFor` and `aria-describedby`; error in a live region                                                     |
| `Card`      | Neutral container; `CardTitle` takes an explicit heading `level`                                                                                 |
| `Badge`     | Status tones; `srPrefix` adds context colour alone cannot carry                                                                                  |
| `SkipLink`  | First focusable element on the page                                                                                                              |
| `Container` | The reading column. `<main>` no longer constrains width, because the stage bleeds; a column page says so, or lives in the `(column)` route group |

`CardTitle` takes a level rather than assuming one because a card in a results grid and a card that
is a page's only content sit at different points in the document outline.

---

## Accessibility rules

Non-negotiable, and checked by both the component tests and axe:

1. Every input has a real `<label>` associated by `htmlFor`/`id`.
2. Colour is never the only signal — a status is also a word.
3. Focus is always visible. The global `:focus-visible` rule gives one consistent indicator; never
   remove an outline without replacing it.
4. 4.5:1 contrast for body text in **both** schemes.
5. Touch targets at least 44px on `md` and `lg` controls.
6. `prefers-reduced-motion` shortens transitions rather than removing them, so state changes stay
   perceptible.
7. `forced-colors` keeps focus boundaries visible when colour is dropped.
8. One `<h1>` per page; heading levels never skip.
9. Errors live in a region that is always present, not conditionally rendered — a live region that
   appears at the same moment as its content is often missed.
10. Zoom is not locked. `maximumScale: 5`.

---

## Visual direction

Restrained and content-first. This is a tool people spend money through, so it should feel precise
rather than playful.

**One scheme, and it is night.** Voyagr is a planet seen from orbit with an interface laid over
it, and a planet does not repaint itself when the reader's operating system changes its mind. The
stage used to be the only dark surface and the product turned to parchment below it, which was two
websites stacked on one scroll. The stage's palette is now the product's: `surface`, `ink`,
`border` and `surface-raised` are the night values, there is no `prefers-color-scheme` block left
in `globals.css`, and `color-scheme: dark` is declared on the root so the platform's own furniture
agrees.

**`stage-*` names the planet, not the theme.** The tokens survive because they describe a world
rather than an interface: `stage-sea` is the ocean, `stage-land` is vegetation, `stage-atmosphere`
is what air scatters at the limb, `stage-chip` is a price on the globe. Only the globe and the
surfaces immediately around it read them. `.stage-scope` no longer repaints an island of the
product; what is left in it is the difference between an interface panel and a pane of glass laid
over a photograph — glass surfaces, a hairline border, and a red that survives being printed on
one.

**The flight paths follow the globe; nothing else does.** As the planet turns, `--color-stage-route`
moves towards the biome in the middle of the view — warm over the deserts, cool over ice, jade over
the tropics — at low chroma, so the arcs stay near-white with a hint of the ground under them. The
transition animates because the property is registered with `@property`. Two earlier versions went
further and both were wrong: one moved the page background, which turned the entire site brown over
the Sahara; the next moved the accent, which turned the headline, the icons and the eyebrow amber
with it. A brand that changes under the reader is not a personality. Ink, surfaces, glass and the
one violet every control is built from are fixed, so every contrast pairing below holds whichever
way the world is facing.

**Ambient light, never an outline.** The glow around the globe is part of the stage's background
paint, not a ring drawn on the sphere. Anything that wraps an object in a shape with a definite
edge — a halo, a rim, a glowing border — reads as an outline rather than as light, and the whole
planet goes with it. What sits on the globe itself is one soft haze that fades out long before it
could look like a boundary.

**The gradient is one control, not a style.** `.voyagr-cta` — a violet-to-indigo gradient with a
glow in its own hue — dresses the primary action and nothing else. Both of its stops are
deliberately no lighter than oklch 0.55, because white type on the brighter violet the reference
uses fails 4.5:1, and a button nobody can read is not a closer match to anything.

**Deliberately avoided:** the generic "AI dashboard" look — a gradient on every surface, glowing
borders everywhere, sparkle iconography as decoration, glass for its own sake. The glass here is
load-bearing: it is what lets a control sit over a planet and still be read.

**What the product actually demands:**

- A figure tagged `estimated` must look different from one tagged `known`. An estimate must never
  carry the visual authority of a quote.
- Excluded costs are shown, not hidden.
- A score is explainable — if 84 is displayed, its factors are reachable.
- Tabular figures (`--font-mono`) for prices in comparisons, so columns align.
- Nothing implies a guaranteed future price.

---

## Adding a component

1. Check Radix first. If a primitive exists, use it.
2. Put it in `src/components/ui/` and export it from `index.ts`.
3. Use semantic tokens. No raw colour values.
4. Write component tests asserting role, accessible name and state — never class names.
5. Verify in both schemes and at mobile width.
6. Run `npm run test:e2e`; axe runs against the app in both viewports.
