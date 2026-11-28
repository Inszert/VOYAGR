# Voyagr — how things stand

Short on purpose. Details live in `docs/finish-plan.md` and `progress.md`.
Last updated: 2026-11-28 (flights section only; the rest below is as of 2026-11-17).

## Flights: Kiwi MCP run (branch `feat/mcp-only-flights`, not pushed, `main` untouched)

Facts from the run's handoff (`docs/autonomous-run/HANDOFF.md`), not re-run when this was written.

Built and committed:

- Flights come from Kiwi.com's MCP server by default (`FLIGHT_PROVIDER=kiwi-mcp`); legacy sources
  are refused in production unless `ALLOW_LEGACY_FLIGHT_PROVIDERS=true`.
- 12-hour read path: cache, Postgres, MCP, stale labelled with age, honest "no data".
- Nightly cleanup of past-departure offers with aggregates kept; route graph tables.
- Price-drop detection and delivery code; hub comparison maths; lazy recommendations service.
- Lazy globe: drag makes no flight call (checked once in a browser); a click on a route runs the
  read path once.

Verified at the last check (per the handoff): typecheck, lint, unit tests (3175 passed, 3 skipped),
production build with `FLIGHT_PROVIDER=kiwi-mcp`.

Not done or not verified:

- Kiwi's terms of use: not checked. Owner must check before any public launch.
- `npm run test:e2e` has not been run on this branch.
- `npm run verify` does not pass as a whole: the format step fails on `docs/imagery-options.md`.
- Migrations 0016 to 0019 have not run against a real Postgres.
- Not wired: hub comparison UI, price-drop alerts from a lookup path (so no alert is raised),
  recommendations on a page, the Redis lock, the budget in Redis.
- No optimisation has been measured.

## Your wishes (Dani writes here, plain English)

-

## In progress

- Bugs: search finding nothing (VIE to KZN), missing images in Popular and in Things to do
- Trip builder on explore: change flight or hotel and see the price move; hotel with photos, stars, location
- Prices follow the traveller count everywhere; fuller date calendar
- Globe: more places as you rotate and zoom, never cut by a box, seasonal look by month
- Stays redesign with a hotel map
- Next: destination page (slideshow, interactive things to do, day plan, airport section)
- Paused by the usage limit: health check, midnight cache, pre-loading places, docs update

## Done

- Fixed: a missing email setting no longer breaks pages or sign-up

- "Things to do": up to 30 real places per destination (Wikidata, Wikimedia photos)
- Cookie consent banner: Travelpayouts script loads only after Accept
- Security review: price-calendar abuse limit, push and image-proxy fixes, trip limits
- Default search dates follow today
- Unit and component suite: 2470 passed, 1 skipped (run 2026-11-17)
- Docs: README, architecture, runbook, setup checklist

- End-to-end and accessibility suite: last full run 278 passed, 1 skipped, 1 failed then fixed (run before commit 1638a79)
- 8 real bugs fixed (trip page crash, globe not draggable, results page hydration error, phone layout shift, hidden Globe/Map switch, and others)

- One shared globe for home and explore: a search no longer reloads it
- Phone header with a menu
- Redesign of sign-in pages, trips hub, watches, stays, status, legal, offline and error pages
- Explore: new result rows, flexible-dates strip fixed, partner grid

- Home page below the hero: image cards, mosaic, rail, full-bleed destination moment
- Explore, trip card and destination page redesign (first pass); badges removed
- Globe: arcs follow the globe when dragged, 367 real airports preloaded as dots, smooth curved arcs

- Cache + background price refresh (pages no longer call Aviasales on every visit)
- Live weather (Open-Meteo), "Typical for these dates" beyond the forecast
- Production refuses mock data
- Hotels: trips work without a priced stay; "Find a stay" partner link
- Email via Resend: welcome/verify, password reset, email change only
- In-app notification bell + push for price drops; alert settings on the account page
- Partner offers: Intui, AirHelp, Yesim, GigSky as native cards
- Travelpayouts Drive script (production only)
- Flexible dates strip ("leave 2 days earlier, save €84")
- Price calendar loads every day of the month
- 16 destination images (AI-generated illustrations)
- Globe: NASA satellite surface, blue atmosphere, glowing arcs, new hero layout
- Trip hub core: travel plan, shared expenses (Tricount-style), emergency numbers and contacts

## Planned

- Redesign: stays, watches, account, sign-in pages, trips hub, status/legal/offline/error pages,
  empty and loading states, emails
- Trip hub: invites, edit expenses, currency picker, "Add to my plan" buttons
- More partners: hotels, car rental, tours, insurance, trains, luggage
- Promo codes on partner offers
- Hero video loops, upscaled images
- Final pass: e2e + accessibility suite, security review, docs, runbook

## Waiting on Dani

- Log in to Travelpayouts in the Playwright browser window (account setup agent is blocked)
- Production host env: `FLIGHT_PROVIDER=aviasales`, `AVIASALES_API_TOKEN`, `EMAIL_PROVIDER=resend`,
  `RESEND_API_KEY`, `REDIS_URL`, `DATABASE_URL`; run `npm run db:migrate` (migrations 0008, 0009)
- A priced hotel feed key (LiteAPI recommended) for real "flight + stay" totals

## Not verified yet

- Real email delivery, live Aviasales calendar calls, Postgres migrations 0008/0009
- Most new screens have not been reviewed in a browser
