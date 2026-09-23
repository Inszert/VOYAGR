import { format, money, type Money } from '@/core/money';
import { Badge, Disclosure, Icon } from '@/components/ui';
import { cn } from '@/lib/cn';
import { weekdayDate } from '@/lib/display-date';
import type { Alternative } from '@/search/alternatives';
import type { DateChoice, FlightChoice } from '@/search/trip-builder';

/**
 * Swapping a part of the trip, shown as whole trips rather than as parts.
 *
 * Every row states what the *trip* would cost and score with that part, not
 * what the part costs. A cheaper flight that lands at midnight often makes
 * the holiday worse, and a list of fares would quietly invite exactly that
 * mistake. The difference is given in both directions - money and score -
 * because neither answers the question alone.
 *
 * **Every row can be chosen.** With `hrefFor`, each option is a link that
 * rebuilds the trip with it, so the card becomes the trip the traveller made
 * and every other option is re-measured from there. The link is the whole
 * mechanism: the server swaps the part in through the engine, and nothing on
 * this page adds a price to another.
 */

export interface SwapPanelProps {
  heading: string;
  alternatives: readonly (Alternative | FlightChoice)[];
  currency: string;
  /** Where choosing an option goes. Without it the panel only compares. */
  hrefFor?: (alternative: Alternative) => string;
  /** Passed to the disclosure, so a card can group several into one panel. */
  className?: string;
}

function deltaLabel(minorUnits: number, currency: string): string {
  if (minorUnits === 0) return 'Same price';
  const formatted = format(money(Math.abs(minorUnits), currency));
  return minorUnits < 0 ? `${formatted} cheaper` : `${formatted} more`;
}

/** "2h 15m earlier". The shift is the builder's, read off two local clocks. */
function shiftLabel(minutes: number | null): string | null {
  if (minutes === null || minutes === 0) return null;

  const size = Math.abs(minutes);
  const hours = Math.floor(size / 60);
  const rest = size % 60;
  const amount = hours === 0 ? `${rest}m` : rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;

  return `Leaves ${amount} ${minutes < 0 ? 'earlier' : 'later'}`;
}

/** Cheaper in the place's tint, dearer in plain ink: a fact, not a verdict. */
function DeltaText({ minorUnits, currency }: { minorUnits: number; currency: string }) {
  return (
    <span className={minorUnits < 0 ? 'text-tint-ink font-medium' : undefined}>
      {deltaLabel(minorUnits, currency)}
    </span>
  );
}

function ChooseLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="border-border-strong text-ink hover:border-tint-ink hover:text-tint-ink focus-visible:outline-brand-500 ease-standard duration-quick inline-flex items-center gap-1 rounded-(--radius-pill) border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      Choose<span className="sr-only"> {label}</span>
      <Icon name="arrow-right" size={0.85} />
    </a>
  );
}

export function SwapPanel({ heading, alternatives, currency, hrefFor, className }: SwapPanelProps) {
  if (alternatives.length <= 1) return null;

  return (
    <Disclosure summary={heading} className={className}>
      <ul className="divide-border flex flex-col divide-y">
        {alternatives.map((alternative) => {
          const shift =
            'departureShiftMinutes' in alternative
              ? shiftLabel(alternative.departureShiftMinutes)
              : null;

          return (
            <li
              key={alternative.offerId}
              className={cn(
                'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-ink flex flex-wrap items-center gap-2 text-sm font-medium">
                  {alternative.label}
                  {alternative.isCurrent ? (
                    <Badge tone="brand" srPrefix="Selection">
                      Chosen
                    </Badge>
                  ) : null}
                </p>
                <p className="text-ink-muted text-sm">
                  {alternative.detail}
                  {shift ? <span className="text-ink"> · {shift}</span> : null}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right text-sm">
                  {/* The whole trip, not the component. */}
                  <p className="text-ink tabular-nums">
                    {format(alternative.trip.cost.total)} total
                  </p>
                  <p className="text-ink-muted tabular-nums">
                    {alternative.isCurrent ? (
                      `Score ${alternative.trip.score.score}`
                    ) : (
                      <>
                        <DeltaText
                          minorUnits={alternative.totalDeltaMinorUnits}
                          currency={currency}
                        />{' '}
                        · score {alternative.trip.score.score} (
                        {alternative.scoreDelta >= 0 ? '+' : ''}
                        {alternative.scoreDelta})
                      </>
                    )}
                  </p>
                  {alternative.trip.eligibility.eligible ? null : (
                    <p className="text-critical-ink text-xs">Outside your limits</p>
                  )}
                </div>

                {hrefFor && !alternative.isCurrent ? (
                  <ChooseLink href={hrefFor(alternative)} label={alternative.label} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Disclosure>
  );
}

export interface DateSwapPanelProps {
  choices: readonly DateChoice[];
  hrefFor: (choice: DateChoice) => string;
  className?: string;
}

function shiftDaysLabel(days: number): string {
  const size = Math.abs(days);
  return `${size} ${size === 1 ? 'day' : 'days'} ${days < 0 ? 'earlier' : 'later'}`;
}

/** A difference the builder measured, or nothing where it could not. */
function moneyDelta(delta: Money | null) {
  if (!delta) return null;
  return <DeltaText minorUnits={delta.amount} currency={delta.currency} />;
}

/**
 * Moving the whole trip to other dates.
 *
 * Each row is a trip the search actually priced - same place, same length of
 * stay, a different departure - so its total is that trip's own. Choosing one
 * rebuilds the card from it; the flight and hotel choices start again from
 * what that date's best trip was.
 */
export function DateSwapPanel({ choices, hrefFor, className }: DateSwapPanelProps) {
  if (choices.length === 0) return null;

  return (
    <Disclosure summary="Change the dates" className={className}>
      <ul className="divide-border flex flex-col divide-y">
        {choices.map((choice) => {
          const { dates } = choice.trip.candidate;
          const label = `${weekdayDate(dates.departureDate)} to ${weekdayDate(dates.returnDate)}`;

          return (
            <li
              key={choice.trip.candidate.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-ink text-sm font-medium tabular-nums">{label}</p>
                <p className="text-ink-muted text-sm">
                  {shiftDaysLabel(choice.shiftDays)} · {dates.nights} nights
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right text-sm">
                  <p className="text-ink tabular-nums">{format(choice.trip.cost.total)} total</p>
                  <p className="text-ink-muted tabular-nums">
                    {moneyDelta(choice.totalDelta)} · score {choice.trip.score.score}
                  </p>
                </div>
                <ChooseLink href={hrefFor(choice)} label={label} />
              </div>
            </li>
          );
        })}
      </ul>
    </Disclosure>
  );
}
