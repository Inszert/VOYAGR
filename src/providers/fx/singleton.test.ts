import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { getRateSource, resetRateSource } from './index';

/**
 * The process-wide rate table - `FX_PROVIDER` resolution, caching and the
 * zero-billing default (`mock` never fetches anything).
 */

const realXml = readFileSync('tests/fixtures/providers/ecb/eurofxref-daily-2026-11-04.xml', 'utf8');
const respondWith = (body: string, status = 200) =>
  Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/xml' } }));

beforeEach(() => {
  resetRateSource();
});

afterEach(() => {
  delete process.env.FX_PROVIDER;
  resetEnvCache();
  resetRateSource();
  vi.restoreAllMocks();
});

describe('FX_PROVIDER=mock (the default-off case)', () => {
  it('never calls fetch, and holds no rate', async () => {
    process.env.FX_PROVIDER = 'mock';
    resetEnvCache();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const source = await getRateSource();

    expect(source.rateFor('EUR', 'USD')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('FX_PROVIDER=ecb (the default)', () => {
  it('loads the real table and caches it across calls', async () => {
    process.env.FX_PROVIDER = 'ecb';
    resetEnvCache();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => respondWith(realXml));

    const first = await getRateSource();
    const second = await getRateSource();

    expect(first).toBe(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.rateFor('EUR', 'USD')).not.toBeNull();
  });

  it('two concurrent callers during a cold start share one fetch', async () => {
    process.env.FX_PROVIDER = 'ecb';
    resetEnvCache();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => respondWith(realXml));

    const [a, b] = await Promise.all([getRateSource(), getRateSource()]);

    expect(a).toBe(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps serving the last good table when a scheduled refresh fails', async () => {
    process.env.FX_PROVIDER = 'ecb';
    resetEnvCache();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    fetchSpy.mockImplementationOnce(() => respondWith(realXml));
    await getRateSource();

    // Force the cache to look due for a refresh without waiting 24h for it.
    if (globalThis.__voyagrFxTable) {
      globalThis.__voyagrFxTable = { ...globalThis.__voyagrFxTable, loadedAt: 0 };
    }
    fetchSpy.mockImplementationOnce(() => Promise.reject(new Error('network down')));

    const afterFailedRefresh = await getRateSource();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(afterFailedRefresh.rateFor('EUR', 'USD')).not.toBeNull();
  });

  it('resetRateSource() actually drops the cache, not just the table reference', async () => {
    process.env.FX_PROVIDER = 'ecb';
    resetEnvCache();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => respondWith(realXml));

    await getRateSource();
    resetRateSource();
    await getRateSource();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
