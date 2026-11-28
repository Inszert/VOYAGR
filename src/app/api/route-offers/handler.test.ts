// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { money } from '@/core/money';
import type { FlightOffer } from '@/core/trip/types';
import type { KiwiLookupResult } from '@/providers/flights/kiwi-read-path';
import { createRouteOffersHandler } from './handler';

const leg = (from: string, to: string) => ({
  segments: [
    {
      origin: from,
      destination: to,
      departsAt: '2027-02-10T07:00:00',
      arrivesAt: '2027-02-10T09:10:00',
      carrier: 'FR',
      flightNumber: '123',
    },
  ],
  durationMinutes: 130,
  cabinBaggageIncluded: null,
  checkedBaggageIncluded: null,
  selfTransfer: null,
});

const offer = {
  id: 'o1',
  providerId: 'kiwi-mcp',
  outbound: leg('VIE', 'BCN'),
  inbound: leg('BCN', 'VIE'),
  price: money(12345, 'EUR'),
  observedAt: '2026-11-28T10:00:00.000Z',
  expiresAt: null,
  deepLink: 'https://www.kiwi.com/deep?x=1',
} as unknown as FlightOffer;

const url = (extra = '') =>
  `http://localhost/api/route-offers?origin=VIE&destination=BCN&departureDate=2027-02-10&returnDate=2027-02-14${extra}`;

describe('route offers handler', () => {
  it('runs the lookup once per click and words the price and link', async () => {
    const lookup = vi.fn(async (): Promise<KiwiLookupResult> => ({
      status: 'fresh',
      offers: [offer],
      observedAt: '2026-11-28T10:00:00.000Z',
      ageMs: 0,
      label: 'checked less than 1 h ago',
      source: 'mcp',
      error: null,
    }));
    const response = await createRouteOffersHandler(lookup)(new Request(url()));
    const body = (await response.json()) as {
      label: string;
      offers: { price: string; bookingUrl: string }[];
    };
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(body.label).toBe('checked less than 1 h ago');
    expect(body.offers[0]?.bookingUrl).toBe('https://www.kiwi.com/deep?x=1');
    expect(body.offers[0]?.price).toMatch(/123\.45/);
  });

  it('reports no_data honestly when the call failed and nothing is stored', async () => {
    const lookup = vi.fn(async (): Promise<KiwiLookupResult> => ({
      status: 'no_data',
      offers: [],
      observedAt: null,
      ageMs: null,
      label: 'no data yet',
      error: null,
    }));
    const response = await createRouteOffersHandler(lookup)(new Request(url()));
    const body = (await response.json()) as { status: string; offers: unknown[] };
    expect(body.status).toBe('no_data');
    expect(body.offers).toEqual([]);
  });

  it('refuses bad input without looking anything up', async () => {
    const lookup = vi.fn();
    const handler = createRouteOffersHandler(lookup);
    expect((await handler(new Request(url('&adults=0')))).status).toBe(400);
    expect(
      (await handler(new Request('http://localhost/api/route-offers?origin=VIE'))).status,
    ).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
  });
});
