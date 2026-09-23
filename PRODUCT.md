# Voyagr — product truth

**Source of truth is `docs/PRODUCT-SPECIFICATION.md`.** This file is the short version, at the
repo root, because the design tooling reads `PRODUCT.md` from there: without it, Impeccable treats
the project as having no product context and offers to run an interview it does not need.

Do not edit the specification from here. If the two disagree, the specification is right.

---

## What it is

Voyagr is an AI travel deal hunter. It searches for **complete trips** — flights, a hotel and the
ride from the airport, priced together — keeps monitoring them in the background, and tells the
user when a materially better combination appears.

It is not a flight search engine with hotels bolted on. The unit is the whole trip, and the number
that matters is the total.

## Who it is for

Someone with flexible dates and a budget, who does not yet know where they are going. The front
page is a globe with prices on it because "where can I afford to go?" is the question, and a list
of departure airports is not an answer to it.

## What it promises

- **Every cost is tagged.** `known`, `estimated` or `excluded`. A transfer nobody priced is an
  `excluded` line, never a zero.
- **Every price says where it came from.** Live, cached, test, or demo data, named per part, beside
  the number rather than in a footnote.
- **Nothing is invented.** A fact a provider did not state is `null` and is shown as unknown. No
  number a user sees was produced by a model.

## What it does not do yet

Phase 1 is not implemented. There is no booking, no payment, no live Travel Watch monitoring and no
production notification pipeline. Hotels and transfers are fixtures; flights can be live (Duffel).
Do not build any of those without being asked.

## The hard constraints

These are not style preferences. They are the product.

1. **The globe is a finished asset.** Geometry, rendering, colour, camera, projection, routes,
   markers, geographic data, interaction, animation — none of it changes unless the user asks for
   globe work by name. UI work happens _around_ it.
2. **Deterministic software owns every number.** Prices, totals, budgets, dates, scores and
   eligibility come from `src/core/`. A model may explain a number; it may never produce, adjust or
   "sanity check" one.
3. **API and MOCK are never confused.** The runtime data-source switch changes which adapters
   answer. It never relabels one as the other, and the UI shows the source that actually served the
   page rather than the one that was asked for.
4. **Accessibility is a requirement, not a polish pass.** Real buttons, real links, a visible focus
   ring, a label on every input, colour never the only signal, 4.5:1 contrast. axe runs against the
   app in a desktop and a mobile viewport and fails the build on any violation.
