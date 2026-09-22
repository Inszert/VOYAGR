import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FlightLeg } from '@/core/trip/types';
import { RouteLine } from './route-line';

/**
 * A flight, drawn as a line.
 *
 * What is defended is the honesty of the figures on it rather than the shape:
 * the clock times are the provider's wall-clock times read as clock faces,
 * the duration is the one the provider stated, and a connection is named
 * rather than counted silently.
 */

function leg(overrides: Partial<FlightLeg> = {}): FlightLeg {
  return {
    segments: [
      {
        origin: 'VIE',
        destination: 'AYT',
        departsAt: '2026-06-06T06:10:00',
        arrivesAt: '2026-06-06T09:55:00',
        carrier: 'OS',
        flightNumber: 'OS431',
      },
    ],
    durationMinutes: 165,
    cabinBaggageIncluded: true,
    checkedBaggageIncluded: null,
    selfTransfer: null,
    ...overrides,
  };
}

describe('RouteLine', () => {
  it('shows the clock times the provider gave, at each end', () => {
    render(<RouteLine leg={leg()} label="Outbound" />);

    expect(screen.getByText('06:10')).toBeInTheDocument();
    expect(screen.getByText('09:55')).toBeInTheDocument();
    expect(screen.getByText('VIE')).toBeInTheDocument();
    expect(screen.getByText('AYT')).toBeInTheDocument();
  });

  it('states the duration the provider gave, not the gap between two clocks', () => {
    /*
     * The clocks say 06:10 to 09:55, which is three hours forty-five on a
     * single clock face. The flight is two hours forty-five, because Antalya
     * is an hour ahead of Vienna. Subtracting one local time from another is
     * exactly the mistake `durationMinutes` exists to prevent, and a card
     * that made it would overstate every eastbound flight by an hour.
     */
    render(<RouteLine leg={leg()} label="Outbound" />);

    expect(screen.getByText(/2h 45m/)).toBeInTheDocument();
    expect(screen.queryByText(/3h 45m/)).not.toBeInTheDocument();
  });

  it('says direct when there is no stop', () => {
    render(<RouteLine leg={leg()} label="Outbound" />);

    expect(screen.getByText(/direct/)).toBeInTheDocument();
  });

  it('names where a connection is, rather than only counting it', () => {
    render(
      <RouteLine
        leg={leg({
          segments: [
            {
              origin: 'VIE',
              destination: 'IST',
              departsAt: '2026-06-06T06:10:00',
              arrivesAt: '2026-06-06T09:20:00',
              carrier: 'TK',
              flightNumber: 'TK1888',
            },
            {
              origin: 'IST',
              destination: 'AYT',
              departsAt: '2026-06-06T11:00:00',
              arrivesAt: '2026-06-06T12:15:00',
              carrier: 'TK',
              flightNumber: 'TK2412',
            },
          ],
          durationMinutes: 365,
        })}
        label="Outbound"
      />,
    );

    expect(screen.getByText(/1 stop in IST/)).toBeInTheDocument();
    // The ends of the journey, not the ends of the first segment.
    expect(screen.getByText('06:10')).toBeInTheDocument();
    expect(screen.getByText('12:15')).toBeInTheDocument();
  });

  it('tells a screen reader which leg it is hearing', () => {
    render(<RouteLine leg={leg()} label="Return" />);

    expect(screen.getByText(/Return:/)).toBeInTheDocument();
  });

  it('renders nothing rather than a half a line when a leg has no segments', () => {
    const { container } = render(<RouteLine leg={leg({ segments: [] })} label="Outbound" />);

    expect(container).toBeEmptyDOMElement();
  });
});
