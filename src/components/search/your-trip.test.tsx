import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { offersForTrip } from '@/booking/partners';
import { SAVED_TRIPS_KEY } from '@/lib/preferences';
import { parseTripCarry } from '@/search/stays/trip-stays';
import { TripFlightCard } from '@/components/stays/trip-flight-card';
import { format } from '@/core/money';
import { perTraveller } from '@/core/party';
import {
  buildFlightOffer,
  buildHotelOffer,
  buildLeg,
  buildProfile,
} from '@/core/trip/test-support';
import type { BuiltTrip, FlightChoice } from '@/search/trip-builder';
import type { RankedTrip } from '@/search/types';
import { buildRankedTrip } from './test-support';
import { YourTrip } from './your-trip';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const createTrip = vi.hoisted(() => vi.fn(async () => ({ saved: true })));
vi.mock('@/app/actions/trips', () => ({ createTripAction: createTrip }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  createTrip.mockClear();
});

function choice(trip: RankedTrip, current: RankedTrip, isCurrent: boolean): FlightChoice {
  return {
    offerId: trip.candidate.flight.id,
    label: 'x',
    detail: 'x',
    trip,
    totalDeltaMinorUnits: trip.cost.total.amount - current.cost.total.amount,
    scoreDelta: trip.score.score - current.score.score,
    isCurrent,
    departureShiftMinutes: 0,
  };
}

function built(overrides: { flightArrival?: string | null; transfer?: boolean } = {}): BuiltTrip {
  const leg = buildLeg();
  const outbound =
    overrides.flightArrival === undefined
      ? leg
      : {
          ...leg,
          segments: leg.segments.map((s) => ({ ...s, arrivesAt: overrides.flightArrival! })),
        };
  const trip = buildRankedTrip({
    passengers: 2,
    flight: buildFlightOffer({ id: 'flight-a', outbound }),
    hotel: buildHotelOffer({ name: 'Hotel Aurora', starRating: 4 }),
    ...(overrides.transfer === false ? { transfer: null } : {}),
  });
  const dearer = buildRankedTrip({
    passengers: 2,
    flight: buildFlightOffer({
      id: 'flight-b',
      price: { amount: trip.candidate.flight.price.amount + 2_400, currency: 'EUR' },
    }),
    hotel: trip.candidate.hotel,
  });

  return {
    trip,
    original: trip,
    customised: false,
    deltaFromOriginal: null,
    flights: [choice(trip, trip, true), choice(dearer, trip, false)],
    hotels: [],
    dates: [],
  };
}

function renderTrip(trip = built(), extra: Partial<React.ComponentProps<typeof YourTrip>> = {}) {
  return render(
    <YourTrip
      built={trip}
      profile={buildProfile()}
      reasons={[]}
      flightHref={(id) => `/explore?tTrip=t&tFlight=${id}`}
      hotelHref={(id) => `/explore?tTrip=t&tHotel=${id}`}
      resetHref="/explore"
      calendarHref="#date-options-heading"
      {...extra}
    />,
  );
}

describe('YourTrip', () => {
  it('prints the arrival as the arrival, never the departure twice', () => {
    renderTrip();
    const out = screen.getByRole('region', { name: /Outbound/ });
    expect(within(out).getByText('09:30')).toBeTruthy();
    expect(within(out).getByText('12:15')).toBeTruthy();
  });

  it('says a landing time nobody stated is not stated', () => {
    renderTrip(built({ flightArrival: null }));
    const out = screen.getByRole('region', { name: /Outbound/ });
    expect(within(out).getByText('Landing time not stated')).toBeTruthy();
    expect(within(out).getAllByText('09:30')).toHaveLength(1);
    expect(screen.getByText(/Check the landing times/)).toBeTruthy();
  });

  it('states the total for the party, and per person from the core split', () => {
    const trip = built();
    renderTrip(trip);
    const summary = screen.getByRole('complementary', { name: 'Trip summary' });

    expect(within(summary).getByText('Total for 2 travellers')).toBeTruthy();
    expect(within(summary).getAllByText(format(trip.trip.cost.total)).length).toBeGreaterThan(0);
    const each = perTraveller(trip.trip.cost.total, 2).each;
    expect(within(summary).getByText(`${format(each)} per person`)).toBeTruthy();
  });

  it('names what the total leaves out once, in the summary', () => {
    renderTrip(built({ transfer: false }));
    const summary = screen.getByRole('complementary', { name: 'Trip summary' });
    expect(within(summary).getByText(/Not included/)).toBeTruthy();
    expect(screen.queryByText(/No airport transfer was priced/)).toBeNull();
  });

  it('changes a flight as one radio per option, against the current total', () => {
    renderTrip();
    const out = screen.getByRole('region', { name: /Outbound/ });
    fireEvent.click(within(out).getByRole('button', { name: 'Change outbound flight' }));

    const radios = within(out).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    // The current choice says so in a word, not by colour alone.
    expect(within(out).getByText('Selected')).toBeTruthy();
    expect(within(out).getByText('+ €24.00')).toBeTruthy();

    fireEvent.click(radios[1]!);
    expect(push).toHaveBeenCalledWith('/explore?tTrip=t&tFlight=flight-b', { scroll: false });
  });

  it('carries no severity badges', () => {
    renderTrip();
    expect(screen.queryByText(/Severity/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Good to know' })).toBeTruthy();
  });

  it('says the stay is not priced, and offers the stays step, when none is priced', () => {
    const noStay = built();
    const bare = { ...noStay, trip: buildRankedTrip({ passengers: 2, hotel: null }) };
    renderTrip(bare, { tripHref: '/explore?tTrip=t' });
    const stay = screen.getByRole('region', { name: /^Stay/ });
    expect(within(stay).getByText('Stay not priced')).toBeTruthy();
    const choose = within(stay).getByRole('link', { name: /Choose a stay in/ });
    expect(choose.getAttribute('href')).toMatch(/^\/stays\?/);
  });

  it('shows the chosen flight, which goes to the stays and back to the flights', () => {
    renderTrip(built(), { tripHref: '/explore?tTrip=t&tFlight=flight-a' });
    const summary = screen.getByRole('complementary', { name: 'Trip summary' });
    const card = within(summary).getByRole('link', { name: /Your flight/ });
    expect(within(card).getByText('Choose a stay for this trip')).toBeTruthy();

    const url = new URL(card.getAttribute('href')!, 'http://x.test');
    expect(url.pathname).toBe('/stays');
    expect(url.searchParams.get('checkIn')).toBeTruthy();
    const carry = parseTripCarry(Object.fromEntries(url.searchParams));
    expect(carry?.tripHref).toBe('/explore?tTrip=t&tFlight=flight-a');

    cleanup();
    render(<TripFlightCard carry={carry!} />);
    const back = screen.getByRole('link', { name: 'Back to your flights' });
    expect(back.getAttribute('href')).toBe('/explore?tTrip=t&tFlight=flight-a');
    expect(screen.getByText(/^Out /)).toBeTruthy();
  });

  it('does not trust a return address that leaves the explorer', () => {
    expect(parseTripCarry({ flightOut: 'Out 09:30', tripHref: 'https://evil.test/' })).toBeNull();
    expect(parseTripCarry({ flightOut: 'Out 09:30', tripHref: '//evil.test/explore' })).toBeNull();
  });

  it('keeps a signed-out trip in this browser, and says so', () => {
    renderTrip(built(), { tripHref: '/explore?tTrip=t', signedIn: false });
    const summary = screen.getByRole('complementary', { name: 'Trip summary' });
    fireEvent.click(within(summary).getByRole('button', { name: 'Save this trip' }));

    expect(within(summary).getByText(/Saved in this browser/)).toBeTruthy();
    expect(within(summary).getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(SAVED_TRIPS_KEY)!)[0].href).toBe(
      '/explore?tTrip=t',
    );
    expect(createTrip).not.toHaveBeenCalled();
  });

  it('says so when the browser will not keep the trip', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    renderTrip(built(), { tripHref: '/explore?tTrip=t', signedIn: false });
    const summary = screen.getByRole('complementary', { name: 'Trip summary' });
    fireEvent.click(within(summary).getByRole('button', { name: 'Save this trip' }));
    expect(within(summary).getByText(/would not keep it/)).toBeTruthy();
    setItem.mockRestore();
  });

  it('saves a signed-in trip through the account action', async () => {
    renderTrip(built(), { tripHref: '/explore?tTrip=t', signedIn: true });
    const summary = screen.getByRole('complementary', { name: 'Trip summary' });
    fireEvent.change(within(summary).getByLabelText(/Your name on this trip/), {
      target: { value: 'Dani' },
    });
    await act(async () => {
      fireEvent.click(within(summary).getByRole('button', { name: 'Save this trip' }));
    });
    expect(createTrip).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(SAVED_TRIPS_KEY)).toBeNull();
  });

  it('shows the eSIM, transfer and compensation partners with their links', () => {
    const extras = offersForTrip({ categories: ['esim', 'transfer', 'compensation'] });
    renderTrip(built(), { extras });
    const section = screen.getByRole('region', { name: 'Add to this trip' });
    for (const name of ['Yesim', 'GigSky', 'Intui', 'AirHelp']) {
      expect(within(section).getByText(name)).toBeTruthy();
    }
    for (const offer of extras) {
      expect(
        within(section)
          .getAllByRole('link')
          .some((a) => a.getAttribute('href')?.includes(new URL(offer.url).hostname)),
      ).toBe(true);
    }
  });
});
