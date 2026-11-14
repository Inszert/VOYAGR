import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { format } from '@/core/money';
import { Container, DemoDataNotice, Icon, type IconName } from '@/components/ui';
import { tintFor, type Tint } from '@/lib/tint';
import { daysBetween } from '@/core/dates';
import { getAiProvider } from '@/ai';
import { draftItinerary, itineraryRequestFor } from '@/discovery/itinerary';
import { ItineraryView } from '@/components/discovery/itinerary-view';
import { loadDestinationDetail } from '@/discovery/destination-detail';
import { DestinationDetailView } from '@/components/discovery/destination-detail-view';
import { DestinationHeader } from '@/components/discovery/destination-header';
import { findCountry } from '@/discovery/countries';
import { resolveDestinationGeo } from '@/search/destination-names';
import { resolveImagery } from '@/providers/imagery';
import { getActiveDataSource } from '@/providers/request-source';
import { FindStayLink } from '@/components/stays/find-stay-link';
import { loadStayLinks } from '@/search/stays/stay-links';
import { offersForTrip } from '@/booking/partners';
import { TripExtras } from '@/components/partners';

/**
 * A destination (1.10.1 section 18).
 *
 * Server-rendered from the same adapters the search uses, so nothing here is a
 * second opinion about a place: the transfer prices are the transfer
 * provider's, the outlook is the weather provider's, and the money is
 * formatted from `Money` rather than assembled from numbers on the way out.
 *
 * The page opens on the globe framed on this place's country, so arriving
 * here reads as zooming further in rather than as leaving the map.
 *
 * Section 18 asks for a good deal this cannot answer yet - imagery, events,
 * national holidays, travel warnings, hidden places. Those are sections 20 to
 * 22 and the imagery decision in `docs/imagery-options.md`. The page names
 * every one of them rather than leaving a reader to assume the silence means
 * "nothing to report", which for a travel warning is the dangerous reading.
 *
 * Dates are optional. Arriving from a search brings them, and the outlook
 * appears; arriving cold shows the place without pretending to know when you
 * are going.
 */

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const place = resolveDestinationGeo(code.toUpperCase());

  return { title: place ? `${place.name}, ${place.country}` : 'Destination' };
}

/** A mark for each way in from the airport. */
/** Each way in its own colour from the palette, beside its name. */
const TRANSFER_TINT: Record<string, Tint> = {
  public: 'sage',
  shared: 'harbour',
  taxi: 'sand',
  private: 'clay',
  walk: 'leather',
};

const TRANSFER_ICON: Record<string, IconName> = {
  public: 'train',
  shared: 'bus',
  taxi: 'car',
  private: 'car',
  walk: 'pin',
};

export default async function DestinationPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const query = await searchParams;

  const startDate = single(query.startDate);
  const endDate = single(query.endDate);
  const passengers = Number(single(query.passengers) ?? 2);
  const currency = (single(query.currency) ?? 'EUR').toUpperCase();

  const destination = code.toUpperCase();
  const place = resolveDestinationGeo(destination);

  const detail = await loadDestinationDetail({
    destination,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'EUR',
    passengers: Number.isSafeInteger(passengers) && passengers > 0 ? passengers : 2,
    // Only trusted when they are actually dates; a malformed one means no
    // outlook rather than an outlook for a date nobody asked about.
    ...(startDate && ISO_DATE.test(startDate) ? { startDate } : {}),
    ...(endDate && ISO_DATE.test(endDate) ? { endDate } : {}),
  });

  if (!detail || !place) notFound();

  const dates =
    startDate && endDate && ISO_DATE.test(startDate) && ISO_DATE.test(endDate)
      ? { startDate, endDate }
      : null;

  /*
   * A drafted plan for the trip's own nights, or a three-night example when
   * the page was opened without dates. A week at most: a longer draft is a
   * page nobody reads, and each day costs the model a paragraph.
   */
  const nights = dates ? Math.min(7, Math.max(1, daysBetween(dates.startDate, dates.endDate))) : 3;
  const itinerary = await draftItinerary(
    itineraryRequestFor({
      destinationName: place.name,
      nights,
      travelStyle: 'balanced',
      places: detail.places,
      weather: detail.weather,
    }),
  );

  // Only with real dates: a link for a window nobody chose would be a guess.
  const stayLinks = dates
    ? await loadStayLinks(
        {
          destination: { code: destination, name: place.name, position: null, radiusKm: null },
          checkIn: dates.startDate,
          checkOut: dates.endDate,
          occupancy: {
            adults: Number.isSafeInteger(passengers) && passengers > 0 ? passengers : 2,
            children: 0,
            rooms: 1,
          },
          currency,
        },
        (await getActiveDataSource()).effective,
      )
    : [];

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col" data-tint={tintFor(place.adm0 ?? destination)}>
      <DestinationHeader
        today={today}
        destination={destination}
        place={place}
        country={place.adm0 ? findCountry(place.adm0) : null}
        dates={dates}
        image={(await resolveImagery([destination])).get(destination.toUpperCase()) ?? null}
      />

      <Container className="flex flex-col gap-14 py-12">
        {/*
          Before the content, as everywhere else. A notice that what follows is
          fictional is worthless underneath the fiction.
        */}
        {detail.provenance === 'mock' ? <DemoDataNotice parts={detail.demoParts} /> : null}

        <DestinationDetailView detail={detail} />

        {itinerary ? (
          <ItineraryView
            itinerary={itinerary}
            nights={nights}
            sample={dates === null}
            placeholder={getAiProvider().metadata.isMock}
          />
        ) : null}

        {stayLinks.length > 0 ? (
          <section aria-labelledby="stay-heading" className="flex flex-col gap-3">
            <h2 id="stay-heading" className="font-display text-display-sm text-ink">
              Where to stay
            </h2>
            <p className="text-ink-muted max-w-2xl text-sm">
              We have no priced hotels for {place.name}. This opens a search for your dates and
              party at a booking site.
            </p>
            {stayLinks.map((link) => (
              <FindStayLink key={link.id} offer={link} />
            ))}
          </section>
        ) : null}

        {detail.transfers.length > 0 ? (
          <section aria-labelledby="transfers-heading" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="transfers-heading" className="font-display text-display-sm text-ink">
                Getting in from the airport
              </h2>
              <p className="text-ink-muted max-w-2xl text-sm">
                Priced each way, for the whole party. A trip total in a search counts both
                directions - this is the half of it you would pay on arrival.
              </p>
            </div>

            {/*
              One row of options, side by side, so they compare at a glance:
              how, how long, how much. Rules between them, not boxes round them.
            */}
            <ul className="divide-border border-border grid divide-y border-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
              {detail.transfers.map((transfer) => (
                <li
                  key={transfer.id}
                  data-tint={TRANSFER_TINT[transfer.mode] ?? 'leather'}
                  className="sm:border-border flex flex-col gap-2 px-1 py-5 sm:border-l sm:px-5 sm:first:border-l-0 sm:[&:nth-child(3)]:border-l-0 lg:[&:nth-child(3)]:border-l"
                >
                  <span className="text-ink flex items-center gap-2.5 text-sm font-medium capitalize">
                    <span
                      aria-hidden="true"
                      className="bg-tint/25 text-tint-ink grid size-9 place-items-center rounded-full"
                    >
                      <Icon name={TRANSFER_ICON[transfer.mode] ?? 'car'} size={1} />
                    </span>
                    {transfer.mode}
                  </span>
                  <span className="text-tint-ink text-2xl font-semibold tabular-nums">
                    {format(transfer.pricePerDirection)}
                    <span className="text-ink-muted text-sm font-normal"> each way</span>
                  </span>
                  <span className="text-ink-muted text-sm">
                    about {transfer.durationMinutes} minutes
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Partner link-outs for what a search does not price. Nothing renders without a partner. */}
        <TripExtras offers={offersForTrip()} today={today} />

        {/*
          What is missing, said once and quietly. A footnote rather than a
          panel: it matters that it is said, not that it is loud.
        */}
        <section
          aria-labelledby="gaps-heading"
          className="border-border text-ink-muted flex flex-col gap-2 border-t pt-6 text-sm"
        >
          <h2 id="gaps-heading" className="text-ink text-sm font-semibold">
            What this page cannot tell you yet
          </h2>
          <p className="max-w-3xl">
            No data source behind the product carries these, which is not the same as there being
            nothing to report - and for a travel warning those are very different things:{' '}
            {[
              // A slot with no data source says so here, instead of an empty
              // section that reads as "nothing to report".
              ...(detail.notAvailable.includes('transfers') ? ['Airport transfer prices'] : []),
              ...(detail.notAvailable.includes('places') ? ['Places to eat, see and do'] : []),
              'Photographs of the places listed',
              'Events',
              'National holidays',
              'Travel warnings',
              'Hidden places',
              'Recommended trip lengths',
            ].map((missing, index, all) => (
              <span key={missing}>
                <span className="text-ink">{missing}</span>
                {index < all.length - 1 ? ', ' : '.'}
              </span>
            ))}
          </p>
        </section>
      </Container>
    </div>
  );
}
