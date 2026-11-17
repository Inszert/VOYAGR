import { Button, EmptyState } from '@/components/ui';
import { aviasalesSearchUrl } from '@/booking/aviasales-search';
import { addDays } from '@/core/dates';
import { format } from '@/core/money';
import type { SearchProfile } from '@/core/trip/types';
import { getEnv } from '@/lib/env';
import { shortDate, weekdayDate } from '@/lib/display-date';
import type { SearchOutcome } from '@/search/types';

/**
 * What a search that found no trip says, and what it offers instead.
 *
 * "Nothing" is three different facts and each has its own way out:
 *
 *  - **Close calls exist.** The near misses below say what ruled each out.
 *  - **The vendor had fares, at other stay lengths.** Measured for VIE-KZN in
 *    November: two cached round trips, three nights and six, against a
 *    seven-night search. Those are listed, at the vendor's own price, each a
 *    link that searches exactly those dates.
 *  - **The vendor had nothing at all** for the route and dates. Said plainly,
 *    because a cache of recent searches is not a timetable, and the way out
 *    is other dates.
 *
 * Every price here is a vendor's quote passed through `format`, never a sum.
 */

export interface EmptySearchProps {
  outcome: SearchOutcome;
  profile: SearchProfile;
  /** This search, with some parameters changed and some removed. */
  linkWith: (changes: Readonly<Record<string, string | null>>) => string;
  changeSearchHref?: string | undefined;
}

/** How many days either side "nearby dates" widens the window by. */
const NEARBY_DAYS = 7;

function nightsLabel(min: number, max: number): string {
  return min === max ? `${min}-night` : `${min}- to ${max}-night`;
}

/**
 * A live Aviasales search for the one route and the one pair of dates this
 * search asked about. A search over several origins, destinations or date
 * windows has no single "same route and dates" to send the traveller to, so it
 * gets no link rather than a guessed one.
 */
function liveAviasalesHref(outcome: SearchOutcome, profile: SearchProfile): string | null {
  const { plan } = outcome.diagnostics;
  const origin = profile.origins[0];
  const destination = plan.destinations[0];
  const window = plan.dateWindows[0];
  if (
    profile.origins.length !== 1 ||
    plan.destinations.length !== 1 ||
    plan.dateWindows.length !== 1 ||
    !origin ||
    !destination ||
    !window
  ) {
    return null;
  }

  return aviasalesSearchUrl({
    origin,
    destination,
    departureDate: window.departureDate,
    returnDate: window.returnDate,
    passengers: profile.passengers,
    marker: getEnv().AVIASALES_PARTNER_ID ?? null,
  });
}

export function EmptySearch({ outcome, profile, linkWith, changeSearchHref }: EmptySearchProps) {
  const { diagnostics, nearMisses } = outcome;
  const otherStays = outcome.otherStayLengths ?? [];
  const vendor =
    diagnostics.sources.find((source) => source.part === 'flights')?.displayName ??
    'The flight provider';
  const span = `${shortDate(profile.earliestDeparture)} and ${shortDate(profile.latestReturn)}`;

  // The same search with the window widened either side, as a custom window so
  // the stay length and everything else is kept.
  const nearbyHref = linkWith({
    tTrip: null,
    tFlight: null,
    tHotel: null,
    flexibility: 'custom',
    departureDate: null,
    returnDate: null,
    earliestDeparture: addDays(profile.earliestDeparture, -NEARBY_DAYS),
    latestReturn: addDays(profile.latestReturn, NEARBY_DAYS),
    minNights: String(profile.minNights),
    maxNights: String(profile.maxNights),
  });

  const actions = (
    <div className="flex flex-wrap justify-center gap-3">
      <Button asChild variant="secondary" size="md">
        <a href={nearbyHref}>Search {NEARBY_DAYS} days either side</a>
      </Button>
      {changeSearchHref ? (
        <Button asChild variant="ghost" size="md">
          <a href={changeSearchHref}>Change the search</a>
        </Button>
      ) : null}
    </div>
  );

  if (nearMisses.length === 0 && otherStays.length > 0) {
    return (
      <EmptyState
        title={`No ${nightsLabel(profile.minNights, profile.maxNights)} trip in those dates`}
        description={`${vendor} has return flights between ${span}, but none for that length of stay. These are the lengths it does have. Each price is the return flight alone, as the vendor quoted it; choosing one prices the whole trip for those dates.`}
        action={
          <div className="flex w-full flex-col items-center gap-4">
            <ul
              aria-label="Other stay lengths with fares"
              className="flex w-full max-w-md flex-col gap-2"
            >
              {otherStays.map((stay) => (
                <li key={`${stay.destination}-${stay.departureDate}-${stay.returnDate}`}>
                  <a
                    href={linkWith({
                      tTrip: null,
                      tFlight: null,
                      tHotel: null,
                      flexibility: 'exact',
                      departureDate: stay.departureDate,
                      returnDate: stay.returnDate,
                    })}
                    className="border-border hover:border-border-strong focus-visible:outline-accent-to text-ink flex items-baseline justify-between gap-4 rounded-(--radius-control) border px-4 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <span>
                      <span className="font-medium">
                        {stay.nights} {stay.nights === 1 ? 'night' : 'nights'}
                      </span>
                      <span className="text-ink-muted">
                        {' '}
                        · {weekdayDate(stay.departureDate)} – {weekdayDate(stay.returnDate)}
                      </span>
                    </span>
                    <span className="tabular-nums">flights {format(stay.price)}</span>
                  </a>
                </li>
              ))}
            </ul>
            {actions}
          </div>
        }
      />
    );
  }

  if (
    nearMisses.length === 0 &&
    diagnostics.flightOffersFound === 0 &&
    diagnostics.issues.length === 0
  ) {
    const liveHref = liveAviasalesHref(outcome, profile);
    return (
      <EmptyState
        title="No fares came back for these dates"
        description={`${vendor} returned no price for this route between ${span}. Its prices come from what travellers searched recently, so a quiet route can show nothing even when airlines fly it. Dates either side, or another month, may have fares.`}
        action={
          liveHref ? (
            <div className="flex w-full flex-col items-center gap-4">
              <Button asChild variant="secondary" size="md">
                <a href={liveHref} target="_blank" rel="noopener noreferrer sponsored">
                  Search live prices on Aviasales (opens in a new tab)
                </a>
              </Button>
              {actions}
            </div>
          ) : (
            actions
          )
        }
      />
    );
  }

  return (
    <EmptyState
      title="Nothing came in under your limits"
      description={
        nearMisses.length > 0
          ? 'These were the closest, and each one says below what ruled it out.'
          : 'Nothing was found within the dates, the budget and the destinations you set.'
      }
      action={actions}
    />
  );
}
