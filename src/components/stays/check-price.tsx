'use client';

import { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { checkPriceAction, type CheckPriceResult } from '@/app/actions/liteapi-check-price';
import { format } from '@/core/money';
import type { StayRate } from '@/core/stay/types';
import { Button } from '@/components/ui';

/**
 * "Check this price" for one LiteAPI rate: the control in the hotel page's side card.
 *
 * The check asks the vendor for the current price and shows it with the time it was asked.
 * Nothing is paid and nothing is saved. The result lands in one polite live region that stays in
 * place; the button shows busy rather than going away.
 * The dates and party come from the page's own query string, so the button needs nothing the
 * page does not already hold; with no usable dates it renders nothing.
 */

export interface CheckPriceProps {
  readonly rate: Pick<StayRate, 'id' | 'providerRateId' | 'roomName' | 'board' | 'cancellation'> & {
    readonly source: Pick<StayRate['source'], 'providerId'>;
  };
}

/** `liteapi:<hotelId>:<offerId>` back to the hotel id. */
function hotelIdOf(rate: CheckPriceProps['rate']): string | null {
  const prefix = `${rate.source.providerId}:`;
  const suffix = `:${rate.providerRateId}`;
  if (!rate.id.startsWith(prefix) || !rate.id.endsWith(suffix)) return null;
  return rate.id.slice(prefix.length, rate.id.length - suffix.length) || null;
}

function count(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function checkedAtLabel(iso: string): string {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
  return `Checked at ${time} UTC`;
}

function Result({ result }: { result: CheckPriceResult }) {
  if (result.status === 'limited') {
    return <p className="text-caution-ink text-sm">{result.message}</p>;
  }
  if (result.status === 'failed') {
    return (
      <div className="text-caution-ink flex flex-col gap-0.5 text-sm">
        <p>{result.message}</p>
        <p>The stored price above is unchanged.</p>
      </div>
    );
  }

  const { check } = result;
  return (
    <div className="text-ink flex flex-col gap-0.5 text-sm">
      <p className="text-base font-semibold tabular-nums">Current price {format(check.total)}</p>
      {check.taxesIncluded ? (
        <p className="text-ink-muted tabular-nums">
          Includes taxes ({format(check.taxesIncluded)})
        </p>
      ) : null}
      {check.payableAtHotel ? (
        <p className="text-ink-muted tabular-nums">
          Payable at the hotel: {format(check.payableAtHotel)} (not part of the price shown)
        </p>
      ) : null}
      {!check.taxesIncluded && !check.payableAtHotel ? (
        <p className="text-ink-muted">Taxes not stated</p>
      ) : null}
      {check.changed ? (
        <p className="text-caution-ink">
          The hotel changed the price or the terms since the list was made.
        </p>
      ) : null}
      {check.testPrices ? <p className="text-ink-muted">Test prices.</p> : null}
      <p className="text-ink-muted">{checkedAtLabel(check.checkedAt)}</p>
    </div>
  );
}

export function CheckPrice({ rate }: CheckPriceProps) {
  const params = useSearchParams();
  const [result, setResult] = useState<CheckPriceResult | null>(null);
  const [pending, startTransition] = useTransition();

  const hotelId = hotelIdOf(rate);
  const checkIn = params.get('checkIn');
  const checkOut = params.get('checkOut');
  if (rate.source.providerId !== 'liteapi' || !hotelId || !checkIn || !checkOut) return null;

  const check = () =>
    startTransition(async () => {
      setResult(
        await checkPriceAction({
          hotelId,
          checkIn,
          checkOut,
          adults: count(params.get('adults'), 2),
          rooms: count(params.get('rooms'), 1),
          currency: params.get('currency') ?? 'EUR',
          roomName: rate.roomName,
          board: rate.board,
          refundable: rate.cancellation.refundable,
        }),
      );
    });

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" loading={pending} onClick={check}>
        Check this price
      </Button>
      <div role="status" aria-live="polite" className="min-h-0">
        {result ? <Result result={result} /> : null}
      </div>
    </div>
  );
}
