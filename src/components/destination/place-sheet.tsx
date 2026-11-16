'use client';

import * as React from 'react';
import { RemotePicture } from '@/components/home/remote-picture';
import { Icon, Sheet, SheetClose, SheetContent } from '@/components/ui';
import { AddToPlan } from '@/components/search/add-to-plan';
import { formatKilometres } from '@/core/distance';
import { placeImageUrl } from '@/providers/places/image-url';
import { KIND_ICON, KIND_TINT, KIND_WORDS, sentenceCase } from './place-kinds';
import { PlacesMap } from './places-map';
import { usePlaces } from './places-context';
import { useMedia } from './use-media';
import './destination.css';

/**
 * One place, in detail: a side panel on a desktop, a bottom sheet on a phone.
 *
 * Radix Dialog underneath (focus trap, Escape, focus returned to whatever
 * opened it). Everything in it is the source's own: the photograph and who took
 * it, the one-line description, how far it is from the centre (core's distance),
 * where it sits on our own plan, a link to its article and "Add to my plan".
 */

export function PlaceSheet() {
  const { things, credits, centre, planTrips, openId, close } = usePlaces();
  const phone = useMedia('(max-width: 767px)') === true;
  const place = things.find((thing) => thing.id === openId) ?? null;
  // Kept for the closing animation, so the panel does not empty while it slides away.
  const [last, setLast] = React.useState(place);
  if (place && place !== last) setLast(place);
  const shown = place ?? last;
  if (!shown) return null;

  const credit = shown.imageFile ? credits[shown.imageFile] : undefined;

  return (
    <Sheet open={place !== null} onOpenChange={(next) => (next ? null : close())}>
      <SheetContent
        title={shown.name}
        side={phone ? 'bottom' : 'right'}
        data-tint={KIND_TINT[shown.kind]}
        className="voyagr-place-sheet"
      >
        <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden">
          {/* The kind's mark is the tile; the photograph covers it once it has arrived, and is removed if it fails. */}
          <span
            aria-hidden="true"
            className="bg-surface-sunken text-tint-ink grid size-full place-items-center"
          >
            <Icon name={KIND_ICON[shown.kind]} size={3} />
          </span>
          {shown.imageFile ? (
            <RemotePicture
              src={placeImageUrl(shown.imageFile, 640)}
              srcSet={`${placeImageUrl(shown.imageFile, 640)} 640w, ${placeImageUrl(shown.imageFile, 1280)} 1280w`}
              sizes="(min-width: 768px) 27.5rem, 100vw"
              alt={`${shown.name}`}
              fallback={null}
              className="absolute inset-0 size-full object-cover"
            />
          ) : null}
          <SheetClose
            className="absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white backdrop-blur-sm hover:bg-black/70"
            aria-label="Close"
          >
            <svg
              viewBox="0 0 24 24"
              width="1.1em"
              height="1.1em"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </SheetClose>
        </div>

        <div className="flex flex-col gap-4 p-5 pb-8">
          {shown.imageFile ? (
            <p className="text-dim -mt-1 text-xs">
              Photograph: {credit?.author ?? 'author not stated'},{' '}
              {credit?.licence ?? 'licence not stated'}.{' '}
              <a
                href={
                  credit?.pageUrl ??
                  `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(shown.imageFile)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-tint-ink inline-flex min-h-6 items-center underline underline-offset-4"
              >
                Commons page<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <p className="text-dim text-[11px] font-medium tracking-[0.18em] uppercase">
              {KIND_WORDS[shown.kind]}
            </p>
            {/* The dialog's own name is the sr-only title; this is the same words, seen. */}
            <p aria-hidden="true" className="font-display text-ink text-2xl leading-tight">
              {shown.name}
            </p>
            {shown.description ? (
              <p className="text-ink-muted text-sm">{sentenceCase(shown.description)}.</p>
            ) : null}
            <p className="text-ink text-sm tabular-nums">
              {formatKilometres(shown.distanceFromCentreMetres)} from the centre
            </p>
          </div>

          <PlacesMap places={things} centre={centre} focusId={shown.id} className="h-auto w-full" />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {shown.wikipediaUrl ? (
              <a
                href={shown.wikipediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-tint-ink inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
              >
                Read on Wikipedia
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
            {planTrips ? (
              <AddToPlan
                place={{ title: shown.name, url: shown.wikipediaUrl }}
                subject={shown.name}
                trips={planTrips}
              />
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
