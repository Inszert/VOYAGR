import { format } from '@/core/money';
import { bestRateFor, ratesOf } from '@/core/stay/comparison';
import type { CanonicalStay } from '@/core/stay/identity';
import type { BoardType, StayRate } from '@/core/stay/types';
import { Icon, Media, Price, SourceTag } from '@/components/ui';

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
 *
 * Built like a destination card rather than like a table row: a photograph
 * with its own band, the name under it, the price anchoring the bottom. A
 * hotel is a place, and a list of places with a thumbnail beside each one is
 * a spreadsheet with pictures in it. The whole card is the link - one target,
 * through the heading's anchor stretched over it, so there is still exactly
 * one thing in the tab order per card.
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
  /** Load the photograph immediately. For the first row only. */
  readonly priority?: boolean;
}

export function StayCard({ stay, nights, href, priority = false }: StayCardProps) {
  const best = bestRateFor(stay);
  const rates = ratesOf(stay);
  const providers = new Set(rates.map((rate) => rate.source.providerId));
  const photo = stay.property.photos[0];

  const place = [stay.property.address.city, stay.property.address.countryCode]
    .filter(Boolean)
    .join(', ');

  return (
    <article className="border-border bg-panel ease-standard duration-settled group relative flex h-full w-full flex-col overflow-hidden rounded-[--radius-card] border transition-[border-color,transform] hover:-translate-y-1 hover:border-[--color-accent-ink] motion-reduce:hover:translate-y-0">
      <Media
        // Keyed to the property rather than to its name, so the same hotel
        // keeps its colour when a provider spells it differently.
        seed={stay.key}
        image={photo ? { url: photo.url, alt: photo.caption ?? '' } : null}
        priority={priority}
        zoomOnHover
        className="h-[180px] w-full shrink-0"
      >
        {stay.property.starRating ? (
          <span className="border-hairline bg-field/85 text-text absolute top-3 left-3 rounded-[--radius-pill] border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md">
            {stay.property.starRating}-star {stay.property.propertyType ?? 'property'}
          </span>
        ) : null}

        {providers.size > 1 ? (
          <span className="border-hairline bg-field/85 text-text absolute top-3 right-3 rounded-[--radius-pill] border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md">
            {providers.size} providers
          </span>
        ) : null}
      </Media>

      <div className="flex flex-1 flex-col px-4 pt-3.5 pb-4">
        <h3 className="text-text text-[19px] leading-tight">
          <a
            href={href}
            // Stretched over the card: the picture, the name and the price
            // are one target, and there is still one stop in the tab order.
            className="focus-visible:outline-accent-ink after:absolute after:inset-0 after:content-['']"
          >
            {stay.property.name}
          </a>
        </h3>

        <p className="text-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          {place ? (
            <span className="flex items-center gap-1">
              <Icon name="pin" size={0.9} />
              {place}
            </span>
          ) : null}

          {stay.property.guestRating ? (
            <span className="tabular-nums">
              {stay.property.guestRating.outOfTen.toFixed(1)}/10
              {stay.property.guestRating.reviewCount
                ? ` · ${stay.property.guestRating.reviewCount} reviews`
                : ''}
            </span>
          ) : (
            // Not a zero and not four blank stars: a rating nobody supplied.
            <span>No guest rating</span>
          )}
        </p>

        {best ? (
          <>
            <p className="text-muted mt-3 text-[13px]">
              {best.roomName ?? 'Room'} ·{' '}
              {best.board ? BOARD_LABEL[best.board] : 'Board not stated'}
            </p>
            <p className="text-muted text-[13px]">{cancellationLabel(best)}</p>

            {/*
              The price anchors the bottom of every card in the row, whatever
              length the name above it ran to. A column of prices that does
              not line up is a column nobody can compare.
            */}
            {/*
              The source above, the price below, each across the full width.

              Side by side they shared about 250px, which wrapped the
              caption and left the figure two lines from what it meant. This
              also lines every price in the row hard against the same right
              edge, which is what makes a row of them comparable.
            */}
            <div className="border-hairline mt-auto flex flex-col gap-2 border-t pt-3.5">
              <SourceTag source={best.source} className="w-fit" />
              <Price
                amount={format(best.total)}
                caption={`total · ${nights} nights · ${format(best.perNight)} a night`}
                size="md"
                align="end"
              />
            </div>
          </>
        ) : (
          <p className="text-caution-ink mt-3 text-sm">No rates were returned for these dates.</p>
        )}
      </div>
    </article>
  );
}
