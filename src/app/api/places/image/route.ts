import { NextResponse } from 'next/server';
import { createLimiter, type Limiter } from '@/lib/concurrency';
import { getLogger } from '@/lib/logger';
import {
  THUMBNAIL_WIDTHS,
  MAX_COMMONS_HOPS,
  commonsThumbnailUrl,
  isAllowedUpstream,
  isCommonsRedirectHop,
  type ThumbnailWidth,
} from '@/providers/places/commons';

/**
 * A photograph of a place, from Wikimedia Commons, served from our own origin.
 *
 * Proxied for the reasons `/api/imagery/[code]` is: the reader's browser never
 * talks to a third party, `img-src` stays at `'self'`, and the service worker
 * can keep a picture it has seen.
 *
 * **This is the dangerous one, so it is narrow.** The other route's upstream
 * address comes from a catalogue we wrote; this one's comes from a query string.
 * So what a caller supplies is a Commons *file name*, never a URL, and
 *
 *  - the name must pass the same pattern the provider's output is held to (no
 *    slash, no `..`, no percent-escape, an image extension);
 *  - the width must be one of the four we offer (the largest is for the slideshow);
 *  - the address asked is built here, on `commons.wikimedia.org`, and its
 *    redirects are followed by hand: on Commons only through its own file
 *    redirects, a few hops at most, and the bytes only from its upload hosts;
 *  - what comes back must be a JPEG, PNG or WebP under a size cap. An SVG is
 *    refused because it can carry script.
 *
 * Credit for each picture is not served here: the page that shows it prints the
 * author and licence beside it, read from the Commons API.
 */

const logger = getLogger('api.places.image');

const FILE_NAME_FIELD_MAX = 200;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Commons now serves 960px for a 640 request and 1280px for the slideshow's:
 * 130-610 KB measured, so 1 MB refused some, and 2 MB leaves room.
 */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const MAX_HELD_BYTES = 32 * 1024 * 1024;

const UPSTREAM_TIMEOUT_MS = 8_000;

interface HeldImage {
  readonly bytes: Uint8Array;
  readonly type: string;
}

/**
 * Held in this process, for the reason the destination route holds its own:
 * without it every reader who has not cached a picture is a round trip to
 * Wikimedia through this server. Evicts the oldest first.
 */
const held = new Map<string, HeldImage>();
let heldBytes = 0;

declare global {
  var __voyagrPlaceImageLimiter: Limiter | undefined;
}

/** Two at a time: a page of places asks for thirty pictures at once. */
function limiter(): Limiter {
  globalThis.__voyagrPlaceImageLimiter ??= createLimiter(2);
  return globalThis.__voyagrPlaceImageLimiter;
}

function remember(key: string, image: HeldImage): void {
  held.set(key, image);
  heldBytes += image.bytes.byteLength;

  while (heldBytes > MAX_HELD_BYTES) {
    const oldest = held.keys().next();
    if (oldest.done) break;

    heldBytes -= held.get(oldest.value)?.bytes.byteLength ?? 0;
    held.delete(oldest.value);
  }
}

function serve({ bytes, type }: HeldImage): Response {
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(bytes.byteLength),
      // A file name at a fixed width is the same picture for as long as the
      // file is not replaced on Commons, which is rare; a week is cheap.
      'Cache-Control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=2592000',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function unavailable(status: 400 | 404 = 404): Response {
  return NextResponse.json({ error: 'Image unavailable' }, { status });
}

function widthFrom(value: string | null): ThumbnailWidth | null {
  if (value === null) return 640;
  const width = Number(value);

  return THUMBNAIL_WIDTHS.find((allowed) => allowed === width) ?? null;
}

async function download(file: string, width: ThumbnailWidth, signal: AbortSignal) {
  const first = commonsThumbnailUrl(file, width);
  if (!first) return null;

  const headers = { 'User-Agent': 'Voyagr/1.0 (https://www.voyagrfind.com)' };

  /*
   * Followed by hand: every redirect's target is the thing to check.
   *
   * Commons now answers `Special:FilePath` with a second redirect on itself
   * (`Special:Redirect/file/...`) before naming the thumbnail, so a hop on
   * Commons is followed - only in those two shapes, and only a few times - and
   * the bytes are fetched only from an upload host.
   */
  let current = first;
  let target: string | null = null;

  for (let hop = 0; hop < MAX_COMMONS_HOPS && target === null; hop += 1) {
    const redirect = await fetch(current, {
      signal,
      headers,
      redirect: 'manual',
      cache: 'no-store',
    });
    const location = redirect.headers.get('location');

    if (redirect.status < 300 || redirect.status >= 400 || !location) return null;

    const next = new URL(location, current).toString();

    if (isAllowedUpstream(next)) target = next;
    else if (isCommonsRedirectHop(next)) current = next;
    else {
      logger.warn({ status: redirect.status }, 'commons redirected somewhere not allowed');
      return null;
    }
  }

  if (target === null) {
    logger.warn({ hops: MAX_COMMONS_HOPS }, 'commons redirected too many times');
    return null;
  }

  const upstream = await fetch(target, { signal, headers, redirect: 'error', cache: 'no-store' });
  const type = upstream.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const declared = Number(upstream.headers.get('content-length') ?? 0);

  if (!upstream.ok || !ALLOWED_TYPES.has(type) || declared > MAX_IMAGE_BYTES) return null;

  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;

  return { bytes, type };
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get('file');
  const width = widthFrom(searchParams.get('w'));

  if (
    file === null ||
    file.length > FILE_NAME_FIELD_MAX ||
    width === null ||
    commonsThumbnailUrl(file, width) === null
  ) {
    return unavailable(400);
  }

  const key = `${width}|${file}`;
  const cached = held.get(key);
  if (cached) return serve(cached);

  try {
    const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    const signal = AbortSignal.any([request.signal, timeout]);
    // The leaf call, and only the leaf call, holds the slot.
    const image = await limiter().run(() => download(file, width, signal));

    if (!image) return unavailable();

    remember(key, image);
    return serve(image);
  } catch (cause) {
    logger.warn({ err: cause }, 'place image proxy failed');
    return unavailable();
  }
}
