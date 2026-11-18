import { buildStayRows, type StayRow } from '@/components/stays/stay-rows';
import { areaAround, type StayArea } from '@/core/stay/listing';
import { buildStayLinkHandoff } from '@/booking/handoff';
import { loadLocator } from '@/discovery/locator-data';
import { isOk } from '@/lib/result';
import type { DataSource } from '@/providers/data-source';
import { LISTING_RADIUS_KM, loadStayListings } from '@/providers/stays/listings';
import { getStayProviders } from '@/providers/stays/registry';
import { resolveStayPlace, type StayPlace } from '@/providers/stays/stay-place';
import { stayHref, type StayParams, type StayViewModel } from '@/search/stays/load-stays';

/**
 * What the stays page loads once the search itself has answered: the place,
 * the hotels listed there, the partner links, the rows and the locator.
 *
 * No live provider call is made on a visitor path here. The listing is a
 * build-time extract, the partner links are built by a links provider (no
 * network), and the locator reads our own geo files.
 */

export type StayListings = ReturnType<typeof loadStayListings>;
export type PartnerLinks = ReadonlyMap<string, { href: string; host: string }>;
export type StayLocator = Awaited<ReturnType<typeof loadLocator>>;

export interface StaysPageData {
  readonly place: StayPlace | null;
  readonly listings: StayListings | null;
  readonly partnerLinks: PartnerLinks;
  readonly rows: StayRow[];
  readonly area: StayArea | null;
  /** The cheapest priced row: two or more, all in one currency, by minor units. Else null. */
  readonly cheapestId: string | null;
  /** The small map for the open property; null off the property step or with no position. */
  readonly locator: StayLocator;
}

function cheapestRowId(rows: readonly StayRow[]): string | null {
  const priced = rows.filter((row) => row.price);
  const first = priced[0]?.price;
  if (!first || priced.length < 2) return null;
  if (priced.some((row) => row.price?.currency !== first.currency)) return null;
  let best = priced[0]!;
  for (const row of priced) {
    if ((row.price?.amount ?? Infinity) < (best.price?.amount ?? Infinity)) best = row;
  }
  return best.id;
}

export async function loadStaysPage(
  view: StayViewModel,
  params: StayParams,
  source: DataSource,
): Promise<StaysPageData> {
  const place =
    view.step === 'results'
      ? resolveStayPlace({ code: view.query.destination.code, name: view.query.destination.name })
      : null;
  const listings = place ? loadStayListings({ code: place.code, centre: place.centre }) : null;
  const linkProvider = getStayProviders(undefined, source).find(
    (provider) => provider.searchStayLinks,
  );
  const partnerLinks = new Map<string, { href: string; host: string }>();
  if (place && listings?.status === 'ok' && linkProvider?.searchStayLinks) {
    for (const listing of listings.listings) {
      const result = await linkProvider.searchStayLinks({
        ...view.query,
        destination: { ...view.query.destination, name: `${listing.name}, ${place.city}` },
      });
      const offer = isOk(result) ? result.value[0] : undefined;
      const handoff = offer ? buildStayLinkHandoff(offer) : null;
      if (handoff) {
        partnerLinks.set(listing.name, {
          href: handoff.url,
          host: offer?.displayName ?? new URL(handoff.url).hostname,
        });
      }
    }
  }
  const rows = place
    ? buildStayRows({
        centre: place.centre,
        nights: view.nights,
        stays: view.stays,
        listings: listings?.status === 'ok' ? listings.listings : [],
        compareHref: (key) => stayHref(params, { property: key, reference: undefined }),
        partnerHref: (name) => partnerLinks.get(name) ?? null,
      })
    : [];
  const area = place ? areaAround(place.centre, LISTING_RADIUS_KM) : null;

  const position = view.step === 'property' ? view.openStay?.property.position : null;
  const locator = position ? await loadLocator(position, { width: 440, height: 330 }) : null;

  return { place, listings, partnerLinks, rows, area, cheapestId: cheapestRowId(rows), locator };
}
