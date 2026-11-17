import { localDestinationImage } from '@/lib/destination-media';
import type { ImageCredit } from '@/providers/imagery/types';
import { placeImageUrl } from '@/providers/places/image-url';
import type { ThingToDo } from '@/providers/types';

/**
 * The frames of "30 seconds of {place}".
 *
 * Six at most, five seconds each. The first is the destination's illustration
 * when one ships (and it says so: it is an illustration, never a photograph of
 * a real place); the rest are real photographs of the places "Things to do"
 * lists, from Wikimedia Commons through our own image route, each captioned
 * with the place and credited to its author.
 *
 * **Fewer than three real photographs and there is no slideshow.** A sequence
 * of one picture and a play button is a promise the page cannot keep.
 */

export const SLIDESHOW_FRAME_COUNT = 6;
export const MIN_REAL_PHOTOGRAPHS = 3;
/** Seconds each frame stays. Thirty in all. */
export const FRAME_SECONDS = 5;

export interface SlideCredit {
  /** "Jane Doe, CC BY-SA 4.0" or "AI-generated illustration". */
  readonly text: string;
  /** The file's page on Commons, or null for the illustration. */
  readonly href: string | null;
}

interface FrameBase {
  readonly id: string;
  /** The place the frame shows, or the destination for its illustration. */
  readonly caption: string;
  readonly credit: SlideCredit;
  /** What a screen reader hears for the picture. */
  readonly alt: string;
}

export interface IllustrationFrame extends FrameBase {
  readonly kind: 'illustration';
  readonly src: string;
  readonly avif: string;
  readonly webp: string;
  readonly width: number;
  readonly height: number;
}

export interface PhotoFrame extends FrameBase {
  readonly kind: 'photo';
  readonly src: string;
  readonly srcSet: string;
  /** The ThingToDo it shows, so a caption can open that place's sheet. */
  readonly placeId: string;
}

export type SlideFrame = IllustrationFrame | PhotoFrame;

export interface SlideshowOutcome {
  readonly status: string;
  readonly things?: readonly ThingToDo[];
  readonly credits?: Readonly<Record<string, ImageCredit>>;
}

function creditText(credit: ImageCredit | undefined): string {
  return `${credit?.author ?? 'photographer not stated'}, ${credit?.licence ?? 'licence not stated'}`;
}

/**
 * The frames for a destination, or null when there is no slideshow to show.
 * Pure: the same places give the same frames in the same order.
 */
export function slideshowFrames(input: {
  readonly code: string;
  readonly name: string;
  readonly outcome: SlideshowOutcome;
}): readonly SlideFrame[] | null {
  const { outcome } = input;
  if (outcome.status !== 'ok' || !outcome.things) return null;

  const local = localDestinationImage(input.code);
  const seen = new Set<string>();
  const photos: PhotoFrame[] = [];
  const room = local ? SLIDESHOW_FRAME_COUNT - 1 : SLIDESHOW_FRAME_COUNT;

  for (const place of outcome.things) {
    if (photos.length >= room) break;
    if (!place.imageFile || seen.has(place.imageFile)) continue;
    seen.add(place.imageFile);

    const credit = outcome.credits?.[place.imageFile];
    photos.push({
      kind: 'photo',
      id: place.id,
      placeId: place.id,
      caption: place.name,
      alt: `${place.name}, ${input.name}`,
      src: placeImageUrl(place.imageFile, 1600),
      srcSet: `${placeImageUrl(place.imageFile, 640)} 640w, ${placeImageUrl(place.imageFile, 1280)} 1280w, ${placeImageUrl(place.imageFile, 1600)} 1600w`,
      credit: {
        text: creditText(credit),
        href:
          credit?.pageUrl ??
          `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(place.imageFile)}`,
      },
    });
  }

  if (photos.length < MIN_REAL_PHOTOGRAPHS) return null;

  const illustration: IllustrationFrame[] = local
    ? [
        {
          kind: 'illustration',
          id: `illustration-${input.code.toUpperCase()}`,
          caption: input.name,
          alt: `Illustration of ${input.name}`,
          credit: { text: 'AI-generated illustration', href: null },
          src: local.fallback,
          avif: local.avif,
          webp: local.webp,
          width: local.width,
          height: local.height,
        },
      ]
    : [];

  return [...illustration, ...photos];
}
