import type { Metadata } from 'next';
import { Button, Container, DateRangeField, Field } from '@/components/ui';
import { SearchKindTabs } from '@/components/search/search-kind-tabs';
import { DatePriceGrid } from '@/components/stays/date-price-grid';
import { RateComparison } from '@/components/stays/rate-comparison';
import { StayCard } from '@/components/stays/stay-card';
import { StaySearchForm } from '@/components/stays/stay-search-form';
import { SourceStrip } from '@/components/ui';
import { getStayProviders } from '@/providers/stays/registry';
import { provenanceForMode, type SourceAttribution } from '@/core/trip/provenance';
import { loadStaySearch, stayHref, type StayParams } from '@/search/stays/load-stays';
import type { IsoDate } from '@/core/trip/types';
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
   * Who answered, named on the page.
   *
   * Read off the adapters themselves rather than from configuration, and
   * shown whether or not anything was found: a page of demo hotels that does
   * not say so is the one outcome this product will not ship.
   */
  const sources: SourceAttribution[] = getStayProviders(undefined, dataSource.effective).map(
    (provider) => ({
      part: 'stays',
      providerId: provider.metadata.id,
      displayName: provider.metadata.displayName,
      provenance: provenanceForMode(
        provider.metadata.mode ?? (provider.metadata.isMock ? 'mock' : 'live'),
      ),
    }),
  );

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

  const searchKindHref = (kind: 'flights' | 'stays' | 'both') =>
    kind === 'flights' ? '/' : stayHref(params, { with: kind === 'both' ? 'flights' : undefined });

  return (
    <div className="stage-scope bg-bg text-text min-h-screen">
      <Container size="wide" className="flex flex-col gap-8 py-10">
        <header className="flex flex-col gap-4">
          <SearchKindTabs active={withFlights ? 'both' : 'stays'} hrefFor={searchKindHref} />

          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-ink text-3xl font-medium">
              {view.query.destination.name ?? 'Stays'}
            </h1>
            <SourceStrip sources={sources} />
          </div>
        </header>

        {withFlights ? (
          <section
            aria-labelledby="flights-heading"
            className="border-border flex flex-col gap-3 rounded-[--radius-surface] border p-4"
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
              ? 'border-border flex flex-col gap-3 rounded-[--radius-surface] border p-4'
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

        {view.step === 'dates' ? (
          <DatePriceGrid
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
          <section aria-labelledby="stays-heading" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="stays-heading" className="text-ink text-lg font-medium">
                {view.stays.length} places for {view.nights} nights
              </h2>
              <a
                href={stayHref(params, { dates: undefined, property: undefined })}
                className="text-accent-ink focus-visible:outline-accent-to -my-1 inline-block rounded-sm py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Change dates
              </a>
            </div>

            {view.stays.length === 0 ? (
              <p className="text-ink-muted text-sm">
                Nothing came back for these dates. Try changing them above.
              </p>
            ) : (
              /*
                As many across as fit, and never a half-empty row.

                The same grid the destination rail uses, for the same reason:
                a search that comes back with three hotels should be three
                wide cards, not three cards packed left against a gap that
                reads as a loading state.
              */
              <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-5">
                {view.stays.map((stay, index) => (
                  <li key={stay.key} className="flex">
                    <StayCard
                      stay={stay}
                      nights={view.nights}
                      priority={index < 3}
                      href={stayHref(params, { property: stay.key, reference: undefined })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {view.step === 'property' && view.openStay ? (
          <section aria-labelledby="property-heading" className="flex flex-col gap-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="property-heading" className="text-ink text-xl font-medium">
                {view.openStay.property.name}
              </h2>
              <a
                href={stayHref(params, { property: undefined, reference: undefined })}
                className="text-accent-ink focus-visible:outline-accent-to rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Back to all places
              </a>
            </div>

            {view.openStay.property.description ? (
              <p className="text-ink-muted max-w-prose text-sm">
                {view.openStay.property.description}
              </p>
            ) : null}

            {view.openStay.property.amenities.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {view.openStay.property.amenities.map((amenity) => (
                  <li
                    key={amenity}
                    className="border-border text-ink-muted rounded-full border px-2.5 py-0.5 text-xs"
                  >
                    {amenity}
                  </li>
                ))}
              </ul>
            ) : null}

            <RateComparison
              comparison={view.comparison}
              hrefFor={(entry) => stayHref(params, { reference: entry.rate.id })}
            />
          </section>
        ) : null}
      </Container>
    </div>
  );
}
