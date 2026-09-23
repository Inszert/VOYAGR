/* eslint-disable no-console -- a command-line recorder; what it prints is its output. */
/**
 * Record one real Duffel search, for the test suite to replay forever.
 *
 * Run once, by hand, with a Duffel **test** key in `.env` as `DUFFEL`:
 *
 *   npx tsx scripts/record-duffel.ts [ORIGIN] [DESTINATION]
 *
 * Nothing in the suite runs this. It drives the real adapter - the same
 * request, the same polling for offers - through a recording `fetch`, writes a
 * **redacted** cassette under `tests/fixtures/providers/`, and prints what
 * Duffel actually sent: how the offers are paged, the validity window on each
 * one, the timezone of the times, and the rate-limit headers. Those are the
 * questions the live-provider readiness gate asks, and only a real response
 * answers them.
 *
 * The key is never printed and never written: headers go through
 * `redactHeaders`, URLs through `redactUrl` and bodies through `redactBody`
 * before anything touches the disk. A live (non-test) key is refused, so a
 * recording can never spend real money or leak real inventory.
 */

import { createDuffelFlightProvider } from '@/providers/flights/duffel';
import { createRecorder } from '@/providers/http/record';

process.loadEnvFile?.('.env');

const token = process.env.DUFFEL;

if (!token) {
  console.error('DUFFEL is not set. Nothing recorded.');
  process.exit(1);
}

if (!token.startsWith('duffel_test_')) {
  console.error('Refusing to record with a live Duffel key. Use a duffel_test_ key.');
  process.exit(1);
}

const [origin = 'VIE', destination = 'BCN'] = process.argv.slice(2);

/*
 * Dates a month ahead: near enough that the sandbox airline has schedules,
 * far enough that the recording is not of tomorrow's sold-out flights.
 */
const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const recorder = createRecorder({ provider: 'duffel', cassetteName: 'duffel-round-trip' });
const provider = createDuffelFlightProvider({ token, fetchImpl: recorder.fetch });

const started = Date.now();
const result = await provider.searchFlights({
  origins: [origin],
  destinations: [destination],
  departureDate: plus(30),
  returnDate: plus(35),
  passengers: 1,
  currency: 'EUR',
});

console.log(`\n${recorder.count} exchanges in ${Date.now() - started}ms`);

if (!result.ok) {
  console.error('The search failed:', result.error.code, result.error.message);
  process.exit(1);
}

const offers = result.value.items;
console.log(`${offers.length} offers mapped; next cursor: ${result.value.nextCursor ?? 'none'}`);

for (const offer of offers.slice(0, 3)) {
  const first = offer.outbound.segments[0];
  console.log(
    `  ${offer.id.slice(0, 12)}…  ${offer.price.amount / 100} ${offer.price.currency}` +
      `  departs ${first?.departsAt}  observed ${offer.observedAt}  expires ${offer.expiresAt}`,
  );
}

const path = recorder.save(
  `${origin}->${destination} round trip, one adult, recorded against the Duffel sandbox.`,
);
console.log(`\nrecorded to ${path}`);
