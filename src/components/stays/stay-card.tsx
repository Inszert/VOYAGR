import { format } from '@/core/money';
import { bestRateFor, ratesOf } from '@/core/stay/comparison';
import type { CanonicalStay } from '@/core/stay/identity';
import type { BoardType, StayRate } from '@/core/stay/types';
import { Icon, Media, Price, SourceTag } from '@/components/ui';
import { amenityIcon } from './stay-property';

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

/** "air conditioning" alone on a line reads as a typo; "Air conditioning" does not. */
function sentenceCase(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

/** How many amenities fit on a card before it becomes a list nobody reads. */
const AMENITIES_ON_CARD = 3;

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
  const { amenities } = stay.property;

  const place = [stay.property.address.city, stay.property.address.countryCode]
    .filter(Boolean)
    .join(', ');

  const kind =
    stay.property.starRating !== null && stay.property.starRating !== undefined
      ? `${stay.property.starRating}-star ${stay.property.propertyType ?? 'property'}`
      : stay.property.propertyType;

  return (
    /*
      Across on a phone, down on anything wider.

      A photograph above the name made each hotel most of a phone screen
      tall, so a list of three was three screens to scroll. Side by side the
      picture is a thumbnail and the facts start at the top of the card. From
      `sm` up there is room for the picture to lead, which is what a place
      deserves once it can have it.

      No lift on hover. The card is a link and says so with its border, its
      surface and its call to action; a card that jumps under the pointer
      moves the thing being read.
    */
    <article className="border-border bg-panel ease-standard duration-settled hover:bg-panel-2 group relative flex h-full w-full overflow-hidden rounded-(--radius-card) border transition-[border-color,background-color] hover:border-(--color-accent-ink) sm:flex-col">
      <Media
        // Keyed to the property rather than to its name, so the same hotel
        // keeps its colour when a provider spells it differently.
        seed={stay.key}
        image={photo ? { url: photo.url, alt: photo.caption ?? '' } : null}
        priority={priority}
        zoomOnHover
        scrim={photo ? 'none' : 'bottom'}
        className="w-28 shrink-0 sm:h-[180px] sm:w-full"
      >
        {photo ? null : (
          /*
            No photograph: the place, set in type, over its wash.

            The provider sent no picture of this property, and a picture of
            something else would be a claim about it that nobody made. What
            is true is where it is, so that is what the space says. Hidden
            from assistive technology: the same place is in the text below.
          */
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3 text-white sm:p-4"
          >
            <Icon name="pin" size={0.95} className="opacity-80" />
            <span className="font-display text-sm leading-tight sm:text-xl">
              {stay.property.address.city ?? stay.property.name}
            </span>
          </div>
        )}

        {providers.size > 1 ? (
          <span className="border-hairline bg-field/85 text-text absolute top-3 right-3 hidden rounded-(--radius-pill) border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md sm:inline">
            {providers.size} providers
          </span>
        ) : null}
      </Media>

      <div className="flex min-w-0 flex-1 flex-col px-4 pt-3.5 pb-4">
        {kind ? <p className="text-muted text-xs">{kind}</p> : null}

        <h3 className="text-text font-display mt-0.5 text-[19px] leading-tight">
          <a
            href={href}
            // Stretched over the card: the picture, the name and the price
            // are one target, and there is still one stop in the tab order.
            className="focus-visible:outline-accent-ink after:absolute after:inset-0 after:content-['']"
          >
            {stay.property.name}
          </a>
        </h3>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          {stay.property.guestRating ? (
            <span className="text-muted flex items-center gap-1.5">
              <span className="border-positive-500/40 bg-positive-500/10 text-positive-ink rounded-(--radius-control) border px-1.5 py-0.5 text-xs font-semibold tabular-nums">
                {stay.property.guestRating.outOfTen.toFixed(1)}
                <span className="sr-only"> out of 10</span>
              </span>
              <span className="tabular-nums">
                {stay.property.guestRating.reviewCount
                  ? `${stay.property.guestRating.reviewCount} reviews`
                  : 'Guest rating'}
              </span>
            </span>
          ) : (
            // Not a zero and not four blank stars: a rating nobody supplied.
            <span className="text-muted">No guest rating</span>
          )}

          {place ? (
            <span className="text-muted flex items-center gap-1">
              <Icon name="pin" size={0.9} />
              {place}
            </span>
          ) : null}
        </div>

        {amenities.length > 0 ? (
          /*
            A mark and a word each, not a row of grey lozenges: the pills made
            every amenity the same small box, and a card of boxes inside a
            card is the clutter this list is meant to cut through.
          */
          <ul className="text-muted mt-2.5 hidden flex-wrap gap-x-3.5 gap-y-1 text-xs sm:flex">
            {amenities.slice(0, AMENITIES_ON_CARD).map((amenity) => {
              const icon = amenityIcon(amenity);
              return (
                <li key={amenity} className="flex items-center gap-1.5">
                  {icon ? <Icon name={icon} size={1} className="text-tint-ink" /> : null}
                  {sentenceCase(amenity)}
                </li>
              );
            })}
            {amenities.length > AMENITIES_ON_CARD ? (
              <li>+{amenities.length - AMENITIES_ON_CARD} more</li>
            ) : null}
          </ul>
        ) : null}

        {best ? (
          <>
            <p className="text-muted mt-2.5 text-[13px]">
              {best.roomName ?? 'Room'} ·{' '}
              {best.board ? BOARD_LABEL[best.board] : 'Board not stated'}
            </p>
            <p
              className={
                best.cancellation.refundable === true
                  ? 'text-positive-ink text-[13px]'
                  : 'text-muted text-[13px]'
              }
            >
              {cancellationLabel(best)}
            </p>

            {/*
              The price anchors the bottom of every card in the row, whatever
              length the name above it ran to. A column of prices that does
              not line up is a column nobody can compare. The source sits on
              the same rule, named beside the figure it is about.
            */}
            <div className="border-hairline mt-auto flex flex-col gap-2 border-t pt-3.5">
              <SourceTag source={best.source} className="w-fit" />
              <Price
                amount={format(best.total)}
                caption={`total · ${nights} nights · ${format(best.perNight)} a night`}
                size="md"
                align="end"
              />
              <p
                aria-hidden="true"
                className="text-accent-ink ease-standard duration-quick flex items-center justify-end gap-1 text-[13px] font-medium opacity-80 transition-opacity group-hover:opacity-100"
              >
                View stay
                <Icon
                  name="arrow-right"
                  size={0.9}
                  className="ease-standard duration-quick transition-transform group-hover:translate-x-0.5"
                />
              </p>
            </div>
          </>
        ) : (
          <p className="text-caution-ink mt-3 text-sm">No rates were returned for these dates.</p>
        )}
      </div>
    </article>
  );
}
