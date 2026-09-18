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

| Group    | Tokens                                                     |
| -------- | ---------------------------------------------------------- |
| Surface  | `surface`, `surface-raised`, `surface-sunken`              |
| Ink      | `ink`, `ink-muted`, `ink-inverse`                          |
| Border   | `border`, `border-strong`                                  |
| Brand    | `brand-50` … `brand-900`                                   |
| Accent   | `accent-300`, `accent-500`, `accent-700`                   |
| Status   | `positive-*`, `caution-*`, `critical-*`                    |
| Tint ink | `brand-ink`, `positive-ink`, `caution-ink`, `critical-ink` |
| Radius   | `radius-card`, `radius-control`                            |

Colours are authored in **OKLCH**, which keeps perceived lightness consistent across hues — a
caution amber and a positive green at the same lightness actually look equally prominent.

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

| Component  | Notes                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `Button`   | Variants and sizes; `asChild` renders a link as an anchor; `loading` sets `aria-busy` and keeps the accessible name |
| `Field`    | Label, hint and error wired through `htmlFor` and `aria-describedby`; error in a live region                        |
| `Card`     | Neutral container; `CardTitle` takes an explicit heading `level`                                                    |
| `Badge`    | Status tones; `srPrefix` adds context colour alone cannot carry                                                     |
| `SkipLink` | First focusable element on the page                                                                                 |

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

**Deliberately avoided:** the generic "AI dashboard" look — gradient hero panels, glowing borders,
dark-glass cards, sparkle iconography, a purple-to-blue gradient on everything. None of it helps
someone decide whether a EUR 742 trip is good value.

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
