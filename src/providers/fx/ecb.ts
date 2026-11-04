import { z } from 'zod';
import type { ExchangeRate, RateSource } from '@/core/fx';
import { fixedRates } from '@/core/fx';
import type { IsoDateTime } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok, type Result } from '@/lib/result';
import type { FetchLike } from '../http/types';

/**
 * European Central Bank euro foreign exchange reference rates, behind the
 * `RateSource` interface.
 *
 * **Why this source, specifically.** Genuinely free: no key, no account, no
 * card, published once a day as a static file
 * (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`), so there
 * is nothing here that can ever bill anyone. The ECB's own reuse policy
 * (`https://www.ecb.europa.eu/home/disclaimer/html/index.en.html`), read
 * directly rather than assumed, permits commercial use and redistribution on
 * one condition: cite the ECB as the source whenever the data is shown or
 * reproduced. `displayName` below exists to make that easy to honour
 * wherever a rate reaches the UI. See `docs/provider-policy.md` for the
 * full evaluation against the project's zero-billing checklist - every
 * point passes, which is why this is `APPROVED`, not `PENDING`.
 *
 * **What the ECB itself says not to do with these rates**: "The reference
 * rates are published for information purposes only. Using the rates for
 * transaction purposes is strongly discouraged." Voyagr never transacts -
 * every use here is pricing comparison and display, exactly the purpose the
 * ECB describes the rates as being for.
 *
 * **The shape this module is deliberately not.** `RateSource.rateFor` is
 * synchronous by design - converting happens inside pure costing and
 * ranking code, and fetching is I/O that belongs above that layer. This
 * module does the I/O once (`fetchEcbRates`), parses it into the handful of
 * `ExchangeRate` facts the feed actually states, and hands back a plain
 * `fixedRates(...)` table - the same synchronous primitive the deterministic
 * mocks already use. Nothing downstream of that table can tell the
 * difference between a real feed and a fixture, which is exactly the point
 * of the seam `src/core/fx.ts` already defined.
 *
 * **Cross pairs.** The ECB publishes every rate as EUR-to-foreign. A
 * non-EUR pair (say USD to GBP) is not a fact this feed states directly -
 * wrap the result in `crossVia('EUR', source)` (`src/core/fx.ts`) to derive
 * it, rather than this module inventing one.
 *
 * **Weekends and TARGET holidays.** The ECB does not publish on days it
 * closes; the feed simply keeps serving the last business day's file with
 * that day's `time`. This adapter does not paper over that - every rate it
 * returns carries the `time` the feed actually stated, however old, and the
 * caller decides via `ConvertOptions.notBefore` whether that is fresh enough
 * to use (see `src/core/fx.ts`'s `convert`).
 */

const log = getLogger('providers.fx.ecb');

export const ECB_SOURCE_NAME = 'European Central Bank';
export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/** The currency every rate in this feed is quoted against. */
export const ECB_BASE_CURRENCY = 'EUR';

export interface EcbRatesLoaded {
  readonly source: RateSource;
  /** The reference date the ECB published these rates for, e.g. "2026-11-04". */
  readonly referenceDate: string;
  readonly currencyCount: number;
}

export interface EcbOptions {
  readonly fetch?: FetchLike;
  readonly url?: string;
  /** Rendering never waits indefinitely for a daily file nobody is blocking on. */
  readonly timeoutMs?: number;
}

const cubeSchema = z.object({
  currency: z.string().length(3),
  rate: z.string().min(1),
});

/**
 * Parsed with a regex, not a full XML parser.
 *
 * The feed's only variable structure is a flat list of
 * `<Cube currency='...' rate='.../>` elements inside one dated `<Cube
 * time='...'>` - pulling an XML dependency in for a document this
 * constrained would be more surface area than the document has fields.
 * Malformed input yields zero matches, which this module treats as "no
 * rates", never as a parse crash.
 */
function parseEcbXml(xml: string): {
  readonly referenceDate: string | null;
  readonly cubes: readonly { currency: string; rate: string }[];
} {
  const dateMatch = /<Cube\s+time=['"]([^'"]+)['"]\s*>/.exec(xml);
  const referenceDate = dateMatch?.[1] ?? null;

  const cubes: { currency: string; rate: string }[] = [];
  const cubeRegex = /<Cube\s+currency=['"]([A-Za-z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g;

  for (const match of xml.matchAll(cubeRegex)) {
    const candidate = { currency: match[1], rate: match[2] };
    const parsed = cubeSchema.safeParse(candidate);
    if (parsed.success) cubes.push(parsed.data);
  }

  return { referenceDate, cubes };
}

/**
 * Fetch and parse today's (or the last published) ECB reference rates.
 *
 * Never throws for a network or parse failure - returns `err`, the same as
 * every other provider adapter in this project, so a caller degrades rather
 * than crashes. A malformed or empty response is reported, never papered
 * over with an invented rate.
 */
export async function fetchEcbRates(
  options: EcbOptions = {},
): Promise<Result<EcbRatesLoaded, AppError>> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const url = options.url ?? ECB_DAILY_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);

  try {
    const response = await doFetch(url, { signal: controller.signal });

    if (!response.ok) {
      log.warn({ status: response.status, url }, 'ECB reference-rate fetch failed');
      return err(
        new AppError('DEPENDENCY_UNAVAILABLE', `ECB reference rates responded ${response.status}`, {
          publicMessage: 'Exchange rates are temporarily unavailable.',
          retryable: true,
        }),
      );
    }

    const xml = await response.text();
    const { referenceDate, cubes } = parseEcbXml(xml);

    if (!referenceDate || cubes.length === 0) {
      log.warn({ url }, 'ECB reference-rate response had no usable rates');
      return err(
        new AppError('DEPENDENCY_UNAVAILABLE', 'ECB reference-rate response had no usable rates', {
          publicMessage: 'Exchange rates are temporarily unavailable.',
          retryable: true,
        }),
      );
    }

    const observedAt = `${referenceDate}T00:00:00Z` as IsoDateTime;

    const rates: ExchangeRate[] = cubes.map((cube) => ({
      from: ECB_BASE_CURRENCY,
      to: cube.currency.toUpperCase(),
      rate: Number(cube.rate),
      observedAt,
    }));

    log.info({ referenceDate, currencyCount: rates.length }, 'ECB reference rates loaded');

    return ok({
      source: fixedRates(rates),
      referenceDate,
      currencyCount: rates.length,
    });
  } catch (cause) {
    log.warn({ err: cause, url }, 'ECB reference-rate fetch threw');
    return err(
      new AppError('DEPENDENCY_UNAVAILABLE', 'ECB reference-rate fetch failed', {
        cause,
        publicMessage: 'Exchange rates are temporarily unavailable.',
        retryable: true,
      }),
    );
  } finally {
    clearTimeout(timeout);
  }
}
