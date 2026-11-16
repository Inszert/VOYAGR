# Provider fixtures

Recorded HTTP exchanges, replayed offline. Evidence of what a vendor actually sent, kept so that
pagination, throttling, malformed bodies and expired prices can be in the test suite without a
network, a credential or a bill.

## Rules

1. **Never reaches the network.** `replayingFetch` answers only from a file here. A request with no
   recording throws. A harness that quietly fell through to a vendor would pass on one machine,
   fail on another, and cost money on both.
2. **No credentials, ever.** Headers are allow-listed, query-string secrets are blanked, and
   token-shaped body fields are replaced. Redaction of a vendor-shaped body cannot be exhaustive,
   so **read a new fixture before committing it**.
3. **Deterministic mocks stay the default.** `src/providers/*/mock.ts` is what the suite runs on.
   These fixtures are for adapters that speak HTTP, which today is none of them.
4. **One behaviour per cassette.** A cassette proving pagination should not also prove a 429. When
   one breaks, its name should say what stopped working.

## Recording a new one

Needs sandbox credentials in the environment. Never in a file, never in a commit.

```ts
const recorder = createRecorder({ provider: 'duffel', cassetteName: 'duffel-search-paginated' });
const adapter = createDuffelProvider({ fetch: recorder.fetch });

await adapter.searchFlights(query);

recorder.save('Two pages of a cursor-paginated search.');
```

Then open the file, read it, and only then commit it.

## What is here now

| Cassette                              | Proves                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `example-paginated-search`            | A cursor across two pages, and the rate-limit headers alongside it.                                                                                                                         |
| `example-rate-limited`                | A 429 with `Retry-After`, then the successful retry.                                                                                                                                        |
| `overpass-barcelona-stays` (raw body) | A real Overpass answer for central Barcelona, trimmed to 60 elements (58 nodes, 2 ways), recorded 2026-11-16. Parsing for `scripts/build-hotels.mjs`; (c) OpenStreetMap contributors, ODbL. |

Both are hand-written against a fictional vendor. No provider has been chosen, so nothing real has
been recorded yet — they exist so the harness itself is tested, and as the shape a real recording
should take.
