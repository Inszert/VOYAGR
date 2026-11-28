// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { StageData } from './stage-store';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The globe itself is not under test: a stand-in with one route arc a user can click.
vi.mock('./globe-stage', () => ({
  GlobeStage: (props: { onRouteSelect?: (r: { origin: string; destination: string }) => void }) => (
    <div>
      <button
        type="button"
        onClick={() => props.onRouteSelect?.({ origin: 'VIE', destination: 'LIS' })}
      >
        arc VIE-LIS
      </button>
    </div>
  ),
}));

import { StageHost } from './stage-host';
import { publishStageData } from './stage-store';

const offers = {
  origin: 'VIE',
  destination: 'LIS',
  offers: [],
  freshness: { label: 'checked 1 h ago' },
};

describe('StageHost route click', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/globe-routes')) {
        return Promise.resolve(new Response(JSON.stringify({ routes: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(offers), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/explore?departureDate=2027-03-10&returnDate=2027-03-17');
    publishStageData({
      origins: [{ code: 'VIE' }],
      routes: { type: 'FeatureCollection', features: [] },
    } as unknown as StageData);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const offerCalls = () =>
    fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/route-offers'));

  it('makes no price call until a route is clicked, then exactly one', async () => {
    render(<StageHost />);
    await act(async () => {});
    expect(offerCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'arc VIE-LIS' }));
    await act(async () => {});

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(offerCalls()).toHaveLength(1);
    const url = String(offerCalls()[0]![0]);
    expect(url).toContain('origin=VIE');
    expect(url).toContain('destination=LIS');
    expect(url).toContain('departureDate=2027-03-10');
    expect(url).toContain('returnDate=2027-03-17');
  });
});
