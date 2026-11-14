import { buildPartnerHandoff } from '@/booking/handoff';
import type { PartnerOffer } from '@/booking/partners';
import type { IsoDate } from '@/core/trip/types';
import { cn } from '@/lib/cn';
import { AffiliateDisclosure } from './affiliate-disclosure';
import { CATEGORY_HEADING, CATEGORY_ORDER } from './partner-meta';
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
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    // A card with no vetted link renders nothing, so it must not take a slot.
    offers: offers.filter((offer) => offer.category === category && buildPartnerHandoff(offer)),
  })).filter((group) => group.offers.length > 0);

  if (groups.length === 0) return null;

  return (
    <section aria-labelledby="trip-extras-heading" className={cn('flex flex-col gap-6', className)}>
      <div className="flex flex-col gap-2">
        <h2 id="trip-extras-heading" className="font-display text-display-sm text-ink">
          Sort the rest of the trip
        </h2>
        <AffiliateDisclosure />
      </div>

      {groups.map((group) => (
        <div key={group.category} className="flex flex-col gap-3">
          <h3 className="text-ink text-base font-semibold">{CATEGORY_HEADING[group.category]}</h3>
          {/* One column on a phone, two from 640px, three from 1024px. */}
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.offers.map((offer) => (
              <li key={offer.id} className="min-w-0">
                <PartnerOfferCard offer={offer} today={today} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
