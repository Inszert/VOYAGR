import { buildStayLinkHandoff, OUTBOUND_LINK_REL } from '@/booking/handoff';
import { Button, Icon } from '@/components/ui';
import type { StayLinkOffer } from '@/core/stay/types';

/**
 * The link out to find a stay nobody here could price.
 *
 * One component for the trip card, the destination page and `/stays`, so the
 * wording and the link attributes cannot drift between them. It shows no price
 * and implies none: it is a way to look, and says whose search it opens.
 * Renders nothing when the link does not pass the hand-off vetting.
 */
export function FindStayLink({ offer, size = 'md' }: { offer: StayLinkOffer; size?: 'sm' | 'md' }) {
  const handoff = buildStayLinkHandoff(offer);
  if (!handoff) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button asChild variant="secondary" size={size}>
        <a href={handoff.url} rel={OUTBOUND_LINK_REL} target="_blank">
          Find a stay in {offer.destinationName}
          <span className="sr-only"> with {offer.displayName} (opens in a new tab)</span>
          <Icon name="arrow-right" size={1} aria-hidden="true" />
        </a>
      </Button>
      <span className="text-ink-muted text-sm">
        No price shown. Rates are on the vendor&rsquo;s own site.
      </span>
    </div>
  );
}
