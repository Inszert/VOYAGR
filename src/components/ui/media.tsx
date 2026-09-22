import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * A photograph, and what stands in for one when none arrived.
 *
 * Three call sites were each solving the same four problems - a wash under
 * the picture, grading over it, a scrim for text, a clip so a hover scale
 * cannot escape the corner radius - and solving them slightly differently.
 * A destination looked like one place on the rail and another on its trip
 * card, and a hotel looked like neither.
 *
 * **The wash is painted first and stays.** The imagery provider is allowed to
 * return nothing - a place nobody has chosen an article for, a reader on a
 * train, a Wikimedia outage - and that is an expected condition rather than a
 * failure. A card whose photograph never arrives is a card in that place's
 * own colour, not a grey rectangle and not a broken-image icon.
 *
 * The height belongs to the call site, through `className`. A rail card, a
 * result header and a hotel row want different crops of the same picture, and
 * a component that decided that for them would be a component with a list of
 * exceptions in it.
 */

export interface MediaImage {
  readonly url: string;
  /** Empty when the picture is decoration beside text that already names it. */
  readonly alt?: string;
  readonly width?: number | null;
  readonly height?: number | null;
}

/** How dark it gets behind text laid over the picture. */
export type MediaScrim = 'none' | 'bottom' | 'full' | 'stage';

const SCRIM_CLASSES: Record<MediaScrim, string> = {
  none: '',
  // For a caption sitting on the lower third.
  bottom: 'bg-gradient-to-t from-black/75 via-black/25 to-transparent',
  // For a heading and a price laid across the whole picture.
  full: 'bg-gradient-to-t from-black/90 via-black/60 to-black/25',
  /*
   * For a panel that has to dissolve into the page rather than sit on it.
   *
   * Black would put a seam where the band meets the stage above it. This
   * fades to the stage's own colour instead, so the picture ends and the
   * page carries on.
   */
  stage: 'from-stage via-stage/80 via-60% bg-gradient-to-t to-transparent',
};

export interface MediaProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * What the wash's hue is derived from - an airport code, a property id.
   *
   * Stable on purpose: one place keeps one colour between renders and
   * between the rail, the result card and the detail page.
   */
  seed: string;
  image?: MediaImage | null;
  /** Load immediately. For the few that are above the fold. */
  priority?: boolean;
  scrim?: MediaScrim;
  /**
   * Scale a little when the enclosing `group` is hovered.
   *
   * Only for a card that is itself a link. A static picture that moves under
   * the pointer is a picture pretending to be a control.
   */
  zoomOnHover?: boolean;
  /** Badges, captions - anything that sits on the picture. */
  children?: React.ReactNode;
}

/**
 * The wash under a photograph.
 *
 * Hue from the seed's own characters, so it is deterministic and the server
 * and the browser paint the same card. Decoration: it says nothing about the
 * place, which is why it is a gradient and not a picture.
 */
export function washFor(seed: string): React.CSSProperties {
  const hue = [...seed].reduce((total, character) => total + character.charCodeAt(0), 0) % 360;

  return {
    backgroundImage:
      `linear-gradient(140deg, oklch(0.55 0.14 ${hue}) 0%,` +
      ` oklch(0.32 0.1 ${(hue + 40) % 360}) 60%,` +
      ` oklch(0.2 0.05 ${(hue + 70) % 360}) 100%)`,
  };
}

export function Media({
  seed,
  image = null,
  priority = false,
  scrim = 'none',
  zoomOnHover = false,
  className,
  children,
  ...props
}: MediaProps) {
  return (
    <div className={cn('relative isolate overflow-hidden', className)} {...props}>
      <div aria-hidden="true" style={washFor(seed)} className="absolute inset-0 -z-10" />

      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- provider URL, not a local asset
        <img
          src={image.url}
          alt={image.alt ?? ''}
          {...(image.width ? { width: image.width } : {})}
          {...(image.height ? { height: image.height } : {})}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          /*
           * Graded, because they cannot be art-directed.
           *
           * The photographs are whatever the imagery provider has for the
           * place. Pulling them down and desaturating them made a wall of
           * grey rectangles; this goes the other way - saturation up by a
           * third, contrast up a little, brightness left where it is - so a
           * sea is a sea and a terracotta roof is terracotta. Anything laid
           * over them carries its own darkness, so nothing depends on the
           * picture being dim.
           */
          className={cn(
            'absolute inset-0 -z-10 size-full object-cover',
            'brightness-[0.97] contrast-[1.12] saturate-[1.35]',
            zoomOnHover &&
              'ease-standard transition-transform duration-700 group-hover:scale-[1.06] motion-reduce:group-hover:scale-100',
          )}
        />
      ) : null}

      {scrim === 'none' ? null : (
        <div aria-hidden="true" className={cn('absolute inset-0 -z-10', SCRIM_CLASSES[scrim])} />
      )}

      {children}
    </div>
  );
}
