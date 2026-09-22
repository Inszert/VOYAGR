import { NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { resolveOneImage } from '@/providers/imagery';

/**
 * A destination photograph, served from our own origin.
 *
 * The obvious implementation points an `<img>` straight at the source's CDN.
 * This one does not, and the reasons are the same ones that made the
 * content security policy worth writing:
 *
 *  - **Privacy.** A hotlinked image is a request from the reader's browser to
 *    a third party, carrying their address and the page they are on, for every
 *    destination they scroll past. Proxying means Wikimedia sees this server
 *    and nobody else.
 *  - **One origin.** `img-src` stays at `'self'`, and a policy that never had
 *    to be widened cannot later be leaned on for something else.
 *  - **Offline.** The service worker can cache same-origin responses, so a
 *    destination already seen still looks like itself on a train.
 *
 * The upstream URL is never taken from the request. It comes from the curated
 * catalogue via the code in the path, so this route cannot be pointed at an
 * arbitrary host - which is what turns an image proxy into an open one.
 */

const logger = getLogger('api.imagery');

/** Codes are three letters. Anything else is not a destination we know. */
const CODE = /^[A-Za-z]{3}$/;

/** What we are willing to hand back as a picture. */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/** A lead photograph that will not fit in this is not a lead photograph. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Roughly a full catalogue of destination photographs, and no more. */
const MAX_HELD_BYTES = 24 * 1024 * 1024;

interface HeldImage {
  readonly bytes: Uint8Array;
  readonly type: string;
}

/**
 * The bytes, held in this process.
 *
 * Without it every reader who has not cached the image costs a round trip to
 * Wikimedia *through this server*, which is both slower than hotlinking - the
 * thing proxying was supposed to be worth paying for - and rude to a service
 * that asks to be cached. A `Map` preserves insertion order, so evicting its
 * first key is a least-recently-added policy, which for a catalogue this size
 * is indistinguishable from a cleverer one.
 */
const held = new Map<string, HeldImage>();
let heldBytes = 0;

function remember(code: string, image: HeldImage): void {
  held.set(code, image);
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
      // A day in the browser, a week on any shared cache, and a stale image
      // is always better than a blocked render.
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;

  if (!CODE.test(code)) {
    return NextResponse.json({ error: 'Unknown destination' }, { status: 404 });
  }

  const image = await resolveOneImage(code);
  if (!image) {
    // A destination with no photograph is a normal state, and the card behind
    // this request already looks right without one.
    return NextResponse.json({ error: 'No image for this destination' }, { status: 404 });
  }

  const cached = held.get(code.toUpperCase());
  if (cached) return serve(cached);

  try {
    const upstream = await fetch(image.url, {
      signal: request.signal,
      headers: { 'User-Agent': 'Voyagr/0.1 (https://voyagr.example; travel search)' },
      // Next's fetch cache is keyed and persisted per deployment and would
      // hold these alongside data responses; this route keeps its own, which
      // is bounded in bytes and can be reasoned about.
      cache: 'no-store',
    });

    const type = upstream.headers.get('content-type')?.split(';')[0]?.trim() ?? '';

    if (!upstream.ok || !ALLOWED_TYPES.has(type)) {
      logger.warn({ code, status: upstream.status, type }, 'upstream image rejected');
      return NextResponse.json({ error: 'Image unavailable' }, { status: 404 });
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());

    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      logger.warn({ code, bytes: bytes.byteLength }, 'upstream image too large');
      return NextResponse.json({ error: 'Image unavailable' }, { status: 404 });
    }

    remember(code.toUpperCase(), { bytes, type });

    return serve({ bytes, type });
  } catch (cause) {
    logger.warn({ err: cause, code }, 'image proxy failed');
    return NextResponse.json({ error: 'Image unavailable' }, { status: 404 });
  }
}
