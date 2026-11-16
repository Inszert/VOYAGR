'use client';

import * as React from 'react';

/**
 * A photograph from our imagery proxy that becomes the deliberate tile if it
 * does not arrive.
 *
 * The proxy answers 404 whenever the source has nothing usable - no lead
 * image, a type we refuse, an upstream outage - and a bare `<img>` shows that
 * as an empty box with its alt text in the corner. This swaps it for the
 * fallback instead, which is what the card looks like for a place with no
 * picture at all.
 *
 * The error can fire before hydration, when no handler is attached yet, so the
 * image is also checked once on mount: complete with no width is a failed load.
 */
export function RemotePicture({
  src,
  alt,
  priority = false,
  className,
  fallback,
  srcSet,
  sizes,
  width,
  height,
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
  fallback: React.ReactNode;
  srcSet?: string;
  sizes?: string;
  width?: number;
  height?: number;
}) {
  const [failed, setFailed] = React.useState(false);
  const ref = React.useRef<HTMLImageElement>(null);

  React.useEffect(() => {
    const image = ref.current;
    if (image && image.complete && image.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (failed) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- our own proxy route, already sized by the provider
    <img
      ref={ref}
      src={src}
      {...(srcSet ? { srcSet } : {})}
      {...(sizes ? { sizes } : {})}
      {...(width ? { width } : {})}
      {...(height ? { height } : {})}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
