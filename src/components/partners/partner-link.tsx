import { OUTBOUND_LINK_REL, type BookingHandoff } from '@/booking/handoff';
import { Button, Icon } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * The one way a partner link is drawn.
 *
 * The card and the row share it so the attributes and the accessible name
 * cannot drift apart. It takes a vetted `BookingHandoff`, never a raw URL: an
 * `href` here has already been through `buildPartnerHandoff`.
 *
 * Press is a small scale-down over the primitive's own transition, and
 * `hover:` in Tailwind v4 is already inside `@media (hover: hover)`, so a
 * touch screen never sticks in a hover state after a tap. `duration-(...)`
 * rather than the `duration-quick` name, so it replaces the primitive's
 * `duration-150` instead of sitting beside it.
 */
const PRESS =
  'ease-standard transition-[transform,filter,background-color,color] duration-(--duration-quick) active:scale-[0.97] motion-reduce:active:scale-100';

export function PartnerLink({
  handoff,
  partner,
  variant,
  className,
}: {
  handoff: BookingHandoff;
  partner: string;
  variant: 'primary' | 'secondary';
  className?: string;
}) {
  return (
    // `md` is 44px tall, the minimum target; `sm` is not, so there is no size prop.
    <Button asChild variant={variant} size="md" className={cn(PRESS, className)}>
      <a href={handoff.url} rel={OUTBOUND_LINK_REL} target="_blank">
        Continue to {partner}{' '}
        {/* The space is outside the span: inside, some name computations drop it ("Intui(opens"). */}
        <span className="sr-only">(opens in a new tab)</span>
        <Icon name="arrow-right" size={1} />
      </a>
    </Button>
  );
}
