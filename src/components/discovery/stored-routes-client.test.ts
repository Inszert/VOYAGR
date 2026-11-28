import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD } from '@/discovery/stored-routes';
import { createStoredRoutesLoader } from './stored-routes-client';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const reply = (routes: unknown[]) =>
  Promise.resolve(new Response(JSON.stringify({ routes }), { status: 200 }));

describe('stored routes loader', () => {
  it('rotating the globe asks only for stored routes and never for prices', async () => {
    const fetcher = vi.fn((..._args: Parameters<typeof fetch>) => reply([]));
    const loader = createStoredRoutesLoader({ onRoutes: () => undefined, fetcher });

    for (let i = 0; i < 60; i += 1) {
      loader.request('VIE', { ...WORLD, west: -180 + i });
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(1000);

    const urls = fetcher.mock.calls.map((call) => String(call[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith('/api/globe-routes?')).toBe(true);
      expect(url).not.toContain('route-offers');
    }
    // A continuous drag is debounced to far fewer requests than frames.
    expect(urls.length).toBeLessThan(10);
  });

  it('cancels the request still in flight when a newer one is made', async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Promise<Response>(() => undefined);
    });
    const onRoutes = vi.fn();
    const loader = createStoredRoutesLoader({ onRoutes, fetcher });

    loader.request('VIE', WORLD);
    await vi.advanceTimersByTimeAsync(400);
    loader.request('VIE', { ...WORLD, west: 0 });
    expect(signals[0]?.aborted).toBe(true);
    loader.dispose();
    expect(onRoutes).not.toHaveBeenCalled();
  });
});
