import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * A place's illustration, or a plain tile with its initials.
 *
 * The same files and the same wording as the home page's destination card:
 * `/img/destinations/{CODE}-{480,768,1024}.{avif,webp}`, described as "an
 * AI-generated illustration" because that is what they are. Fills the box it
 * is put in, so the call site owns the crop and the aspect ratio.
 *
 * With no picture it is a quiet tile in the surface colour carrying the
 * letters, not a gradient pretending to be an image that has not loaded.
 */

export interface PlacePictureProps {
  /** Null for a place with no picture: the initials tile is drawn instead. */
  picture: { readonly code: string; readonly blur: string; readonly label: string } | null;
  /** Letters for the tile; usually the country's initials. */
  initials: string;
  sizes: string;
  priority?: boolean;
  /** Alt text override; by default "{label} - AI-generated illustration". */
  alt?: string;
  className?: string;
}

const WIDTHS = [480, 768, 1024] as const;

function set(code: string, extension: 'avif' | 'webp'): string {
  return WIDTHS.map((w) => `/img/destinations/${code}-${w}.${extension} ${w}w`).join(', ');
}

export function PlacePicture({
  picture,
  initials,
  sizes,
  priority = false,
  alt,
  className,
}: PlacePictureProps) {
  if (!picture) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'bg-surface-sunken font-display text-ink-muted grid place-items-center text-[clamp(1.75rem,8cqi,3.5rem)] tracking-[0.04em]',
          className,
        )}
      >
        {initials}
      </span>
    );
  }

  return (
    <span
      className={cn('relative block overflow-hidden', className)}
      style={{ backgroundImage: `url(${picture.blur})`, backgroundSize: 'cover' }}
    >
      <picture>
        <source type="image/avif" srcSet={set(picture.code, 'avif')} sizes={sizes} />
        <img
          src={`/img/destinations/${picture.code}-768.webp`}
          srcSet={set(picture.code, 'webp')}
          sizes={sizes}
          alt={alt ?? `${picture.label} — AI-generated illustration`}
          width={1024}
          height={688}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      </picture>
    </span>
  );
}
