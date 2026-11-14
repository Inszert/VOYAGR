import { isAfter, isIsoDate } from '@/core/dates';
import { fromMajor } from '@/core/money';
import type { AlertPreferencesInput } from '@/db/repository';
import { err, ok, type Result } from '@/lib/result';

/**
 * Reading the alert-preferences form.
 *
 * Pure and separate from the action so the rules - what counts as an airport,
 * a budget, a window - are tested without a request. The budget is parsed from
 * the text the user typed into minor units once, here; nothing downstream sees
 * a float.
 */

export const MAX_ALERT_DESTINATIONS = 12;

const THREE_LETTERS = /^[A-Z]{3}$/;
const DECIMAL = /^\d+(\.\d{1,3})?$/;

export interface AlertPreferencesFormValues {
  readonly homeAirport: string;
  readonly destinations: string;
  readonly budget: string;
  readonly currency: string;
  readonly earliestDeparture: string;
  readonly latestDeparture: string;
  readonly priceDropAlerts: boolean;
}

export function parseAlertPreferences(
  values: AlertPreferencesFormValues,
): Result<AlertPreferencesInput, string> {
  const homeAirport = values.homeAirport.trim().toUpperCase();
  if (homeAirport !== '' && !THREE_LETTERS.test(homeAirport)) {
    return err('Use a three-letter airport code for your home airport, such as LHR.');
  }

  const destinations = [
    ...new Set(
      values.destinations
        .split(/[\s,]+/)
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (destinations.some((code) => !THREE_LETTERS.test(code))) {
    return err('Destinations are three-letter airport codes, separated by commas.');
  }
  if (destinations.length > MAX_ALERT_DESTINATIONS) {
    return err(`Choose at most ${MAX_ALERT_DESTINATIONS} destinations.`);
  }

  let budget: AlertPreferencesInput['budget'] = null;
  const budgetText = values.budget.trim();
  if (budgetText !== '') {
    const currency = values.currency.trim().toUpperCase();

    if (!DECIMAL.test(budgetText) || Number(budgetText) <= 0) {
      return err('Enter your budget as a positive amount, such as 500.');
    }
    if (!THREE_LETTERS.test(currency)) {
      return err('Use a three-letter currency code for your budget, such as EUR.');
    }

    budget = fromMajor(Number(budgetText), currency);
  }

  const earliest = values.earliestDeparture.trim();
  const latest = values.latestDeparture.trim();
  for (const date of [earliest, latest]) {
    if (date !== '' && !isIsoDate(date)) return err('Enter dates as day, month and year.');
  }
  if (earliest !== '' && latest !== '' && isAfter(earliest, latest)) {
    return err('The latest departure cannot be before the earliest.');
  }

  return ok({
    homeAirport: homeAirport === '' ? null : homeAirport,
    destinations,
    budget,
    earliestDeparture: earliest === '' ? null : earliest,
    latestDeparture: latest === '' ? null : latest,
    priceDropAlerts: values.priceDropAlerts,
  });
}
