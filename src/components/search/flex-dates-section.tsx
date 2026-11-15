import { getEnv } from '@/lib/env';
import { getProviderRegistry } from '@/providers/registry';
import { getActiveDataSource } from '@/providers/request-source';
import { loadFlexDates, type FlexDates } from '@/search/flex-dates';
import { FlexDatesStrip } from './flex-dates-strip';

/**
 * The flexible-dates strip with its prices loaded.
 *
 * A server component: it reads the shared day-price cache and renders the
 * strip, so a page that wants "fly a few days earlier or later" says where the
 * trip goes and when, and nothing else. It renders nothing when the window is
 * set to zero or when the trip is not one this can be asked about.
 */

export interface FlexDatesTrip {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  currency: string;
  passengers: number;
}

export interface FlexDatesSectionProps extends FlexDatesTrip {
  /** A search link with `__DEPARTURE__` and `__RETURN__` where the dates go. */
  hrefTemplate: string;
  className?: string;
  /** Prices already loaded by the page, so they are read once and shared. */
  preloaded?: FlexDates | null;
}

/** The strip's data, or null when the window is off or the trip is not a trip. */
export async function loadFlexForTrip(trip: FlexDatesTrip): Promise<FlexDates | null> {
  const windowDays = getEnv().FLEX_DAYS;
  if (windowDays === 0 || trip.returnDate <= trip.departureDate) return null;

  const source = (await getActiveDataSource()).effective;
  return loadFlexDates(
    { ...trip, windowDays },
    {
      flights: getProviderRegistry(source).flights,
      today: new Date().toISOString().slice(0, 10),
    },
  );
}

export async function FlexDatesSection({
  hrefTemplate,
  className,
  preloaded,
  ...trip
}: FlexDatesSectionProps) {
  const flex = preloaded === undefined ? await loadFlexForTrip(trip) : preloaded;
  if (!flex) return null;

  return (
    <FlexDatesStrip
      options={flex.options}
      best={flex.best}
      ageMs={flex.ageMs}
      reason={flex.reason}
      {...(className ? { className } : {})}
      hrefFor={(option) =>
        hrefTemplate
          .replace('__DEPARTURE__', option.departureDate)
          .replace('__RETURN__', option.returnDate)
      }
    />
  );
}
