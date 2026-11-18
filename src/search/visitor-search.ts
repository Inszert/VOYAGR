import { createHash } from 'node:crypto';
import type { IsoDate } from '@/core/trip/types';
import { getRepositories } from '@/db';
import type { VisitorSearchRepository } from '@/db/repository';
import { getLogger } from '@/lib/logger';

/**
 * Records what visitors search for, so the stays recommendations can follow real demand.
 *
 * No personal data is stored: the destination, the dates, the party size, the currency and the
 * time. The one-way `dedupeKey` lets the same visitor repeating a search within ten minutes count
 * once; it is a hash of the search and the user agent, never an address, name or email.
 */

const log = getLogger('search.visitor-search');

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|wget|python-requests/i;
const CODE = /^[A-Z]{3}$/;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT.test(userAgent);
}

export interface VisitorSearchEvent {
  readonly destinationCodes: readonly string[];
  readonly checkIn: IsoDate;
  readonly checkOut: IsoDate;
  readonly partySize: number;
  readonly currency: string;
  readonly userAgent: string | null;
}

/** Stores each destination of a search once. Returns how many rows were stored. */
export async function recordVisitorSearch(
  event: VisitorSearchEvent,
  repository: Pick<VisitorSearchRepository, 'record'> = getRepositories().visitorSearches,
): Promise<number> {
  if (isBotUserAgent(event.userAgent)) return 0;
  const currency = event.currency.toUpperCase();
  const partySize = Math.trunc(event.partySize);
  if (!/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(partySize) || partySize < 1) return 0;
  const codes = [...new Set(event.destinationCodes.map((code) => code.trim().toUpperCase()))]
    .filter((code) => CODE.test(code))
    .slice(0, 5);

  let stored = 0;
  for (const destinationCode of codes) {
    const dedupeKey = createHash('sha256')
      .update(
        [event.userAgent, destinationCode, event.checkIn, event.checkOut, partySize, currency].join(
          '|',
        ),
      )
      .digest('hex');
    if (
      await repository.record({
        destinationCode,
        checkIn: event.checkIn,
        checkOut: event.checkOut,
        partySize,
        currency,
        dedupeKey,
      })
    ) {
      stored += 1;
    }
  }
  return stored;
}

/**
 * Records a search from inside a request. It reads the user agent from the request headers and
 * never throws: a failed write must not fail a page. Outside a request there is no user agent, so
 * nothing is recorded.
 */
export async function recordVisitorSearchFromRequest(
  event: Omit<VisitorSearchEvent, 'userAgent'>,
): Promise<void> {
  try {
    const { headers } = await import('next/headers');
    const userAgent = (await headers()).get('user-agent');
    await recordVisitorSearch({ ...event, userAgent });
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : 'unknown' }, 'search not recorded');
  }
}
