import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convert } from '@/core/fx';
import { money } from '@/core/money';
import { ECB_BASE_CURRENCY, fetchEcbRates } from './ecb';

/**
 * The ECB adapter, offline.
 *
 * `eurofxref-daily-2026-11-04.xml` is the real, current response from the
 * ECB's own feed (see the fixture's own README) - this is where the 28
 * currencies, the element shape, and the `time` attribute are evidenced,
 * not invented.
 */

const FIXTURE_PATH = 'tests/fixtures/providers/ecb/eurofxref-daily-2026-11-04.xml';
const realXml = readFileSync(FIXTURE_PATH, 'utf8');

const respondWith = (body: string, status = 200) =>
  Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/xml' } }));

describe('fetchEcbRates', () => {
  it('parses every currency the real feed states, against EUR', async () => {
    const result = await fetchEcbRates({ fetch: () => respondWith(realXml) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.referenceDate).toBe('2026-11-04');
    expect(result.value.currencyCount).toBe(29);

    const usd = result.value.source.rateFor(ECB_BASE_CURRENCY, 'USD');
    expect(usd).toEqual({
      from: 'EUR',
      to: 'USD',
      rate: 1.1267,
      observedAt: '2026-11-04T00:00:00Z',
    });
  });

  it('actually converts money with the parsed rate, through the real fx engine', async () => {
    const result = await fetchEcbRates({ fetch: () => respondWith(realXml) });
    if (!result.ok) throw result.error;

    const converted = convert(money(10000, 'EUR'), 'USD', result.value.source);

    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    // 100.00 EUR at 1.1267 -> 112.67 USD.
    expect(converted.value).toEqual(money(11267, 'USD'));
  });

  it('has no rate for a currency the feed never stated', async () => {
    const result = await fetchEcbRates({ fetch: () => respondWith(realXml) });
    if (!result.ok) throw result.error;

    expect(result.value.source.rateFor('EUR', 'XYZ')).toBeNull();
  });

  it('refuses rather than inventing a rate when the feed is unreachable', async () => {
    const result = await fetchEcbRates({
      fetch: () => Promise.reject(new Error('network down')),
    });

    expect(result.ok).toBe(false);
  });

  it('refuses rather than inventing a rate when the feed answers with an error status', async () => {
    const result = await fetchEcbRates({ fetch: () => respondWith('', 503) });

    expect(result.ok).toBe(false);
  });

  it('refuses rather than guessing when the response has no usable Cube elements', async () => {
    const result = await fetchEcbRates({
      fetch: () => respondWith('<gesmes:Envelope></gesmes:Envelope>'),
    });

    expect(result.ok).toBe(false);
  });

  it('drops a malformed single currency rather than failing the whole table', async () => {
    const withOneBadEntry = realXml.replace(
      "<Cube currency='USD' rate='1.1267'/>",
      "<Cube currency='USD' rate='not-a-number'/>",
    );

    const result = await fetchEcbRates({ fetch: () => respondWith(withOneBadEntry) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // USD dropped, the other 28 currencies the feed stated are untouched.
    expect(result.value.currencyCount).toBe(28);
    expect(result.value.source.rateFor('EUR', 'USD')).toBeNull();
    expect(result.value.source.rateFor('EUR', 'GBP')).not.toBeNull();
  });
});
