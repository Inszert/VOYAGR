import { IMAGE_HOSTS } from '@/consent/csp';
import { Media } from '@/components/ui';
import type { StayPhoto as StayPhotoData } from '@/core/stay/types';

/**
 * Hotel photographs, shown only where the Content-Security-Policy lets them load.
 *
 * `img-src` (src/consent/csp.ts) names the LiteAPI content host and nothing else, so
 * that list is the one source of truth here: any other host is blocked by the
 * browser, and its photograph is replaced by the hotel's name set in type, so
 * nothing renders as a broken image.
 */
export const IMAGE_HOSTS_IN_CSP: readonly string[] = IMAGE_HOSTS;

/** `https` only, and only from a host the policy allows. Same-origin paths are always fine. */
export function showablePhoto(photo: StayPhotoData): boolean {
  if (photo.url.startsWith('/') && !photo.url.startsWith('//')) return true;

  try {
    const url = new URL(photo.url);
    return url.protocol === 'https:' && IMAGE_HOSTS_IN_CSP.includes(url.host);
  } catch {
    return false;
  }
}

export function showablePhotos(photos: readonly StayPhotoData[]): StayPhotoData[] {
  return photos.filter(showablePhoto);
}

export interface StayPhotoProps {
  readonly photo: StayPhotoData | undefined;
  readonly hotelName: string;
  readonly seed: string;
  readonly priority?: boolean;
  readonly zoomOnHover?: boolean;
  readonly className?: string;
  /** Hide the name placeholder from assistive technology when the name is already adjacent. */
  readonly decorativePlaceholder?: boolean;
}

export function StayPhoto({
  photo,
  hotelName,
  seed,
  priority = false,
  zoomOnHover = false,
  className,
  decorativePlaceholder = false,
}: StayPhotoProps) {
  const shown = photo && showablePhoto(photo) ? photo : null;

  return (
    <Media
      seed={seed}
      image={shown ? { url: shown.url, alt: shown.caption ?? `Photo of ${hotelName}` } : null}
      priority={priority}
      zoomOnHover={zoomOnHover}
      scrim={shown ? 'none' : 'bottom'}
      className={className}
    >
      {shown ? null : (
        <div
          {...(decorativePlaceholder ? { 'aria-hidden': true } : {})}
          className="absolute inset-x-0 bottom-0 p-3 text-white sm:p-4"
        >
          <span className="font-display text-sm leading-tight text-balance sm:text-lg">
            {hotelName}
          </span>
        </div>
      )}
    </Media>
  );
}
