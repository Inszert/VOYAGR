import { money } from '../money';
import type {
  FlightLeg,
  FlightOffer,
  HotelOffer,
  SearchProfile,
  TransferOffer,
  TripCandidate,
  WeatherOutlook,
} from './types';

/**
 * Test fixtures for the deterministic core.
 *
 * A builder rather than a constant: each test overrides only the field it cares
 * about, so a test that is about budget headroom does not also have to spell out
 * a flight itinerary. Keeping the baseline in one place means a change to the
 * domain types breaks one file instead of twenty.
 *
 * Test-only. Not imported by application code.
 */

export function buildLeg(overrides: Partial<FlightLeg> = {}): FlightLeg {
  return {
    segments: [
      {
        origin: 'VIE',
        destination: 'AYT',
        departsAt: '2026-06-10T09:30:00Z',
        arrivesAt: '2026-06-10T12:15:00Z',
        carrier: 'OS',
        flightNumber: 'OS431',
      },
    ],
    durationMinutes: 165,
    cabinBaggageIncluded: true,
    checkedBaggageIncluded: true,
    selfTransfer: false,
    ...overrides,
  };
}

export function buildFlightOffer(overrides: Partial<FlightOffer> = {}): FlightOffer {
  return {
    id: 'flight-1',
    providerId: 'mock-flights',
    outbound: buildLeg(),
    inbound: buildLeg({
      segments: [
        {
          origin: 'AYT',
          destination: 'VIE',
          departsAt: '2026-06-15T14:00:00Z',
          arrivesAt: '2026-06-15T16:45:00Z',
          carrier: 'OS',
          flightNumber: 'OS432',
        },
      ],
    }),
    price: money(29800, 'EUR'),
    observedAt: '2026-01-15T09:00:00Z',
    ...overrides,
  };
}

export function buildHotelOffer(overrides: Partial<HotelOffer> = {}): HotelOffer {
  return {
    id: 'hotel-1',
    providerId: 'mock-hotels',
    name: 'Hotel Marina',
    starRating: 4,
    reviewScore: 8.6,
    reviewCount: 1240,
    distanceToBeachMetres: 220,
    distanceToCentreMetres: 900,
    boardType: 'breakfast',
    freeCancellation: true,
    totalPrice: money(34000, 'EUR'),
    excludedFees: null,
    observedAt: '2026-01-15T09:00:00Z',
    ...overrides,
  };
}

export function buildTransferOffer(overrides: Partial<TransferOffer> = {}): TransferOffer {
  return {
    id: 'transfer-1',
    providerId: 'mock-transfers',
    mode: 'shared',
    durationMinutes: 45,
    pricePerDirection: money(1600, 'EUR'),
    observedAt: '2026-01-15T09:00:00Z',
    ...overrides,
  };
}

export function buildWeather(days = 5): WeatherOutlook[] {
  return Array.from({ length: days }, (_, index) => ({
    date: `2026-06-${String(10 + index).padStart(2, '0')}`,
    temperatureMinC: 21,
    temperatureMaxC: 28,
    precipitationProbability: 0.1,
    windKph: 12,
    seaTemperatureC: 24,
    confidence: 0.8,
  }));
}

export function buildCandidate(overrides: Partial<TripCandidate> = {}): TripCandidate {
  return {
    id: 'candidate-1',
    origin: 'VIE',
    destination: 'AYT',
    destinationName: 'Antalya',
    dates: { departureDate: '2026-06-10', returnDate: '2026-06-15', nights: 5 },
    passengers: 2,
    flight: buildFlightOffer(),
    hotel: buildHotelOffer(),
    transfer: buildTransferOffer(),
    weather: buildWeather(),
    extraCosts: [],
    ...overrides,
  };
}

export function buildProfile(overrides: Partial<SearchProfile> = {}): SearchProfile {
  return {
    passengers: 2,
    origins: ['VIE'],
    minNights: 4,
    maxNights: 6,
    earliestDeparture: '2026-06-01',
    latestReturn: '2026-06-30',
    targetBudget: money(65000, 'EUR'),
    maxBudget: money(85000, 'EUR'),
    reserveBudget: null,
    travelStyle: 'balanced',
    optimisationMode: 'best_value',
    requireDirectFlights: false,
    requireCheckedBaggage: false,
    requireFreeCancellation: false,
    minHotelReviewScore: null,
    maxBeachDistanceMetres: null,
    ...overrides,
  };
}
