import { isIsoDate, isAfter, isLocalDateTime, localDate } from '@/core/dates';
import { minorUnitExponent, money, type Money } from '@/core/money';
import type { Split } from '@/core/expenses';
import { findCountryByIso2 } from '@/discovery/countries';
import { err, ok, type Result } from '@/lib/result';
import type { IsoDate, LocalDateTime } from '@/core/trip/types';
import {
  PLAN_ITEM_KINDS,
  PLAN_ITEM_STATUSES,
  type PlanItemKind,
  type PlanItemStatus,
} from './types';

/**
 * Reading the trip hub's forms.
 *
 * Pure and separate from the actions, so the rules - what is an amount, a
 * date, a split - are tested without a request. Every error is a sentence
 * written for the person who typed the thing.
 */

/** The part of `FormData` this file reads, so tests need not build a request. */
export interface FormValues {
  get(name: string): FormDataEntryValue | null;
}

function text(values: FormValues, name: string): string {
  const value = values.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

const MAX_NAME = 80;
const MAX_TITLE = 140;
const MAX_DESCRIPTION = 140;

/**
 * An amount typed by a person, as exact minor units.
 *
 * Read digit by digit rather than through a float, so what was typed is what
 * is stored. More decimals than the currency has is refused, not rounded: a
 * quiet rounding of a number somebody typed is the kind of thing nobody
 * checks.
 */
export function parseAmount(raw: string, currency: string): Result<Money, string> {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return err('Use a three-letter currency code, such as EUR.');

  const typed = raw.trim().replace(',', '.');
  const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(typed);
  if (!match) return err('Enter an amount as digits, such as 12.50.');

  const [, whole = '0', fraction = ''] = match;
  const exponent = minorUnitExponent(code);
  if (fraction.length > exponent) {
    return err(
      exponent === 0
        ? `${code} has no decimals.`
        : `${code} has ${exponent} decimal places at most.`,
    );
  }

  const minor = Number(whole + fraction.padEnd(exponent, '0'));
  return ok(money(minor, code));
}

function parseOptionalDate(raw: string, label: string): Result<IsoDate | null, string> {
  if (raw === '') return ok(null);
  return isIsoDate(raw) ? ok(raw) : err(`${label} must be a real date.`);
}

export interface TripFormInput {
  readonly name: string;
  readonly destination: string;
  readonly destinationCountry: string | null;
  readonly startDate: IsoDate | null;
  readonly endDate: IsoDate | null;
  readonly ownerName: string;
}

export function parseTripForm(values: FormValues): Result<TripFormInput, string> {
  const name = text(values, 'name');
  if (name === '' || name.length > MAX_NAME)
    return err(`Give the trip a name of up to ${MAX_NAME} characters.`);

  const destination = text(values, 'destination');
  if (destination === '' || destination.length > MAX_NAME) {
    return err(`Say where you are going, in up to ${MAX_NAME} characters.`);
  }

  const ownerName = text(values, 'ownerName');
  if (ownerName === '' || ownerName.length > MAX_NAME) {
    return err('Enter the name your travel companions will see for you.');
  }

  const countryRaw = text(values, 'destinationCountry').toUpperCase();
  if (countryRaw !== '' && !findCountryByIso2(countryRaw)) {
    return err('Choose a country from the list, or leave it blank.');
  }

  const start = parseOptionalDate(text(values, 'startDate'), 'The start date');
  if (!start.ok) return start;
  const end = parseOptionalDate(text(values, 'endDate'), 'The end date');
  if (!end.ok) return end;
  if (start.value && end.value && isAfter(start.value, end.value)) {
    return err('The trip cannot end before it starts.');
  }

  return ok({
    name,
    destination,
    destinationCountry: countryRaw === '' ? null : countryRaw,
    startDate: start.value,
    endDate: end.value,
    ownerName,
  });
}

export interface PlanItemFormInput {
  readonly kind: PlanItemKind;
  readonly title: string;
  readonly date: IsoDate | null;
  readonly startsAt: LocalDateTime | null;
  readonly price: Money | null;
  readonly status: PlanItemStatus;
}

export function parsePlanItemForm(values: FormValues): Result<PlanItemFormInput, string> {
  const kind = text(values, 'kind') as PlanItemKind;
  if (!PLAN_ITEM_KINDS.includes(kind)) return err('Choose what kind of item this is.');

  const title = text(values, 'title');
  if (title === '' || title.length > MAX_TITLE) {
    return err(`Give the item a title of up to ${MAX_TITLE} characters.`);
  }

  const status = (text(values, 'status') || 'idea') as PlanItemStatus;
  if (!PLAN_ITEM_STATUSES.includes(status)) return err('Choose idea, planned or booked.');

  const dateRaw = text(values, 'date');
  const timeRaw = text(values, 'time');
  const date = parseOptionalDate(dateRaw, 'The date');
  if (!date.ok) return date;

  let startsAt: LocalDateTime | null = null;
  if (timeRaw !== '') {
    if (!date.value) return err('Add a date to go with the time.');
    startsAt = `${date.value}T${timeRaw}`;
    if (!isLocalDateTime(startsAt)) return err('The time must look like 14:30.');
  }

  let price: Money | null = null;
  const priceRaw = text(values, 'price');
  if (priceRaw !== '') {
    const parsed = parseAmount(priceRaw, text(values, 'currency'));
    if (!parsed.ok) return parsed;
    price = parsed.value;
  }

  // The date of a timed item is the date of its time, by construction.
  return ok({
    kind,
    title,
    date: startsAt ? localDate(startsAt) : date.value,
    startsAt,
    price,
    status,
  });
}

export interface ExpenseFormInput {
  readonly paidBy: string;
  readonly amount: Money;
  readonly description: string;
  readonly date: IsoDate;
  readonly split: Split;
}

/**
 * The expense form has one row per member: `include:<id>`, `weight:<id>` and
 * `exact:<id>`. Which of them is read depends on `splitKind`.
 */
export function parseExpenseForm(
  values: FormValues,
  memberIds: readonly string[],
): Result<ExpenseFormInput, string> {
  const paidBy = text(values, 'paidBy');
  if (!memberIds.includes(paidBy)) return err('Choose who paid.');

  const description = text(values, 'description');
  if (description === '' || description.length > MAX_DESCRIPTION) {
    return err(`Describe the expense in up to ${MAX_DESCRIPTION} characters.`);
  }

  const date = text(values, 'date');
  if (!isIsoDate(date)) return err('Enter the date the expense was paid.');

  const currency = text(values, 'currency');
  const amount = parseAmount(text(values, 'amount'), currency);
  if (!amount.ok) return amount;
  if (amount.value.amount <= 0) return err('The amount must be more than zero.');

  const kind = text(values, 'splitKind');

  if (kind === 'equal') {
    const included = memberIds.filter((id) => values.get(`include:${id}`) === 'on');
    if (included.length === 0) return err('Choose at least one person to share it with.');
    return ok({
      paidBy,
      amount: amount.value,
      description,
      date,
      split: { kind, memberIds: included },
    });
  }

  if (kind === 'shares') {
    const weights: { memberId: string; weight: number }[] = [];
    for (const memberId of memberIds) {
      const raw = text(values, `weight:${memberId}`);
      if (raw === '') continue;
      if (!/^\d{1,6}$/.test(raw)) return err('Shares are whole numbers, such as 1 or 2.');
      weights.push({ memberId, weight: Number(raw) });
    }
    if (!weights.some((entry) => entry.weight > 0)) {
      return err('Give at least one person a share above zero.');
    }
    return ok({ paidBy, amount: amount.value, description, date, split: { kind, weights } });
  }

  if (kind === 'exact') {
    const amounts: { memberId: string; amount: Money }[] = [];
    for (const memberId of memberIds) {
      const raw = text(values, `exact:${memberId}`);
      if (raw === '') continue;
      const parsed = parseAmount(raw, currency);
      if (!parsed.ok) return parsed;
      amounts.push({ memberId, amount: parsed.value });
    }
    const total = amounts.reduce((acc, entry) => acc + entry.amount.amount, 0);
    if (total !== amount.value.amount) {
      return err('The amounts you entered for each person must add up to the total.');
    }
    return ok({ paidBy, amount: amount.value, description, date, split: { kind, amounts } });
  }

  return err('Choose how to split it: equally, by shares or by exact amounts.');
}

export interface ContactFormInput {
  readonly name: string;
  readonly phone: string;
  readonly relation: string;
}

export function parseContactForm(values: FormValues): Result<ContactFormInput, string> {
  const name = text(values, 'name');
  const phone = text(values, 'phone');
  const relation = text(values, 'relation');

  if (name === '' || name.length > MAX_NAME) return err('Enter the contact’s name.');
  if (relation === '' || relation.length > MAX_NAME) return err('Say who they are to you.');

  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[0-9][0-9 ()-]*$/.test(phone) || digits.length < 4 || digits.length > 15) {
    return err('Enter a phone number with the country code, such as +44 20 7946 0000.');
  }

  return ok({ name, phone, relation });
}
