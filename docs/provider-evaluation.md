# Provider evaluation

Candidate flight and hotel data providers, compared on what their **current official
documentation states publicly**. Part of the live-provider readiness task in
`implementation-plan.md`.

**No vendor is chosen here, and nothing is integrated.** This exists so that choosing one is a
decision made against recorded facts rather than an impression.

---

## How to read this

Every row carries where it came from, because the difference matters more than the fact:

| Mark          | Meaning                                                                                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[doc]**     | Read directly from the vendor's own documentation page.                                                                                                                                                                                       |
| **[doc-idx]** | From a search index of the vendor's own documentation, where the page itself could not be fetched (several vendor doc sites render client-side and return an empty body to a plain fetch). Treat as strong but re-check before relying on it. |
| **[none]**    | Not found in public documentation. Not the same as "no such limit" — only "not published".                                                                                                                                                    |
| **[vendor]**  | **Requires vendor confirmation.** Commercial, contractual or account-specific. Nothing here may be assumed.                                                                                                                                   |

Retrieved 19 September 2026. Vendor documentation changes without notice; anything load-bearing
should be re-read before it is relied on, and quoted figures re-checked against the account's own
contract.

Nothing in this document is invented. Where a figure is unknown it says so.

---

## The question that decides everything

> **Is background polling permitted?**

Voyagr's entire premise is that it keeps searching after the user closes the tab. That is not a
normal API usage pattern — most travel APIs are priced and rate-limited on the assumption that a
request follows a human. A provider that forbids unattended polling, or prices per call in a way
that makes it ruinous, is not a provider this product can use, however good its data is.

**No candidate states a position on this in public documentation. [none]** For every vendor it is
**[vendor]** — and it is the first question to ask, before any technical evaluation, because a "no"
ends the conversation.

---

## Comparison

### Flights

|                       | **Duffel**                                                                                                                           | **Amadeus Self-Service**                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox               | Test mode with test access token **[doc]**                                                                                           | Free test environment, self-service signup **[doc-idx]**                                                                                                                                |
| Authentication        | Bearer access token **[doc]**                                                                                                        | OAuth2 client credentials **[doc-idx]**                                                                                                                                                 |
| Pagination            | Cursor. `?limit` 1–200, default 50; follow `meta.after` **[doc]**                                                                    | **[none]** — varies per endpoint                                                                                                                                                        |
| Rate limit            | Search: 120 requests / 60s live. Per-endpoint, "subject to change without notice" **[doc-idx]**                                      | Test: free monthly quota per API, exceeded returns 429. Production: "no consumption limit… as long as there are no outstanding usage bills" **[doc-idx]**. Per-second limits **[none]** |
| 429 / retry           | `rate_limit_exceeded`; retry after `ratelimit-reset`. Headers: `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset` **[doc]** | 429 on quota exhaustion **[doc-idx]**; backoff guidance **[none]**                                                                                                                      |
| Timeouts              | "You must set a HTTP client timeout of at least 130s" for order/booking creation; upstream can take 120s **[doc]**                   | **[none]**                                                                                                                                                                              |
| Do-not-retry          | 202, 500, 502: "You should not retry this request". 503: retry later. 202 on order creation may duplicate the booking **[doc]**      | **[none]**                                                                                                                                                                              |
| Offer expiry          | `expires_at` on every offer, "usually 15–30 minutes". `offer_expired` → do not retry, search again **[doc-idx]**                     | **[none]**                                                                                                                                                                              |
| Currency              | **[none]** in pages read                                                                                                             | **[none]** in pages read                                                                                                                                                                |
| Date/time semantics   | **[none]** — must be confirmed against a real response                                                                               | **[none]**                                                                                                                                                                              |
| Caching / storage     | **[none]**                                                                                                                           | **[none]**                                                                                                                                                                              |
| Attribution / display | **[none]**                                                                                                                           | **[none]**                                                                                                                                                                              |
| Public pricing        | **[vendor]**                                                                                                                         | Free monthly quota in test _and_ production; beyond it, "pay-as-you-go… at the rates indicated on the Pricing page, with no additional fees" **[doc-idx]**. Per-API rates **[vendor]**  |
| Commercial terms      | **[vendor]**                                                                                                                         | **[vendor]**                                                                                                                                                                            |
| Background polling    | **[vendor]**                                                                                                                         | **[vendor]**                                                                                                                                                                            |

### Hotels

|                       | **Booking.com Demand API**                                                                                                                                                                                                      | **Hotelbeds APItude**                                                                                | **Amadeus Hotel Search**                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Sandbox               | Yes. "a dedicated, non-production environment… mirrors the structure of the live production environment" using "your regular credentials" **[doc]**                                                                             | Test environment on the developer portal **[doc-idx]**                                               | Same test environment as flights **[doc-idx]** |
| Sandbox limits        | "Maximum 50 requests per minute". Reservations only against sandbox inventory. "A real credit card is required for testing accommodation booking flows including payments". Cars "currently not available in sandbox" **[doc]** | **[none]**                                                                                           | Free monthly quota **[doc-idx]**               |
| Authentication        | API key token **and** affiliate ID header on every request **[doc-idx]**                                                                                                                                                        | API key + SHA-256 signature **[doc-idx]**                                                            | OAuth2 client credentials **[doc-idx]**        |
| Pagination            | Differs per endpoint: `rows` for accommodation, `maximum_results` for cars; `next_page` token **[doc-idx]**                                                                                                                     | **[none]**                                                                                           | **[none]**                                     |
| Rate limit            | Sandbox 50 rpm **[doc]**. Production: enforced per minute, "contact your Account Manager for details on your partner account's specific rate limit" **[doc-idx]** → **[vendor]**                                                | "4 QPS" cited for a production plan **[doc-idx]**, tier-dependent → **[vendor]**                     | As flights **[doc-idx]**                       |
| 429 / retry           | 429, "access is temporarily restricted for a brief period (typically 1 minute)" **[doc-idx]**                                                                                                                                   | 429 "Too many requests" on the Cache API **[doc-idx]**                                               | 429 **[doc-idx]**                              |
| Timeouts              | **[none]**                                                                                                                                                                                                                      | **[none]**                                                                                           | **[none]**                                     |
| Price freshness       | **[none]**                                                                                                                                                                                                                      | Rates with `rateType` = `recheck` must be re-confirmed via `checkrates` before booking **[doc-idx]** | **[none]**                                     |
| Currency              | **[none]** in pages read                                                                                                                                                                                                        | **[none]**                                                                                           | **[none]**                                     |
| Date/time semantics   | **[none]**                                                                                                                                                                                                                      | **[none]**                                                                                           | **[none]**                                     |
| Caching / storage     | **[none]** in official pages read. A third-party integration blog states static content may be cached but pricing may not; **not verified against Hotelbeds' own terms** and must not be relied on                              | Same — **[vendor]**                                                                                  | **[none]**                                     |
| Attribution / display | **[none]**                                                                                                                                                                                                                      | **[none]**                                                                                           | **[none]**                                     |
| Public pricing        | **[vendor]** — commission model, partner-negotiated                                                                                                                                                                             | **[vendor]**                                                                                         | As flights                                     |
| Commercial terms      | Partner application; production access is account-managed **[doc-idx]** → **[vendor]**                                                                                                                                          | Partner contract **[vendor]**                                                                        | **[vendor]**                                   |
| Background polling    | **[vendor]**                                                                                                                                                                                                                    | **[vendor]**                                                                                         | **[vendor]**                                   |

---

## What this changes about our own code

The readiness task listed assumptions our code makes that only a live provider can falsify. Some
now have partial answers.

| Assumption in `src/`                                     | What the research says                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One call returns every offer worth having (`maxResults`) | **Confirmed wrong for at least two vendors.** Duffel is cursor-paginated with a 200 ceiling **[doc]**; Booking.com paginates differently per endpoint **[doc-idx]**. `FlightSearchQuery`/`HotelSearchQuery` have no cursor, so the adapter interface needs one before either can be integrated honestly.                                                                       |
| A failed call is simply a failed call                    | **Confirmed insufficient.** Duffel names responses that must _not_ be retried — 202 on order creation "may result in a duplicate order" **[doc]**. A blanket retry at the provider boundary would create duplicate bookings. Retry policy has to be per status, not per adapter.                                                                                               |
| `providerConcurrency` of 6 is a safe pace                | **Probably too fast for hotels.** A cited 4 QPS Hotelbeds plan **[doc-idx]** and Booking.com's 50 rpm sandbox **[doc]** are both below what our default fan-out would produce. The shared limiter is the right shape; the number must come from the vendor.                                                                                                                    |
| A per-call timeout is enough                             | **Confirmed insufficient for booking.** Duffel requires ≥130s client timeouts on order creation **[doc]** — far beyond our 8s default, which is fine for search and wrong for anything transactional.                                                                                                                                                                          |
| Every quote is current                                   | **Confirmed to need work.** Duffel offers carry `expires_at`, "usually 15–30 minutes" **[doc-idx]**; Hotelbeds `recheck` rates must be re-confirmed via `checkrates` **[doc-idx]**. Our five-minute page cache is inside both windows, but nothing in the domain models an expiring offer, and a Travel Watch storing a price for hours is storing something that has expired. |
| Times, currency, caching, attribution                    | **Still unknown.** None of these is documented publicly by any candidate. They are exactly what the recorded-fixture harness exists to answer, from a real sandbox response.                                                                                                                                                                                                   |

---

## Requires vendor confirmation

Nothing below may be assumed, estimated or inferred. Each is a question to put to a vendor in
writing, and the answer belongs in this document with a date against it.

**Ask first — a wrong answer ends the evaluation:**

1. **Is unattended background polling permitted?** Voyagr re-runs a saved search every few hours
   with no human present. Ask explicitly; do not infer permission from silence in the docs.
2. **What is the per-account rate limit**, in production, for the endpoints we would use?
3. **What does a search cost**, and is search billed separately from booking?

**Then:**

4. May responses be cached, and for how long? Separately for static content and for prices.
5. May prices be stored? Voyagr keeps a price history indefinitely-ish (90-day retention) in order
   to answer "is this actually cheap?". That is storage of vendor pricing data over time.
6. What attribution, branding or display requirements attach to showing an offer?
7. Is there a minimum look-to-book ratio, and what happens if we fall below it? A product that
   searches continuously and books rarely is structurally bad on this metric.
8. Are there restrictions on showing a vendor's price alongside a competitor's?
9. What are the terms for the sandbox specifically — is it rate-limited, time-limited, or does it
   require a signed agreement?
10. What notice is given before a breaking API change or a rate-limit change? Duffel states its
    interval is "subject to change without notice" **[doc-idx]**.

---

## What this does not answer

- **No vendor has been chosen.** That is deliberate: this is a comparison, not a recommendation.
- **No credentials have been obtained**, and none are in the repository. When a sandbox credential
  is needed it loads through `src/lib/env.ts` from the environment, like every other secret.
- **No commercial terms have been verified.** Everything marked **[vendor]** is unanswered.
- **Nothing has been integrated.** `src/providers/` is still entirely mock.

The next step is not code. It is putting the eleven questions above to two vendors and writing the
answers down.

---

## Sources

Flights:

- [Duffel — Response handling](https://duffel.com/docs/api/overview/response-handling)
- [Duffel — Pagination](https://duffel.com/docs/api/overview/pagination)
- [Duffel — Offers](https://duffel.com/docs/api/v2/offers)
- [Duffel — API rate limit](https://help.duffel.com/hc/en-gb/articles/10229200096786-What-is-the-API-rate-limit)
- [Duffel — Getting an accurate price before booking](https://duffel.com/docs/guides/getting-an-accurate-price-before-booking)
- [Amadeus — Self-Service pricing](https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/pricing/)
- [Amadeus — API rate limits](https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/api-rate-limits/)
- [Amadeus — Moving to production](https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/API-Keys/moving-to-production/)

Hotels:

- [Booking.com — Demand API sandbox](https://developers.booking.com/demand/docs/getting-started/sandbox)
- [Booking.com — Rate limiting](https://developers.booking.com/demand/docs/development-guide/rate-limiting)
- [Booking.com — Authentication](https://developers.booking.com/demand/docs/development-guide/authentication)
- [Booking.com — Pagination](https://developers.booking.com/demand/docs/development-guide/pagination)
- [Hotelbeds — Developer portal](https://developer.hotelbeds.com/)
- [Hotelbeds — Cache API operations](https://developer.hotelbeds.com/documentation/hotels/cache-api/operations/)
- [Hotelbeds — Booking API](https://developer.hotelbeds.com/documentation/hotels/booking-api/)

Pages marked **[doc-idx]** could not be fetched directly — several of these sites render
client-side and return an empty body — and were read through a search index of the same official
documentation. They are re-checkable at the URLs above.
