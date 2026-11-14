import { getEnv } from '@/lib/env';
import { getProviderRegistry } from '@/providers/registry';
import { getActiveDataSource } from '@/providers/request-source';
import { loadFlexDates } from '@/search/flex-dates';
import { FlexDatesStrip } from './flex-dates-strip';

/**
 * The flexible-dates strip with its prices loaded.
 *
 * A server component: it reads the shared day-price cache and renders the
 * strip, so a page that wants "fly a few days earlier or later" says where the
 * trip goes and when, and nothing else. It renders nothing when the window is
 * set to zero or when the trip is not one this can be asked about.
 */

export interface FlexDatesSectionProps {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  currency: string;
  passengers: number;
  /** A search link with `__DEPARTURE__` and `__RETURN__` where the dates go. */
  hrefTemplate: string;
  className?: string;
}

export async function FlexDatesSection({
  hrefTemplate,
  className,
  ...trip
}: FlexDatesSectionProps) {
  const windowDays = getEnv().FLEX_DAYS;
  if (windowDays === 0 || trip.returnDate <= trip.departureDate) return null;

  const source = (await getActiveDataSource()).effective;
  const flex = await loadFlexDates(
    { ...trip, windowDays },
    {
      flights: getProviderRegistry(source).flights,
      today: new Date().toISOString().slice(0, 10),
    },
  );

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
