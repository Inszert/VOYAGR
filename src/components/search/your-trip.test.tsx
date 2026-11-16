import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

function renderTrip(trip = built()) {
  return render(
    <YourTrip
      built={trip}
      profile={buildProfile()}
      reasons={[]}
      flightHref={(id) => `/explore?tTrip=t&tFlight=${id}`}
      hotelHref={(id) => `/explore?tTrip=t&tHotel=${id}`}
      resetHref="/explore"
      calendarHref="#date-options-heading"
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
});
