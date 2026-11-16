import { addDays, daysBetween } from '@/core/dates';
import { legArrival } from '@/core/trip/legs';
import type { TravelWarning, TravelWarningCode } from '@/core/trip/constraints';
import type { WeatherOutlook } from '@/core/trip/types';
import { feelFor, summariseWeather, type WeatherFeel } from '@/discovery/weather-summary';
import type { RankedTrip } from './types';

/**
 * What the trip builder says in words, worked out once.
 *
 * Every sentence is built from facts the engines already settled: the
 * constraint engine's warnings, the legs' stated times, the weather
 * provider's figures. Nothing here computes a price, and nothing invents a
 * figure - the temperatures are the provider's, averaged and rounded the way
 * `summariseWeather` does everywhere else.
 */

/** Which mark a line carries. The sentence says the same thing in words. */
export type CheckKind = 'bag' | 'ticket' | 'clock' | 'cloud' | 'bed' | 'shield';

export interface CheckItem {
  readonly key: string;
  readonly kind: CheckKind;
  readonly text: string;
  /**
   * `check`: we do not know, so the traveller should find out.
   * `known`: it is so, and worth knowing before paying.
   * Read out ahead of the sentence, so the distinction is not in the icon alone.
   */
  readonly certainty: 'check' | 'known';
}

/** The warnings whose words are better shorter here, and the mark each carries. */
const PHRASES: Partial<Record<TravelWarningCode, { kind: CheckKind; text?: string }>> = {
  BAGGAGE_ALLOWANCE_UNKNOWN: {
    kind: 'bag',
    text: 'Check the baggage allowance: the airline did not state it.',
  },
  CABIN_BAGGAGE_ONLY: {
    kind: 'bag',
    text: 'Checked baggage is not included, so a bag adds to the total.',
  },
  SELF_TRANSFER_UNKNOWN: { kind: 'ticket', text: 'Check that both flights are on one ticket.' },
  SELF_TRANSFER_RISK: { kind: 'ticket' },
  SEPARATE_TICKETS: { kind: 'ticket', text: 'Outbound and return are separate tickets.' },
  LATE_ARRIVAL: { kind: 'clock' },
  EARLY_DEPARTURE: { kind: 'clock' },
  LOW_WEATHER_CONFIDENCE: { kind: 'cloud' },
  NON_REFUNDABLE: { kind: 'bed' },
  LONG_TRANSFER: { kind: 'clock' },
};

/**
 * Costs the total leaves out. The summary says those once, from the cost
 * engine's own tagging, so the checklist does not say them a second time.
 */
const SAID_IN_THE_SUMMARY: ReadonlySet<TravelWarningCode> = new Set([
  'NO_STAY_PRICED',
  'NO_TRANSFER_PRICED',
]);

/** The checklist: the engine's warnings, plus the facts no provider stated. */
export function goodToKnow(trip: RankedTrip): CheckItem[] {
  const items: CheckItem[] = [];

  for (const warning of trip.warnings as readonly TravelWarning[]) {
    if (SAID_IN_THE_SUMMARY.has(warning.code)) continue;
    const phrase = PHRASES[warning.code];
    items.push({
      key: warning.code,
      kind: phrase?.kind ?? 'shield',
      text: phrase?.text ?? warning.message,
      certainty: warning.severity === 'confirmed' ? 'known' : 'check',
    });
  }

  const { outbound, inbound } = trip.candidate.flight;
  if (legArrival(outbound) === null || legArrival(inbound) === null) {
    items.push({
      key: 'ARRIVAL_NOT_STATED',
      kind: 'clock',
      text: 'Check the landing times: this fare states when each flight leaves, not when it lands.',
      certainty: 'check',
    });
  }

  // What is known first, then what to check, each in the engine's order.
  return [
    ...items.filter((item) => item.certainty === 'known'),
    ...items.filter((item) => item.certainty === 'check'),
  ];
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "Late November": the part of the month the trip's middle day falls in. */
export function seasonPhrase(departureDate: string, returnDate: string): string {
  const middle = addDays(departureDate, Math.floor(daysBetween(departureDate, returnDate) / 2));
  const day = Number(middle.slice(8, 10));
  const month = MONTHS[Number(middle.slice(5, 7)) - 1] ?? '';
  const part = day <= 10 ? 'Early' : day <= 20 ? 'Mid' : 'Late';
  return `${part} ${month}`;
}

const FEEL_WORD: Record<WeatherFeel, string> = {
  hot: 'hot',
  warm: 'warm',
  mild: 'mild',
  cool: 'cool',
  cold: 'cold',
};

export interface SeasonLine {
  /** "Late November in Rome: mild days, cool evenings, 12–19°C". */
  readonly text: string;
  /** True unless every day is a meteorological forecast. */
  readonly typical: boolean;
}

/**
 * The weather in one line, or null when the provider gave nothing.
 *
 * The words for days and evenings are `feelFor` on the provider's own average
 * high and low; the range is those two figures.
 */
export function seasonLine(
  place: string,
  departureDate: string,
  returnDate: string,
  days: readonly WeatherOutlook[],
): SeasonLine | null {
  const summary = summariseWeather(days);
  if (!summary) return null;

  const { highC, lowC } = summary.overall;
  const range = lowC === highC ? `${highC}°C` : `${lowC}–${highC}°C`;
  const daysWord = FEEL_WORD[feelFor(highC)];
  const eveningsWord = FEEL_WORD[feelFor(lowC)];
  const feel =
    daysWord === eveningsWord
      ? `${daysWord} days and evenings`
      : `${daysWord} days, ${eveningsWord} evenings`;

  return {
    text: `${seasonPhrase(departureDate, returnDate)} in ${place}: ${feel}, ${range}`,
    typical: summary.forecastDays < summary.overall.days,
  };
}
