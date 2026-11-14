# Voyagr — finish plan

Decision of record (2026-11-14): **Voyagr goes live.** Mocks stay for tests and local dev only.
Production must never resolve a mock provider or show "Demo data". All decisions below were made
by the lead without asking; the reason sits beside each one.

Working method: lead plans, designs and reviews; Sonnet sub-agents implement; Haiku explorers
search. Each phase ends with: checks, `progress.md` update, commit.

## Facts established (survey, 2026-11-14)

- Flights: Aviasales Data API `prices_for_dates` only (cached price points). No cache beyond an
  in-process `SearchCache` (5 min) and discovery snapshot (60 min). Every uncached `/` visit hits it.
- Queue: BullMQ driver exists; worker runs `travel-watch.refresh` + `notification.deliver`.
  `PRICE_REFRESH_MINUTES` does not exist yet.
- Stays: `StayProvider` interface with mock only; `/stays` uses it. Trip totals use `HotelProvider`
  (mock only). Weather: Open-Meteo adapter exists, off by default.
- Email: console driver only. Auth flows exist and are tested with a fake provider.
- Persistence: Postgres when `DATABASE_URL` set, else memory. Caches are in-process only.
- **Hotellook (Travelpayouts' hotel product and API) closed 2025-10-20.** Travelpayouts has no
  hotel price API any more, only affiliate links to other programs.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                  | Reason                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Hotels: build a `travelpayouts-stays` adapter that yields **affiliate deep links** (Booking.com / Agoda programs via our partner ID) with price `null`. Add a pluggable priced adapter slot (`STAY_PROVIDERS=...`) so a priced feed works once a key exists.            | The brief assumes a Travelpayouts hotel API; it was retired. We may not invent a nightly price (CLAUDE.md: unknown is `null`).                                              |
| D2  | A stay with no price becomes an `excluded` cost line. Trip total is then "flights only, stay not included". **"All in" copy renders only when every line is known/estimated.**                                                                                            | Honesty rule; the wording is currently unconditional in `map-model.ts:128` and `search-form.tsx:248`.                                                                       |
| D3  | Priced hotel feed candidate: Amadeus Self-Service Hotel Search (free tier) first, Booking.com Demand API when approved. Listed in `SETUP-CHECKLIST.md`; adapter built to the `StayProvider` contract and tested against recorded fixtures.                                | A priced feed needs an account we cannot create.                                                                                                                            |
| D4  | Cache: two tiers. L1 in-process (existing), L2 **Redis** (already required for BullMQ) via a `CacheStore` interface with memory fallback for dev. Entries carry `observedAt`; read path is stale-while-revalidate.                                                        | Pages must not call Aviasales per request; works with no new infra.                                                                                                         |
| D5  | Refresh via worker job `cache.refresh` on `PRICE_REFRESH_MINUTES` (default 30) for recommended destinations, per-origin cheap flights and themed collections; hotels `HOTEL_REFRESH_MINUTES` (default 360). User searches are live but cached by query key for 5 minutes. | Matches brief B. Quota maths documented in architecture.md.                                                                                                                 |
| D6  | Weather: forecast inside the Open-Meteo horizon (≤16 days), climate averages beyond, labelled "typical for these dates". Default provider becomes `open-meteo` outside tests.                                                                                              | Keyless, already implemented.                                                                                                                                               |
| D7  | Flexible dates: ±3 days (`FLEX_DAYS`), derived from Aviasales `calendar` data already cached; savings computed in `src/core/flex-dates.ts`; a day with no data is `unknown`.                                                                                              | Numbers belong in core.                                                                                                                                                     |
| D8  | Email: **Resend** driver (HTTPS API, no SDK, `fetch` behind the provider interface), SMTP fallback via `nodemailer`-free minimal driver is skipped; console remains dev default. Production config **fails at startup** if the driver is `console`.                       | One reliable path beats two half-tested ones. Failing loudly matches existing env policy.                                                                                   |
| D9  | Alerts: new `email` notification channel, `alert_preferences` (home airport, destinations, budget, date window, digest on/off), signed one-click unsubscribe (HMAC token, RFC 8058 `List-Unsubscribe-Post`), weekly digest job. Threshold from `watches/signal.ts`.      | Reuses the watch pipeline.                                                                                                                                                  |
| D10 | Production guard: `assertNoMockInProduction()` in env/registry plus a test that builds the registry with `NODE_ENV=production` and fails if any slot resolves a mock.                                                                                                     | Brief A. Transfers and places currently have only mocks: they need live-or-absent behaviour (see Phase 2).                                                                  |
| D11 | Imagery: Higgsfield MCP for missing destinations and hero visuals, one art direction (defined in `docs/design-direction.md`), AVIF/WebP + posters, labelled "AI-generated" in credits. Wikimedia photos retained.                                                          | Brief E. The Higgsfield MCP server was not connected in this session (only the authentication stub); Phase 6 attempts it and falls back to the existing imagery pipeline. |
| D12 | Motion: CSS scroll-driven animations + View Transitions, no new library; reduced-motion gets a still version of each.                                                                                                                                                     | Smaller, 60fps, brief prefers it.                                                                                                                                           |

## Phases

### 1. Plan

This file, `SETUP-CHECKLIST.md` additions, design audit (`/impeccable audit`, `find-animation-opportunities`) → `docs/design-audit.md`.

### 2. Data foundation (B, A-weather, A-demo removal)

- `src/cache/` `CacheStore` (memory, redis), `readThrough` with SWR + `observedAt`.
- Worker job `cache.refresh` + env `PRICE_REFRESH_MINUTES`, `HOTEL_REFRESH_MINUTES`; refresh targets list in code.
- Pages (`/`, `/explore`, destination) read cache; "updated N min ago" component from `observedAt`.
- Weather wired to destination + dates; climate fallback labelled.
- Production no-mock guard + test; remove user-visible demo paths in production; transfers/places: absent (`excluded`) in production rather than mock.
  Acceptance: `npm run verify`; test fails if prod resolves a mock; no Aviasales call on a warm page load.

### 3. Hotels (A)

- `travelpayouts-stays` deep-link adapter (schema-checked), priced adapter slot + Amadeus adapter skeleton behind a key.
- Cost: `excluded` vs `known`/`estimated`; honest "all in".
  Acceptance: totals tests for stay-known and stay-excluded; copy test.

### 4. Accounts & email (D)

- Resend driver, startup guard, DNS records in `SETUP-CHECKLIST.md`, email templates, flows e2e, alert preferences + routing + digest + unsubscribe.

### 5. Flexible dates (C)

- `src/core/flex-dates.ts`, strip UI on destination selection, freshness shown.

### 6. Design direction + imagery style test (E)

- `docs/design-direction.md`, Higgsfield style test (2–3 frames), judged, refined.

### 7. Design build (E)

- Globe upgrade, scroll storytelling, editorial layouts, redesigned cards, imagery pipeline, email visuals, small fixes (country names, alt text, empty states, skeletons). Visual QA at 1440×900 and 390×844.

### 8. Polish & review (F)

- `impeccable` polish, `review-animations`, security review, e2e, docs (README, architecture, runbook, DESIGN), `npm run verify`, deployment checklist.

## Definition of done

As in the brief; plus the honesty caveat from D1/D2 — real priced hotels need the key listed in
`SETUP-CHECKLIST.md`; until then stays are deep links and the total says what it excludes.

## Additions (owner, 2026-11-14)

- **Owner approval:** imagery art direction approved; lead may do "whatever works best", including
  the globe's size, camera, light and animation. Bigger changes are shown to the owner as they land.
- **D13 — "Up to 30 things to do" per destination.** When a destination/country is selected, show
  a recommended list (sights, food, neighbourhoods, events) grouped by kind, with imagery.
  Places must be **real**: sourced from a free open dataset (Wikidata / Wikivoyage / OpenStreetMap,
  licences recorded), schema-checked like any provider, cached with a long TTL. The model may
  order and describe selected places (guardrails apply) but may not invent a place or a date.
  Events need a dated feed (candidate: Ticketmaster Discovery API free tier, key in
  `WHAT-I-NEED-FROM-YOU.md`); without a key the events group is absent, not made up.
  Higgsfield imagery for a place is labelled "AI-generated illustration".
  Slot: after design slice 2. "30" is a ceiling; fewer real places is fine.
- **Higgsfield:** owner reports unlimited use for two days (to 2026-11-16). Generate hero video
  loops and the destination batch within that window.
