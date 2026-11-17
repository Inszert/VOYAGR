import { z } from 'zod';
import type { Money } from '@/core/money';
import type { BoardType, StayQuery } from '@/core/stay/types';
import { createLimiterPool, type Limiter } from '@/lib/concurrency';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok, type Result } from '@/lib/result';
import type { FetchLike } from '@/providers/http/types';
import { LiteApiStayProvider, splitTaxes, toMoney } from '@/providers/stays/liteapi';

/**
 * "Check this price": a live re-quote and a prebook, for one rate, on a visitor's click.
 *
 * This and the snapshot worker are the only code allowed to reach the live LiteAPI client.
 * Nothing is paid, nothing is stored as a price, and the book endpoint is never called.
 *
 * Two live calls per check, each through the shared `liteapi` limiter, wrapping the leaf call
 * only:
 *
 * 1. `hotels/rates` for the one hotel and the same dates, to get a fresh `offerId`. A cached
 *    `offerId` is never sent to prebook (migration plan Part 10).
 * 2. `rates/prebook` with that fresh `offerId` and `usePaymentSdk: false`.
 *
 * The figures are the vendor's own, as `Money`. The answer says when it was checked; it is a
 * reading, not a promise that the price holds.
 */

const log = getLogger('booking.liteapi-prebook');

const PREBOOK_URL = 'https://api.liteapi.travel/v3.0/rates/prebook';
const TIMEOUT_MS = 20_000;

const limiterPool = createLimiterPool(1);

export interface PriceCheckInput {
  readonly hotelId: string;
  readonly query: StayQuery;
  /** Which of the hotel's fresh rates is the one the visitor was looking at. */
  readonly roomName: string | null;
  readonly board: BoardType | null;
  readonly refundable: boolean | null;
}

export interface PriceCheck {
  readonly total: Money;
  readonly taxesIncluded: Money | null;
  /** Paid at the hotel. Never part of `total`. */
  readonly payableAtHotel: Money | null;
  readonly checkedAt: string;
  /** The vendor substituted a different rate (price, cancellation or board). */
  readonly changed: boolean;
  readonly testPrices: boolean;
}

export interface PriceCheckDeps {
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => Date;
  readonly limiter?: Limiter;
}

const prebookSchema = z
  .object({
    data: z
      .object({
        price: z.number().positive(),
        currency: z.string().min(1),
        priceDifferencePercent: z.number().nullish(),
        cancellationChanged: z.boolean().nullish(),
        boardChanged: z.boolean().nullish(),
        roomTypes: z
          .array(
            z
              .object({
                rates: z.array(
                  z
                    .object({
                      retailRate: z
                        .object({
                          taxesAndFees: z
                            .array(
                              z.object({
                                included: z.boolean(),
                                amount: z.number(),
                                currency: z.string().min(1),
                              }),
                            )
                            .nullish()
                            .catch(null),
                        })
                        .passthrough(),
                    })
                    .passthrough(),
                ),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough(),
  })
  .passthrough();

function unavailable(message: string, publicMessage: string): Result<never, AppError> {
  return err(new AppError('PROVIDER_UNAVAILABLE', message, { publicMessage }));
}

export async function checkLiteApiPrice(
  input: PriceCheckInput,
  deps: PriceCheckDeps,
): Promise<Result<PriceCheck, AppError>> {
  if (!deps.apiKey) {
    return err(new AppError('CONFIGURATION_ERROR', 'LiteAPI is not configured.'));
  }
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => new Date());
  const limiter = deps.limiter ?? limiterPool.for('liteapi');

  // 1. Re-quote. A fresh offer, never one from a cache.
  const provider = new LiteApiStayProvider({ apiKey: deps.apiKey, fetchImpl, now });
  const quoted = await limiter.run(() => provider.fetchRates([input.hotelId], input.query));
  if (!quoted.ok) return quoted;

  const fresh = quoted.value.get(input.hotelId) ?? [];
  const match = fresh.find(
    (rate) =>
      rate.roomName === input.roomName &&
      rate.board === input.board &&
      rate.cancellation.refundable === input.refundable,
  );
  if (!match) {
    return unavailable(
      'No fresh rate matched the one being checked.',
      'That rate is no longer offered for these dates.',
    );
  }

  // 2. Prebook with the fresh offer id. The key goes in a header and is never logged.
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await limiter.run(() =>
      fetchImpl(PREBOOK_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': deps.apiKey,
        },
        body: JSON.stringify({ offerId: match.providerRateId, usePaymentSdk: false }),
        signal: timeout,
      }),
    );
  } catch (cause) {
    return err(
      new AppError(
        timeout.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
        'LiteAPI prebook could not be reached.',
        { cause },
      ),
    );
  }

  if (!response.ok) {
    log.warn({ status: response.status }, 'liteapi prebook error status');
    return unavailable(
      `LiteAPI prebook responded with ${response.status}.`,
      'We could not check this price just now. Try again in a moment.',
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const parsed = prebookSchema.safeParse(body);
  if (!parsed.success) {
    return err(new AppError('PROVIDER_ERROR', 'LiteAPI returned an unrecognised prebook answer.'));
  }

  const data = parsed.data.data;
  const total = toMoney(data.price, data.currency);
  if (!total) {
    return err(new AppError('PROVIDER_ERROR', 'LiteAPI prebook stated a price we cannot read.'));
  }
  const taxes = splitTaxes(data.roomTypes.flatMap((room) => room.rates));

  return ok({
    total,
    taxesIncluded: taxes.included,
    payableAtHotel: taxes.payableAtProperty,
    checkedAt: now().toISOString(),
    changed:
      (data.priceDifferencePercent ?? 0) !== 0 ||
      data.cancellationChanged === true ||
      data.boardChanged === true,
    testPrices: match.source.provenance === 'test',
  });
}
