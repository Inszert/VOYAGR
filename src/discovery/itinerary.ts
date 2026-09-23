import { getAiProvider, validateItinerary, type Itinerary, type ItineraryRequest } from '@/ai';
import type { TravelStyle, WeatherOutlook } from '@/core/trip/types';
import { getLogger } from '@/lib/logger';
import { shortDate } from '@/lib/display-date';
import type { Place } from '@/providers/types';

const log = getLogger('discovery.itinerary');

/** Places offered to the model: the best-rated few, so a draft stays focused. */
const PLACES_FOR_DRAFT = 8;

/**
 * The request a draft is built from: only facts the page already shows.
 *
 * Pure. The places are the destination's own, best-rated first; the weather
 * is one line per day from the provider's figures. These are also the only
 * sources the guardrail lets the draft quote a number from.
 */
export function itineraryRequestFor(input: {
  readonly destinationName: string;
  readonly nights: number;
  readonly travelStyle: TravelStyle;
  readonly places: readonly Place[];
  readonly weather: readonly WeatherOutlook[];
}): ItineraryRequest {
  const places = [...input.places]
    .filter((place) => place.rating !== null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name))
    .slice(0, PLACES_FOR_DRAFT)
    .map((place) => place.name);

  return {
    destinationName: input.destinationName,
    nights: input.nights,
    travelStyle: input.travelStyle,
    placeNames: places,
    weatherByDay: input.weather
      .slice(0, input.nights)
      .map(
        (day) =>
          `${shortDate(day.date)}: ${Math.round(day.temperatureMaxC)}°C, ${Math.round(day.precipitationProbability * 100)}% chance of rain`,
      ),
    mealsPerDay: 2,
  };
}

/**
 * Draft an itinerary through the AI abstraction, and keep it only if the
 * guardrail accepts it. A failure of any kind is no itinerary, never an
 * error page: the draft is a help, not the page.
 */
export async function draftItinerary(request: ItineraryRequest): Promise<Itinerary | null> {
  if (request.nights < 1 || request.placeNames.length === 0) return null;

  try {
    const draft = await getAiProvider().generateItinerary(request, {
      signal: AbortSignal.timeout(8_000),
    });
    const accepted = validateItinerary(draft, request);
    if (!accepted) log.warn({ destination: request.destinationName }, 'itinerary draft discarded');
    return accepted;
  } catch (error) {
    log.warn({ err: error }, 'itinerary draft failed');
    return null;
  }
}
