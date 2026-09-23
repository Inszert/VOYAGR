import type * as React from 'react';
import { Icon, Media } from '@/components/ui';
import type { StayOccupancy } from '@/core/stay/types';
import type { DestinationImage } from '@/providers/imagery/types';
import { imageryUrlFor } from '@/providers/imagery/url';
import { shortDateRange } from '@/lib/display-date';

/**
 * The top of a stay search: where, when and for whom, over the place itself.
 *
 * A hotel search is about a place before it is about a hotel, and the page
 * used to open on the name of the city in plain type above a form. This puts
 * the city's own photograph behind that name - the same curated picture the
 * globe's cards and the destination page use, through the same proxy, with
 * the same credit - so the results below read as being *somewhere*.
 *
 * **The picture is of the destination, never of a hotel.** No hotel is
 * pictured here, and nothing on this header claims one is. When the catalogue
 * has no article for the place, the wash stands in and the header still
 * reads as deliberate.
 *
 * Every figure is handed in: the nights come from `nightsIn`, the party from
 * the parsed query. Nothing is counted here.
 */

export interface StayHeaderProps {
  /** The place as the person typed it. */
  readonly name: string;
  /** The curated imagery code for the place, when it has one. */
  readonly imageCode: string | null;
  readonly image: DestinationImage | null;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly occupancy: StayOccupancy;
  /** Who is answering, named over the picture rather than below it. */
  readonly sources?: React.ReactNode;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function StayHeader({
  name,
  imageCode,
  image,
  checkIn,
  checkOut,
  nights,
  occupancy,
  sources,
}: StayHeaderProps) {
  const guests = occupancy.adults + occupancy.children;

  return (
    <Media
      seed={imageCode ?? name}
      image={image && imageCode ? { url: imageryUrlFor(imageCode), alt: '' } : null}
      priority
      className="flex min-h-[12rem] flex-col justify-between gap-6 rounded-(--radius-surface) p-5 sm:min-h-[15rem] sm:p-7"
    >
      {/*
        Two scrims, as on the destination page: one up from the bottom where
        the name sits, one in from the left, so the type has its own dark
        whatever the photograph is and the rest of the picture stays bright.
      */}
      <div
        aria-hidden="true"
        className="from-stage via-stage/55 absolute inset-0 -z-10 bg-gradient-to-t to-transparent"
      />
      <div
        aria-hidden="true"
        className="from-stage/70 absolute inset-0 -z-10 bg-gradient-to-r via-transparent to-transparent"
      />

      {/*
        The provenance tags over a photograph get their own dark backing.
        "Demo data" is the one label on this page that must never be hard
        to read, and a translucent pill over a bright sky is.
      */}
      <div className="[&_.voyagr-source]:bg-stage/85 flex justify-end [&_.voyagr-source]:backdrop-blur-sm">
        {sources}
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display-md text-balance text-white">{name}</h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/85">
          <Icon name="calendar" size={0.95} />
          <span className="tabular-nums">{shortDateRange(checkIn, checkOut)}</span>
          <span aria-hidden="true" className="text-white/50">
            ·
          </span>
          <span>{plural(nights, 'night', 'nights')}</span>
          <span aria-hidden="true" className="text-white/50">
            ·
          </span>
          <span>
            {plural(guests, 'guest', 'guests')}, {plural(occupancy.rooms, 'room', 'rooms')}
          </span>
        </p>

        {image ? (
          <p className="text-xs text-white/65">
            Photograph of {name} by{' '}
            <a
              href={image.credit.pageUrl}
              rel="noopener noreferrer nofollow"
              target="_blank"
              className="underline underline-offset-4 hover:text-white"
            >
              {image.credit.author ?? 'photographer not stated'}
            </a>
            {image.credit.licence ? `, ${image.credit.licence}` : ''}, via Wikimedia.
          </p>
        ) : null}
      </div>
    </Media>
  );
}
