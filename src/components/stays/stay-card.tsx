import { format } from '@/core/money';
import { bestRateFor, ratesOf } from '@/core/stay/comparison';
import type { CanonicalStay } from '@/core/stay/identity';
import type { BoardType, StayRate } from '@/core/stay/types';
import { Icon, SourceTag } from '@/components/ui';

/**
 * One property, however many providers are offering it.
 *
 * The card leads with the best price across every provider and says how many
 * found it, because "three ways to book this" is information and "the same
 * hotel three times" is noise. Which provider produced the headline is named
 * rather than implied.
 *
 * **Everything a provider did not say is said as unavailable.** A missing
 * cancellation policy is the single most expensive thing to guess at, so it
 * reads "not stated" rather than defaulting either way.
 */

export const BOARD_LABEL: Record<BoardType, string> = {
  room_only: 'Room only',
  breakfast: 'Breakfast included',
  half_board: 'Half board',
  full_board: 'Full board',
  all_inclusive: 'All inclusive',
};

/** Cancellation in one phrase, including the phrase for "we do not know". */
export function cancellationLabel(rate: StayRate): string {
  if (rate.cancellation.refundable === null) return 'Cancellation terms not stated';

  return rate.cancellation.refundable ? 'Free cancellation' : 'Non-refundable';
}

export interface StayCardProps {
  readonly stay: CanonicalStay;
  readonly nights: number;
  /** Link to this property's detail and comparison view. */
  readonly href: string;
}

export function StayCard({ stay, nights, href }: StayCardProps) {
  const best = bestRateFor(stay);
  const rates = ratesOf(stay);
  const providers = new Set(rates.map((rate) => rate.source.providerId));
  const photo = stay.property.photos[0];

  return (
    <article className="border-border bg-surface-raised flex flex-col gap-3 rounded-[--radius-surface] border p-4 sm:flex-row">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- provider URL, not a local asset
        <img
          src={photo.url}
          alt={photo.caption ?? ''}
          className="h-32 w-full rounded-[--radius-control] object-cover sm:w-44"
        />
      ) : (
        <div
          aria-hidden="true"
          className="bg-surface-sunken h-32 w-full rounded-[--radius-control] sm:w-44"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-ink text-base font-medium">
            <a
              href={href}
              className="focus-visible:outline-accent-to rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {stay.property.name}
            </a>
          </h3>

          {stay.property.starRating ? (
            <p className="text-ink-muted text-sm">
              {stay.property.starRating}-star {stay.property.propertyType ?? 'property'}
            </p>
          ) : null}
        </div>

        <p className="text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {stay.property.address.city ? (
            <span className="flex items-center gap-1">
              <Icon name="pin" size={0.9} />
              {stay.property.address.city}
            </span>
          ) : null}

          {stay.property.guestRating ? (
            <span>
              {stay.property.guestRating.outOfTen.toFixed(1)}/10
              {stay.property.guestRating.reviewCount
                ? ` · ${stay.property.guestRating.reviewCount} reviews`
                : ''}
            </span>
          ) : (
            <span>No guest rating</span>
          )}
        </p>

        {best ? (
          <div className="mt-auto flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-col gap-1">
              <p className="text-ink-muted text-sm">
                {best.roomName ?? 'Room'} ·{' '}
                {best.board ? BOARD_LABEL[best.board] : 'Board not stated'}
              </p>
              <p className="text-ink-muted text-sm">{cancellationLabel(best)}</p>
              <SourceTag source={best.source} className="w-fit" />
            </div>

            <div className="text-right">
              <p className="text-ink text-xl font-semibold tabular-nums">{format(best.total)}</p>
              <p className="text-ink-muted text-sm tabular-nums">
                {format(best.perNight)} a night · {nights} nights
              </p>
              {providers.size > 1 ? (
                <a
                  href={href}
                  className="text-accent-ink focus-visible:outline-accent-to mt-1 inline-block rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Compare {providers.size} providers
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-caution-ink text-sm">No rates were returned for these dates.</p>
        )}
      </div>
    </article>
  );
}
