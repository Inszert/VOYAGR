import { z } from 'zod';
import { minorUnitExponent } from '@/core/money';
import { isLocalDateTime } from '@/core/dates';
import type { StayLinkOffer } from '@/core/stay/types';
import type { FlightOffer, HotelOffer, TransferOffer } from '@/core/trip/types';
import { THING_KINDS } from './types';

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

/**
 * A file on Wikimedia Commons, without its `File:` prefix.
 *
 * Narrow on purpose: this string is used to build a request, so it may hold
 * letters, digits and the punctuation file names really use, and never a slash,
 * a percent sign, a `..` or a control character. Exported because the image
 * route holds a request to exactly the same rule.
 */
export const COMMONS_FILE_NAME =
  /^(?!.*\.\.)[\p{L}\p{N}][\p{L}\p{N} _.,'()&!+–—’-]{0,180}\.(?:jpe?g|png|webp)$/iu;

const airport = z.string().regex(/^[A-Z]{3}$/, 'must be a three-letter IATA airport code');

const segment = z
  .object({
    origin: airport,
    destination: airport,
    departsAt: localDateTime,
    // Required and nullable: a vendor that does not state the arrival says null.
    arrivesAt: localDateTime.nullable(),
    carrier: z.string().min(1),
    flightNumber: z.string().min(1),
  })
  .strict();

const leg = z
  .object({
    segments: z.array(segment).min(1, 'a leg with no segments is not a journey'),
    durationMinutes: z.number().int().positive().finite(),
    // Connections counted but not itemised. Absent when the segments say it all.
    connectionsStated: z.number().int().positive().optional(),
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
    // Set only by the search when it pairs two one-way fares; never by a vendor.
    ticketing: z.literal('two_one_way').optional(),
    returnDeepLink: z.string().url().optional(),
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
    rooms: z.number().int().min(1).max(20).nullable(),
    // Required and nullable, like every fact a provider may not state. Photos
    // are https only: they are put straight into an <img>.
    photoUrls: z.array(z.string().url().startsWith('https://')).max(20).nullable(),
    position: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).nullable(),
    area: z.string().min(1).max(80).nullable(),
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

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date');

/**
 * A link into a stay search. `price` is `z.null()`, not `.nullable()`: this
 * kind of offer has no price by definition, and a vendor figure sneaking in
 * would be a number no engine has costed.
 */
export const stayLinkOfferSchema = z
  .object({
    id: z.string().min(1),
    providerId: z.string().min(1),
    displayName: z.string().min(1),
    destinationName: z.string().min(1),
    checkIn: calendarDate,
    checkOut: calendarDate,
    occupancy: z
      .object({
        adults: z.number().int().min(1),
        children: z.number().int().min(0),
        rooms: z.number().int().min(1),
      })
      .strict(),
    price: z.null(),
    // Plain https only: this goes straight into an `href`.
    url: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://'), 'must be an https URL'),
  })
  .strict();

/**
 * A place worth a visit, from an open dataset.
 *
 * Every optional fact is `.nullable()` and not optional, for the rule at the
 * top of this file. `wikipediaUrl` goes straight into an `href`, so it is held
 * to https on Wikipedia itself; `imageFile` ends up in a request to Wikimedia
 * Commons, so it is held to a plain file name with an image extension.
 */
export const thingToDoSchema = z
  .object({
    id: z.string().regex(/^Q[1-9]\d{0,12}$/, 'must be a Wikidata item id'),
    providerId: z.string().min(1),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(THING_KINDS),
    description: z.string().trim().min(1).max(400).nullable(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    distanceFromCentreMetres: z.number().int().min(0).max(1_000_000),
    notability: z.number().int().min(0),
    wikipediaUrl: z
      .string()
      .url()
      .refine(
        (value) => /^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\//.test(value),
        'must be a Wikipedia article',
      )
      .nullable(),
    imageFile: z
      .string()
      .max(200)
      .regex(COMMONS_FILE_NAME, 'must be a Commons image file name')
      .nullable(),
  })
  .strict();

/**
 * A place to stay, listed from an open map - not a price.
 *
 * What OpenStreetMap states about a hotel and nothing more: a name, where it
 * is, and the stars, address and website only where a mapper recorded them,
 * each `.nullable()` rather than optional. There is no price field at all: a
 * listing is a place, and a price comes only from a priced provider. `website`
 * goes into an `href`, so it is held to http(s).
 */
export const stayListingSchema = z
  .object({
    id: z.string().regex(/^osm:(node|way|relation)\/\d{1,15}$/, 'must be an OSM element id'),
    providerId: z.string().min(1),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(['hotel', 'guest_house', 'hostel', 'apartment']),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    stars: z.number().min(1).max(5).nullable(),
    address: z.string().trim().min(1).max(300).nullable(),
    website: z
      .string()
      .url()
      .refine((value) => /^https?:\/\//.test(value), 'must be an http(s) URL')
      .nullable(),
  })
  .strict();

export type ValidatedStayListing = z.infer<typeof stayListingSchema>;

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

/**
 * One itinerary from the Google Flights sidecar (`services/google-flights/server.py`).
 *
 * The sidecar is ours but what it relays is a scrape, so it is held to the same rule as a
 * vendor: every fact it may not have is required and nullable. `price` is a string because the
 * adapter parses it to minor units itself, exactly; a bare number here would invite a float.
 */
export const googleFlightsRowSchema = z
  .object({
    price: z.string().min(1).nullable(),
    currency,
    airlines: z.array(z.string().min(1)),
    stops: z.number().int().min(0),
    duration_minutes: z.number().int().positive().nullable(),
    departs_at: localDateTime.nullable(),
    arrives_at: localDateTime.nullable(),
    is_best: z.boolean().nullable(),
    segments: z
      .array(
        z.object({
          from_airport: airport.nullable(),
          to_airport: airport.nullable(),
          departs_at: localDateTime.nullable(),
          arrives_at: localDateTime.nullable(),
          duration_minutes: z.number().int().positive().nullable(),
        }),
      )
      .min(1),
  })
  .passthrough();

/** The sidecar's envelope. Rows stay `unknown` so one bad row cannot sink the page. */
export const googleFlightsResponseSchema = z
  .object({
    currency,
    // A UTC instant: it becomes `observedAt`, which is never a local time.
    fetched_at: isoDateTime,
    offers: z.array(z.unknown()),
  })
  .passthrough();

export type ValidatedGoogleFlightsRow = z.infer<typeof googleFlightsRowSchema>;

export type ValidatedFlightOffer = z.infer<typeof flightOfferSchema>;
export type ValidatedHotelOffer = z.infer<typeof hotelOfferSchema>;
export type ValidatedTransferOffer = z.infer<typeof transferOfferSchema>;
export type ValidatedThingToDo = z.infer<typeof thingToDoSchema>;
export type ValidatedStayLinkOffer = z.infer<typeof stayLinkOfferSchema>;

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

const _stayLinkMatches: StayLinkOffer = null as unknown as ValidatedStayLinkOffer;

void _stayLinkMatches;
void _flightMatches;
void _hotelMatches;
void _transferMatches;

// --- LiteAPI ----------------------------------------------------------------

/**
 * One hotel row from LiteAPI's `GET /v3.0/data/hotels`.
 *
 * Only what the documentation lists as required is required here; every other
 * fact is optional on the wire and becomes an explicit `null` in our own model
 * when the adapter maps it. Non-strict: a vendor adding a field is not a defect.
 */
export const liteapiHotelRowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(300),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    city: z.string().nullish(),
    country: z.string().nullish(),
    address: z.string().nullish(),
    zip: z.string().nullish(),
    main_photo: z.string().nullish(),
    stars: z.number().finite().nullish(),
    rating: z.number().finite().nullish(),
    reviewCount: z.number().int().nonnegative().nullish(),
  })
  .passthrough();

/** A vendor amount: a non-negative decimal in major units, with its own currency. */
const liteapiAmount = z
  .object({
    amount: z.number().finite().nonnegative(),
    currency,
  })
  .passthrough();

/**
 * One entry of `retailRate.taxesAndFees[]` (docs.nuitee.com, post_hotels-rates): `included` says
 * whether the amount is already in the total; `included: false` is payable at the property.
 */
const liteapiTaxSchema = z
  .object({
    included: z.boolean(),
    description: z.string().nullish(),
    amount: z.number().finite().nonnegative(),
    currency,
  })
  .passthrough();

/**
 * A malformed tax list becomes `null` ("not stated"), never an empty list and never a dropped
 * rate: the price is still the vendor's price, only the tax breakdown is unknown.
 */
const liteapiTaxList = z.array(liteapiTaxSchema).nullish().catch(null);

/** `cancelTime` is "ISO datetime", sampled as `2026-07-30 02:00:00`, always GMT. */
const liteapiCancelPolicySchema = z
  .object({
    cancelTime: z.string().min(1),
    amount: z.number().finite().nonnegative().nullish(),
    type: z.string().nullish(),
  })
  .passthrough();

/**
 * One hotel's entry in `POST /v3.0/hotels/rates`. A room type with no rate that
 * carries a stated total is not a price, so it fails here and is dropped.
 */
export const liteapiRatesRowSchema = z
  .object({
    hotelId: z.string().min(1),
    roomTypes: z.array(
      z
        .object({
          offerId: z.string().min(1),
          offerRetailRate: liteapiAmount.nullish(),
          rates: z
            .array(
              z
                .object({
                  rateId: z.string().min(1),
                  name: z.string().nullish(),
                  boardType: z.string().nullish(),
                  retailRate: z
                    .object({
                      total: z.array(liteapiAmount).min(1),
                      taxesAndFees: liteapiTaxList,
                    })
                    .passthrough(),
                  cancellationPolicies: z
                    .object({
                      refundableTag: z.string().nullish(),
                      cancelPolicyInfos: z.array(liteapiCancelPolicySchema).nullish().catch(null),
                    })
                    .passthrough()
                    .nullish(),
                  paymentTypes: z.array(z.string()).nullish().catch(null),
                })
                .passthrough(),
            )
            .min(1),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** The two envelopes. A body that is not one of these is a failure, not an empty list. */
export const liteapiHotelsEnvelopeSchema = z.object({ data: z.array(z.unknown()) }).passthrough();
export const liteapiRatesEnvelopeSchema = z
  .object({ data: z.array(z.unknown()), sandbox: z.boolean().nullish() })
  .passthrough();
