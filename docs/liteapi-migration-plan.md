# LiteAPI (Nuitee) migration plan

Written 2026-11-17 by the planner. **This is a plan only; no source code was changed.**
Execution is by Sonnet or Haiku sub-agents, part by part, with the lead reviewing. Opus is not used
for execution; parts that need Opus-level design are flagged, and their design is done by the lead
before an executor starts.

Read first: `CLAUDE.md`, `docs/provider-policy.md` (decision 2026-11-17: no payments, no selling
bookings, prices and links only), `docs/finish-plan.md`, `devmap.html` `DATA`.

## Owner decisions this plan implements (binding)

1. Move everything possible to LiteAPI (Nuitee) in its **sandbox**: hotels (search, rates, photos,
   stars, reviews, location), flights (search and pricing where Nuitee offers it), experiences, and
   reservations only as far as they run **without taking money**. Otherwise the reservation step is
   shown, disabled.
2. Keep on Travelpayouts / existing partners: transfers (Intui), eSIM (Yesim, GigSky), flight
   compensation (AirHelp). Aviasales stays **only as a fallback** when LiteAPI fails.
3. Markup 0 in the sandbox dashboard. Taxes are shown as included or excluded, each on its own.
   Excluded taxes are shown as "Payable at the hotel" and are **never added to a price**.
4. No payment gateway. Reserve and pay buttons may exist, visibly disabled, with the words
   "Payments are not switched on yet".
5. Costs matter: fewest calls per user search, with cache keys and TTLs written down.

## What exists today (read from the code, 2026-11-17)

- `src/providers/stays/liteapi.ts`: key-gated `StayProvider`. It makes 2 calls per search:
  `GET /v3.0/data/hotels` (by lat/lng/radius) and `POST /v3.0/hotels/rates`. It is used **only by
  `/stays`** through `src/providers/stays/registry.ts` (`STAY_PROVIDERS=liteapi`). It has no cache.
  It reads `main_photo` only. It sets `taxesAndFees: null` and ignores the vendor's
  `taxesAndFees[].included` flag. Children are skipped, because the vendor needs ages we do not
  hold. Sandbox rates are labelled provenance `test`.
- Fixtures: `tests/fixtures/providers/liteapi/data-hotels-lisbon.json` and
  `hotels-rates-lisbon.json`, written from the documented shapes, not recorded.
- Trip totals do **not** use LiteAPI. They use `HotelProvider` (`src/providers/registry.ts`,
  `resolveHotelProvider`), which today resolves only to `mock`/`absent`; anything else fails closed.
  The trip orchestrator (`src/search/orchestrator.ts`, `fetchHotels`) calls it once per destination
  per date window. `DEFAULT_SEARCH_LIMITS` (`src/search/types.ts`) implies up to **48 hotel calls
  per trip search**.
- Flights: `FLIGHT_PROVIDER` is `mock | live | aviasales` (`src/lib/env.ts`). The registry builds
  only Aviasales (`resolveFlightProvider`). `src/providers/flights/combined.ts`
  (`CombinedFlightProvider`, the merge with Google Flights) exists, but **no non-test code builds
  it**.
- `/stays` date step: `src/search/stays/calendar.ts` (`exploreStayDates`, `shiftDays: 3`) runs the
  same stay search over 7 windows, which means **7 rates calls on one page view**.
- **Taxes conflict:** `src/core/trip/cost.ts` today turns `hotel.excludedFees` into a
  `hotel_fees` line with confidence **`estimated`**. Estimated lines **are counted** in the total
  (`counted = lines.filter(l => l.confidence !== 'excluded')`). Owner decision 3 forbids that, so
  Part 2 changes it.
- Reserve/pay placeholder: `src/components/search/reserve-placeholder.tsx` (native `disabled`)
  appears on `src/app/destinations/[code]/page.tsx` and `src/components/search/your-trip.tsx`. Its
  copy reads "Booking and payment are not switched on yet". The owner's wording is "Payments are not
  switched on yet".
- Partners: `src/booking/partners.ts` (Intui, AirHelp, Yesim, GigSky), shown by
  `src/components/partners/*` and `src/components/destination/airport-transfers.tsx`.
- Cache: `src/cache/` (`readThrough`, `CacheStore` memory/redis/postgres, `cacheKey(kind, query)`,
  `CACHE_KEY_VERSION = 'v1'`, kinds `discovery | search | weather | flex | places`).

## What was verified on docs.nuitee.com (2026-11-17)

The pages below were actually read. Anything not in this list is **unverified**, and an executor
must read the page before coding against it. Do not invent a field.

| Page                                                             | What it says (as read)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reference/api-pricing-usage-costs.md`                           | **Price index endpoints: $0.05/request** (the owner's brief says $0.02; see owner questions). **Places: $0.01/request.** **Rates, Prebook, Book: free** "when used under the Terms of Service and within a **5000:1 search-to-book ratio**". "All other endpoints" are free, including hotel content endpoints; `data/hotels`, `data/hotel`, `data/reviews` and `min-rates` are not named one by one. **Flight search: EUR 0.005/request**, applied only to searches beyond a **1,500:1** search-to-booking ratio. Flight ticketing fee: 1% of transaction value, minimum EUR 2, maximum EUR 10 per booking. Billed monthly on consumption. Nuitee "may review usage and apply limits or pricing changes" for abusive or non-standard use. **Sandbox billing is not mentioned.** No "public prices $0.02" line was found. |
| `docs/getting-access-to-flights.md`                              | Flights is gated separately but uses the **same API key**. Sandbox is "enabled by default for new accounts" (`sand_…` key). "Sandbox should not be used to validate real-world pricing or availability." Production needs explicit approval, after the Connect account has gone live. The matrix and advanced search return **403 until the account is entitled**. A flights credit line is a contract path.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `docs/getting-access-to-experiences.md`                          | "Experiences access is **enabled on request**" through Request Assistance in the dashboard. Same API key. Sandbox exists but may not be on by default. "Sandbox does not mirror the production Experiences catalogue." Production needs approval. **Booking collects payment through Stripe.** Pricing is not described.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `reference/post_hotels-rates.md` (first 100k of 435k characters) | Request: `hotelIds`, `cityName`/`countryCode`, `latitude`/`longitude`/`radius`, `placeId`, `iataCode`, `checkin`, `checkout`, `currency`, `guestNationality`, `occupancies` (`adults`, optional `children` ages), `limit`, `timeout`, `roomMapping`, `includeHotelData`, `maxRatesPerHotel`. Response: `retailRate.total`, `retailRate.suggestedSellingPrice`, **`retailRate.taxesAndFees[]` with `included` (boolean), `description`, `amount`, `currency`**, `offerRetailRate`, `cancellationPolicies` (`cancelPolicyInfos`, `refundableTag`), `paymentTypes`, `boardType`/`boardName`.                                                                                                                                                                                                                                 |
| `reference/get_data-hotel.md` (first 100k of 170k characters)    | `GET /v3.0/data/hotel?hotelId=…&language=…&timeout=…`. Returns `hotelImages[]` (`url`, `urlHd`, `caption`, `order`, `defaultImage`), `main_photo`, `thumbnail`, `starRating`, `rating`, `reviewCount`, `location.latitude/longitude`, `address`, `city`, `country`, `hotelFacilities`, `facilities[]`, `hotelDescription` (HTML), `markdownDescription`, `normalizedDescription`, `checkinCheckoutTimes`, `policies[]`, and fee facts (`resortFee`, `securityDeposit`, `breakfastPrice` and others).                                                                                                                                                                                                                                                                                                                      |
| `reference/post_rates-prebook.md`                                | Request: `offerId`, `usePaymentSdk` (required), plus `voucherCode`, `addons`, `bedTypeIds`, `includeCreditBalance`, `payment`. Response: `prebookId`, `price`, `commission`, `priceDifferencePercent`, `cancellationChanged`, `boardChanged`, `paymentTypes`, `termsAndConditions`, and `transactionId`/`secretKey` (payment SDK only). **The page states no card requirement for prebook.**                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `reference/post_rates-book.md`                                   | `payment.method` values: `ACC_CREDIT_CARD`, `WALLET`, `CREDIT`, `TRANSACTION_ID` (labelled `TRANSACTION` in another section of the same page), `CREDIT_CARD` and `CREDIT_CARD_SCHEDULED` (both enabled only on request). Verbatim: "In sandbox mode, this [`ACC_CREDIT_CARD`] can be used to simulate a booking without getting charged." In production, `ACC_CREDIT_CARD` charges **the account's own card**, that is, Voyagr pays.                                                                                                                                                                                                                                                                                                                                                                                      |
| `reference/post_flights-rates.md`                                | `POST /v3.0/flights/rates` (also `/flights/rates/stream`). Required: `legs[]` (`origin`, `destination`, `date` no more than 11 months ahead, optional `direction`), `adults`, `currency`. Optional: `children` (+`childrenAges`), `infants` (+`infantAges`), `cabinClass`, `country`, `filters`, `sort`, `margin`, `sessionId`. Response: `data[].journeys[]` with `journeyKey`, `segments[]` (`carrier`, `flight`, `departureTime`, `arrivalTime`, `duration`, `originCode`, `destinationCode`), `legDurations`, `totalDuration`, `connections`, and `offers[]` (`offerId`, `expiration`, `pricing.display.total`, `currency`, `base`, `taxes`, `fees`, `baggage`, `fare`, `terms`). Sandbox and per-request price are not stated on this page.                                                                          |
| `docs/booking-a-room.md`                                         | "Every account has free access to a sandbox key." Step 4 is "Simulate a test payment to book the room."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Index (`docs.nuitee.com/`)                                       | Endpoint pages exist for `get_data-reviews`, `post_hotels-min-rates`, `hotelsratesbatch` (Enterprise), `searchflightsmatrix`, `post_flights-verify`, `post_flights-prebooks`, `post_flights-bookings`, `get_data-flights-airports`, `searchexperiencetours`, `getexperiencetour`, `getexperiencetouravailability`, `prebookexperiencetour`, `createexperiencebooking`, `get_data-places`, and `docs/revenue-management-and-commission.md`. **These pages were not read.**                                                                                                                                                                                                                                                                                                                                                 |

**Not verified:** whether sandbox calls are ever billed (no page says so; the owner reports the
sandbox is free). The second halves of the rates and hotel-details pages. Reviews, min-rates,
experiences and the flights matrix fields. Where markup is set and whether `margin` on
`flights/rates` must be sent as 0. Whether `offerRetailRate` includes the `included: false` taxes
(the expectation is that it does not; prove it with a recorded sandbox response). Rate limits. The
terms on caching and background polling.

## Pricing used in this plan

Two sets of numbers, because they disagree:

- **Owner's brief:** price index $0.02/request, public prices $0.02/request, places $0.01/request.
- **Docs (as read):** price index $0.05/request; places $0.01/request; rates/prebook/book free
  within 5000:1 search-to-book; content endpoints free; flight search EUR 0.005/request beyond
  1,500:1.

**The plan calls no price-index endpoint and no places endpoint.** Voyagr already has coordinates
for every destination (`public/geo/label-places.v1.json`, `src/discovery/`), so `data/places` is
never needed. That leaves rates, content and flight search. For a **worst case** the tables below
price every rates/min-rates call at the owner's "$0.02 public prices" figure. The **docs case** is
$0 within ratio. Voyagr makes **zero bookings**, so any ratio is breached from the first search.
That is owner question Q1, and it is the main cost risk in this plan.

## Parts

Twelve parts. Order: 11 → 10 → 1 → 3 → 2 → 7 → 6 → 8 → 4 → 9 → 5 → 12.

---

### Part 1. Hotels search and the stays page

- **Goal:** `/stays` lists LiteAPI hotels with real sandbox rates. Included and excluded taxes are
  shown separately, and nothing excluded is added to a price.
- **What changes:**
  - `src/providers/schema.ts`: extend `liteapiRatesRowSchema` so `retailRate.taxesAndFees` is
    parsed (`included`, `amount`, `currency`, `description`). Map a missing list to explicit
    `null`, never to `[]` meaning "no taxes".
  - `src/providers/stays/liteapi.ts`:
    - Map `included: true` amounts to `StayRate.taxesAndFees`, as information that is part of the
      total.
    - Map `included: false` amounts to a new field, `StayRate.payableAtProperty: Money | null`,
      summed in one currency with `Money`. Mixed currencies give `null` plus a warning, never a
      conversion here.
    - Map `paymentTypes` to `paymentTiming` only where the value is documented; otherwise keep
      `null`.
    - Map `cancellationPolicies.cancelPolicyInfos` to `cancellation.deadline`, once the field
      shape has been read on the page.
  - `src/core/stay/types.ts`: add `payableAtProperty: Money | null` to `StayRate`, documented as
    "never part of `total`". Update `src/providers/stays/mock.ts`, `travelpayouts-links.ts` and
    `contract.test.ts` to state it (`null`).
  - `src/components/stays/stay-property.tsx`, `rate-comparison.tsx`, `stay-card.tsx`,
    `stay-rows.ts`:
    - one line "Includes taxes and fees X" when `taxesAndFees` is known;
    - one line "Payable at the hotel: X" when `payableAtProperty` is known. It is never added to
      the price shown;
    - "Taxes not stated" when both are `null`.
  - `src/core/stay/comparison.ts`: rates compare on `total` only. A rate with a
    `payableAtProperty` gets a "plus payable at the hotel" note in the comparison, never a summed
    number.
  - Record one real sandbox response for Lisbon (rates and hotels) into
    `tests/fixtures/providers/liteapi/` with the key stripped, replacing the hand-written fixtures.
    Do this once, by hand, with the owner's sandbox key. Do not read `.env`; the owner runs the
    recorder (`src/providers/http/cassette.ts`).
  - Wrap both calls in the cache (Part 10).
  - `/stays` calendar: switch `exploreStayDates` for LiteAPI to `POST /hotels/min-rates`, one call
    per window, once its fields are verified. Otherwise keep `rates` but cap at the 7 windows
    already set.
- **Owner model:** Sonnet. The `StayRate.payableAtProperty` type addition goes to the lead for
  review before merge, because it is a data-model change.
- **Dependencies:** Part 11 (env), Part 10 (cache store kinds).
- **Acceptance:**
  - Unit (`liteapi.test.ts`): a rate with `included:false` 12.40 EUR gives `payableAtProperty`
    12.40 EUR and a `total` that is unchanged. An `included:true` amount gives `taxesAndFees`. A
    missing tax list gives both `null`. Mixed currency gives `null` and a warning. A sandbox
    envelope gives provenance `test`.
  - Component tests: by role and text, "Payable at the hotel" is present and not part of the
    headline price, and "Taxes not stated" appears when unknown.
  - Browser (owner sandbox key, `STAY_PROVIDERS=liteapi`): `/stays?…Lisbon` shows hotels with
    prices, a hotel with excluded tax shows the separate line, and there are no console errors.
    Screenshots at 390, 768 and 1440.
- **Calls per user action:**

  | Action                               | Cold calls                                                        | Warm (cached) | Production worst case (at $0.02)       | Docs case                                |
  | ------------------------------------ | ----------------------------------------------------------------- | ------------- | -------------------------------------- | ---------------------------------------- |
  | Open `/stays` dates step (7 windows) | 1 `data/hotels` + 7 `min-rates` (or `rates`)                      | 0 within TTL  | 7 × $0.02 = **$0.14**                  | $0 (content and rates free within ratio) |
  | Confirm dates (results list)         | 1 `rates` (the selected window; often already cached by calendar) | 0             | $0.02                                  | $0                                       |
  | Change one filter or sort            | 0 (client-side or same key)                                       | 0             | $0                                     | $0                                       |
  | Sandbox                              | same counts                                                       | same          | billing unverified; owner reports free |                                          |

- **Risks and owner questions:** Sandbox prices are not real (Nuitee's own words, flights and
  experiences pages). Showing them on the public site is the Q2 question. Guest nationality is
  hard-coded `US` (`DEFAULT_GUEST_NATIONALITY`), and it can change the price (Q6).

---

### Part 2. Hotel prices in trip totals

- **Goal:** Trip candidates on explore and on the destination page carry a LiteAPI hotel price, and
  "Payable at the hotel" is an `excluded` line that is never in the total.
- **What changes:**
  - `src/lib/env.ts`: `HOTEL_PROVIDER` accepts `liteapi`. It fails closed at startup without
    `LITEAPI_API_KEY`, the same pattern as Aviasales.
  - `src/providers/hotels/liteapi.ts` (new): a `HotelProvider` adapter that reuses the HTTP client,
    schemas and mapping from `src/providers/stays/liteapi.ts`. Extract the shared parts to
    `src/providers/liteapi/client.ts` and `src/providers/liteapi/map.ts` rather than copying them.
    It yields the cheapest rate per hotel as `HotelOffer`, with
    `excludedFees = payableAtProperty`.
  - `src/providers/registry.ts`: `resolveHotelProvider` builds it.
  - **`src/core/trip/cost.ts`:** the `hotel_fees` line changes from `confidence: 'estimated'` to
    `confidence: 'excluded'`, label "Payable at the hotel", conditions "Paid to the hotel, not
    included in this price". This is the owner's decision 3 and it changes the current behaviour.
    Update `cost.test.ts` and `constraints.ts` (line ~486, which reads `excludedFees`) to match.
    State in the PR that these existing assertions changed **because of an owner decision**, not to
    make the suite pass.
  - `src/components/search/cost-breakdown.tsx`: the excluded line reads "Payable at the hotel: X"
    under the total, and the "All in" wording stays off when an excluded line exists (D2 already
    does this; confirm).
  - Call budget: `src/search/orchestrator.ts` `fetchHotels` is called per destination per date
    window, up to 48 per search. Price hotels only for the cheapest **3** flight windows per
    destination (6 × 3 = 18). Use `min-rates` with up to `maxHotelOffersPerDestination × 3` hotel
    ids from the cached `data/hotels` list. This is a limits change, not a rewrite; see Part 10.
- **Owner model:** Sonnet for the adapter and the cost line. **Opus-level design flag:** the lead
  decides how hotel pricing is restricted to the top flight windows without changing ranking
  semantics. Scoring and search are deterministic core, and CLAUDE.md forbids rewriting them.
- **Dependencies:** Parts 1, 10, 11.
- **Acceptance:**
  - `cost.test.ts`: a hotel with `excludedFees` 20 EUR gives total = flights + hotel, an
    `excluded` line of 20 EUR labelled "Payable at the hotel", and `excluded` contains it.
  - Registry test: `HOTEL_PROVIDER=liteapi` without a key throws `CONFIGURATION_ERROR` with zero
    fetches (`fetch` spy).
  - Search test with a fixture adapter: the hotel-call count is ≤ 18 at default limits.
  - Browser: explore Vienna to Lisbon shows a trip total with a hotel line, the excluded line sits
    below the total, and swapping the hotel moves the total.
- **Calls per user action:**

  | Action                                           | Cold                                          | Warm | Production worst case ($0.02) | Docs case       |
  | ------------------------------------------------ | --------------------------------------------- | ---- | ----------------------------- | --------------- |
  | One trip search (6 destinations, today's limits) | 6 `data/hotels` + 48 rates = 54               | 0    | 48 × $0.02 = **$0.96**        | $0 within ratio |
  | Same, after the top-3-windows cap                | 6 `data/hotels` (cached 7 d) + 18 `min-rates` | 0    | 18 × $0.02 = **$0.36**        | $0              |
  | Swap hotel on a built trip                       | 0 (swap options are from the same answer)     | 0    | $0                            | $0              |

- **Risks and owner questions:** Q1 (look-to-book with zero bookings). Moving "payable at the
  hotel" out of the total lowers totals the user sees today for mock hotels. That is intended.

---

### Part 3. Hotel photos, stars, reviews, location

- **Goal:** A hotel's page and its trip-builder card show the vendor's photo gallery, stars, guest
  rating, reviews and map point.
- **What changes:**
  - `src/providers/liteapi/content.ts` (new): `getHotelDetails(hotelId)` calls
    `GET /v3.0/data/hotel` and `getHotelReviews(hotelId)` calls `GET /v3.0/data/reviews`. **Read
    the reviews page first; its fields are unverified.** Schema-check both in
    `src/providers/schema.ts`. Keep only `https` images, ordered by `order`, `defaultImage` first,
    using `urlHd` when present. Map `starRating` to `starRating`, `rating`/`reviewCount` to
    `guestRating` (as today), `location` to `position`, `normalizedDescription` (plain text only,
    never the HTML) to `description`, and `hotelFacilities` to `amenities`.
  - Review text is vendor content: show it as quoted, attributed text. The model may not rewrite
    it, and no number from it is shown that the vendor did not state.
  - `src/components/stays/stay-property.tsx`: a gallery built from existing primitives, with alt
    text from the `caption` or "Photo of <hotel name>". Image URLs go through the existing image
    proxy pattern if the CSP needs it. Check `src/proxy.ts` `img-src`, then add the LiteAPI image
    host, or proxy through our origin as Wikimedia is.
  - `src/components/search/your-trip.tsx`: the hotel row shows the `main_photo` that is already
    returned by `data/hotels`. This needs no extra call. It clears the devmap in-progress note
    "Hotel photos are blocked".
- **Owner model:** Sonnet (CSP or proxy change: get a security-engineer review).
- **Dependencies:** Parts 1, 10, 11.
- **Acceptance:**
  - Unit: http images dropped, the `defaultImage` order holds, missing `starRating` gives `null`,
    and an HTML description is never rendered.
  - Component: the gallery has accessible names. axe passes in the e2e suite (desktop and phone).
  - Browser: a Lisbon hotel shows 5 or more photos, stars and a rating. Images load without CSP
    console errors.
- **Calls per user action:**

  | Action                  | Cold                                | Warm (7 d content cache) | Production ($)                                                |
  | ----------------------- | ----------------------------------- | ------------------------ | ------------------------------------------------------------- |
  | Open a hotel page       | 1 `data/hotel` + 1 `data/reviews`   | 0                        | $0 (content endpoints free per docs; unverified per endpoint) |
  | Trip-builder hotel card | 0 (uses `main_photo` from the list) | 0                        | $0                                                            |

- **Risks:** The licence for reusing hotel images is not read. The images are the vendor's, under
  LiteAPI's terms (Q7).

---

### Part 4. Flights search

- **Goal:** Flight offers come from `POST /v3.0/flights/rates` in the sandbox, with Aviasales used
  only when LiteAPI fails (Part 9).
- **What changes:**
  - Precondition (owner): confirm in the dashboard that Flights answers on the sandbox key. Docs
    say sandbox flights are on by default; the matrix returns 403 until entitled.
  - `src/providers/flights/liteapi.ts` (new): a `FlightProvider`.
    - One request per date window: `legs` = outbound plus inbound (`direction`), `adults`,
      `currency`, `cabinClass: 'ECONOMY'`. Children only with their ages; without ages, skip, as
      for stays.
    - Map journeys and segments to `FlightLeg`. Carry `departureTime`/`arrivalTime` as
      `LocalDateTime` only after reading the documented format. Durations come from the vendor
      (`duration`, `legDurations`), never from subtracting times.
    - Price = `pricing.display.total` as `Money`. `base`, `taxes` and `fees` are kept as the
      vendor states them.
    - Provenance `test` in the sandbox, decided by the key's `sand_` prefix or a response flag
      once one is verified. Never `live` in the sandbox.
    - Do not send `margin`, or send `0` if the docs require it (Q3).
  - `src/providers/schema.ts`: flight schemas. A malformed offer is dropped and reported.
  - `src/lib/env.ts`: `FLIGHT_PROVIDER` gains `liteapi`. It fails closed without the key.
  - `src/providers/registry.ts`: `resolveFlightProvider` builds LiteAPI wrapped with the fallback
    (Part 9).
  - `src/providers/rate.ts`: declare `rateLimitPerMinute` once known. Until then use a
    conservative value (for example 30) in a documented constant, so the `LimiterPool` bounds the
    fan-out.
  - The price calendar and flex-dates strip (`src/core/flex-dates.ts`,
    `src/components/search/price-calendar.tsx`) depend on Aviasales' monthly `calendar` data.
    LiteAPI has a matrix endpoint (`searchflightsmatrix`) that is entitled-only and unread. **Keep
    the calendar on Aviasales**, labelled indicative as today, until the matrix is entitled and
    read.
- **Owner model:** Sonnet. **Opus-level design flag:** the fan-out. Aviasales answers a month per
  call; LiteAPI answers one date pair per call. Today's limits (4 origins × 6 destinations × 8
  windows) would be **192 calls** per search. The lead must set a LiteAPI-specific budget before an
  executor starts, for example exact dates first, the 3 cheapest windows from the Aviasales
  calendar, and 1 origin unless the user chose more.
- **Dependencies:** Parts 9, 10, 11; owner confirms flights on the sandbox key.
- **Acceptance:**
  - Unit with a recorded sandbox cassette: a round trip maps to two legs with the vendor's
    durations, the total is `Money` in the requested currency, provenance is `test`, and a
    malformed offer is dropped and reported.
  - Registry test: no key means `CONFIGURATION_ERROR` and zero fetches.
  - Budget test: a default search makes ≤ the call ceiling the lead sets.
  - Browser: explore Vienna to Lisbon on exact dates shows LiteAPI flights. Aviasales still drives
    the calendar.
- **Calls per user action:**

  | Action                                     | Cold                  | Warm (10 min) | Production, beyond 1,500:1 (EUR 0.005) |
  | ------------------------------------------ | --------------------- | ------------- | -------------------------------------- |
  | Exact-date search, 1 origin, 1 destination | 1                     | 0             | EUR 0.005                              |
  | Explore, today's limits, uncapped          | up to 192             | 0             | up to **EUR 0.96**                     |
  | Explore with the proposed cap (1 × 6 × 3)  | 18                    | 0             | **EUR 0.09**                           |
  | Calendar / flex strip                      | 0 LiteAPI (Aviasales) | —             | $0 LiteAPI                             |

- **Risks and owner questions:** Q2 (sandbox fares are not real prices). Q4 (production flights
  need Go-live and approval). With zero bookings, every search is beyond 1,500:1, so it is billed.

---

### Part 5. Experiences

- **Goal:** Destination "things to do" can show bookable tours from LiteAPI Experiences beside the
  Wikidata places, with prices, and with booking disabled.
- **What changes:**
  - Precondition (owner): open a Request Assistance ticket to enable Experiences on the **sandbox**
    key. The docs say it is "enabled on request".
  - Read `reference/searchexperiencetours.md`, `getexperiencetour.md` and
    `getexperiencetouravailability.md` **before** coding. None were read for this plan.
  - `src/providers/experiences/liteapi.ts` (new) plus a new `ExperienceProvider` interface in
    `src/providers/types.ts`, kind `experiences`, behind `EXPERIENCE_PROVIDER=liteapi|absent`. Use
    search and details only. **No prebook and no booking:** the docs say booking collects payment
    through Stripe.
  - `src/components/search/what-to-do.tsx` and the destination things-to-do section: a "Tours"
    group, with the price as the vendor states it ("from X" only if the vendor says "from"), a
    photo and a disabled "Book this tour" button using the Part 7 wording.
  - Wikidata places stay. Experiences add to them and never replace them.
- **Owner model:** Sonnet. **Opus-level design flag:** a new provider kind and interface. The lead
  writes the interface after the endpoint pages are read.
- **Dependencies:** Parts 7, 10, 11; owner enables Experiences.
- **Acceptance:**
  - Unit with a recorded sandbox response: tours map with `Money`, unknown fields stay `null`, and
    there is no booking call path (a test asserts the adapter has no prebook or book method).
  - Browser: the Lisbon destination shows a Tours group with disabled booking and no console
    errors.
- **Calls per user action:**

  | Action                | Cold                                            | Warm (6 h) | Production                      |
  | --------------------- | ----------------------------------------------- | ---------- | ------------------------------- |
  | Open destination page | 1 search                                        | 0          | **not stated in the docs** (Q5) |
  | Open one tour         | 1 details (+1 availability if dates are chosen) | 0          | not stated                      |

- **Risks:** pricing unknown; the sandbox catalogue differs from production; production needs
  approval.

---

### Part 6. Reservations UI as a disabled step

- **Goal:** The person sees the whole reservation flow (choose room, check price, guest details,
  pay), with every step that takes money visibly disabled.
- **What changes:**
  - `src/components/stays/stay-property.tsx` and `src/components/search/your-trip.tsx`: a
    "Reserve" step list built from the existing primitives. The steps are: 1 choose a room
    (enabled), 2 check the price (see below), 3 guest details (disabled), 4 pay (disabled, Part 7).
    Each disabled step says so in words, not only in colour.
  - **Price check via prebook:** prebook does not state a card requirement, and its response
    carries `priceDifferencePercent`, `cancellationChanged` and `boardChanged`. It could power an
    honest "Check this price is still right" button. But it "creates a checkout session", and the
    docs do not say whether it holds inventory or has side effects. **Do not ship it user-facing
    until Q8 is answered.** Until then step 2 is disabled too, with the words "Price check is not
    switched on yet".
  - **Book is never called from the app.** `/rates/book` needs a payment method. The only one that
    avoids collecting money from the guest, `ACC_CREDIT_CARD`, charges Voyagr's own card in
    production, which violates the 2026-11-17 decision. Optionally, an internal script
    `scripts/liteapi-sandbox-booking.mjs` may run prebook then book with `ACC_CREDIT_CARD` **only
    when the key starts with `sand_`** (it refuses otherwise), to prove the flow for a future
    decision. It is not reachable from any route, and only if the owner says yes (Q8).
- **Owner model:** Sonnet for the UI. The script, if approved, is Sonnet plus a security-engineer
  review. **Opus-level design flag:** whether prebook becomes user-facing.
- **Dependencies:** Parts 1, 7.
- **Acceptance:**
  - Component tests: the disabled steps have `disabled`/`aria-disabled` and visible text, there is
    no form submit, and a grep test proves no `rates/book` or `rates/prebook` URL in `src/app` or
    `src/components`.
  - Browser: the steps are visible at 390 px without clipping, and focus order is sensible.
- **Calls per user action:** 0 while disabled. If prebook is enabled later: 1 prebook per click,
  free within ratio per docs.
- **Risks:** a disabled flow that looks enabled. Mitigation: words, not only styling.

---

### Part 7. Payment button placeholder

- **Goal:** Every reserve and pay button is disabled and says "Payments are not switched on yet".
- **What changes:**
  - `src/components/search/reserve-placeholder.tsx`: keep the native `disabled`. The helper text
    becomes "Payments are not switched on yet. You can see the price and book on the hotel's own
    page." The second button label becomes "Pay: payments are not switched on yet".
  - `reserve-placeholder.test.tsx`: assert the new text and the disabled state by role.
  - Reuse the component in Parts 5 and 6, without copying it.
- **Owner model:** Haiku.
- **Dependencies:** none.
- **Acceptance:** the component test passes. In the browser on the destination page and in Your
  trip, the buttons cannot be activated by click or keyboard. axe is clean.
- **Calls:** 0.
- **Risks:** none.

---

### Part 8. Transfers, eSIM, AirHelp unchanged

- **Goal:** Intui, Yesim, GigSky and AirHelp keep working exactly as they do now.
- **What changes:** nothing in `src/booking/partners.ts`, `src/components/partners/*` or
  `src/components/destination/airport-transfers.tsx`. Add a regression assertion to
  `src/booking/partners.test.ts` that these four ids are registered with `rel="sponsored"`
  disclosure, if it is not there already. `TRANSFER_PROVIDER` stays `mock`/`absent`; LiteAPI does
  not replace transfers.
- **Owner model:** Haiku.
- **Dependencies:** none. Run it after Parts 2 and 4 to prove nothing moved.
- **Acceptance:** `partners.test.ts` and `partners.test.tsx` pass. In the browser, the destination
  page still shows the four partner cards with working links.
- **Calls:** 0 LiteAPI.
- **Risks:** none.

---

### Part 9. Aviasales as fallback only

- **Goal:** Aviasales answers a flight search only when LiteAPI fails, and the result says it is
  indicative.
- **What changes:**
  - `src/providers/flights/fallback.ts` (new): `FallbackFlightProvider(primary, secondary)`. It
    calls the primary. On `err` (`PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_ERROR`, 403) it calls the secondary and records a `SearchIssue` "Live fares unavailable; showing
    indicative prices". An **empty** primary result is not a failure by default (Q9). Each
    provider keeps its own limiter (`LimiterPool` keyed on provider id).
  - `src/providers/registry.ts`: when `FLIGHT_PROVIDER=liteapi` and `AVIASALES_API_TOKEN` is set,
    build the fallback. Without the Aviasales token, LiteAPI runs alone.
  - Aviasales stays the source for the price calendar and flex strip (Part 4) and for the cache
    warm-up (`src/cache/targets.ts`). That counts as "fallback for data LiteAPI cannot give"
    (Q9).
  - `CombinedFlightProvider` (Google Flights merge) is unchanged and remains unbuilt.
- **Owner model:** Sonnet.
- **Dependencies:** Part 4.
- **Acceptance:**
  - Unit: primary ok means the secondary is never called (spy). Primary err means the secondary
    is called once and the issue is recorded. Primary empty means the secondary is not called (or
    is, per Q9).
  - Browser: with an invalid LiteAPI key on a dev build, the search shows Aviasales fares and the
    issue line.
- **Calls:** LiteAPI as Part 4. Aviasales 0 when LiteAPI is healthy, and up to today's Aviasales
  count on failure.
- **Risks:** Aviasales' terms on background polling are still open (provider policy).

---

### Part 10. Caching and the call budget

- **Goal:** One user search makes the fewest LiteAPI calls. Every call is cached by a stable key
  with an `observedAt`, and identical concurrent requests share one call.
- **What changes:**
  - `src/cache/key.ts`: add `CacheKind` values `liteapi-hotels`, `liteapi-hotel`,
    `liteapi-reviews`, `liteapi-rates`, `liteapi-minrates`, `liteapi-flights`,
    `liteapi-experiences`. Keys go through `cacheKey(kind, query)` with a **normalised** query:
    sorted hotel ids, coordinates rounded to 3 decimals, uppercase currency.
  - Wrap each LiteAPI call in `readThrough` (SWR). For rates, flights and experiences add an
    in-process single-flight map, so 10 concurrent identical searches make 1 call.
  - Keys and TTLs:

    | Kind                  | Key (normalised fields)                                                                      | TTL                                                          | Why                                        |
    | --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
    | `liteapi-hotels`      | lat(3dp), lng(3dp), radius m, limit                                                          | 7 days                                                       | Hotel lists change slowly; content is free |
    | `liteapi-hotel`       | hotelId, language                                                                            | 7 days                                                       | Photos, stars, description                 |
    | `liteapi-reviews`     | hotelId, language                                                                            | 1 day                                                        | Reviews accrue slowly                      |
    | `liteapi-rates`       | sha256(sorted hotelIds), checkin, checkout, occupancy signature, currency, guestNationality  | **15 min** (SWR up to 30 min shown with "Updated N min ago") | Prices move; `offerId`s expire             |
    | `liteapi-minrates`    | same as rates                                                                                | 30 min                                                       | Used only for trip totals and the calendar |
    | `liteapi-flights`     | legs (origin, destination, date, direction), adults, children ages, infants, cabin, currency | **10 min**                                                   | Fares move; offers carry `expiration`      |
    | `liteapi-experiences` | lat/lng or destination code, date (if any), currency                                         | 6 h                                                          | Catalogue is stable                        |

    A cached `offerId` is never sent to prebook. Prebook (if ever enabled) re-quotes.

  - `src/search/types.ts`: a LiteAPI search profile. Price hotels for the cheapest 3 flight
    windows per destination; flights capped at 1 origin × 6 destinations × 3 windows unless the
    user picks more. `maxProviderCalls` is set so reaching it degrades and says so (existing
    behaviour).
  - `/stays` calendar shares keys with the results step, so confirming the selected window costs 0
    more calls.
  - Background refresh (`src/cache/refresh.ts`, `targets.ts`): **no LiteAPI targets** until the
    terms allow polling (provider policy). Travel Watch stays off for LiteAPI.
  - `src/providers/observability.ts`: count LiteAPI calls by endpoint per request id, and log the
    count (never the key) so the real per-search number can be read in production logs.
  - `docs/architecture.md` "Caching and refresh": add the table and the arithmetic.
- **Owner model:** Sonnet. **Opus-level design flag:** the search profile limits, shared with
  Parts 2 and 4.
- **Dependencies:** none (it goes before 1 to 5).
- **Acceptance:**
  - Unit: two identical rates queries make 1 fetch; reordered hotel ids give the same key;
    different nationality or occupancy gives a different key; an expired entry serves stale and
    refreshes once.
  - Budget tests: a default trip search's LiteAPI call count is ≤ the documented ceiling.
  - Browser: reloading the same `/stays` and explore URL within the TTL makes 0 LiteAPI calls
    (read from the server log counter).
- **Per-search totals (cold, all parts, proposed caps):**

  | User action                    | LiteAPI calls (cold)                            | Warm | Prod worst case                                    | Prod docs case                  |
  | ------------------------------ | ----------------------------------------------- | ---- | -------------------------------------------------- | ------------------------------- |
  | Explore search, 6 destinations | 6 hotels lists + 18 min-rates + 18 flights = 42 | 0    | 18 × $0.02 + 18 × EUR 0.005 ≈ **$0.36 + EUR 0.09** | EUR 0.09 (flights beyond ratio) |
  | `/stays` full flow             | 1 + 7 + 0 = 8                                   | 0    | $0.14                                              | $0                              |
  | Hotel page                     | 2                                               | 0    | $0                                                 | $0                              |
  | Destination page (with tours)  | 1 + 6 min-rates (trip card) + 1 tours           | 0    | $0.12 + tours unknown                              | tours unknown                   |

  Sandbox: the same call counts. Billing is not stated in the docs; the owner reports free.

- **Risks:** a 15-minute rate cache shows prices up to 15 to 30 minutes old. This is acceptable
  with the "Updated N min ago" line, which already exists.

---

### Part 10 addendum. Owner decision 2026-11-17: our own database, refreshed on a schedule

This supersedes the per-visitor live caching above. Visitors never make a LiteAPI call. Their
pages and searches read our own snapshot tables only.

- **Scheduled refresh.** A worker job refreshes the launch destinations on a schedule. Default:
  **3 times a day**, set in config. Hourly is possible but multiplies the cost by 8.
- **Launch scope (default).** The six explore destinations from Part 1, each with its three
  flex windows.
- **Cost arithmetic.** Calls per day = destinations × windows × refreshes per day.
  Six × three × three = **54 rates calls a day**. At $0.02 per call (worst case) that is
  **$1.08 a day, about $32 a month**. Flights at EUR 0.005 beyond the ratio: 54 calls a day, about
  EUR 0.27 a day, about EUR 8 a month. Hotel content and photos refresh weekly (free per the docs).
  Each extra destination adds 9 rates calls a day at this schedule. Each extra daily refresh adds
  18 calls a day for six destinations.
- **Tables (proposed; an Opus design call decides the final shape).**
  - `liteapi_hotels`: hotel id, content JSON, `fetched_at`, `expires_at`.
  - `liteapi_rates_snapshot`: destination, check-in, check-out, occupancy signature, currency,
    rates JSON, `observed_at`, `expires_at`.
  - `liteapi_refresh_runs`: run id, job, started and finished times, calls made, status. This is
    the audit trail and the real call counter.
  - Recommended: a separate table set, not the generic `cache_entries`, so expiry and the call
    counter stay clean. Reuse the existing queue and worker (`src/cache/refresh.ts`,
    `targets.ts`) for the schedule.
- **What a visitor sees.** `observedAt` on every price, with "Updated N hours ago". Older than
  twice the interval: "Prices last checked N hours ago". No snapshot for a destination or window:
  no price and a plain line, "Hotel prices are not loaded for these dates yet." A visitor request
  never falls back to a live LiteAPI call. The Aviasales fallback (Part 9) still applies, because
  Aviasales is already polled by the existing system.
- **Prebook stays live**, one call per click, only for the "check this price" step (Q8 answer).
  Its result is never stored as a price. Set a per-visitor limit in Part 10 (value to choose).
- **Blocker: polling terms.** The plan's rule "no LiteAPI targets until the terms allow polling"
  is still in force. The scheduled refresh ships behind a flag (`LITEAPI_SNAPSHOT_ENABLED`,
  default off) until Nuitee confirms in writing that periodic refresh for display is allowed.
  This is new owner question Q10.
- **Sandbox.** The same job runs in sandbox with the same call counts, so the cost can be
  measured there before any production key.

### Part 10 design (Opus, 2026-11-17)

Binding for the build. Where this section and Parts 1 to 9 disagree, this section wins for the
snapshot.

**Storage** (`src/db/migrations/0013_liteapi_snapshot.sql`, additive, all SQL parameterised):

- `liteapi_hotels`: `hotel_id` PK, `destination_code`, `content` JSONB (the mapped stay property),
  `fetched_at`, `expires_at` (fetched plus 7 days). Index on (`destination_code`, `expires_at`).
- `liteapi_rates_snapshot`: `destination_code`, `check_in`, `check_out`, `occupancy_sig` (for
  example `a2-c0-r1`), `currency` CHAR(3), `guest_nationality` CHAR(2), `environment` CHECK IN
  ('sandbox','production'), `schema_version` INT, `rates` JSONB (the validated mapped
  `{ property, rates[] }[]`, Money as `{ amount, currency }`), `observed_at`, `expires_at`,
  `run_id`. Primary key: all six key columns.
- `liteapi_refresh_runs`: `run_id` PK, `job`, `destination_code`, `check_in`, `check_out`,
  `environment`, `started_at`, `finished_at`, `calls_made`, `status` CHECK IN ('running','ok',
  'failed','skipped_cap','disabled'), `error_code` (an `ErrorCode` only, never a message).
  Indexes on (`destination_code`, `check_in`, `check_out`, `started_at` DESC) and (`started_at`).
- Rates are one JSONB column, not normalised: a page reads a whole destination-and-window answer,
  nothing queries inside a rate, and `StayRate` is still changing. `schema_version` lets the reader
  reject an old row.

**Repository** (`src/db/repository.ts`, memory and Postgres, clock injected as in
`PostgresCacheStore`): `getRates(key)` and `getHotels(destination)` return unexpired rows only;
`putRates` upserts then deletes expired rows; `putHotels`; `startRun`; `finishRun`; `latestRun`;
`callsSince(since)` for the daily ceiling.

**Refresh job** (`src/liteapi-snapshot/job.ts`, `schedule.ts`):

- Job name `liteapi.snapshot.refresh`, payload `{ destination, checkIn, checkOut }`, one run per
  destination and window, added to `JOB_NAMES`.
- Schedule: `LITEAPI_SNAPSHOT_REFRESHES_PER_DAY` (integer 1 to 24, default 3). Rounds start at
  fixed UTC slots (00:00, 08:00, 16:00 by default). A 30-second check starts a round when the slot
  changes. After a restart, a round starts only if `latestRun()` shows none in the current slot.
- Targets (`src/liteapi-snapshot/targets.ts`, pure, takes `today`): `LAUNCH_DESTINATIONS` (a single
  constant, **owner to confirm**; placeholder LIS, BCN, PRG, BUD, ROM, VIE), three windows at
  today+30, +33 and +36 with 4 nights each, 2 adults, 1 room, EUR, nationality from
  `LITEAPI_GUEST_NATIONALITY` or `US`.
- One run: (1) hotel content, one `data/hotels` call only if missing or expired; (2) one
  `hotels/rates` call with the stored hotel ids; (3) map, then upsert the snapshot.
- `liteapi.ts` exposes `listHotels()` and `fetchRates()`; `searchStays` composes them. Behaviour
  is unchanged.
- Concurrency: a process-level `LimiterPool` keyed `liteapi`. Only the two leaf calls are wrapped.
- Caps: at most 2 calls per run (reaching the cap gives `skipped_cap`, no call). Daily ceiling =
  destinations × windows × refreshes (plus destinations on a content day), checked with
  `callsSince(start of UTC day)`; above it the run is refused and logged.
- Provider failure: the run is finished `failed` with its `error_code`; nothing is written, so the
  previous row stays. The log carries `runId`, destination, window, code and `callsMade`, never the
  key. The job does not throw, so the queue does not retry it and spend more calls.
- Flag `LITEAPI_SNAPSHOT_ENABLED` (default false) stops it in two places: the worker does not start
  the scheduler, and the handler records `disabled` and returns before building the client. A
  missing key behaves the same way.
- Sandbox runs the same code with the same counts; `environment` comes from `liteApiEnvironment`.

**Read path (zero LiteAPI calls):**

- `src/providers/stays/snapshot.ts`: `SnapshotStayProvider`, metadata id `liteapi`. The stays
  registry builds it for `liteapi`, not the live provider. `fanout.ts` and `exploreStayDates` do not
  change. A missing row returns `ok([])`. Rows are re-validated with zod and Money is rebuilt.
- `src/liteapi-snapshot/read.ts`: `snapshotStatus(query, now)` returns `{ state, observedAt, ageHours,
testPrices }` for `load-stays.ts`. States, using `freshnessOf` and `ageOf`:

  | State   | When                                                             | Wording                                                       |
  | ------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
  | fresh   | age ≤ 2 × interval (16 h)                                        | "Updated N hours ago"                                         |
  | aging   | age > 2 × interval                                               | "Prices last checked N hours ago"                             |
  | missing | no row, a non-launch window or occupancy, or `expires_at` passed | "Hotel prices are not loaded for these dates yet." (no price) |
  | unknown | `observedAt` in the future                                       | price shown, no age claim                                     |

  `expires_at` is observed plus 3 × interval (24 h).

- Part 2's LiteAPI hotel provider reads the snapshot too, never the live client.
- Aviasales fallback (Q9, for flights in Part 4): on a LiteAPI error or an empty answer, the visitor
  path reads only the existing cache store, never `loadAndStore` and never a live call. No cache
  entry means the flight is unpriced and the page shows a search issue.
- Hotels have no Aviasales fallback. An empty hotel snapshot shows the "not loaded" line; the
  Travelpayouts links still show.

**Money and provenance:** integer minor units throughout. `observedAt` on every rate is the instant
of the rates call, and the row's `observed_at` is the same instant. If `environment = 'sandbox'` or
any rate has `provenance: 'test'`, the page shows a visible "Test prices" note (Q2). Prebook results
are never written to these tables.

**Cost (calls a day = destinations × windows × refreshes):** 6 × 3 × 3 = **54 rates calls a day**,
worst case $1.08 a day, about $32 a month. Flights, once Part 4 joins: 54 a day, about EUR 0.27 a
day, about EUR 8 a month. Each extra destination adds 9 a day; each extra refresh a day adds 18;
each extra window adds 18; hourly is eight times the cost (432 a day). Hotel content is about six
`data/hotels` calls a week, free per the docs.

**Tests:** repository contract (memory and Postgres: upsert replaces, expired reads as null,
`latestRun` ordering, `callsSince`, parameterised SQL); targets (deterministic windows, stable
occupancy signature, stable key); job with a fake provider (success writes a row, failure keeps the
old row and logs no key, the cap stops the third call, the daily ceiling refuses a run, the limiter
never has more than its limit in flight); scheduler (three rounds a day, a restart in the same slot
makes zero calls); flag off (zero fetches, run recorded `disabled`); read path (all four states and
their exact strings, "Test prices" for sandbox, `loadStaySearch` with `STAY_PROVIDERS=liteapi` and a
key makes zero fetches); import guard (no file under `src/app/**` reaches
`src/providers/stays/liteapi.ts` or `src/liteapi-snapshot/job.ts`, except through the worker).

**Build order:** (1) storage: migration, repository, memory and Postgres, contract test; (2) env and
the adapter split: `LITEAPI_SNAPSHOT_ENABLED`, `LITEAPI_SNAPSHOT_REFRESHES_PER_DAY`, `liteapi.ts`
split; (3) pure logic: `targets.ts`, `staleness.ts`, `stored-schema.ts`; (4) job, schedule, queue
name and worker registration; (5) read path: `read.ts`, `snapshot.ts`, the stays registry,
`load-stays.ts`, the snapshot status component, `src/app/stays/page.tsx`; (6) import guard,
`docs/architecture.md`, `docs/runbook.md`. Not in the build: `.env.example` (permission-blocked, the
owner adds it), and `devmap.html` (the lead edits it).

### Part 4 design (lead, 2026-11-17): flights from the snapshot

Owner answer: the departure cities the snapshot covers are **Budapest (BUD), Vienna (VIE), Prague
(PRG) and London (LON)**. Use the city code LON if LiteAPI accepts it; if it does not, use LHR and
say so in the report.

**Cost.** 4 origins × 6 destinations × 3 windows × 3 refreshes = **216 flight calls a day**. Worst
case EUR 0.005 each beyond the 1,500:1 ratio: about **EUR 1.08 a day, about EUR 32 a month**. The
owner accepted this by choosing four origins. Add the flight calls to the daily ceiling.

**Rules.**

- Flights never run on a visitor path. Visitors read stored flights only.
- Party and windows match the hotel snapshot: 2 adults, economy, EUR, round trip. Departure is the
  window's check-in date and the return is its check-out date (4 nights).
- A flight offer carries its own `expiration`. Store it as information only; it never hides an
  offer, and nothing may say an offer is valid until a time. Owner decision (2026-11-17): stored
  fares are shown as indicative prices with the time they were seen, and a stored offer is never
  sent to booking or prebook.
- Freshness uses the same four states and the same wording as hotels, plus one fixed line under
  every stored flight price: "Seen at HH:MM UTC. Fares change within minutes; check the airline
  before you book." (HH:MM is the offer's `observedAt` in UTC.)
- Sandbox prices are not real. The "Test prices" note applies to flights too.

**Storage.** Migration `0014_liteapi_flights_snapshot.sql`, one table `liteapi_flights_snapshot`:
`origin`, `destination`, `departure_date`, `return_date`, `adults`, `currency`, `cabin`, `offers`
JSONB (validated and mapped), `observed_at`, `expires_at` (observed plus 3 × interval), `environment`,
`schema_version`, `run_id`. Primary key: origin, destination, departure_date, return_date, adults,
currency, cabin. Parameterised SQL only. Repository methods follow the hotel ones, with the clock
injected.

**Job.** `liteapi.flights.refresh`, payload `{ origin, destination, departureDate, returnDate }`,
one run per origin, destination and window. One flights call per run (the flights rates request
the docs describe; read `post_flights-rates` for the exact fields). Same schedule, same per-run cap,
same disabled flag as the hotel job. The worker registers it only with `LITEAPI_SNAPSHOT_ENABLED`.
A provider failure keeps the old row and logs only the error code.

**Config.** `LITEAPI_SNAPSHOT_ORIGINS`, a comma list of three-letter codes, default
`BUD,VIE,PRG,LON`, validated in `src/lib/env.ts`.

**Read path.**

- A snapshot flight reader implements the flight provider interface and reads the table only.
- A missing row, or one past the row's `expires_at`, is "not loaded": no price from LiteAPI.
- Part 9 applies here: when the stored row is missing, read the existing Aviasales cache with
  `getCacheStore().get(key)` only. Never `loadAndStore`, never a live call. No entry means the
  flight is unpriced and the page shows a search issue.
- The calendar stays on Aviasales, as the plan says.

**Files.** Migration 0014; `src/db/repository.ts`, `memory.ts`, `postgres.ts` and a contract test;
`src/liteapi-snapshot/flights-job.ts`, `flights-read.ts` and tests; `src/providers/flights/liteapi.ts`
(the live fetch, used only by the job) and `src/providers/flights/liteapi-snapshot.ts` (the reader)
and tests; `src/providers/registry.ts` (`FLIGHT_PROVIDER=liteapi` builds the reader; a missing key
still fails closed, as now); `src/queue/types.ts`; `src/worker/main.ts`; `src/lib/env.ts`; the import
guard test (the live flights fetch may be reached only from the worker); `docs/architecture.md` and
`docs/runbook.md` (the flight arithmetic).

**Tests.** Repository contract for the table; the job with a fake provider (one call per run, cap,
failure keeps the old row, log has no key); flag off makes zero calls; the reader's four states and
the fixed fare line; a missing row with the Aviasales cache empty is unpriced, and a spy shows zero
fetches; the import guard.

**Live check, 2026-11-17 (two sandbox calls, VIE and LON to LIS, one round trip).** Both returned
200, so LON is accepted as an origin. Every offer's `expiration` was about **10 minutes** after the
call. A stored offer is therefore expired within minutes of the refresh, and the rule "never show an
offer past its expiry" hides every stored fare. Owner decision needed on how stored fares may be
shown: indicative with the time they were seen, or not at all. `pricing.display.total` is the only
price field returned; whether it covers both adults is not stated and is not yet verified.

### Part 11. Env and deploy

- **Goal:** LiteAPI is switched on by configuration only. It fails closed, and the policy document
  matches the code.
- **What changes:**
  - `src/lib/env.ts`:
    - `FLIGHT_PROVIDER` enum adds `liteapi`; `HOTEL_PROVIDER` accepts `liteapi`;
      `EXPERIENCE_PROVIDER` (new) is `absent | liteapi`.
    - `LITEAPI_GUEST_NATIONALITY` (optional, ISO-2, default `US` as today).
    - `LITEAPI_ENVIRONMENT` is derived, not set: `sandbox` when the key starts with `sand_`. Log
      the mode at startup (never the key). `LITEAPI_API_KEY` is already in the redaction list;
      keep it there.
  - Production guard (`assertNoMockInProduction` neighbour): a sandbox key in a production build
    is **refused unless** `LITEAPI_SANDBOX_IN_PRODUCTION=true` is set explicitly. Q2 decides
    whether that flag is ever set.
  - `.env.example`: placeholders only (`LITEAPI_API_KEY=`), with `STAY_PROVIDERS=liteapi`,
    `HOTEL_PROVIDER=liteapi`, `FLIGHT_PROVIDER=liteapi` commented.
  - `docs/provider-policy.md`: update the LiteAPI row with the verified pricing (above). Add rows
    for LiteAPI Flights and LiteAPI Experiences. Record that the "no paid API, ever" policy (2026-11-04)
    is superseded **for LiteAPI** by the owner's 2026-11-17 decision. Only the owner can sign
    that change (Q1).
  - `docs/runbook.md` and `docs/deployment-checklist.md`: how to switch on, how to switch off
    (unset the key, or drop `liteapi` from the lists), and where the call counter appears in the
    logs.
  - `WHAT-I-NEED-FROM-YOU.md`: the owner items (Q1 to Q9).
- **Owner model:** Sonnet, with a security-engineer review of the guard and redaction.
- **Dependencies:** none (first).
- **Acceptance:**
  - `registry.test.ts`: each new value without a key throws with zero fetches. A sandbox key with
    `NODE_ENV=production` and no flag throws. With the flag it builds and logs `sandbox`. No
    request header or cookie can select LiteAPI.
  - `npm run verify` passes. The deploy log shows the LiteAPI mode line and no key.
- **Calls:** 0.
- **Risks:** the production guard blocks the owner's "sandbox on the live site" plan until Q2 is
  answered. That is the point.

---

### Part 12. Devmap updates

- **Goal:** `devmap.html` `DATA` reflects this migration, part by part, as each lands.
- **What changes:** in `devmap.html` `DATA` (by the executor of each part, not by this planner):
  - `planned`: replace "Priced hotel feed (LiteAPI, Amadeus or Booking.com) behind
    STAY_PROVIDERS" with the roadmap list below.
  - `inProgress`: update the trip-builder note "Hotel photos are blocked" when Part 3 lands.
  - `failing`: change "Hotel feed absent" (known limit) when Part 2 lands.
  - `needsOwner`: replace "A priced hotel feed key …" with Q1 to Q9 below.
  - Move each part to `done` with its commit hash, and with "Awaiting a browser check" until a
    browser check is recorded.
- **Owner model:** Haiku.
- **Dependencies:** each part as it lands.
- **Acceptance:** the devmap renders; every new item has a `src`.
- **Calls:** 0.
- **Risks:** none.

---

## Owner questions

- **Q1. Look-to-book and the no-paid-API policy.** Rates, prebook and book are free only "within a
  5000:1 search-to-book ratio", and flight search is free only within 1,500:1. Voyagr makes zero
  bookings, so both ratios are breached from the first search. Nuitee "may … apply limits or
  pricing changes". Is a written exception from Nuitee needed before production? And does the
  owner formally supersede the 2026-11-04 "no paid API, ever" rule for LiteAPI?
- **Q2. Sandbox prices on the public site.** Nuitee says sandbox pricing is not real-world.
  Showing it to visitors as a price is showing an invented number. Options: (a) sandbox only on
  preview and dev builds; (b) on the live site with a visible "Test prices" note, which conflicts
  with D20 (no provenance badges); (c) wait for a production key. The plan's default is (a): the
  production guard refuses a sandbox key unless a flag is set.
- **Q3. Markup.** Is markup 0 set in the dashboard for hotels, and should `margin` on
  `flights/rates` be omitted or sent as 0?
- **Q4. Flights production access.** It needs Go-live and approval. Has it been requested?
- **Q5. Experiences.** Has the sandbox enablement ticket been opened? The pricing for experiences
  is not in the docs.
- **Q6. Guest nationality.** It defaults to `US` and can change the price. Use the visitor's
  country (from settings, never guessed from IP without consent), or keep a fixed default?
- **Q7. Image and review reuse terms.** Confirm that LiteAPI's terms allow showing its hotel
  photos and reviews on Voyagr pages.
- **Q8. Prebook and sandbox booking.** May prebook be used as a user-facing "check this price"
  step (no money)? And may an internal, sandbox-only script run book with `ACC_CREDIT_CARD` to
  prove the flow (never from the UI)?
- **Q9. Fallback scope.** Fall back to Aviasales on an empty LiteAPI answer as well as on an
  error? Keep Aviasales for the price calendar, flex strip and cache warm-up, which LiteAPI cannot
  give without the entitled matrix?
- Also: the owner's figures ($0.02 price index, $0.02 public prices) differ from the docs ($0.05
  price index; no "public prices" line found). Which is current for this account?

## Roadmap: LiteAPI migration

Ready to paste into `devmap.html` `DATA.planned`:

```js
{ area: "LiteAPI migration", text: "Env and deploy: liteapi values for FLIGHT/HOTEL/EXPERIENCE providers, sandbox-key guard in production, policy doc updated", note: "Part 11. Sonnet. First.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Caching and call budget: cache keys and TTLs per LiteAPI call, single-flight, call counter, LiteAPI search limits", note: "Part 10. Sonnet; limits designed by the lead.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Hotels search and stays page: sandbox rates, taxes included and 'Payable at the hotel' shown separately", note: "Part 1. Sonnet.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Hotel photos, stars, reviews and location from LiteAPI content", note: "Part 3. Sonnet.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Hotel prices in trip totals; 'Payable at the hotel' becomes an excluded line, never in the total", note: "Part 2. Sonnet; hotel-window cap designed by the lead.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Payment button placeholder: 'Payments are not switched on yet'", note: "Part 7. Haiku.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Reservation flow shown as disabled steps; no book call from the app", note: "Part 6. Sonnet; prebook use waits on the owner.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Transfers (Intui), eSIM (Yesim, GigSky) and AirHelp unchanged, with a regression test", note: "Part 8. Haiku.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Flights search from LiteAPI in the sandbox; calendar stays on Aviasales", note: "Part 4. Sonnet; fan-out designed by the lead.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Aviasales only as a fallback when LiteAPI flights fail", note: "Part 9. Sonnet.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Experiences (tours) from LiteAPI on the destination page, booking disabled", note: "Part 5. Sonnet; needs Experiences enabled on the sandbox key.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Devmap kept in step with each LiteAPI part", note: "Part 12. Haiku.", src: "docs/liteapi-migration-plan.md" },
```

And for `DATA.needsOwner`:

```js
{ text: "LiteAPI: written answer on the look-to-book ratio with zero bookings, and sign-off that LiteAPI's paid endpoints supersede the no-paid-API rule", src: "docs/liteapi-migration-plan.md (Q1)" },
{ text: "LiteAPI: may sandbox prices appear on the live site, and how are they labelled?", src: "docs/liteapi-migration-plan.md (Q2)" },
{ text: "LiteAPI: markup 0 set in the dashboard; flights margin", src: "docs/liteapi-migration-plan.md (Q3)" },
{ text: "LiteAPI: request Flights production access and Experiences sandbox access", src: "docs/liteapi-migration-plan.md (Q4, Q5)" },
{ text: "LiteAPI: guest nationality, image and review terms, prebook use, fallback scope", src: "docs/liteapi-migration-plan.md (Q6 to Q9)" },
```

## Owner answers 2026-11-17 (binding)

- Q1: The 5000:1 ratio is for the live (production) account. Sandbox billing is not stated in the docs; treat sandbox as free but confirm with Nuitee in writing before any live key.
- Q2: LIVE site shows hotel prices with a visible "Test prices" note while the key is sandbox. This overrides the no-badges rule (D20) for hotel prices only; record that exception in docs/finish-plan.md.
- Q8: Prebook may be used as a "check this price" step with no money. Book is never called from the UI.
- Q9: Fall back to Aviasales on errors AND on empty LiteAPI answers.
- Markup stays 0 in the sandbox dashboard.
