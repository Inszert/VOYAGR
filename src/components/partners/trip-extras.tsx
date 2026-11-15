import { buildPartnerHandoff } from '@/booking/handoff';
import type { PartnerOffer } from '@/booking/partners';
import type { IsoDate } from '@/core/trip/types';
import { cn } from '@/lib/cn';
import { AffiliateDisclosure } from './affiliate-disclosure';
import { CATEGORY_ORDER } from './partner-meta';
import { PartnerOfferCard } from './partner-offer-card';

/**
 * "Sort the rest of the trip": the partner offers for what a search does not
 * price, grouped by what the traveller is trying to do.
 *
 * Renders nothing at all when there is nothing to show - never a heading over
 * an empty list, and never a placeholder for a partner we do not have. The
 * disclosure is part of the section rather than left to each page, so a page
 * cannot show the links and forget to say what they are.
 */
export function TripExtras({
  offers,
  today,
  className,
}: {
  offers: readonly PartnerOffer[];
  /** For promo expiry. Passed in: this component has no clock. */
  today: IsoDate;
  className?: string;
}) {
  // A card with no vetted link renders nothing, so it must not take a slot.
  const shown = CATEGORY_ORDER.flatMap((category) =>
    offers.filter((offer) => offer.category === category && buildPartnerHandoff(offer)),
  );

  if (shown.length === 0) return null;

  return (
    <section aria-labelledby="trip-extras-heading" className={cn('flex flex-col gap-6', className)}>
      <h2 id="trip-extras-heading" className="font-display text-display-sm text-ink">
        Sort the rest of the trip
      </h2>

      {/* One grid across the whole band; each card names its own category. */}
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4">
        {shown.map((offer) => (
          <li key={offer.id} className="min-w-0">
            <PartnerOfferCard offer={offer} today={today} />
          </li>
        ))}
      </ul>

      <AffiliateDisclosure />
    </section>
  );
}
