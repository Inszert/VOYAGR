import { describe, expect, it } from 'vitest';
import { validateItinerary, type Itinerary } from '@/ai';
import { createMockAiProvider } from '@/ai/providers/mock';
import type { Place } from '@/providers/types';
import { itineraryRequestFor } from './itinerary';

/**
 * Drafted itineraries.
 *
 * Defended: the draft is built from the page's own places and weather, one
 * day per night; and a draft that invents a figure or gets the days wrong is
 * discarded whole, never shown.
 */

const place = (name: string, rating: number | null): Place => ({
  id: name,
  providerId: 'mock-places',
  name,
  category: 'attraction',
  priceLevel: null,
  rating,
  ratingCount: 100,
  distanceFromCentreMetres: 500,
});

const request = itineraryRequestFor({
  destinationName: 'Antalya',
  nights: 3,
  travelStyle: 'balanced',
  places: [place('Old Harbour', 4.2), place('Museum', 4.8), place('Unrated Spot', null)],
  weather: [],
});

describe('itineraryRequestFor', () => {
  it('offers the best-rated places, and never an unrated one', () => {
    expect(request.placeNames).toEqual(['Museum', 'Old Harbour']);
  });
});

describe('validateItinerary', () => {
  it('accepts the mock provider’s draft for the nights asked', async () => {
    const draft = await createMockAiProvider().generateItinerary(request);
    expect(validateItinerary(draft, request)).not.toBeNull();
  });

  it('discards a draft with the wrong number of days', async () => {
    const draft = await createMockAiProvider().generateItinerary(request);
    const short: Itinerary = { ...draft, days: draft.days.slice(0, 2) };
    expect(validateItinerary(short, request)).toBeNull();
  });

  it('discards a draft that invents a figure', async () => {
    const draft = await createMockAiProvider().generateItinerary(request);
    const invented: Itinerary = {
      ...draft,
      days: draft.days.map((day, index) =>
        index === 1 ? { ...day, afternoon: 'Book the €149 boat tour at 14:30.' } : day,
      ),
    };
    expect(validateItinerary(invented, request)).toBeNull();
  });
});
