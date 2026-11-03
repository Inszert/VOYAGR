# Open-Meteo fixtures

Real response bodies, recorded 3 November 2026 against `api.open-meteo.com` and
`archive-api.open-meteo.com` for Vienna (48.11, 16.57). No credential was involved - Open-Meteo's
free tier needs none - so unlike the rest of `tests/fixtures/providers/`, these are plain response
bodies rather than `Cassette` objects: there is no request to redact and no `replayingFetch` harness
needed. `open-meteo.test.ts` reads them directly and feeds them to the adapter's injected
`fetchImpl`.

| File                   | Proves                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `forecast-vienna.json` | The `/v1/forecast` daily shape: numeric `precipitation_probability_max`, no `null`s.             |
| `archive-2023-06.json` | The `/v1/archive` shape for one June, one of three years averaged into a climatology normal.     |
| `archive-2024-06.json` | Same, a different year - real month-to-month variation in the numbers the average is taken over. |
| `archive-2025-06.json` | Same, the third sampled year.                                                                    |
