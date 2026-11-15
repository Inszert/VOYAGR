import { Price } from '@/components/ui/price';
import { UpdatedAgo } from '@/components/ui/updated-ago';
import { abs, format } from '@/core/money';
import type { FlexOption, FlexSaving } from '@/core/flex-dates';
import { cn } from '@/lib/cn';
import { shortDate, weekdayDate } from '@/lib/display-date';
import { formatWhole } from '@/search/day-prices-json';

/**
 * "Fly a few days earlier or later": the same trip, moved, with what each move
 * costs.
 *
 * Every figure arrives from `src/core/flex-dates.ts` as `Money` and is only
 * formatted here. A day with no price says so and is not a link: it is
 * unanswered, which is not the same as cheap or the same as dear.
 *
 * Colour is never the only signal. The saving is the words "Save", the dearer
 * days say "more", the chosen day carries the words "Your dates" and a heavier
 * outline, and the unknown ones say "No price yet".
 */

export interface FlexDatesStripProps {
  options: readonly FlexOption[];
  best: FlexSaving | null;
  /** Age of the oldest price shown, or null. */
  ageMs: number | null;
  /** Where choosing a day goes: a search for those exact dates. */
  hrefFor: (option: FlexOption) => string;
  /** Why there are no prices, when the provider could not be read. */
  reason?: string | null;
  className?: string;
}

function days(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

/** "Leave 2 days earlier and save €84." */
export function flexSentence(best: FlexSaving): string {
  const { offset } = best.option;

  return `Leave ${days(Math.abs(offset))} ${offset < 0 ? 'earlier' : 'later'} and save ${formatWhole(best.saving)}.`;
}

function differenceOf(
  option: FlexOption,
): { text: string; tone: 'save' | 'more' | 'quiet' } | null {
  if (!option.price) return { text: 'No price yet', tone: 'quiet' };
  // The chosen day is the one everything else is read against.
  if (option.offset === 0) return null;
  if (!option.saving) return { text: 'Not comparable', tone: 'quiet' };
  if (option.saving.amount > 0) return { text: `Save ${formatWhole(option.saving)}`, tone: 'save' };
  if (option.saving.amount < 0) {
    return { text: `${formatWhole(abs(option.saving))} more`, tone: 'more' };
  }

  return { text: 'Same price', tone: 'quiet' };
}

export function FlexDatesStrip({ options, best, ageMs, hrefFor, className }: FlexDatesStripProps) {
  if (options.length <= 1) return null;

  // Every day unknown: a heading over a row of dashes tells nobody anything.
  if (!options.some((option) => option.price !== null)) return null;

  return (
    <section
      aria-labelledby="flex-dates-heading"
      className={cn('flex min-w-0 flex-col gap-3', className)}
    >
      <div className="flex flex-col gap-1">
        <h2 id="flex-dates-heading" className="font-display text-ink text-xl">
          Fly a few days earlier or later
        </h2>

        {best ? <p className="text-ink text-sm font-medium">{flexSentence(best)}</p> : null}

        <UpdatedAgo ageMs={ageMs} />
      </div>

      <ul
        className={cn(
          'flex min-w-0 gap-2 overflow-x-auto pb-2',
          // Scrolls and snaps on a phone; on a wider screen the cells share the row.
          'snap-x snap-mandatory sm:snap-none',
        )}
      >
        {options.map((option) => {
          const chosen = option.offset === 0;
          const difference = differenceOf(option);
          const label = [
            `Leave ${weekdayDate(option.departureDate)}, back ${weekdayDate(option.returnDate)}`,
            option.price ? format(option.price) : 'no price yet',
            chosen ? 'your dates' : '',
            difference?.text.toLowerCase() ?? '',
          ]
            .filter(Boolean)
            .join(', ');

          const body = (
            <>
              {chosen ? (
                <span className="text-ink text-[11px] font-semibold tracking-[0.1em] uppercase">
                  Your dates
                </span>
              ) : null}
              <span className="text-ink text-sm font-medium">
                {weekdayDate(option.departureDate)}
              </span>
              <span className="text-ink-muted text-xs tabular-nums">
                back {shortDate(option.returnDate)}
              </span>

              {option.price ? (
                <Price amount={formatWhole(option.price)} size="sm" className="mt-1" />
              ) : (
                <span aria-hidden="true" className="text-dim mt-1 text-base">
                  &ndash;
                </span>
              )}

              {difference ? (
                <span
                  className={cn(
                    'text-xs font-medium tabular-nums',
                    difference.tone === 'save' ? 'text-positive-ink' : 'text-ink-muted',
                  )}
                >
                  {difference.text}
                </span>
              ) : null}
            </>
          );

          const cell = cn(
            'flex min-h-28 w-full flex-col items-start gap-0.5 rounded-(--radius-card) border p-3 text-left',
            // The chosen day is told apart by weight and by its words, not by colour alone.
            chosen ? 'border-ink border-2' : 'border-hairline',
            option.price
              ? 'ease-standard duration-quick hover:border-border-strong transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-to'
              : 'border-dashed',
          );

          return (
            <li key={option.departureDate} className="w-28 min-w-28 flex-1 snap-start">
              {option.price ? (
                <a
                  href={hrefFor(option)}
                  aria-label={label}
                  aria-current={chosen ? 'true' : undefined}
                  className={cell}
                >
                  {body}
                </a>
              ) : (
                <div
                  role="group"
                  aria-label={label}
                  aria-current={chosen ? 'true' : undefined}
                  className={cell}
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
