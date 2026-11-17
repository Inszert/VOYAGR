import { Button } from '@/components/ui';

/**
 * A visible, switched-off place for reserving and paying.
 *
 * Booking and payment do not exist yet. Both buttons use the native `disabled`
 * attribute so they cannot be clicked, focused into action or submitted, and
 * nothing here calls any booking or payment code.
 */
export function ReservePlaceholder({ className }: { className?: string }) {
  return (
    <div className={['flex flex-col gap-2', className].filter(Boolean).join(' ')}>
      <Button variant="cta" size="lg" className="w-full" disabled>
        Reserve this trip
      </Button>
      <p className="text-ink-muted text-sm">
        Booking and payment are not switched on yet. You can see the price and check it with the
        hotel.
      </p>
      <Button variant="secondary" size="md" className="w-full" disabled>
        Payments are not switched on yet
      </Button>
    </div>
  );
}
