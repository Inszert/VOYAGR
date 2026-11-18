import { nightsBetween } from '@/core/dates';
import type { IsoDate } from '@/core/trip/types';
import type { RecommendationCard } from '@/search/stays/recommendations';
import { stayHref } from '@/search/stays/load-stays';
import { StayPhoto } from './stay-photo';
import { starWords } from './stay-property';

/**
 * One recently priced hotel from the stored snapshot, as one link named by the hotel.
 * Every figure arrives formatted on the card; this component words it and computes nothing.
 */

export interface RecommendedStayCardProps {
  readonly card: RecommendationCard;
  /** City name for the line under the hotel; falls back to the city code. */
  readonly cityName?: string;
  readonly adults?: number;
  readonly rooms?: number;
  readonly currency?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  const name = MONTHS[Number(month) - 1];
  return name ? `${Number(day)} ${name}` : date;
}

export function RecommendedStayCard({
  card,
  cityName,
  adults = 2,
  rooms = 1,
  currency,
}: RecommendedStayCardProps) {
  const href = stayHref(
    {},
    {
      destinationCode: card.cityCode,
      destination: cityName,
      checkIn: card.checkIn,
      checkOut: card.checkOut,
      adults: String(adults),
      rooms: String(rooms),
      currency,
      dates: 'confirmed',
      property: card.hotelKey,
    },
  );
  const nights = nightsBetween(card.checkIn as IsoDate, card.checkOut as IsoDate);
  const stars = starWords(card.stars) ?? 'Stars not stated';
  const rating =
    card.guestRating !== null ? `${card.guestRating.toFixed(1)} out of 10` : 'No guest rating';

  return (
    <a
      href={href}
      className="border-border bg-surface flex h-full flex-col overflow-hidden rounded-lg border"
    >
      <StayPhoto
        photo={card.photoUrl ? { url: card.photoUrl, caption: null } : undefined}
        hotelName={card.name}
        seed={card.hotelKey}
        decorativePlaceholder
        className="aspect-[3/2] w-full"
      />
      <span className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-ink font-display text-lg leading-tight">{card.name}</h3>
        <span className="text-ink-muted text-sm">{cityName ?? card.cityCode}</span>
        <span className="text-ink-muted text-sm">
          {stars} · {rating}
        </span>
        {card.price ? (
          <span className="text-ink mt-2 flex flex-col text-sm">
            <span className="font-semibold">{card.price.totalLabel} total</span>
            <span className="text-ink-muted">
              {nights} {nights === 1 ? 'night' : 'nights'}, {shortDate(card.checkIn)} to{' '}
              {shortDate(card.checkOut)}, {adults} {adults === 1 ? 'guest' : 'guests'}
            </span>
          </span>
        ) : (
          <span className="text-ink-muted mt-2 text-sm">No stored price</span>
        )}
        {card.testPrices ? <span className="text-ink-muted text-xs">Test prices.</span> : null}
      </span>
    </a>
  );
}
