import { nightsBetween } from '@/core/dates';
import type { TripRecord } from '@/db/repository';
import { findCountryByIso2 } from '@/discovery/countries';
import { shortDateRange } from '@/lib/display-date';
import { placePictureForText, type PlacePictureData } from '@/lib/place-image';

/**
 * A trip, as the words and picture the pages put on it.
 *
 * Presentation only. The night count is `nightsBetween` from the core's date
 * helpers, never subtracted here; the country is spelled out in full; the
 * picture is the one we ship for that place, or null. Nothing in this file is a
 * price.
 */

export interface TripPresentation {
  readonly country: string | null;
  readonly dates: string | null;
  readonly nights: string | null;
  readonly picture: PlacePictureData | null;
}

export function presentTrip(trip: TripRecord): TripPresentation {
  const country = trip.destinationCountry
    ? (findCountryByIso2(trip.destinationCountry)?.name ?? null)
    : null;

  let dates: string | null = null;
  let nights: string | null = null;
  if (trip.startDate && trip.endDate) {
    dates = shortDateRange(trip.startDate, trip.endDate);
    const count = nightsBetween(trip.startDate, trip.endDate);
    nights = count === 1 ? '1 night' : `${count} nights`;
  }

  return {
    country,
    dates,
    nights,
    picture: placePictureForText(trip.destination),
  };
}
