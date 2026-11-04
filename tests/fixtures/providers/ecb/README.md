# ECB reference-rate fixture

`eurofxref-daily-2026-11-04.xml` is the real, current response from the European Central Bank's
own daily reference-rate feed (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`),
fetched 2026-11-04. Nothing in it is invented: it is the actual document the ECB publishes once a
day, for free, with no API key and no account - 28 currencies against the euro, each with the
`time` the rate was true for.

Kept as a fixture rather than fetched live in tests for the same reason every other provider's
tests are offline: deterministic, fast, and it proves the parser against a real document rather
than a shape somebody imagined the ECB sends. See `src/providers/fx/ecb.test.ts`.
