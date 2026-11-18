import type { Metadata } from 'next';
import { Button, Container, DateRangeField, EmptyState, Field, Icon } from '@/components/ui';
import { SearchKindTabs } from '@/components/search/search-kind-tabs';
import { DatePriceGrid } from '@/components/stays/date-price-grid';
import { RateComparison } from '@/components/stays/rate-comparison';
import { FindStayLink } from '@/components/stays/find-stay-link';
import { SnapshotStatusLine } from '@/components/stays/snapshot-status';
import { HOTELS_CREDIT } from '@/providers/stays/listings';
import { StaySearchForm } from '@/components/stays/stay-search-form';
import { StayHeader } from '@/components/stays/stay-header';
import { TripFlightCard } from '@/components/stays/trip-flight-card';
import { parseTripCarry } from '@/search/stays/trip-stays';
import { StayResults } from '@/components/stays/stay-results';
import { StaySideCard } from '@/components/stays/stay-side-card';
import { loadStaysPage } from './load-page';
import { StayProperty } from '@/components/stays/stay-property';
import { tintFor } from '@/lib/tint';
import { imageryCodeForPlace, imageryRefFor, resolveImagery } from '@/providers/imagery';
import { loadStaySearch, stayHref, type StayParams } from '@/search/stays/load-stays';
import type { IsoDate } from '@/core/trip/types';
import { StayStart } from '@/components/stays/stay-start';
import { loadRecommendations } from '@/search/stays/recommendations';
import { coveredCities } from '@/search/stays/start-cities';
import { getActiveDataSource } from '@/providers/request-source';

/**
 * The stay search, as one flow.
 *
 * Dates, then hotels, then one hotel - in that order and all at one address.
 * The step is derived from the query string rather than held in component
 * state, so the back button walks back through the flow and a link to any
 * step opens on that step.
 *
 * Nothing here knows which provider answered. It renders the normalized
 * model, so adding a vendor is registering an adapter.
 */

export const metadata: Metadata = {
  title: 'Stays',
  description: 'Search for places to stay by dates and compare the hotels and rates in a city.',
};

function firstValues(params: Record<string, string | string[] | undefined>): StayParams {
  const values: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(params)) {
    values[key] = Array.isArray(value) ? value[0] : value;
  }

  return values;
}

export default async function StaysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = firstValues(await searchParams);
  /*
   * The same one-line expression the discovery loader uses. A calendar date
   * from the UTC instant, kept as a string so nothing ever parses it back
   * into a `Date` for arithmetic.
   */
  const today = new Date().toISOString().slice(0, 10) as IsoDate;
  // Read once and passed down, like every other page: the vendors that
  // answered and the vendors named on the page have to be the same ones.
  const dataSource = await getActiveDataSource();
  const view = await loadStaySearch(params, today, dataSource.effective);

  /*
   * Flights and a stay, on one page, with two independent sets of dates.
   *
   * `with=flights` adds the flight search above the stay flow. The two are
   * deliberately separate forms submitting to separate places: the hotel
   * dates live in `checkIn`/`checkOut` and the flight dates in the trip
   * search's own parameters, so **changing one cannot overwrite the other**.
   * A trip from the 10th to the 14th with a hotel from the 11th to the 13th
   * is a normal thing to want and has to stay expressible.
   */
  const withFlights = params.with === 'flights';
  // A flight chosen on the trip, carried here as words; null unless the link came from a trip.
  const tripCarry = parseTripCarry(params);

  const nothingSearched = !params.destination && !params.checkIn && !params.property;

  /*
   * The start screen: nothing searched yet. Stored hotels and the cities we
   * cover, read on the server from our own snapshot - no vendor call. Every
   * later step below is untouched.
   */
  if (nothingSearched) {
    const cards = await loadRecommendations({ seed: today, count: 4 });
    return (
      <div className="stage-scope bg-bg text-text min-h-screen" data-tint={tintFor(null)}>
        <Container size="wide" className="flex flex-col gap-8 py-10 lg:gap-5 lg:py-6">
          <SearchKindTabs
            active="stays"
            hrefFor={(kind) =>
              kind === 'stays'
                ? stayHref(params, { with: undefined })
                : `/explore?view=${kind === 'flights' ? 'flight' : 'trip'}`
            }
          />
          <StayStart
            query={view.query}
            today={today}
            cards={cards}
            cities={coveredCities()}
            errors={view.errors}
          />
        </Container>
      </div>
    );
  }

  /*
   * The place's photograph, for the header.
   *
   * By the code a trip handed over, or else by the typed name matched
   * exactly against the curated catalogue - never by searching for it. No
   * code, no picture, and the header keeps its wash.
   */
  const imageCode =
    view.query.destination.code && imageryRefFor(view.query.destination.code)
      ? view.query.destination.code
      : imageryCodeForPlace(view.query.destination.name ?? '');
  const image = imageCode ? ((await resolveImagery([imageCode])).get(imageCode) ?? null) : null;

  /*
   * A stay is the only thing searched here. Flights, and a whole trip, are
   * searched on the explorer - where flights and hotels are priced together
   * - so those two tabs leave for it rather than bolting a flight form on.
   */
  const { place, listings, rows, area, cheapestId, locator } = await loadStaysPage(
    view,
    params,
    dataSource.effective,
  );
  const searchKindHref = (kind: 'flights' | 'stays' | 'both') =>
    kind === 'stays'
      ? stayHref(params, { with: undefined })
      : `/explore?view=${kind === 'flights' ? 'flight' : 'trip'}`;

  return (
    <div
      className="stage-scope bg-bg text-text min-h-screen"
      data-tint={tintFor(imageCode ?? view.query.destination.name)}
    >
      <Container size="wide" className="flex flex-col gap-8 py-10 lg:gap-5 lg:py-6">
        <header className="flex flex-col gap-4">
          <SearchKindTabs active={withFlights ? 'both' : 'stays'} hrefFor={searchKindHref} />

          <StayHeader
            name={view.query.destination.name ?? 'Stays'}
            imageCode={imageCode}
            image={image}
            checkIn={view.query.checkIn}
            checkOut={view.query.checkOut}
            nights={view.nights}
            occupancy={view.query.occupancy}
          />
        </header>

        {tripCarry ? <TripFlightCard carry={tripCarry} /> : null}

        {withFlights ? (
          <section
            aria-labelledby="flights-heading"
            className="border-border flex flex-col gap-3 rounded-(--radius-surface) border p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="flights-heading" className="text-ink text-lg font-medium">
                Flights
              </h2>
              <p className="text-ink-muted text-sm">
                Separate dates from the stay below. Changing one leaves the other alone.
              </p>
            </div>

            <form method="get" action="/" className="grid gap-3 sm:grid-cols-4">
              <Field label="From" name="origins" defaultValue={params.origins ?? ''} required />
              <Field
                label="To"
                name="destinations"
                defaultValue={params.destinations ?? view.query.destination.code ?? ''}
                required
              />
              <DateRangeField
                startLabel="Leaving"
                startName="earliestDeparture"
                startValue={params.earliestDeparture ?? view.query.checkIn}
                endLabel="Back"
                endName="latestReturn"
                endValue={params.latestReturn ?? view.query.checkOut}
                min={today}
              />
              <input type="hidden" name="checkIn" value={view.query.checkIn} />
              <input type="hidden" name="checkOut" value={view.query.checkOut} />
              <div className="flex items-end">
                <Button type="submit">Search flights</Button>
              </div>
            </form>
          </section>
        ) : null}

        <section
          aria-labelledby="stay-search-heading"
          className={
            withFlights
              ? 'border-border flex flex-col gap-3 rounded-(--radius-surface) border p-4'
              : 'contents'
          }
        >
          {withFlights ? (
            <h2 id="stay-search-heading" className="text-ink text-lg font-medium">
              Stay
            </h2>
          ) : (
            <h2 id="stay-search-heading" className="sr-only">
              Stay search
            </h2>
          )}

          <StaySearchForm
            query={view.query}
            today={today}
            errors={view.errors}
            /*
             * The flight dates ride along, unchanged.
             *
             * Without this the flight form falls back to the stay's check-in
             * and so *follows* it: editing the hotel dates silently moved the
             * flight, which is precisely the coupling this mode exists to
             * avoid. Carrying them means that once either set of dates has
             * been chosen, it keeps its own value.
             */
            hidden={
              withFlights
                ? {
                    with: 'flights',
                    ...(params.origins ? { origins: params.origins } : {}),
                    ...(params.destinations ? { destinations: params.destinations } : {}),
                    earliestDeparture: params.earliestDeparture ?? view.query.checkIn,
                    latestReturn: params.latestReturn ?? view.query.checkOut,
                  }
                : {}
            }
            submitLabel={view.step === 'dates' ? 'Search stays' : 'Update search'}
          />
        </section>

        {view.failures.length > 0 ? (
          <p role="status" className="text-caution-ink text-sm">
            {view.failures.length} provider
            {view.failures.length === 1 ? '' : 's'} could not answer, so some options may be
            missing.
          </p>
        ) : null}

        {view.snapshot && view.step !== 'results' ? (
          <SnapshotStatusLine status={view.snapshot} />
        ) : null}

        {view.step === 'dates' ? (
          <DatePriceGrid
            city={view.query.destination.name ?? null}
            prices={view.calendar}
            hrefFor={(price) =>
              stayHref(params, {
                checkIn: price.checkIn,
                checkOut: price.checkOut,
                dates: 'confirmed',
                property: undefined,
                reference: undefined,
              })
            }
          />
        ) : null}

        {view.step === 'results' ? (
          <section aria-label="Places to stay" className="flex flex-col gap-4">
            {rows.length > 0 && place && area ? null : (
              <h1 className="text-ink font-display text-display-sm">
                Places to stay in {place?.city ?? view.query.destination.name ?? 'your city'}
              </h1>
            )}
            <a
              href={stayHref(params, { dates: undefined, property: undefined })}
              className="text-accent-ink focus-visible:outline-accent-to inline-flex min-h-11 w-fit items-center rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Change dates
            </a>

            {view.stays.length === 0 && view.links.length > 0
              ? /*
                Nothing here could be priced, and a link out exists: that link is
                the answer, so it is the page's content rather than something
                sitting above a sentence that says nothing came back.
              */
                view.links.map((link) => (
                  <section
                    key={link.id}
                    aria-labelledby={`partner-${link.id}`}
                    className="border-border bg-surface-raised flex flex-col gap-4 rounded-(--radius-shell) border p-6 sm:p-8"
                  >
                    <div>
                      <h3
                        id={`partner-${link.id}`}
                        className="font-display text-display-sm text-ink text-balance"
                      >
                        Find a place to stay in {link.destinationName}
                      </h3>
                      <p className="text-ink-muted mt-2 max-w-[60ch] text-sm leading-relaxed">
                        We cannot show rates for {link.destinationName} ourselves yet. The search
                        opens on {link.displayName} with your dates and guests filled in, and the
                        price you see there is theirs.
                      </p>
                    </div>
                    <FindStayLink offer={link} />
                  </section>
                ))
              : view.links.map((link) => <FindStayLink key={link.id} offer={link} />)}

            {rows.length > 0 && place && area ? (
              <StayResults
                rows={rows}
                nights={view.nights}
                city={place.city}
                centre={place.centre}
                area={area}
                status={view.snapshot}
                cheapestId={cheapestId}
                credit={HOTELS_CREDIT}
                listed={listings?.status === 'ok'}
              />
            ) : view.links.length > 0 ? null : (
              <EmptyState
                icon={<Icon name="bed" />}
                title={
                  !place
                    ? `We could not place ${view.query.destination.name ?? 'that city'} on the map`
                    : listings?.status === 'absent'
                      ? `We do not have a list of hotels in ${place.city} yet`
                      : 'No places came back for these dates'
                }
                description={
                  !place
                    ? 'Try the city name as it is usually written in English, for example Barcelona or Vienna.'
                    : listings?.status === 'absent'
                      ? 'Our hotel list covers the larger cities so far, and no provider priced a stay here for these dates.'
                      : 'Nothing was listed or priced for this stay. Other dates, or fewer guests to a room, often do.'
                }
                action={
                  <Button asChild variant="secondary" size="md">
                    <a href={stayHref(params, { dates: undefined, property: undefined })}>
                      Change dates
                    </a>
                  </Button>
                }
              />
            )}
          </section>
        ) : null}

        {view.step === 'property' && view.openStay ? (
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-8">
              <StayProperty
                stay={view.openStay}
                backHref={stayHref(params, { property: undefined, reference: undefined })}
                locator={null}
              />
              <RateComparison
                comparison={view.comparison}
                hrefFor={(entry) => stayHref(params, { reference: entry.rate.id })}
              />
            </div>
            {view.reference ? (
              <div className="lg:sticky lg:top-24 lg:order-last">
                <StaySideCard
                  rate={view.reference}
                  hotelName={view.openStay.property.name}
                  checkIn={view.query.checkIn}
                  checkOut={view.query.checkOut}
                  nights={view.nights}
                  adults={view.query.occupancy.adults}
                  rooms={view.query.occupancy.rooms}
                  locator={locator ? { map: locator, label: view.openStay.property.name } : null}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </Container>
    </div>
  );
}
