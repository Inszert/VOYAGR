import { lessThan, subtract, type Money } from '@/core/money';
import type { AirportCode, IsoDate } from '@/core/trip/types';
import type { DateWindow, RankedTrip, SearchOutcome } from './types';

/**
 * What the dates are worth (1.10.1 section 8).
 *
 * Section 8 asks to "show the user visually how changing dates affects price",
 * and section 37 sets the bar for it: can flexible dates *visibly* save money?
 * A window is only worth searching if the answer can be pointed at.
 *
 * Everything here is derived from trips the search already priced. No new
 * provider call, no re-search, no estimate: the cheapest total for a set of
 * dates is the cost engine's total for a real trip that was really costed.
 *
 * Two honesty rules shape the whole module.
 *
 * The first: dates with no trip are not cheap, and they are not expensive
 * either - they are unanswered. `cheapestTotal` is `null` for them, and the
 * page says "nothing found" rather than drawing an empty bar that reads as
 * zero.
 *
 * The second: the breakdown covers the windows the search actually priced, not
 * every window the dates allow. A month of flexible dates is hundreds of
 * combinations and a search prices eight of them, evenly spread. Presenting
 * eight samples as a complete calendar would be a chart that lies about its
 * own resolution, so the count of both is carried and shown.
 */

/** Weather over one date window, as a range rather than a single number. */
export interface DateWeather {
  readonly minC: number;
  readonly maxC: number;
  /**
   * The *lowest* confidence across the stay, not the average.
   *
   * The weakest claim wins, the same rule the provenance model uses: a week
   * whose last three days are climatology is not a forecast because its first
   * four were.
   */
  readonly confidence: number;
  /**
   * The *highest* daily chance of rain over the stay, 0-1.
   *
   * The pessimistic end rather than the average, because an average hides the
   * one washed-out day that is the thing a person moving their dates is trying
   * to avoid.
   */
  readonly rainChance: number;
}

/** One set of dates the search priced, and what it found there. */
export interface DateOption {
  readonly window: DateWindow;
  /**
   * Cheapest eligible total for these dates, or null when nothing qualified.
   *
   * From `cost.total` - the cost engine's figure for a specific trip, not a
   * minimum computed across trips by this module.
   */
  readonly cheapestTotal: Money | null;
  /** The trip that total belongs to, so the page can link to it. */
  readonly cheapestTripId: string | null;
  /** Where the cheapest trip goes. Different dates may favour a different city. */
  readonly destination: AirportCode | null;
  readonly destinationName: string | null;
  /** Best overall score on these dates, from the scoring engine. */
  readonly bestScore: number | null;
  readonly weather: DateWeather | null;
  /** Door-to-door flying time of the cheapest trip, both legs. */
  readonly travelMinutes: number | null;
  /** Eligible trips found on these dates. */
  readonly tripCount: number;
}

export interface DateBreakdown {
  /** Every priced window, in departure order. */
  readonly options: readonly DateOption[];
  readonly cheapest: DateOption | null;
  readonly dearest: DateOption | null;
  /**
   * What moving from the priciest priced dates to the cheapest would save.
   *
   * Null unless at least two windows produced a price - one window is not a
   * choice, and a saving against nothing is not a saving.
   */
  readonly saving: Money | null;
  readonly windowsPriced: number;
  readonly windowsAllowed: number;
  /** True when the search sampled the window rather than covering it. */
  readonly sampled: boolean;
  readonly currency: string;
}

/** Windows compare by their two dates; nights follow from them. */
function windowKey(departureDate: IsoDate, returnDate: IsoDate): string {
  return `${departureDate}..${returnDate}`;
}

export function dateWindowKey(window: DateWindow): string {
  return windowKey(window.departureDate, window.returnDate);
}

function weatherOf(trip: RankedTrip): DateWeather | null {
  const days = trip.candidate.weather;
  if (days.length === 0) return null;

  return {
    minC: Math.min(...days.map((day) => day.temperatureMinC)),
    maxC: Math.max(...days.map((day) => day.temperatureMaxC)),
    confidence: Math.min(...days.map((day) => day.confidence)),
    rainChance: Math.max(...days.map((day) => day.precipitationProbability)),
  };
}

/**
 * Build the breakdown from a completed search.
 *
 * Driven by `plan.dateWindows` rather than by the results, so a window that
 * produced nothing still appears. Dropping it would turn "we looked and found
 * nothing on those dates" into "those dates do not exist", and the second is
 * the more expensive mistake: it hides the possibility that the user's budget,
 * not the calendar, is what is wrong.
 */
export function buildDateBreakdown(outcome: SearchOutcome): DateBreakdown {
  const { plan } = outcome.diagnostics;

  const byWindow = new Map<string, RankedTrip[]>();
  for (const trip of outcome.results) {
    const key = windowKey(trip.candidate.dates.departureDate, trip.candidate.dates.returnDate);
    const existing = byWindow.get(key);
    if (existing) existing.push(trip);
    else byWindow.set(key, [trip]);
  }

  const options: DateOption[] = [...plan.dateWindows]
    .sort((a, b) => dateWindowKey(a).localeCompare(dateWindowKey(b)))
    .map((window) => {
      const trips = byWindow.get(dateWindowKey(window)) ?? [];

      if (trips.length === 0) {
        return {
          window,
          cheapestTotal: null,
          cheapestTripId: null,
          destination: null,
          destinationName: null,
          bestScore: null,
          weather: null,
          travelMinutes: null,
          tripCount: 0,
        };
      }

      // `lessThan` rather than comparing `.amount`: it refuses to compare two
      // currencies, which is the bug this would otherwise hide when a search
      // ever spans more than one.
      const cheapest = trips.reduce((best, trip) =>
        lessThan(trip.cost.total, best.cost.total) ? trip : best,
      );

      return {
        window,
        cheapestTotal: cheapest.cost.total,
        cheapestTripId: cheapest.candidate.id,
        destination: cheapest.candidate.destination,
        destinationName: cheapest.candidate.destinationName,
        // The best score on these dates, which need not be the cheapest trip:
        // "these dates are good value" and "these dates are cheap" are
        // different claims and the page makes them separately.
        bestScore: trips.reduce((best, trip) => Math.max(best, trip.score.score), 0),
        weather: weatherOf(cheapest),
        travelMinutes:
          cheapest.candidate.flight.outbound.durationMinutes +
          cheapest.candidate.flight.inbound.durationMinutes,
        tripCount: trips.length,
      };
    });

  const priced = options.filter(
    (option): option is DateOption & { cheapestTotal: Money } => option.cheapestTotal !== null,
  );

  const cheapest =
    priced.length > 0
      ? priced.reduce((best, option) =>
          lessThan(option.cheapestTotal, best.cheapestTotal) ? option : best,
        )
      : null;

  const dearest =
    priced.length > 0
      ? priced.reduce((worst, option) =>
          lessThan(worst.cheapestTotal, option.cheapestTotal) ? option : worst,
        )
      : null;

  return {
    options,
    cheapest,
    dearest,
    saving:
      cheapest && dearest && priced.length > 1
        ? subtract(dearest.cheapestTotal as Money, cheapest.cheapestTotal as Money)
        : null,
    windowsPriced: plan.dateWindows.length,
    windowsAllowed: plan.dateWindowsAvailable,
    sampled: plan.dateWindows.length < plan.dateWindowsAvailable,
    currency: plan.currency,
  };
}

/**
 * The dates worth pointing at.
 *
 * Section 8 lists "cheapest dates", "best weather" and "best value" as things
 * a person should be able to ask for. They are not three searches - the search
 * already priced every window - so they are three ways of reading one
 * breakdown, computed here rather than by a control that would re-run it.
 *
 * Each is a real trip's real figure. "Best value" is the scoring engine's
 * highest total, not a second opinion about price; "best weather" is the
 * lowest chance of rain, with the warmest day breaking a tie.
 */
export interface DateHighlights {
  readonly cheapest: DateOption | null;
  readonly bestWeather: DateOption | null;
  readonly bestValue: DateOption | null;
}

export function pickHighlights(breakdown: DateBreakdown): DateHighlights {
  const priced = breakdown.options.filter((option) => option.cheapestTotal !== null);

  const bestWeather = priced
    .filter((option) => option.weather !== null)
    .reduce<DateOption | null>((best, option) => {
      if (!best?.weather || !option.weather) return option.weather ? option : best;
      if (option.weather.rainChance !== best.weather.rainChance) {
        return option.weather.rainChance < best.weather.rainChance ? option : best;
      }
      return option.weather.maxC > best.weather.maxC ? option : best;
    }, null);

  const bestValue = priced.reduce<DateOption | null>((best, option) => {
    if (best === null) return option;
    return (option.bestScore ?? 0) > (best.bestScore ?? 0) ? option : best;
  }, null);

  return { cheapest: breakdown.cheapest, bestWeather, bestValue };
}
