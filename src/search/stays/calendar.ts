import { addDays } from '@/core/dates';
import { compare, ratio, subtract, type Money } from '@/core/money';
import { bestRateFor } from '@/core/stay/comparison';
import type { StayQuery } from '@/core/stay/types';
import type { IsoDate } from '@/core/trip/types';
import type { Limiter } from '@/lib/concurrency';
import { searchAllStays } from '@/providers/stays/fanout';
import type { StayProvider } from '@/providers/stays/types';

/**
 * What a stay costs on other dates, without asking a provider for a calendar.
 *
 * Almost no accommodation provider has a fare-calendar endpoint; nearly all
 * price exact dates. So date exploration is built here, by running the same
 * search over a set of candidate windows and collecting the cheapest
 * comparable rate from each. A provider that *does* have a calendar can
 * later short-circuit this, but no provider is required to have one - which
 * is what keeps the interface small enough for the next vendor to satisfy.
 *
 * **Only dates that were actually searched appear.** There is no
 * interpolation between two priced windows and no carrying a price forward
 * to a neighbouring date. A price on a date nobody asked about is invented,
 * and a calendar of invented prices is worse than a calendar with gaps.
 */

export interface StayDatePrice {
  readonly checkIn: IsoDate;
  readonly checkOut: IsoDate;
  readonly nights: number;
  /** The cheapest rate found for this window, or `null` if nothing was. */
  readonly total: Money | null;
  readonly perNight: Money | null;
  /** Which provider offered it. */
  readonly providerId: string | null;
  /** Difference against the window the user currently has selected. */
  readonly differenceFromSelected: Money | null;
  readonly fractionFromSelected: number | null;
  /** True for the cheapest window in the set. */
  readonly cheapest: boolean;
  /** True for the window the user currently has selected. */
  readonly selected: boolean;
}

export interface CalendarOptions {
  /** How many days either side of the selected check-in to try. */
  readonly shiftDays?: number;
  /** Stay lengths to try, in nights. Defaults to the selected length only. */
  readonly nightOptions?: readonly number[];
  readonly limiter?: Limiter;
  /** Hard cap on provider calls, so exploring cannot become a crawl. */
  readonly maxWindows?: number;
}

/** The windows worth pricing, given what the user has selected. */
export function candidateWindows(
  query: StayQuery,
  options: CalendarOptions = {},
): { checkIn: IsoDate; checkOut: IsoDate; nights: number }[] {
  const shift = options.shiftDays ?? 3;
  const selectedNights = Math.max(
    1,
    Math.round(
      (Date.parse(`${query.checkOut}T00:00:00Z`) - Date.parse(`${query.checkIn}T00:00:00Z`)) /
        86_400_000,
    ),
  );

  const lengths = options.nightOptions?.length ? options.nightOptions : [selectedNights];
  const windows: { checkIn: IsoDate; checkOut: IsoDate; nights: number }[] = [];

  for (let offset = -shift; offset <= shift; offset += 1) {
    const checkIn = addDays(query.checkIn as IsoDate, offset);

    for (const nights of lengths) {
      windows.push({ checkIn, checkOut: addDays(checkIn, nights), nights });
    }
  }

  /*
   * Deduplicated and capped.
   *
   * Every window is a full fan-out across every provider, so the count here
   * multiplies directly into provider calls and into somebody's bill.
   */
  const seen = new Set<string>();

  return windows
    .filter((window) => {
      const key = `${window.checkIn}:${window.checkOut}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, options.maxWindows ?? 15);
}

/**
 * Price each candidate window and report them against the selected one.
 *
 * Windows that returned nothing are kept with a `null` price rather than
 * dropped: "we looked and there was nothing" and "we never looked" are
 * different answers, and a calendar that silently omits the first is
 * telling the user the date does not exist.
 */
export async function exploreStayDates(
  providers: readonly StayProvider[],
  query: StayQuery,
  options: CalendarOptions = {},
): Promise<StayDatePrice[]> {
  const windows = candidateWindows(query, options);

  const priced = await Promise.all(
    windows.map(async (window) => {
      const result = await searchAllStays(
        providers,
        { ...query, checkIn: window.checkIn, checkOut: window.checkOut },
        options.limiter ? { limiter: options.limiter } : {},
      );

      let best: ReturnType<typeof bestRateFor> = null;

      for (const stay of result.stays) {
        const rate = bestRateFor(stay);
        if (!rate) continue;
        if (!best || compare(rate.total, best.total) < 0) best = rate;
      }

      return { window, best };
    }),
  );

  const selected = priced.find(
    (entry) => entry.window.checkIn === query.checkIn && entry.window.checkOut === query.checkOut,
  );

  const reference = selected?.best ?? null;

  const cheapestTotal = priced.reduce<Money | null>((lowest, entry) => {
    if (!entry.best) return lowest;
    if (!lowest || lowest.currency !== entry.best.total.currency) return lowest ?? entry.best.total;

    return compare(entry.best.total, lowest) < 0 ? entry.best.total : lowest;
  }, null);

  return priced.map(({ window, best }) => {
    const sameCurrency =
      best !== null && reference !== null && best.total.currency === reference.total.currency;

    return {
      checkIn: window.checkIn,
      checkOut: window.checkOut,
      nights: window.nights,
      total: best?.total ?? null,
      perNight: best?.perNight ?? null,
      providerId: best?.source.providerId ?? null,
      differenceFromSelected: sameCurrency ? subtract(best.total, reference.total) : null,
      fractionFromSelected: sameCurrency
        ? ratio(subtract(best.total, reference.total), reference.total)
        : null,
      cheapest:
        best !== null &&
        cheapestTotal !== null &&
        best.total.currency === cheapestTotal.currency &&
        compare(best.total, cheapestTotal) === 0,
      selected: window.checkIn === query.checkIn && window.checkOut === query.checkOut,
    };
  });
}
