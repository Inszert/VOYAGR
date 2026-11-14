import { buildPartnerHandoff } from '@/booking/handoff';
import type { PartnerOffer } from '@/booking/partners';
import { Icon } from '@/components/ui';
import { cn } from '@/lib/cn';
import { CATEGORY_ICON } from './partner-meta';
import { PartnerLink } from './partner-link';

/**
 * The compact form of a partner offer, for inside another card.
 *
 * One line where there is room, wrapping rather than overflowing where there
 * is not. The link is a secondary button: the card around it already has its
 * own filled action, and a second one would be two answers to "what next".
 * "Partner link" is said in words so the row is disclosed on its own, wherever
 * it is dropped.
 */
export function PartnerOfferRow({ offer, className }: { offer: PartnerOffer; className?: string }) {
  const handoff = buildPartnerHandoff(offer);
  if (!handoff) return null;

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <span className="text-ink-muted flex min-w-0 items-center gap-2 text-sm">
        <Icon name={CATEGORY_ICON[offer.category]} size={1.1} />
        <span>
          <span className="text-ink font-medium">{offer.partner}</span>
          <span className="text-dim"> · partner link</span>
        </span>
      </span>
      <PartnerLink handoff={handoff} partner={offer.partner} variant="secondary" />
    </div>
  );
}
