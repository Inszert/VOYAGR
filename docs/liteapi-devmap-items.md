# LiteAPI devmap items

Paste-ready lists for `devmap.html` `DATA`, taken from `docs/liteapi-migration-plan.md` Part 12 and
its Roadmap block. The devmap itself is not edited here.

Where a binding answer in "Owner answers 2026-11-17 (binding)" supersedes a line, the JS line carries
a `// changed:` comment saying which answer. Every other line is copied from the plan.

Not included: the `inProgress`, `failing` and `done` moves in Part 12. The executor of each part makes
those as it lands, with its commit hash.

## 1. Roadmap for `DATA.planned` (one line per part, owner model in `note`)

```js
{ area: "LiteAPI migration", text: "Env and deploy: liteapi values for FLIGHT/HOTEL/EXPERIENCE providers, sandbox-key guard in production (hotel prices excepted, see Q2), policy doc updated", note: "Part 11. Sonnet. First.", src: "docs/liteapi-migration-plan.md" }, // changed: owner answer Q2
{ area: "LiteAPI migration", text: "Caching and call budget: cache keys and TTLs per LiteAPI call, single-flight, call counter, LiteAPI search limits", note: "Part 10. Sonnet; limits designed by the lead.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Hotels search and stays page: sandbox rates, taxes included and 'Payable at the hotel' shown separately", note: "Part 1. Sonnet.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Hotel photos, stars, reviews and location from LiteAPI content", note: "Part 3. Sonnet.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Hotel prices in trip totals; 'Payable at the hotel' becomes an excluded line, never in the total", note: "Part 2. Sonnet; hotel-window cap designed by the lead.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Payment button placeholder: 'Payments are not switched on yet'", note: "Part 7. Haiku.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Reservation flow shown as disabled steps; no book call from the app", note: "Part 6. Sonnet; prebook allowed only as a no-money 'check this price' step (Q8); book is never called from the UI.", src: "docs/liteapi-migration-plan.md" }, // changed: owner answer Q8
{ area: "LiteAPI migration", text: "Transfers (Intui), eSIM (Yesim, GigSky) and AirHelp unchanged, with a regression test", note: "Part 8. Haiku.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Flights search from LiteAPI in the sandbox; calendar stays on Aviasales", note: "Part 4. Sonnet; fan-out designed by the lead.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Aviasales only as a fallback when LiteAPI flights fail or come back empty", note: "Part 9. Sonnet.", src: "docs/liteapi-migration-plan.md" }, // changed: owner answer Q9
{ area: "LiteAPI migration", text: "Experiences (tours) from LiteAPI on the destination page, booking disabled", note: "Part 5. Sonnet; needs Experiences enabled on the sandbox key.", src: "docs/liteapi-migration-plan.md" },
{ area: "LiteAPI migration", text: "Devmap kept in step with each LiteAPI part", note: "Part 12. Haiku.", src: "docs/liteapi-migration-plan.md" },
```

## 2. Owner needs for `DATA.needsOwner` (open questions only)

```js
{ text: "LiteAPI: written exception from Nuitee on the 5000:1 hotel and 1,500:1 flight search-to-book ratios before production; written confirmation of sandbox billing before any live key; owner decision on whether LiteAPI supersedes the 2026-11-04 no-paid-API rule", src: "docs/liteapi-migration-plan.md (Q1)" }, // changed: Q1 partly answered
{ text: "LiteAPI: flights/rates margin, omitted or sent as 0; hotel markup 0 is set on the sandbox dashboard, live not yet stated", src: "docs/liteapi-migration-plan.md (Q3)" }, // changed: Q3 partly answered
{ text: "LiteAPI: request Flights production access (Go-live and approval) and Experiences sandbox access", src: "docs/liteapi-migration-plan.md (Q4, Q5)" },
{ text: "LiteAPI: guest nationality default and source (Q6), image and review reuse terms (Q7), whether an internal sandbox-only script may run book with ACC_CREDIT_CARD (Q8), and whether Aviasales stays for the calendar, flex strip and cache warm-up (Q9, second half, not addressed by the answers)", src: "docs/liteapi-migration-plan.md (Q6 to Q9)" }, // changed: Q8, Q9 partly answered
{ text: "LiteAPI: which figures are current for this account, the $0.02 price index and public prices (owner) or the $0.05 price index (docs)", src: "docs/liteapi-migration-plan.md (Owner questions, Q9 'Also'; not in Part 12's list)" }, // added: not in Part 12's list
```

## 3. Answered 2026-11-17 (keep out of `needsOwner`)

- **Q1.** The 5000:1 ratio applies to the live account. The docs do not state sandbox billing, so
  treat sandbox as free and confirm with Nuitee in writing before any live key. The rest of Q1 stays
  open in section 2.
- **Q2.** The live site shows hotel prices with a visible "Test prices" note while the key is sandbox.
  This overrides D20 (no provenance badges) for hotel prices only. Follow-up, not a devmap item: record
  the exception in `docs/finish-plan.md`, where D20 is defined (line 150). Part 11's body default
  (refuse a sandbox key in production unless a flag is set) is superseded for hotel prices.
- **Q3.** Markup stays 0 in the sandbox dashboard. The flights margin question stays open in section 2.
- **Q8.** Prebook may be used as a no-money "check this price" step. Book is never called from the UI.
  The sandbox-only script question stays open in section 2.
- **Q9.** Fall back to Aviasales on errors and on empty LiteAPI answers. Part 9's body ("an empty
  primary result is not a failure by default") is superseded. The calendar, flex strip and cache
  warm-up question stays open in section 2.
