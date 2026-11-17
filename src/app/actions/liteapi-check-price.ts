'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getCurrentUser } from '@/auth/current-user';
import { checkLiteApiPrice, type PriceCheck } from '@/booking/liteapi-prebook';
import { isIsoDate } from '@/core/dates';
import type { StayQuery } from '@/core/stay/types';
import { getEnv } from '@/lib/env';
import { FixedWindowLimiter } from '@/lib/fixed-window';
import { getLogger } from '@/lib/logger';

/**
 * "Check this price". Rate-limited per visitor, then one re-quote and one prebook.
 * Returns plain data; an expected failure is a message, never a throw.
 */

const log = getLogger('app.liteapi-check-price');

/** The one place the limit lives: checks per visitor, per fixed window. */
export const PRICE_CHECKS_PER_WINDOW = 5;
export const PRICE_CHECK_WINDOW_MS = 60 * 60 * 1000;

const VISITOR_COOKIE = 'voyagr_visitor';

const limiter = new FixedWindowLimiter({
  max: PRICE_CHECKS_PER_WINDOW,
  windowMs: PRICE_CHECK_WINDOW_MS,
});

const inputSchema = z.object({
  hotelId: z.string().min(1).max(64),
  checkIn: z.string().refine(isIsoDate),
  checkOut: z.string().refine(isIsoDate),
  adults: z.number().int().min(1).max(16),
  rooms: z.number().int().min(1).max(8),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  roomName: z.string().max(200).nullable(),
  board: z.enum(['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive']).nullable(),
  refundable: z.boolean().nullable(),
});

export type CheckPriceInput = z.input<typeof inputSchema>;

export type CheckPriceResult =
  | { readonly status: 'ok'; readonly check: PriceCheck }
  | { readonly status: 'limited'; readonly message: string }
  | { readonly status: 'failed'; readonly message: string };

async function visitorKey(): Promise<string> {
  const user = await getCurrentUser();
  if (user) return `user:${user.id}`;

  const store = await cookies();
  let id = store.get(VISITOR_COOKIE)?.value;
  if (!id) {
    id = randomUUID();
    store.set(VISITOR_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: PRICE_CHECK_WINDOW_MS / 1000,
      ...(getEnv().NODE_ENV === 'production' ? { secure: true } : {}),
    });
  }
  return `session:${id}`;
}

export async function checkPriceAction(input: CheckPriceInput): Promise<CheckPriceResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success || parsed.data.checkOut <= parsed.data.checkIn) {
    return { status: 'failed', message: 'We could not read those dates.' };
  }

  const apiKey = getEnv().LITEAPI_API_KEY;
  if (!apiKey) return { status: 'failed', message: 'Price checks are not available.' };

  const decision = limiter.take(await visitorKey());
  if (!decision.allowed) {
    const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
    return {
      status: 'limited',
      message: `You have used your ${PRICE_CHECKS_PER_WINDOW} price checks for this hour. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    };
  }

  const value = parsed.data;
  const result = await checkLiteApiPrice(
    {
      hotelId: value.hotelId,
      roomName: value.roomName,
      board: value.board,
      refundable: value.refundable,
      query: {
        destination: { code: null, name: null, position: null, radiusKm: null },
        checkIn: value.checkIn as StayQuery['checkIn'],
        checkOut: value.checkOut as StayQuery['checkOut'],
        occupancy: { adults: value.adults, children: 0, rooms: value.rooms },
        currency: value.currency.toUpperCase(),
      },
    },
    { apiKey },
  );

  if (!result.ok) {
    log.warn({ code: result.error.code }, 'price check failed');
    return { status: 'failed', message: result.error.publicMessage };
  }
  return { status: 'ok', check: result.value };
}
