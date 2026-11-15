import type * as React from 'react';
import { washFor } from '@/components/ui';
import { cn } from '@/lib/cn';
import { localDestinationImage } from '@/lib/destination-media';

/**
 * A destination's picture, filling whatever box the caller gives it.
 *
 * In order of preference: the illustration shipped under `/img/destinations`
 * (AVIF, then WebP, with its own blurred placeholder painted underneath), the
 * imagery provider's photograph, and last a tile in the place's own colour.
 * The picture is absolutely positioned inside a box whose size the caller
 * sets, so nothing moves when it loads.
 *
 * Decoration or content is the caller's call: pass `alt=""` beside text that
 * already names the place, a description where the picture stands alone.
 */

export interface DestinationPictureProps {
  code: string;
  /** The provider photograph, used only when no shipped illustration exists. */
  providerUrl?: string | null;
  alt: string;
  priority?: boolean;
  sizes?: string;
  /** Names the picture for the view transition into the destination page. */
  transitionName?: string;
  className?: string;
  imageClassName?: string;
  children?: React.ReactNode;
}

export function DestinationPicture({
  code,
  providerUrl = null,
  alt,
  priority = false,
  sizes = '(min-width: 1024px) 50vw, 100vw',
  transitionName,
  className,
  imageClassName,
  children,
}: DestinationPictureProps) {
  const local = localDestinationImage(code);
  const style = {
    ...(transitionName ? { viewTransitionName: transitionName } : {}),
  } as React.CSSProperties;

  const imageClasses = cn(
    'voyagr-card-image absolute inset-0 -z-10 size-full object-cover',
    imageClassName,
  );

  return (
    <div className={cn('relative isolate overflow-hidden', className)} style={style}>
      <div aria-hidden="true" style={washFor(code)} className="absolute inset-0 -z-20" />

      {local ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-20 scale-110 bg-cover bg-center blur-lg"
            style={{ backgroundImage: `url(${local.blur})` }}
          />
          <picture>
            <source type="image/avif" srcSet={local.avif} sizes={sizes} />
            <source type="image/webp" srcSet={local.webp} sizes={sizes} />
            <img
              src={local.fallback}
              alt={alt}
              width={local.width}
              height={local.height}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              {...(priority ? { fetchPriority: 'high' as const } : {})}
              className={imageClasses}
            />
          </picture>
        </>
      ) : providerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- provider URL through our own proxy
        <img
          src={providerUrl}
          alt={alt}
          width={1024}
          height={688}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className={cn(imageClasses, 'brightness-[0.97] contrast-[1.08] saturate-[1.2]')}
        />
      ) : null}

      {children}
    </div>
  );
}
