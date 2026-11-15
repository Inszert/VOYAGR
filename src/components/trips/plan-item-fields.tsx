import { Field, Select } from '@/components/ui';
import type { PlanItemRecord } from '@/db/repository';
import { expenseCurrencyOptions } from '@/trip-hub/currencies';
import {
  PLAN_ITEM_KINDS,
  PLAN_ITEM_STATUSES,
  PLAN_KIND_LABELS,
  PLAN_STATUS_LABELS,
} from '@/trip-hub/types';

/**
 * The fields of a plan item, shared by "add" and "edit".
 *
 * With `item` they start as its values; without, as a blank idea. Money is
 * shown in major units for editing, as the digits that were stored.
 */

export function majorText(minor: number, exponent: number): string {
  const sign = minor < 0 ? '-' : '';
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  return exponent === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export function PlanItemFields({
  item,
  exponentFor,
  compact = false,
}: {
  readonly item?: PlanItemRecord;
  /** Minor-unit exponent for the price's currency, from `minorUnitExponent`. */
  readonly exponentFor?: (currency: string) => number;
  /** One column, for the narrow "add" panel beside the timeline. */
  readonly compact?: boolean;
}) {
  const price = item?.price ?? null;

  return (
    <div className={compact ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
      <Select
        label="Kind"
        name="kind"
        defaultValue={item?.kind ?? 'activity'}
        options={PLAN_ITEM_KINDS.map((kind) => ({ value: kind, label: PLAN_KIND_LABELS[kind] }))}
      />
      <Field label="Title" name="title" required maxLength={140} defaultValue={item?.title} />
      <Select
        label="Status"
        name="status"
        defaultValue={item?.status ?? 'idea'}
        options={PLAN_ITEM_STATUSES.map((status) => ({
          value: status,
          label: PLAN_STATUS_LABELS[status],
        }))}
      />
      <Field label="Date" name="date" type="date" defaultValue={item?.date ?? ''} />
      <Field
        label="Local time"
        name="time"
        type="time"
        hint="Where it happens. Needs a date."
        defaultValue={item?.startsAt ? item.startsAt.slice(11, 16) : ''}
      />
      <Field
        label="Price you were quoted"
        name="price"
        inputMode="decimal"
        hint="Optional. You enter it; we do not look it up."
        defaultValue={
          price && exponentFor ? majorText(price.amount, exponentFor(price.currency)) : ''
        }
      />
      <Select
        label="Currency"
        name="currency"
        hint="Used only if you enter a price."
        defaultValue={price?.currency ?? 'EUR'}
        options={expenseCurrencyOptions(price ? [price.currency] : [])}
      />
    </div>
  );
}
