import { format } from '@/core/money';
import type { StayDatePrice } from '@/search/stays/calendar';
import { cn } from '@/lib/cn';
import { shortDateRange } from '@/lib/display-date';
import { Price } from '@/components/ui';

/**
 * What the same stay costs on neighbouring dates.
 *
 * Shown *before* the hotel list on purpose: choosing a property and then
 * discovering the week was the expensive one is the wrong order to learn
 * things in. Every figure here was returned by a provider for that exact
 * window - there is no interpolation and no carrying a price sideways.
 *
 * **A window with no price is shown, not hidden.** "We looked and nothing
 * came back" and "we never looked" are different answers, and omitting the
 * first tells somebody the date does not exist.
 *
 * Styling is deliberately not a traffic light. Cheaper is marked, dearer is
 * left plain, and neither is coloured as good or bad: the comparison is
 * factual, and a red date would be editorialising about a price the provider
 * simply quoted.
 */

export interface DatePriceGridProps {
  readonly prices: readonly StayDatePrice[];
  /** Builds the link that selects a window. */
  readonly hrefFor: (price: StayDatePrice) => string;
}

/**
 * `10 – 14 Jun`.
 *
 * Through the shared formatter rather than `toLocaleDateString`: the ICU data
 * on one machine writes "Sept" and on another "Sep", and the same dates
 * appear on the cards below this grid.
 */
function windowLabel(price: StayDatePrice): string {
  return shortDateRange(price.checkIn, price.checkOut);
}

function differenceLabel(price: StayDatePrice): string | null {
  if (price.selected) return 'Your dates';
  if (!price.differenceFromSelected || price.differenceFromSelected.amount === 0) return null;

  const cheaper = price.differenceFromSelected.amount < 0;
  const magnitude = format({
    amount: Math.abs(price.differenceFromSelected.amount),
    currency: price.differenceFromSelected.currency,
  });

  const percent =
    price.fractionFromSelected === null
      ? ''
      : ` · ${Math.abs(price.fractionFromSelected * 100).toFixed(1)}%`;

  return `${magnitude}${percent} ${cheaper ? 'cheaper' : 'more'}`;
}

export function DatePriceGrid({ prices, hrefFor }: DatePriceGridProps) {
  const priced = prices.filter((price) => price.total !== null);

  return (
    <section aria-labelledby="dates-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dates-heading" className="text-ink font-display text-2xl">
          Which dates are cheaper?
        </h2>
        <p className="text-ink-muted text-sm">
          {priced.length} of {prices.length} date ranges were priced.
        </p>
      </div>

      {/*
        One row, not a grid.

        The windows are a sequence - each starts a day after the last - and a
        grid wraps that sequence into rows that read like unrelated boxes. As
        a strip it reads left to right like the calendar it is: all of it at
        once on a wide screen, and scrolled sideways, snapping to each window,
        on a phone. The scroll region is a list of links, so the keyboard
        reaches every window and brings it into view by focusing it.
      */}
      <ul className="-mx-1 grid snap-x snap-mandatory auto-cols-[minmax(9rem,1fr)] grid-flow-col gap-2 overflow-x-auto px-1 pt-1 pb-3">
        {prices.map((price) => {
          const difference = differenceLabel(price);
          const cheaper =
            !price.selected &&
            price.differenceFromSelected !== null &&
            price.differenceFromSelected.amount < 0;

          return (
            <li key={`${price.checkIn}:${price.checkOut}`} className="flex snap-start">
              <a
                href={hrefFor(price)}
                aria-current={price.selected ? 'true' : undefined}
                className={cn(
                  'border-border bg-surface-raised focus-visible:outline-accent-to flex w-full flex-col rounded-(--radius-card) border p-3.5',
                  'ease-standard duration-quick transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
                  price.selected
                    ? 'border-accent-to bg-accent-to/10'
                    : 'hover:border-border-strong hover:bg-surface-sunken',
                )}
              >
                <span className="text-ink text-sm font-medium tabular-nums">
                  {windowLabel(price)}
                </span>
                <span className="text-ink-muted text-xs">{price.nights} nights</span>

                {price.total ? (
                  <Price
                    className="mt-3"
                    amount={format(price.total)}
                    size="md"
                    caption={price.perNight ? `${format(price.perNight)} a night` : null}
                  />
                ) : (
                  /*
                   * Said in words, not left blank. A blank cell reads as a
                   * date nobody can book rather than one nobody quoted.
                   */
                  <span className="text-caution-ink mt-3 block text-sm">
                    No price came back for these dates
                  </span>
                )}

                {/*
                  The comparison as a line, the two states as badges.

                  "€36.00 · 9.9% cheaper" is a fact about this window and
                  reads as a sentence; boxed, it wrapped into a two-line pill
                  in a card this narrow. "Your dates" and "Cheapest found" are
                  states, and states are what badges are for.
                */}
                {difference && !price.selected ? (
                  <span
                    className={cn(
                      'mt-2 text-xs tabular-nums',
                      cheaper ? 'text-ink' : 'text-ink-muted',
                    )}
                  >
                    {difference}
                  </span>
                ) : null}

                <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 empty:hidden">
                  {price.selected ? (
                    <span className="bg-tint-ink text-surface rounded-(--radius-pill) px-2 py-0.5 text-[11px] font-semibold">
                      {difference}
                    </span>
                  ) : null}
                  {price.cheapest && !price.selected ? (
                    <span className="bg-ink text-surface rounded-(--radius-pill) px-2 py-0.5 text-[11px] font-semibold">
                      Cheapest found
                    </span>
                  ) : null}
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <p className="text-ink-muted text-sm">
        Prices are for the dates actually searched. Nothing here is estimated between them.
      </p>
    </section>
  );
}
