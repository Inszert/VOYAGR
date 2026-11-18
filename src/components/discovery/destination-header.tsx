import { AirportSizeLegend } from '@/components/map/airport-size-legend';
import { Container } from '@/components/ui';
import type { Country } from '@/discovery/countries';
import type { DestinationGeo } from '@/discovery/map-model';
import { hasRegions, regionsUrl } from '@/discovery/regions';
import {
  COUNTRIES_DETAIL_URL,
  COUNTRIES_URL,
  ICE_URL,
  LAND_URL,
  PLACES_URL,
  PHYSICAL_URL,
  CITY_LIGHTS_URL,
  COASTLINE_URL,
} from '@/discovery/stage-data';
import type { DestinationImage } from '@/providers/imagery/types';
import { imageryUrlFor } from '@/providers/imagery/url';
import { GlobeStage } from './globe-stage';
import { shortDate } from '@/lib/display-date';

/**
 * The top of a destination's own page.
 *
 * The same stage as the homepage, framed on the country the place is in, so
 * arriving here reads as zooming further into the globe rather than as
 * leaving it for a different website. The place is marked; its country is
 * lit and its regions are drawn.
 *
 * **No price on the marker.** This page knows the place, not what a trip
 * there costs - that depends on dates, an origin and a party this page was
 * not given. A chip carrying a figure here would be inventing one.
 */

export interface DestinationHeaderProps {
  /** Today, so the world is lit for now when no dates were given. */
  today: string;
  destination: string;
  place: DestinationGeo;
  country: Country | null;
  /** The dates the page is describing, if it was given any. */
  dates: { readonly startDate: string; readonly endDate: string } | null;
  /**
   * A photograph of the place, when one was found.
   *
   * Behind the whole header rather than beside the text, so arriving here
   * feels like landing somewhere. Heavily scrimmed: the globe and the type on
   * top of it have to stay readable whatever the photograph happens to be.
   */
  image?: DestinationImage | null;
}

export function DestinationHeader({
  today,
  destination,
  place,
  country,
  dates,
  image = null,
}: DestinationHeaderProps) {
  const empty = { type: 'FeatureCollection', features: [] } as const;

  return (
    <section
      aria-labelledby="destination-heading"
      // `isolate`: the photograph sits at a negative z-index so the type can
      // sit over it without a wrapper, and a negative z-index only paints
      // above this section's own background once this section is a stacking
      // context. Without it the picture is painted behind the dark it is
      // supposed to be seen through, which looks exactly like no picture.
      className="bg-stage text-stage-ink relative isolate -mt-[4.25rem] overflow-hidden pt-[4.25rem]"
    >
      {image ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-20">
          <img
            src={imageryUrlFor(destination)}
            alt=""
            width={image.width}
            height={image.height}
            loading="eager"
            decoding="async"
            className="size-full object-cover"
          />
          {/*
            Two scrims, not one. A flat wash over a photograph leaves the
            bright half of it competing with the headline; a vertical gradient
            plus a horizontal one darkens the corner the type is in and lets
            the picture stay visible where nothing sits on it.
          */}
          <div className="from-stage via-stage/45 to-stage/25 absolute inset-0 bg-gradient-to-t" />
          <div className="from-stage via-stage/55 absolute inset-0 bg-gradient-to-r to-transparent" />
        </div>
      ) : null}

      <div
        aria-hidden="true"
        className="voyagr-sky pointer-events-none absolute inset-0 -z-10"
        style={{ '--sky-x': '65%', '--sky-y': '45%' } as React.CSSProperties}
      />

      <Container size="wide" className="py-8">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
          <div className="flex flex-col gap-3">
            <p className="text-stage-ink-muted text-xs font-semibold tracking-[0.2em] uppercase">
              {country ? country.name : place.country} · airport {destination}
            </p>
            <h1
              id="destination-heading"
              className="font-display text-display-md sm:text-display-lg text-balance"
            >
              {place.name}
            </h1>
            <p className="text-stage-ink-muted max-w-prose">
              {dates
                ? `What this place is like between ${shortDate(dates.startDate)} and ${shortDate(dates.endDate)}, from the same providers that priced the trip.`
                : 'What this place is like, from the same providers that price a trip to it. Arrive from a search and the outlook covers your dates.'}
            </p>

            {image ? (
              <p className="text-stage-ink-muted/80 text-xs">
                Photograph of {place.name} by{' '}
                <a
                  href={image.credit.pageUrl}
                  rel="noopener noreferrer nofollow"
                  target="_blank"
                  className="underline underline-offset-4"
                >
                  {image.credit.author ?? 'photographer not stated'}
                </a>
                {image.credit.licence ? `, ${image.credit.licence}` : ''}, via Wikimedia.
              </p>
            ) : null}
          </div>

          <div>
            <div className="h-[18rem] sm:h-[22rem]">
              <GlobeStage
                chips={[
                  {
                    destination,
                    name: place.name,
                    country: place.country,
                    adm0: place.adm0,
                    position: place.position,
                    label: '',
                    reason: '',
                    href: `/destinations/${destination.toLowerCase()}`,
                    actionLabel: 'This page is about',
                    rank: 0,
                    highlighted: true,
                  },
                ]}
                origins={[]}
                routes={empty}
                points={{
                  type: 'FeatureCollection',
                  features: [
                    {
                      type: 'Feature',
                      geometry: { type: 'Point', coordinates: [...place.position] },
                      properties: { destination, name: place.name },
                    },
                  ],
                }}
                landUrl={LAND_URL}
                iceUrl={ICE_URL}
                placesUrl={PLACES_URL}
                countriesUrl={COUNTRIES_URL}
                countriesDetailUrl={COUNTRIES_DETAIL_URL}
                physicalUrl={PHYSICAL_URL}
                cityLightsUrl={CITY_LIGHTS_URL}
                coastlineUrl={COASTLINE_URL}
                seasonDate={dates?.startDate ?? today}
                regionsUrl={country && hasRegions(country.adm0) ? regionsUrl(country.adm0) : null}
                provenance="unavailable"
                countryCounts={country ? { [country.adm0]: 1 } : {}}
                selectedCountry={
                  country ? { adm0: country.adm0, name: country.name, bbox: country.bbox } : null
                }
                // A country selected here goes to the explorer, because this
                // page is about one place and the explorer is about all of them.
                navigation={{ path: '/explore', query: '' }}
                variant="explorer"
              />
            </div>
            <AirportSizeLegend className="mt-2" />
          </div>
        </div>
      </Container>
    </section>
  );
}
