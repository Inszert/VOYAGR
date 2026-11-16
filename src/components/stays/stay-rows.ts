import { format, type Money } from '@/core/money';
import { formatKilometres } from '@/core/distance';
import { bestRateFor } from '@/core/stay/comparison';
import type { CanonicalStay } from '@/core/stay/identity';
import { distanceFromCentre, matchListing } from '@/core/stay/listing';
import type { ValidatedStayListing } from '@/providers/schema';

/**
 * One row of the stays list and one pin on its map, as the page hands them
 * to the client.
 *
 * Built on the server from two sources that answer different questions: the
 * priced providers ("what it costs") and the listing ("which hotels are
 * here"). A listing the priced results also hold is merged into that stay; a
 * listing nobody priced keeps `price: null` and says "Check price". Every
 * figure - the total, the distance - comes from `src/core`; this file formats
 * and joins, and computes nothing a user reads.
 */
export interface StayRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string | null;
  /** Stars as stated by a provider or a mapper; null when nobody stated any. */
  readonly stars: number | null;
  readonly address: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly distanceMetres: number;
  readonly distanceLabel: string;
  /** The whole stay's best total, only from a priced provider. */
  readonly price: Money | null;
  readonly priceLabel: string | null;
  readonly photo: string | null;
  /** Where the row leads: our rate comparison for a priced stay, else out to look. */
  readonly link: {
    readonly kind: 'compare' | 'partner' | 'website';
    readonly href: string;
    /** Whose site an outbound link opens, for the accessible name. */
    readonly host: string | null;
  } | null;
}

export interface BuildRowsInput {
  readonly centre: { readonly latitude: number; readonly longitude: number };
  readonly nights: number;
  readonly stays: readonly CanonicalStay[];
  readonly listings: readonly ValidatedStayListing[];
  readonly compareHref: (stayKey: string) => string;
  /** A partner search for one hotel, or null when no partner is configured. */
  readonly partnerHref: (hotelName: string) => { href: string; host: string } | null;
}

const KIND_LABEL: Record<string, string> = {
  hotel: 'Hotel',
  guest_house: 'Guest house',
  hostel: 'Hostel',
  apartment: 'Apartment',
};

export function kindLabel(kind: string | null): string | null {
  return kind ? (KIND_LABEL[kind] ?? null) : null;
}

export function buildStayRows(input: BuildRowsInput): StayRow[] {
  const priced = new Map(
    input.stays.map((stay) => [
      stay.key,
      { name: stay.property.name, position: stay.property.position, stay },
    ]),
  );
  const listingFor = new Map<string, ValidatedStayListing>();
  const unmatched: ValidatedStayListing[] = [];

  for (const listing of input.listings) {
    const key = matchListing(
      {
        name: listing.name,
        position: { latitude: listing.latitude, longitude: listing.longitude },
      },
      priced,
    );
    if (key && !listingFor.has(key)) listingFor.set(key, listing);
    else unmatched.push(listing);
  }

  const rows: StayRow[] = [];

  for (const stay of input.stays) {
    const listing = listingFor.get(stay.key);
    const position =
      stay.property.position ??
      (listing ? { latitude: listing.latitude, longitude: listing.longitude } : null);
    // A stay that cannot be placed cannot be a pin; the rate page still lists it.
    if (!position) continue;

    const rate = bestRateFor(stay);
    const metres = distanceFromCentre(input.centre, position);

    rows.push({
      id: `stay:${stay.key}`,
      name: stay.property.name,
      kind: stay.property.propertyType ?? listing?.kind ?? null,
      stars: stay.property.starRating ?? listing?.stars ?? null,
      address: stay.property.address.line ?? listing?.address ?? null,
      latitude: position.latitude,
      longitude: position.longitude,
      distanceMetres: metres,
      distanceLabel: `${formatKilometres(metres)} from the centre`,
      price: rate?.total ?? null,
      priceLabel: rate ? `${format(rate.total)} total · ${input.nights} nights` : null,
      photo: stay.property.photos[0]?.url ?? null,
      link: { kind: 'compare', href: input.compareHref(stay.key), host: null },
    });
  }

  // Priced first, cheapest first; then the listed places nearest the centre first.
  rows.sort((a, b) => (a.price && b.price ? a.price.amount - b.price.amount : 0));

  const listed = unmatched
    .map((listing) => {
      const metres = distanceFromCentre(input.centre, listing);
      const partner = input.partnerHref(listing.name);
      const link: StayRow['link'] = partner
        ? { kind: 'partner', href: partner.href, host: partner.host }
        : listing.website
          ? { kind: 'website', href: listing.website, host: new URL(listing.website).hostname }
          : null;

      return {
        id: listing.id,
        name: listing.name,
        kind: listing.kind,
        stars: listing.stars,
        address: listing.address,
        latitude: listing.latitude,
        longitude: listing.longitude,
        distanceMetres: metres,
        distanceLabel: `${formatKilometres(metres)} from the centre`,
        price: null,
        priceLabel: null,
        photo: null,
        link,
      } satisfies StayRow;
    })
    .sort((a, b) => a.distanceMetres - b.distanceMetres || a.name.localeCompare(b.name));

  return [...rows, ...listed];
}
