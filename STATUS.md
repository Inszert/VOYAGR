# Voyagr — how things stand

Short on purpose. Details live in `docs/finish-plan.md` and `progress.md`.
Last updated: 2026-11-15.

## Your wishes (Dani writes here, plain English)

-

## In progress

- Next up: "up to 30 things to do" per destination, more partners, cookie consent, hero video, final docs

## Done

- End-to-end and accessibility suite green: 248 passed, 0 failed (desktop and phone)
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
- "Up to 30 things to do" per destination (real places only)
- Trip hub: invites, edit expenses, currency picker, "Add to my plan" buttons
- More partners: hotels, car rental, tours, insurance, trains, luggage
- Promo codes on partner offers
- Cookie consent banner
- Hero video loops, upscaled images
- Final pass: e2e + accessibility suite, security review, docs, runbook

## Waiting on Dani

- Log in to Travelpayouts in the Playwright browser window (account setup agent is blocked)
- Cookie consent: load Drive only after "accept"? (recommended: yes)
- Production host env: `FLIGHT_PROVIDER=aviasales`, `AVIASALES_API_TOKEN`, `EMAIL_PROVIDER=resend`,
  `RESEND_API_KEY`, `REDIS_URL`, `DATABASE_URL`; run `npm run db:migrate` (migrations 0008, 0009)
- A priced hotel feed key (LiteAPI recommended) for real "flight + stay" totals

## Not verified yet

- Real email delivery, live Aviasales calendar calls, Postgres migrations 0008/0009
- Most new screens have not been reviewed in a browser
