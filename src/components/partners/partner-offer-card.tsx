import { buildPartnerHandoff } from '@/booking/handoff';
import { activePromo, type PartnerOffer } from '@/booking/partners';
import { Card, CardTitle, Icon } from '@/components/ui';
import type { IsoDate } from '@/core/trip/types';
import { CATEGORY_ICON, CATEGORY_LABEL } from './partner-meta';
import { PartnerLink } from './partner-link';
import { PromoCode } from './promo-code';

/**
 * A partner's offer, drawn as one of ours.
 *
 * Name, one line on what you get, a promo code when there is a live one, and a
 * single filled button. There is no price: a partner quotes its own on its own
 * site, and this card does not guess at it. Renders nothing when the link does
 * not pass the hand-off vetting, since a card with no way through is noise.
 */
export function PartnerOfferCard({ offer, today }: { offer: PartnerOffer; today: IsoDate }) {
  const handoff = buildPartnerHandoff(offer);
  if (!handoff) return null;

  const promo = activePromo(offer, today);
  const headingId = `partner-${offer.id}-heading`;

  return (
    <Card
      as="article"
      aria-labelledby={headingId}
      elevation="raised"
      className="flex h-full min-w-0 flex-col gap-4"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="bg-surface-sunken text-brand-ink grid size-10 shrink-0 place-items-center rounded-(--radius-control)"
        >
          <Icon name={CATEGORY_ICON[offer.category]} size={1.25} />
        </span>
        <div className="min-w-0">
          <p className="text-ink-muted text-[11px] font-medium tracking-[0.1em] uppercase">
            {CATEGORY_LABEL[offer.category]}
          </p>
          <CardTitle level={3} id={headingId} className="break-words">
            {offer.partner}
          </CardTitle>
        </div>
      </div>

      <p className="text-ink-muted text-sm">{offer.description}</p>

      {promo ? <PromoCode code={promo.code} /> : null}

      <div className="mt-auto">
        <PartnerLink handoff={handoff} partner={offer.partner} variant="primary" />
      </div>
    </Card>
  );
}
