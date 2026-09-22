import { createLimiter, type Limiter } from '@/lib/concurrency';
import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { imageryRefFor } from './catalogue';
import { createWikimediaImagery } from './wikimedia';
import type { DestinationImage, ImageryProvider, ImageryRef } from './types';

export type { DestinationImage, ImageCredit, ImageryProvider, ImageryRef } from './types';
export { imageryRefFor, illustratedDestinations } from './catalogue';
export { createWikimediaImagery } from './wikimedia';
export { imageryUrlFor } from './url';

/**
 * Imagery, resolved once and remembered.
 *
 * Three rules hold this together, and all three exist because a photograph is
 * decoration and a page must never wait on decoration:
 *
 *  - **A miss is cached too.** A destination the source has no picture for
 *    would otherwise be looked up on every render, forever.
 *  - **The lookup is bounded by a clock.** Rendering waits at most
 *    `LOOKUP_TIMEOUT_MS`; past that the page renders with gradients and the
 *    answer lands in the cache for the next reader.
 *  - **One limiter, shared.** Every call goes through it, so a burst of
 *    traffic is still one request at a time to a service that asks politely
 *    for exactly that.
 */

const logger = getLogger('providers.imagery');

/** A found image is stable for half a day; an article's lead image rarely moves. */
const HIT_TTL_MS = 12 * 60 * 60 * 1000;

/** A miss is retried sooner, in case the article gained a picture. */
const MISS_TTL_MS = 60 * 60 * 1000;

/** Rendering never waits longer than this for decoration. */
const LOOKUP_TIMEOUT_MS = 2_500;

interface CacheEntry {
  readonly image: DestinationImage | null;
  readonly expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

let provider: ImageryProvider | null | undefined;
let limiter: Limiter | undefined;

/**
 * The configured provider, or null when imagery is switched off.
 *
 * Off is a supported state, not a broken one: the cards are designed to work
 * without photographs, which is what `docs/imagery-options.md` argued for in
 * the first place.
 */
export function getImageryProvider(): ImageryProvider | null {
  if (provider === undefined) {
    const env = getEnv();
    provider = env.IMAGERY_PROVIDER === 'wikimedia' ? createWikimediaImagery() : null;
  }

  return provider;
}

function getLimiter(): Limiter {
  limiter ??= createLimiter(1);
  return limiter;
}

/** Test helper - drops the memoised provider, limiter and cached images. */
export function resetImageryCache(): void {
  provider = undefined;
  limiter = undefined;
  cache.clear();
}

/**
 * The photograph for each destination, as far as it is known right now.
 *
 * Never throws and never rejects: every failure path ends in an entry being
 * absent from the returned map, which the card renders as no photograph.
 */
export async function resolveImagery(
  codes: readonly string[],
  options: { readonly timeoutMs?: number } = {},
): Promise<ReadonlyMap<string, DestinationImage>> {
  const found = new Map<string, DestinationImage>();
  const active = getImageryProvider();
  if (!active) return found;

  const now = Date.now();
  const wanted: ImageryRef[] = [];

  for (const code of new Set(codes.map((value) => value.toUpperCase()))) {
    const cached = cache.get(code);

    if (cached && cached.expiresAt > now) {
      if (cached.image) found.set(code, cached.image);
      continue;
    }

    const ref = imageryRefFor(code);
    if (ref) wanted.push(ref);
  }

  if (wanted.length === 0) return found;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? LOOKUP_TIMEOUT_MS);

  try {
    // The leaf call, and only the leaf call, holds the slot.
    const result = await getLimiter().run(() => active.lookup(wanted, controller.signal));

    if (!result.ok) return found;

    for (const [code, image] of result.value) {
      cache.set(code, {
        image,
        expiresAt: Date.now() + (image ? HIT_TTL_MS : MISS_TTL_MS),
      });
      if (image) found.set(code, image);
    }
  } catch (cause) {
    logger.warn({ err: cause }, 'imagery lookup aborted');
  } finally {
    clearTimeout(timeout);
  }

  return found;
}

/** One destination's photograph, for the proxy route. */
export async function resolveOneImage(code: string): Promise<DestinationImage | null> {
  const found = await resolveImagery([code], { timeoutMs: 6_000 });
  return found.get(code.toUpperCase()) ?? null;
}
