# Voyagr — design language

**This file records what exists. It does not propose anything.** Every value below was read out of
`src/app/globals.css`; if the two disagree, the stylesheet is right and this file is stale.

`docs/design-system.md` is the longer document: why Radix and Tailwind, what each primitive
guarantees, and the accessibility rules. This one is the reference a design tool reads first —
Impeccable's context loader looks for `DESIGN.md` at the repo root, and without it the incumbent
system is a "documentation gap" it will offer to replace.

> **There is no second colour scheme, and it is night.** `surface`, `ink` and `border` are night
> values. There is no light block in `globals.css` and adding one would split the site in two.

---

## Colour

Semantic tokens, in the order a component should reach for them. Raw hex belongs in `globals.css`
and nowhere else.

### Surfaces

| Token                     | Value                | Purpose                                     |
| ------------------------- | -------------------- | ------------------------------------------- |
| `--color-surface`         | `#05070e`            | Page ground                                 |
| `--color-surface-raised`  | `#0c101b`            | A card                                      |
| `--color-surface-sunken`  | `#10151f`            | A region inside a card; filters; fact cells |
| `--color-surface-overlay` | `rgba(12,16,27,.72)` | Glass, over the globe or over a photograph  |
| `--color-bg-alt`          | `#080b13`            | A band that separates two sections          |
| `--color-field`           | `#0a0e18`            | The inside of an input                      |

### Ink and borders

| Token                   | Value                   | Purpose                            |
| ----------------------- | ----------------------- | ---------------------------------- |
| `--color-ink`           | `#ffffff`               | Body and headings                  |
| `--color-ink-muted`     | `#98a0b0`               | Supporting text                    |
| `--color-dim`           | `#7a8190`               | Metadata, the quietest legible ink |
| `--color-border`        | `rgba(255,255,255,.07)` | The hairline                       |
| `--color-border-strong` | `rgba(255,255,255,.16)` | A boundary that has to be seen     |

### Accent and status

| Token                    | Value                 | Purpose                              |
| ------------------------ | --------------------- | ------------------------------------ |
| `--color-accent-from/to` | `#6a6cf6` → `#8b7bf7` | The one filled button, as a gradient |
| `--color-brand-ink`      | `#a9a5f5`             | Accent text on a dark surface        |
| `--color-positive-ink`   | `#7fd8a6`             | Under budget, confirmed              |
| `--color-caution-ink`    | `#ecc06a`             | Estimated, unpriced, needs checking  |
| `--color-critical-ink`   | `#f09a92`             | Over budget, demo data, an error     |

**Use the `-ink` token, never the `-500` ramp value, for text.** A ramp value dark enough for a
light chip measures under 4.5:1 once the surface behind it is dark. The ramp is for fills and
borders (`bg-positive-500/10`, `border-caution-500/30`).

### Stage

`--color-stage-*` names the parts of the night the planet owns: the ocean, the land, the
atmosphere, the terminator, a price chip. **Only the globe and the surfaces immediately around it
use these directly.** `stage-scope` is the class that makes an ordinary primitive resolve its
semantic tokens to stage values, which is how a result card's header can sit in the stage palette
without hard-coding anything.

---

## Typography

Two faces, loaded by `next/font/google` and served from our own origin, so `font-src` stays
`'self'`.

- **Inter** (`--font-sans`) — interface, body, data. Everything that is not a heading.
- **Playfair Display** (`--font-display`) — page titles, section titles, destination names,
  editorial recommendations. **Not** form labels, buttons, badges or metadata.

Editorial scale, line height and tracking set together so a display heading cannot be given body
leading by accident:

| Token               | Size    | Line height | Tracking |
| ------------------- | ------- | ----------- | -------- |
| `--text-display-sm` | 1.75rem | 1.15        | -0.015em |
| `--text-display-md` | 2.5rem  | 1.08        | -0.02em  |
| `--text-display-lg` | 3.5rem  | 1.02        | -0.025em |
| `--text-display-xl` | 4.5rem  | 1           | -0.03em  |

`--text-display-xl` is the front page's headline only; it is 2.75rem on a phone.

**Tabular figures are not optional on a price.** Ten results in a column with proportional digits
do not line up, and a column of prices that does not line up cannot be scanned. `Price` handles it;
anywhere else, `tabular-nums`.

---

## Spacing

There is no bespoke spacing scale: Tailwind's default 4px step is the scale. What matters is using
few, larger decisions rather than many small ones.

| Level        | Typical           | Where                             |
| ------------ | ----------------- | --------------------------------- |
| metadata     | `gap-1` / `gap-2` | Between a label and its value     |
| card content | `gap-3` / `gap-4` | Between the regions inside a card |
| section      | `gap-5` / `gap-6` | Between a heading and its content |
| page section | `py-8` … `pb-16`  | Between major bands of the page   |

---

## Radius

| Token              | Value           | Applies to                                  |
| ------------------ | --------------- | ------------------------------------------- |
| `--radius-control` | 0.625rem (10px) | Buttons, inputs, small tiles                |
| `--radius-card`    | 0.875rem (14px) | A card; the field group in the search panel |
| `--radius-surface` | 0.875rem (14px) | A feature card                              |
| `--radius-shell`   | 1.25rem (20px)  | The search panel; the closing band panels   |
| `--radius-pill`    | full            | Chips, badges, stage controls               |

---

## Borders

One hairline, `--color-border`, and one stronger boundary, `--color-border-strong`. A premium dark
interface separates things with surface contrast, spacing and type before it reaches for a border —
so do not outline every nested element, and never give one element a border _and_ a glow _and_
three shadows.

---

## Surfaces and states

| State    | Treatment                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| default  | The surface token for its level                                                                                |
| hover    | A surface shift, and 1–2px of lift **only if the element is itself a link or button**                          |
| focus    | The global `:focus-visible` ring — 2px `--color-brand-500`, 2px offset. Never removed                          |
| active   | Return to base position, shadow reduced                                                                        |
| selected | `aria-current` or `aria-pressed` first; the visual is a stronger border or the accent fill, never colour alone |
| disabled | `opacity-60`/`70` and `cursor-not-allowed`; the label stays readable                                           |
| loading  | `aria-busy`, dimensions preserved, focus kept                                                                  |
| error    | `--color-critical-ink` text in a live region; never colour as the only signal                                  |

---

## Elevation

Four steps, not a free-form shadow. Elevation is a hierarchy — what is on top of what — and a
product where any component can invent its own depth has no hierarchy, just a lot of shadows.

| Token               | Use                                      |
| ------------------- | ---------------------------------------- |
| _(none)_            | A region inside a card                   |
| `--shadow-raised`   | An ordinary card                         |
| `--shadow-floating` | The result that is the answer; a popover |
| `--shadow-lifted`   | A panel over the stage                   |
| `--shadow-accent`   | The glow under the accent gradient only  |

---

## Motion

Four durations and four curves, so every transition in the product agrees with the others. Nothing
overshoots: `--ease-emphasis` (overshoot 1.2) is retired in favour of `--ease-out-quart`.

| Token                   | Value                            | Use                                 |
| ----------------------- | -------------------------------- | ----------------------------------- |
| `--duration-quick`      | 120ms                            | Press, hover                        |
| `--duration-settled`    | 220ms                            | Popovers, chips                     |
| `--duration-deliberate` | 420ms                            | Sheets, view transitions            |
| `--duration-cinematic`  | 900ms                            | Arc draw, reveal steps              |
| `--ease-standard`       | `cubic-bezier(.2,0,0,1)`         | Everything not listed below         |
| `--ease-out-quart`      | `cubic-bezier(0.25, 1, 0.5, 1)`  | Default enter                       |
| `--ease-out-expo`       | `cubic-bezier(0.16, 1, 0.3, 1)`  | Camera, large surfaces              |
| `--ease-in-out-soft`    | `cubic-bezier(0.65, 0, 0.35, 1)` | Things that move and stay on screen |

The globe's camera, idle turn, arcs and pin pulse take their numbers from
`src/components/discovery/globe-motion.ts`, which holds the same values for script.

**Reduced motion is handled once, in the base layer.** `prefers-reduced-motion: reduce` shortens
every animation and transition to 0.01ms rather than removing it, so state changes stay perceptible
without animating. A component does not need to opt out again — and a component that sets its own
`animation` outside the cascade must.

`forced-colors: active` keeps the focus ring as `CanvasText`, so a boundary survives when colour is
dropped.

---

## Density

Three levels, which is what stops a page being one long column of identical objects:

- **featured** — the answer. The largest picture, the largest price. `feature` on `Card`.
- **medium** — the alternatives to it.
- **compact** — supporting information: a near miss, a filter, a metadata row.

Not every element gets the same padding. This is how hierarchy is made without another colour.

---

## Primitives

In `src/components/ui/`, exported through `index.ts`. Reach for one of these before writing a
one-off. See `docs/design-system.md` for what each guarantees.

`Button` · `Card` · `Badge` · `Tag`/`ToggleChip`/`RadioChip` · `Field` · `Select` · `DateField` ·
`DateRangeField` · `CalendarMonth` · `AmountSlider` · `Popover` · `Disclosure` · `Icon` ·
`Container` · `EmptyState` · `Skeleton` · `SkipLink` · `Media` · `Price` · `FactGrid` ·
`ProvenanceBadge` · `SourceStrip`/`SourceTag`

Three of those carry rules worth repeating here:

- **`Media`** — the wash is painted first and stays. The imagery provider returning nothing is an
  expected condition, not a failure, so a card without a photograph is that place's card in that
  place's colour. Never a broken-image icon, never a grey rectangle.
- **`Price`** — takes a string that `format()` already produced from a `Money`. It does no
  arithmetic, by construction.
- **`FactGrid`** — one bordered panel with hairlines between cells. Four bordered, filled tiles
  inside a bordered card are four boxes, not a hierarchy.

---

## What this product is not

Avoid, in every case: generic SaaS dashboard, card soup, glassmorphism everywhere, neon, excessive
gradients, giant shadows, nested cards, a second font, arbitrary animation, meaningless decoration,
palm-tree icons, aeroplane emoji, booking-site orange, giant discount badges.

Glass has exactly two homes: controls over the globe, and floating interface over imagery.
