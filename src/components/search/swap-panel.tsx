import { format, money, type Money } from '@/core/money';
import { Badge, Disclosure, Icon, type IconName } from '@/components/ui';
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
  /** A mark for what this panel changes. */
  icon?: IconName;
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

/**
 * The summary line of a builder panel: what it changes, what is chosen now,
 * and how many other options there are. The heading comes first, so the
 * panel's name is still "Change the flight" to anyone finding it by name.
 */
function PanelSummary({
  heading,
  icon,
  now,
  others,
}: {
  heading: string;
  icon?: IconName | undefined;
  now: string | null;
  others: number;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3.5">
      {icon ? (
        <span
          aria-hidden="true"
          className="bg-tint/15 text-tint-ink ring-tint/30 grid size-10 shrink-0 place-items-center rounded-full ring-1"
        >
          <Icon name={icon} size={1.1} />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ink text-[15px] font-medium">{heading}</span>
        {now ? (
          <span className="text-ink-muted truncate text-xs font-normal">Now {now}</span>
        ) : null}
      </span>
      <span className="text-tint-ink ml-auto shrink-0 pl-2 text-xs font-medium tabular-nums">
        {others} other {others === 1 ? 'option' : 'options'}
      </span>
    </span>
  );
}

/** A row in a builder panel: the current choice lit, the rest quiet. */
const OPTION_ROW =
  '-mx-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-(--radius-card) px-3 py-3';

function ChooseLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="bg-tint-ink text-surface hover:bg-ink focus-visible:outline-brand-500 ease-standard duration-quick inline-flex items-center gap-1 rounded-(--radius-pill) px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.97]"
    >
      Choose<span className="sr-only"> {label}</span>
      <Icon name="arrow-right" size={0.85} />
    </a>
  );
}

export function SwapPanel({
  heading,
  alternatives,
  currency,
  hrefFor,
  icon,
  className,
}: SwapPanelProps) {
  if (alternatives.length <= 1) return null;

  const current = alternatives.find((alternative) => alternative.isCurrent);

  return (
    <Disclosure
      summary={
        <PanelSummary
          heading={heading}
          icon={icon}
          now={current ? `${current.label} · ${current.detail}` : null}
          others={alternatives.length - (current ? 1 : 0)}
        />
      }
      className={className}
    >
      <ul className="flex flex-col gap-1">
        {alternatives.map((alternative) => {
          const shift =
            'departureShiftMinutes' in alternative
              ? shiftLabel(alternative.departureShiftMinutes)
              : null;

          return (
            <li
              key={alternative.offerId}
              className={cn(OPTION_ROW, alternative.isCurrent && 'bg-tint/10 ring-tint/30 ring-1')}
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
  /** The dates the trip has now, in words. */
  now?: string;
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
export function DateSwapPanel({ choices, hrefFor, now, className }: DateSwapPanelProps) {
  if (choices.length === 0) return null;

  return (
    <Disclosure
      summary={
        <PanelSummary
          heading="Change the dates"
          icon="calendar"
          now={now ?? null}
          others={choices.length}
        />
      }
      className={className}
    >
      <ul className="flex flex-col gap-1">
        {choices.map((choice) => {
          const { dates } = choice.trip.candidate;
          const label = `${weekdayDate(dates.departureDate)} to ${weekdayDate(dates.returnDate)}`;

          return (
            <li key={choice.trip.candidate.id} className={OPTION_ROW}>
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
