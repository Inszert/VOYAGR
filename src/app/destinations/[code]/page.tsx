import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { format } from '@/core/money';
import { Card, CardTitle, Container, DemoDataNotice, Tag } from '@/components/ui';
import { loadDestinationDetail } from '@/discovery/destination-detail';
import { DestinationDetailView } from '@/components/discovery/destination-detail-view';
import { DestinationHeader } from '@/components/discovery/destination-header';
import { findCountry } from '@/discovery/countries';
import { resolveDestinationGeo } from '@/search/destination-names';
import { resolveImagery } from '@/providers/imagery';

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

  return (
    <div className="flex flex-col">
      <DestinationHeader
        today={new Date().toISOString().slice(0, 10)}
        destination={destination}
        place={place}
        country={place.adm0 ? findCountry(place.adm0) : null}
        dates={dates}
        image={(await resolveImagery([destination])).get(destination.toUpperCase()) ?? null}
      />

      <Container className="flex flex-col gap-6 py-10">
        {/*
          Before the content, as everywhere else. A notice that what follows is
          fictional is worthless underneath the fiction.
        */}
        {detail.provenance === 'mock' ? <DemoDataNotice /> : null}

        <DestinationDetailView detail={detail} />

        {detail.transfers.length > 0 ? (
          <Card as="section" aria-labelledby="transfers-heading" elevation="raised">
            <CardTitle id="transfers-heading" level={2}>
              Getting in from the airport
            </CardTitle>
            <p className="text-ink-muted mt-1 text-sm">
              Priced each way, for the whole party. A trip total in a search counts both directions
              - this is the half of it you would pay on arrival.
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {detail.transfers.map((transfer) => (
                <li
                  key={transfer.id}
                  className="border-border flex flex-wrap items-baseline justify-between gap-2 rounded-[--radius-card] border p-3"
                >
                  <span className="text-ink text-sm font-medium capitalize">{transfer.mode}</span>
                  <span className="text-ink-muted text-sm">
                    about {transfer.durationMinutes} minutes
                  </span>
                  <span className="text-ink text-sm font-semibold tabular-nums">
                    {format(transfer.pricePerDirection)} each way
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card as="section" aria-labelledby="gaps-heading" surface="sunken">
          <CardTitle id="gaps-heading" level={2}>
            What this page cannot tell you yet
          </CardTitle>
          <p className="text-ink-muted mt-2 text-sm">
            Section 18 of the specification asks for more than this. These are missing because no
            data source behind the product carries them, not because there is nothing to report -
            and for a travel warning those are very different things.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {[
              'Photographs',
              'Events',
              'National holidays',
              'Travel warnings',
              'Hidden places',
              'Recommended trip lengths',
            ].map((missing) => (
              <li key={missing}>
                <Tag>{missing}</Tag>
              </li>
            ))}
          </ul>
        </Card>
      </Container>
    </div>
  );
}
