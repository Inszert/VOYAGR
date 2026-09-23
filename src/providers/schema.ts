import { z } from 'zod';
import { minorUnitExponent } from '@/core/money';
import { isLocalDateTime } from '@/core/dates';
import type { FlightOffer, HotelOffer, TransferOffer } from '@/core/trip/types';

/**
 * What a provider is allowed to hand us.
 *
 * AI output has been validated since 1.1 (`src/ai/guardrails.ts`); provider
 * output never was, on the reasonable-sounding grounds that the adapter types
 * it. A TypeScript interface is a promise about our own code and says nothing
 * about the JSON on the wire: a vendor that sends `"price": null`, a string
 * where a number is typed, or a field it simply forgot, produces a value that
 * satisfies the compiler and then costs a trip wrongly - or throws somewhere
 * far from the adapter that let it in.
 *
 * This is the boundary. Nothing reaches `src/core/` without passing it.
 *
 * **An invalid offer is dropped, not fatal.** One malformed hotel in a page of
 * twenty is nineteen usable hotels and one recorded issue, which is the same
 * stance the search already takes on a failed provider call: degrade, say so,
 * never abort. What is refused is letting it through.
 *
 * **Unknown is `null`, and `null` is required.** Every field the domain models
 * as "the provider may not have said" is `.nullable()` and **not** optional:
 * the adapter has to decide, explicitly, that the vendor was silent. A field
 * that is simply absent is an adapter that forgot to map it, and that is a bug
 * worth failing on rather than a silence worth honouring.
 */

/** An ISO 4217 code. Case is normalised by `money()`, so both are accepted. */
const currency = z.string().regex(/^[A-Za-z]{3}$/, 'currency must be a three-letter ISO 4217 code');

/**
 * Money, as the domain holds it: integer minor units plus a currency.
 *
 * The integer check is the one that matters. A vendor sending `12.34` for a
 * EUR price looks plausible and is out by a factor of a hundred - the classic
 * money bug, and exactly what integer minor units exist to make impossible.
 */
const moneySchema = z
  .object({
    amount: z.number().int('money amount must be an integer number of minor units').finite().safe(),
    currency,
  })
  .strict();

/** A price that cannot be negative. A refund is not an offer. */
const price = moneySchema.refine((value) => value.amount >= 0, {
  message: 'a quoted price cannot be negative',
});

/**
 * An instant, in UTC.
 *
 * Parsed rather than pattern-matched, because what matters is that it names a
 * real moment. A `LocalDateTime` is rejected here by the same token: it has no
 * zone, so it is not an instant, and `observedAt` is always one.
 */
const isoDateTime = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), 'must be a parsable instant')
  .refine(
    (value) => /(?:Z|[+-]\d{2}:?\d{2})$/.test(value),
    'must carry a zone: an observation without one is not an instant',
  );

/**
 * A wall-clock time at an airport, with no zone.
 *
 * The mirror of the rule above, and the domain is emphatic about it: a flight
 * time is the clock face where the flight happens. A vendor sending `Z` has
 * either converted to UTC or mislabelled local time, and we cannot tell which
 * - so it is refused at the boundary rather than guessed at downstream.
 */
const localDateTime = z.string().refine(isLocalDateTime, 'must be a zoneless local date-time');

const airport = z.string().regex(/^[A-Z]{3}$/, 'must be a three-letter IATA airport code');

const segment = z
  .object({
    origin: airport,
    destination: airport,
    departsAt: localDateTime,
    arrivesAt: localDateTime,
    carrier: z.string().min(1),
    flightNumber: z.string().min(1),
  })
  .strict();

const leg = z
  .object({
    segments: z.array(segment).min(1, 'a leg with no segments is not a journey'),
    durationMinutes: z.number().int().positive().finite(),
    // Nullable and required: see the note at the top of this file.
    cabinBaggageIncluded: z.boolean().nullable(),
    checkedBaggageIncluded: z.boolean().nullable(),
    selfTransfer: z.boolean().nullable(),
  })
  .strict();

export const flightOfferSchema = z
  .object({
    id: z.string().min(1),
    providerId: z.string().min(1),
    outbound: leg,
    inbound: leg,
    price,
    observedAt: isoDateTime,
    // Required, and null when unstated: a missing key is an adapter bug.
    expiresAt: isoDateTime.nullable(),
    deepLink: z.string().url().optional(),
  })
  .strict();

export const hotelOfferSchema = z
  .object({
    id: z.string().min(1),
    providerId: z.string().min(1),
    name: z.string().min(1),
    starRating: z.number().min(1).max(5).nullable(),
    reviewScore: z.number().min(0).max(10).nullable(),
    reviewCount: z.number().int().min(0),
    distanceToBeachMetres: z.number().min(0).nullable(),
    distanceToCentreMetres: z.number().min(0).nullable(),
    boardType: z.enum(['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive']),
    freeCancellation: z.boolean(),
    totalPrice: price,
    excludedFees: price.nullable(),
    observedAt: isoDateTime,
    deepLink: z.string().url().optional(),
  })
  .strict();

export const transferOfferSchema = z
  .object({
    id: z.string().min(1),
    providerId: z.string().min(1),
    mode: z.enum(['private', 'shared', 'public', 'taxi', 'walk']),
    durationMinutes: z.number().int().min(0).finite(),
    pricePerDirection: price,
    observedAt: isoDateTime,
  })
  .strict();

/**
 * A price whose currency the domain cannot hold.
 *
 * `minorUnitExponent` falls back to 2 for anything it does not know, which is
 * right for display and wrong for arithmetic: a JPY amount treated as having
 * two decimal places is out by a hundred. Checked separately from the schema
 * because it is a question about our own table, not about the vendor's JSON.
 */
export function hasKnownMinorUnits(currencyCode: string): boolean {
  return minorUnitExponent(currencyCode) >= 0;
}

/** One offer that did not pass, and why, in words a log reader can act on. */
export interface RejectedOffer {
  /** The offer's id when it had a usable one, so it can be found at the vendor. */
  readonly id: string | null;
  readonly problems: readonly string[];
}

export interface ValidationOutcome<T> {
  readonly accepted: readonly T[];
  readonly rejected: readonly RejectedOffer[];
}

/**
 * Keep what is well-formed, report what is not.
 *
 * Deliberately not `parse`: a throw here would turn one bad row into an empty
 * search. The caller gets both halves and decides what to do with the second,
 * which in the orchestrator's case is a recorded issue.
 */
export function validateOffers<T>(
  schema: z.ZodType<T>,
  offers: readonly unknown[],
): ValidationOutcome<T> {
  const accepted: T[] = [];
  const rejected: RejectedOffer[] = [];

  for (const offer of offers) {
    const parsed = schema.safeParse(offer);

    if (parsed.success) {
      accepted.push(parsed.data);
      continue;
    }

    rejected.push({
      id: readId(offer),
      problems: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    });
  }

  return { accepted, rejected };
}

/** The offer's own id, if there is one worth quoting back. */
function readId(offer: unknown): string | null {
  if (typeof offer !== 'object' || offer === null) return null;

  const id = (offer as { id?: unknown }).id;

  return typeof id === 'string' && id.length > 0 ? id : null;
}

export type ValidatedFlightOffer = z.infer<typeof flightOfferSchema>;
export type ValidatedHotelOffer = z.infer<typeof hotelOfferSchema>;
export type ValidatedTransferOffer = z.infer<typeof transferOfferSchema>;

/*
 * The schemas and the domain types must not drift.
 *
 * These assignments compile only while each schema still produces something
 * the domain accepts. Adding a field to `FlightOffer` without adding it here
 * is then a build error rather than a field that silently stops being
 * checked - which is the failure mode a validation layer is most prone to.
 */
const _flightMatches: FlightOffer = null as unknown as ValidatedFlightOffer;
const _hotelMatches: HotelOffer = null as unknown as ValidatedHotelOffer;
const _transferMatches: TransferOffer = null as unknown as ValidatedTransferOffer;

void _flightMatches;
void _hotelMatches;
void _transferMatches;
