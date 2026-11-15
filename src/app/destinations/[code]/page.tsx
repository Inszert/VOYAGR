import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { format } from '@/core/money';
import { Button, Container, Icon, UpdatedAgo, type IconName } from '@/components/ui';
import { costCoverage, describeExclusions } from '@/core/trip/coverage';
import { DestinationHero } from '@/components/destination/destination-hero';
import { WeatherSection } from '@/components/destination/weather-section';
import { HeaderOffset } from '@/components/search/header-offset';
import { formatWhole } from '@/search/day-prices-json';
import { countryNameFor } from '@/lib/destination-media';
import { shortDate } from '@/lib/display-date';
import { summariseWeather, TYPICAL_LABEL } from '@/discovery/weather-summary';
import '@/components/search/explore.css';
import { tintFor, type Tint } from '@/lib/tint';
import { daysBetween } from '@/core/dates';
import { getAiProvider } from '@/ai';
import { getEnv } from '@/lib/env';
import { draftItinerary, itineraryRequestFor } from '@/discovery/itinerary';
import { ItineraryView } from '@/components/discovery/itinerary-view';
import { loadDestinationDetail } from '@/discovery/destination-detail';
import { DestinationDetailView } from '@/components/discovery/destination-detail-view';
import { resolveDestinationGeo } from '@/search/destination-names';
import { resolveImagery } from '@/providers/imagery';
import { getActiveDataSource } from '@/providers/request-source';
import { FindStayLink } from '@/components/stays/find-stay-link';
import { loadStayLinks } from '@/search/stays/stay-links';
import { offersForTrip } from '@/booking/partners';
import { TripExtras } from '@/components/partners';
import { buildDiscoveryQuery } from '@/discovery/snapshot';
import { FlexDatesSection, loadFlexForTrip } from '@/components/search/flex-dates-section';
import {
  ThingsToDoLoaded,
  ThingsToDoSkeleton,
} from '@/components/destination/things-to-do-section';
import { loadThingsToDo, parseKind, type ThingsToDoOutcome } from '@/discovery/things-to-do';
import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import type { ThingKind } from '@/providers/types';

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

  // Started now and awaited inside a Suspense boundary: the first look at a city
  // asks an open dataset a heavy question, and nothing else on the page waits for it.
  const things = loadThingsToDo({
    destination,
    destinationName: place.name,
    position: place.position,
  });
  const kind = parseKind(query.kind);
  const user = await getCurrentUser();
  const planTrips = user
    ? (await getRepositories().trips.listForUser(user.id)).map((trip) => ({
        id: trip.id,
        name: trip.name,
      }))
    : null;
  // Every other parameter is carried over, so a filter does not forget the dates.
  const hrefForKind = (next: ThingKind | null): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === 'kind' || value === undefined) continue;
      for (const entry of [value].flat()) params.append(key, entry);
    }
    if (next) params.set('kind', next);
    const text = params.toString();

    return `${text ? `?${text}` : '?'}#things-heading`;
  };

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

  /*
   * "Fly a few days earlier or later", for one real pair of dates. Arriving
   * from a search brings the origin and the pair; without both there is no
   * trip to move, and a strip for a window nobody chose would be a guess.
   */
  const origin = (single(query.origin) ?? '').toUpperCase();
  const flexDeparture = single(query.departureDate);
  const flexReturn = single(query.returnDate);
  const flex =
    /^[A-Z]{3}$/.test(origin) &&
    flexDeparture &&
    flexReturn &&
    ISO_DATE.test(flexDeparture) &&
    ISO_DATE.test(flexReturn)
      ? { origin, departureDate: flexDeparture, returnDate: flexReturn }
      : null;

  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'EUR';
  const safePassengers = Number.isSafeInteger(passengers) && passengers > 0 ? passengers : 2;
  const country = countryNameFor(destination);
  const image = (await resolveImagery([destination])).get(destination.toUpperCase()) ?? null;

  // A search link with the dates left open, for the strip and for the panel's button.
  const hrefTemplate = flex
    ? `/explore?${new URLSearchParams({
        ...buildDiscoveryQuery({
          today,
          defaults: {
            origins: origin,
            currency: safeCurrency,
            passengers: String(safePassengers),
          },
        }),
        destinations: destination,
        flexibility: 'exact',
        departureDate: '__DEPARTURE__',
        returnDate: '__RETURN__',
      }).toString()}`
    : null;

  // Read once and shared: the hero's price and the strip are the same prices.
  const flexData =
    flex && hrefTemplate
      ? await loadFlexForTrip({
          ...flex,
          destination,
          currency: safeCurrency,
          passengers: safePassengers,
        })
      : null;
  // The price of the dates the visitor arrived with: read off the strip, never computed here.
  const ownDates = flexData?.options.find((option) => option.offset === 0) ?? null;
  const flightsFrom = ownDates?.price ? formatWhole(ownDates.price) : null;
  const exclusions = describeExclusions(
    costCoverage([{ category: 'hotel' }, { category: 'transfer' }]).excluded,
  );

  const weatherSummary = summariseWeather(detail.weather);
  const weatherLine = weatherSummary
    ? `${weatherSummary.overall.highC}°C by day · ${
        weatherSummary.forecastDays === weatherSummary.overall.days
          ? 'forecast'
          : TYPICAL_LABEL.toLowerCase()
      }`
    : null;

  const planHref =
    flex && hrefTemplate
      ? hrefTemplate
          .replace('__DEPARTURE__', flex.departureDate)
          .replace('__RETURN__', flex.returnDate)
      : `/?destinations=${destination}`;

  return (
    <div data-tint={tintFor(place.adm0 ?? destination)}>
      <HeaderOffset />
      <DestinationHero
        code={destination}
        name={place.name}
        country={country}
        image={image}
        price={
          flightsFrom
            ? {
                amount: flightsFrom,
                covers: `Flights for ${safePassengers} ${safePassengers === 1 ? 'traveller' : 'travellers'}`,
              }
            : null
        }
        weather={weatherLine}
        dates={dates ? `${shortDate(dates.startDate)} to ${shortDate(dates.endDate)}` : null}
      />

      <Container size="wide" className="py-12 md:py-16">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[minmax(0,1fr)_24rem] xl:gap-16">
          <div className="order-2 flex min-w-0 flex-col gap-14 lg:order-1">
            {flex && hrefTemplate ? (
              <FlexDatesSection
                {...flex}
                destination={destination}
                currency={safeCurrency}
                passengers={safePassengers}
                hrefTemplate={hrefTemplate}
                preloaded={flexData}
              />
            ) : null}

            {/* The weather is drawn by `WeatherSection`; the rest of the detail by the shared view. */}
            <WeatherSection days={detail.weather} />
            <DestinationDetailView detail={{ ...detail, weather: [] }} />

            <Suspense fallback={<ThingsToDoSkeleton city={place.name} />}>
              <ThingsToDoLoaded
                outcome={things}
                city={place.name}
                kind={kind}
                hrefFor={hrefForKind}
                planTrips={planTrips}
              />
            </Suspense>

            {itinerary ? (
              <ItineraryView
                itinerary={itinerary}
                nights={nights}
                sample={dates === null}
                placeholder={getAiProvider().metadata.isMock && getEnv().NODE_ENV !== 'production'}
              />
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

                {/* One row of options, side by side, so they compare at a glance. */}
                <ul className="divide-border border-border grid divide-y border-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
                  {detail.transfers.map((transfer) => (
                    <li
                      key={transfer.id}
                      data-tint={TRANSFER_TINT[transfer.mode] ?? 'leather'}
                      className="sm:border-border flex flex-col gap-2 px-1 py-5 sm:border-l sm:px-5 sm:first:border-l-0 sm:[&:nth-child(3)]:border-l-0 xl:[&:nth-child(3)]:border-l"
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
                      <span className="text-ink-muted text-sm tabular-nums">
                        about {transfer.durationMinutes} minutes
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/*
              What is missing, said once and quietly. A note rather than a
              panel: it matters that it is said, not that it is loud.
            */}
            <section
              aria-labelledby="gaps-heading"
              className="border-border text-ink-muted flex flex-col gap-2 border-l-2 pl-5 text-sm"
            >
              <h2 id="gaps-heading" className="text-ink text-sm font-semibold">
                What this page cannot tell you yet
              </h2>
              <p className="max-w-3xl">
                No data source behind the product carries these, which is not the same as there
                being nothing to report - and for a travel warning those are very different things:{' '}
                <Suspense fallback={<MissingList things={null} detail={detail} />}>
                  <ResolvedMissingList things={things} detail={detail} />
                </Suspense>
              </p>
            </section>
          </div>

          {/*
            The price and the way to act on it, kept in view beside the facts
            on a wide screen and first on a phone. "from" because it is the
            cheapest quote seen; what it leaves out is said in words under it.
          */}
          <aside aria-labelledby="plan-heading" className="order-1 lg:order-2">
            <div className="border-border bg-surface-raised shadow-raised flex flex-col gap-5 rounded-(--radius-surface) border p-6 lg:sticky lg:top-[calc(var(--voyagr-header-h,4.5rem)+1.5rem)]">
              <h2 id="plan-heading" className="font-display text-ink text-2xl">
                Plan a trip to {place.name}
              </h2>

              {flightsFrom ? (
                <div className="flex flex-col gap-1">
                  <p className="text-ink-muted text-sm">
                    Flights for {safePassengers} {safePassengers === 1 ? 'traveller' : 'travellers'}
                    , from
                  </p>
                  <p className="text-ink text-3xl font-semibold tracking-tight tabular-nums">
                    {flightsFrom}
                  </p>
                  {exclusions ? (
                    <p className="text-caution-ink text-sm font-medium">{exclusions}</p>
                  ) : null}
                  <UpdatedAgo ageMs={flexData?.ageMs ?? null} />
                </div>
              ) : flex ? null : (
                <p className="text-ink-muted text-sm">
                  Open this page from a search and it shows what the trip costs for your dates.
                </p>
              )}

              <Button
                asChild
                variant="cta"
                size="lg"
                className="w-full active:scale-[0.97] motion-reduce:active:scale-100"
              >
                <a href={planHref}>
                  {flex ? `See trips to ${place.name}` : 'Search trips'}
                  <Icon name="arrow-right" size={1} aria-hidden="true" />
                </a>
              </Button>

              {stayLinks.length > 0 ? (
                <div className="border-border flex flex-col gap-3 border-t pt-4">
                  <p className="text-ink text-sm font-medium">Where to stay</p>
                  <p className="text-ink-muted text-sm">
                    We have no priced hotels for {place.name}. This opens a search for your dates
                    and party at a booking site.
                  </p>
                  {stayLinks.map((link) => (
                    <FindStayLink key={link.id} offer={link} />
                  ))}
                </div>
              ) : null}
            </div>
          </aside>
        </div>

        {/* Partner link-outs for what a search does not price. Nothing renders without a partner. */}
        <div className="bg-surface-sunken border-border mt-16 rounded-(--radius-surface) border p-6 empty:hidden sm:p-10">
          <TripExtras offers={offersForTrip()} today={today} />
        </div>
      </Container>
    </div>
  );
}

/**
 * What the page cannot tell you, said once.
 *
 * "Places to eat, see and do" is named while the places are unknown and
 * whenever they could not be had - the source off, down or empty - and dropped
 * only once a real list is on the page above. `things` is null while that is
 * still loading, which is the pessimistic reading.
 */
function MissingList({
  things,
  detail,
}: {
  things: ThingsToDoOutcome | null;
  detail: { notAvailable: readonly string[] };
}) {
  const placesListed = things?.status === 'ok' && things.things.length > 0;

  return (
    <>
      {[
        // A slot with no data source says so here, instead of an empty
        // section that reads as "nothing to report".
        ...(detail.notAvailable.includes('transfers') ? ['Airport transfer prices'] : []),
        ...(placesListed ? [] : ['Places to eat, see and do']),
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
    </>
  );
}

async function ResolvedMissingList({
  things,
  detail,
}: {
  things: Promise<ThingsToDoOutcome>;
  detail: { notAvailable: readonly string[] };
}) {
  return <MissingList things={await things} detail={detail} />;
}
