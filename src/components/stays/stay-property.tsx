import type * as React from 'react';
import { Icon, Media, type IconName } from '@/components/ui';
import type { CanonicalStay } from '@/core/stay/identity';
import type { LocatorMap as LocatorMapData } from '@/discovery/locator';
import { LocatorMap } from './locator-map';
import { cn } from '@/lib/cn';

/**
 * One property, opened.
 *
 * What a person deciding on a hotel looks for, in the order they look: what
 * it looks like, what it is and how good, what is there, where it is, and
 * then what it costs from whom - the comparison, passed in as `children`.
 *
 * **Pictures are only ever of what they say they are.** The provider's own
 * photographs lead when it sent any. When it sent none, the page says so; the
 * city's photograph is already its header, and a picture of anything else
 * here would read as a claim about the hotel that nobody made.
 */

export interface StayPropertyProps {
  readonly stay: CanonicalStay;
  /** Where "Back to all places" goes. */
  readonly backHref: string;
  readonly locator: LocatorMapData | null;
  /** The rate comparison. */
  readonly children: React.ReactNode;
}

/** An icon for an amenity, by what it names. Anything unrecognised gets none. */
export function amenityIcon(amenity: string): IconName | null {
  const text = amenity.toLowerCase();

  if (text.includes('wifi') || text.includes('internet')) return 'wifi';
  if (text.includes('pool')) return 'waves';
  if (text.includes('air')) return 'wind';
  if (text.includes('kitchen')) return 'utensils';
  if (text.includes('breakfast')) return 'coffee';
  if (text.includes('gym') || text.includes('fitness')) return 'dumbbell';
  if (text.includes('spa')) return 'sparkle';
  if (text.includes('parking')) return 'parking';
  if (text.includes('beach')) return 'sun';

  return null;
}

function sentenceCase(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

export function StayProperty({ stay, backHref, locator, children }: StayPropertyProps) {
  const { property } = stay;
  const photos = property.photos;
  const address = [property.address.line, property.address.city, property.address.countryCode]
    .filter(Boolean)
    .join(', ');

  const kind = [
    property.starRating ? `${property.starRating}-star` : null,
    property.propertyType ?? null,
  ]
    .filter(Boolean)
    .join(' ');

  // A function rather than a component: it closes over this property, and
  // is drawn on the colour band or on the page depending on the photos.
  const header = (onImage: boolean) => {
    return (
      <header className="flex flex-col gap-3">
        {kind ? (
          <p
            className={
              onImage ? 'text-sm font-medium text-white/85' : 'text-tint-ink text-sm font-medium'
            }
          >
            {sentenceCase(kind)}
          </p>
        ) : null}
        <h2
          id="property-heading"
          // Not `cn`: its merge reads `text-display-md` and `text-white` as the
          // same kind of class and keeps only one.
          className={`font-display text-display-md text-balance ${onImage ? 'text-white' : 'text-ink'}`}
        >
          {property.name}
        </h2>
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-4 gap-y-2 text-sm',
            onImage ? 'text-white/85' : 'text-ink-muted',
          )}
        >
          {property.guestRating ? (
            <span className="flex items-center gap-2">
              <span className="bg-positive-500/20 text-positive-ink border-positive-500/50 rounded-(--radius-control) border px-2 py-0.5 text-sm font-semibold tabular-nums backdrop-blur-sm">
                {property.guestRating.outOfTen.toFixed(1)}
                <span className="sr-only"> out of 10</span>
              </span>
              {property.guestRating.reviewCount
                ? `${property.guestRating.reviewCount} guest reviews`
                : 'Guest rating'}
            </span>
          ) : (
            <span>No guest rating</span>
          )}
          {address ? (
            <span className="flex items-center gap-1.5">
              <Icon name="pin" size={0.95} />
              {address}
            </span>
          ) : null}
        </div>
      </header>
    );
  };

  return (
    <section aria-labelledby="property-heading" className="flex flex-col gap-8">
      <a
        href={backHref}
        className="text-tint-ink focus-visible:outline-accent-to inline-flex w-fit items-center gap-1.5 rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Icon name="chevron-left" size={0.95} />
        Back to all places
      </a>

      {/*
        The pictures. The provider's, laid out as a gallery when there are
        several.
      */}
      {photos.length > 0 ? (
        <>
          <div className="grid h-[18rem] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-(--radius-surface) sm:h-[24rem]">
            {photos.slice(0, 5).map((photo, index) => (
              <Media
                key={photo.url}
                seed={`${stay.key}-${index}`}
                image={{ url: photo.url, alt: photo.caption ?? '' }}
                priority={index === 0}
                className={index === 0 ? 'col-span-4 row-span-2 sm:col-span-2' : 'hidden sm:block'}
              />
            ))}
          </div>
          {header(false)}
        </>
      ) : (
        /*
          No photographs: the property's own colour band, with its name on it.

          The same wash its card in the list carries, so the place opened is
          recognisably the one clicked. Said plainly inside it that the
          provider sent no pictures, so the colour is never mistaken for one.
        */
        <Media
          seed={stay.key}
          scrim="bottom"
          priority
          className="flex min-h-[15rem] flex-col justify-end rounded-(--radius-surface) p-6 sm:min-h-[18rem] sm:p-8"
        >
          {header(true)}
          <p className="mt-4 text-xs text-white/70">
            The provider sent no photographs of this property.
          </p>
        </Media>
      )}

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {property.description ? (
            <p className="text-ink-muted max-w-prose text-base leading-relaxed">
              {property.description}
            </p>
          ) : null}

          {property.amenities.length > 0 ? (
            <section aria-labelledby="amenities-heading" className="flex flex-col gap-4">
              <h3 id="amenities-heading" className="font-display text-ink text-xl">
                What&rsquo;s here
              </h3>
              {/*
                A list with an icon each, not a row of pills. Pills made every
                amenity the same small grey lozenge; set in a grid with a mark
                beside each, they read as a list of things the place has.
              */}
              <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {property.amenities.map((amenity) => {
                  const icon = amenityIcon(amenity);
                  return (
                    <li key={amenity} className="text-ink flex items-center gap-3 text-sm">
                      <span
                        aria-hidden="true"
                        className="bg-tint/15 text-tint-ink grid size-8 shrink-0 place-items-center rounded-full"
                      >
                        {icon ? <Icon name={icon} size={1.05} /> : <Icon name="plus" size={0.9} />}
                      </span>
                      {sentenceCase(amenity)}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {children}
        </div>

        <aside aria-labelledby="where-heading" className="flex flex-col gap-3 lg:sticky lg:top-24">
          <h3 id="where-heading" className="font-display text-ink text-xl">
            Where it is
          </h3>
          {locator ? (
            <div className="border-border overflow-hidden rounded-(--radius-card) border">
              <LocatorMap map={locator} label={property.name} />
            </div>
          ) : null}
          <p className="text-ink-muted text-sm">
            {address ? `${address}. ` : ''}
            {property.position
              ? `${Math.abs(property.position.latitude).toFixed(3)}° ${property.position.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(property.position.longitude).toFixed(3)}° ${property.position.longitude >= 0 ? 'E' : 'W'}.`
              : 'The provider did not give a position.'}
          </p>
          {locator ? (
            <p className="text-dim text-xs">
              A regional map from Natural Earth: it shows the coast and the places around, not
              streets.
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
