import { z } from 'zod';
import { money, type Money } from '@/core/money';
import type { StayOffer, StayProperty, StayRate } from '@/core/stay/types';

/**
 * What a stored snapshot row is allowed to hold, and how it is read back.
 *
 * The rows are our own writes, but a stored row is still input: it may have been written by an
 * older build, edited by hand, or damaged. The reader never trusts it. A row is checked here,
 * Money is rebuilt through `money()` (so an amount that is not an integer cannot become a
 * price), and a row whose `schema_version` is not the current one is refused outright.
 *
 * **Bump `STORED_SCHEMA_VERSION` whenever `StayRate`, `StayProperty` or what is stored changes.**
 * Old rows then read as "not loaded" until the next refresh replaces them, instead of being
 * misread.
 */
export const STORED_SCHEMA_VERSION = 1;

const currency = z.string().regex(/^[A-Za-z]{3}$/);

const moneySchema = z
  .object({ amount: z.number().int().safe(), currency })
  .strict()
  .transform((value): Money => money(value.amount, value.currency));

const nullableMoney = moneySchema.nullable();

const instant = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'not an instant');

const nullableString = z.string().nullable();

const propertySchema = z
  .object({
    id: z.string().min(1),
    providerPropertyId: z.string().min(1),
    name: z.string().min(1),
    description: nullableString,
    photos: z.array(z.object({ url: z.url(), caption: nullableString }).strict()),
    address: z
      .object({
        line: nullableString,
        city: nullableString,
        region: nullableString,
        postcode: nullableString,
        countryCode: nullableString,
      })
      .strict(),
    position: z.object({ latitude: z.number(), longitude: z.number() }).strict().nullable(),
    starRating: z.number().nullable(),
    guestRating: z
      .object({
        score: z.number(),
        scale: z.number(),
        outOfTen: z.number(),
        reviewCount: z.number().nullable(),
      })
      .strict()
      .nullable(),
    amenities: z.array(z.string()),
    propertyType: nullableString,
  })
  .strict();

const rateSchema = z
  .object({
    id: z.string().min(1),
    providerRateId: z.string().min(1),
    providerRoomId: nullableString,
    roomName: nullableString,
    bedConfiguration: nullableString,
    board: z
      .enum(['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive'])
      .nullable(),
    cancellation: z
      .object({
        refundable: z.boolean().nullable(),
        deadline: nullableString,
        description: nullableString,
      })
      .strict(),
    paymentTiming: z.enum(['pay_now', 'pay_later']).nullable(),
    benefits: z.array(z.string()),
    total: moneySchema.refine((value) => value.amount > 0, 'a stay total is positive'),
    perNight: moneySchema,
    base: nullableMoney,
    taxesAndFees: nullableMoney,
    payableAtProperty: nullableMoney,
    occupancy: z
      .object({
        adults: z.number().int().min(1),
        children: z.number().int().min(0),
        rooms: z.number().int().min(1),
      })
      .strict(),
    observedAt: instant,
    expiresAt: instant.nullable(),
    source: z
      .object({
        part: z.enum(['flights', 'hotels', 'stays', 'transfers']),
        providerId: z.string().min(1),
        displayName: z.string().min(1),
        provenance: z.enum([
          'live',
          'cached',
          'estimated',
          'historical',
          'typical',
          'test',
          'indicative',
          'mock',
          'ai-generated',
          'unavailable',
        ]),
      })
      .strict(),
  })
  .strict();

const offerSchema = z.object({ property: propertySchema, rates: z.array(rateSchema) }).strict();
const offersSchema = z.array(offerSchema);

export type StoredReadFailure = 'schema_version' | 'invalid';

export type StoredRatesResult =
  | { readonly ok: true; readonly offers: readonly StayOffer[] }
  | { readonly ok: false; readonly reason: StoredReadFailure };

/**
 * The stored `rates` column as offers, or the reason it cannot be used.
 * One bad offer fails the whole row: a half-read snapshot would show a partial city as the
 * whole of it, and the next refresh replaces the row anyway.
 */
export function readStoredRates(schemaVersion: number, stored: unknown): StoredRatesResult {
  if (schemaVersion !== STORED_SCHEMA_VERSION) return { ok: false, reason: 'schema_version' };

  const parsed = offersSchema.safeParse(stored);
  if (!parsed.success) return { ok: false, reason: 'invalid' };

  return { ok: true, offers: parsed.data as unknown as readonly StayOffer[] };
}

/** One mapped property as stored in `liteapi_hotels.content`, or null when it is not valid. */
export function readStoredProperty(stored: unknown): StayProperty | null {
  const parsed = propertySchema.safeParse(stored);
  return parsed.success ? (parsed.data as unknown as StayProperty) : null;
}

/** What goes into the `rates` column. Plain data: Money is `{ amount, currency }`. */
export function toStoredRates(
  offers: readonly { property: StayProperty; rates: readonly StayRate[] }[],
): unknown {
  return offers.map((offer) => ({ property: offer.property, rates: offer.rates }));
}
