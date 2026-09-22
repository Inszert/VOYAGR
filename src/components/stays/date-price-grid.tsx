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
        <h2 id="dates-heading" className="text-ink text-lg font-medium">
          Which dates are cheaper?
        </h2>
        <p className="text-ink-muted text-sm">
          {priced.length} of {prices.length} date ranges were priced.
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {prices.map((price) => {
          const difference = differenceLabel(price);

          return (
            <li key={`${price.checkIn}:${price.checkOut}`}>
              <a
                href={hrefFor(price)}
                aria-current={price.selected ? 'true' : undefined}
                className={cn(
                  'border-border bg-surface-raised focus-visible:outline-accent-to block rounded-[--radius-control] border p-3',
                  'hover:border-border-strong transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
                  price.selected && 'border-accent-to',
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-ink text-sm font-medium">{windowLabel(price)}</span>
                  <span className="text-ink-muted text-xs">{price.nights} nights</span>
                </span>

                {price.total ? (
                  <Price
                    className="mt-1"
                    amount={format(price.total)}
                    size="md"
                    caption={price.perNight ? `${format(price.perNight)} a night` : null}
                  />
                ) : (
                  /*
                   * Said in words, not left blank. A blank cell reads as a
                   * date nobody can book rather than one nobody quoted.
                   */
                  <span className="text-caution-ink mt-1 block text-sm">
                    No price came back for these dates
                  </span>
                )}

                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  {difference ? (
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px]',
                        price.selected
                          ? 'border-accent-to text-accent-ink'
                          : 'border-border text-ink-muted',
                      )}
                    >
                      {difference}
                    </span>
                  ) : null}
                  {price.cheapest && !price.selected ? (
                    <span className="border-border text-ink rounded-full border px-2 py-0.5 text-[11px] font-medium">
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
