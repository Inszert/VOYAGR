import * as React from 'react';
import { cn } from '@/lib/cn';
import { Badge, type BadgeTone } from './badge';
import {
  PROVENANCE_EMPHASIS,
  PROVENANCE_EXPLANATION,
  PROVENANCE_LABEL,
  type DataProvenance,
} from '@/core/trip/provenance';

/**
 * Says where a figure came from (1.10.1 §4).
 *
 * Always beside the number, never in a footnote. "€184 · Live price" and
 * "€184 · Demo data" are different claims, and the difference has to be
 * readable at the same glance as the price itself.
 *
 * Colour is never the only signal: every provenance ships its own words, and
 * the badge carries a screen-reader prefix so the claim is announced rather
 * than merely shown.
 */

const TONE: Record<DataProvenance, BadgeTone> = {
  live: 'positive',
  cached: 'neutral',
  estimated: 'caution',
  historical: 'neutral',
  typical: 'caution',
  // Critical, not caution: this is not a weaker price, it is not a price.
  mock: 'critical',
  'ai-generated': 'brand',
  unavailable: 'neutral',
};

export interface ProvenanceBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  provenance: DataProvenance;
  /** Show the one-line explanation as a title. Off inside dense lists. */
  explain?: boolean;
}

export function ProvenanceBadge({
  provenance,
  explain = true,
  className,
  ...props
}: ProvenanceBadgeProps) {
  return (
    <Badge
      tone={TONE[provenance]}
      srPrefix="Data source"
      title={explain ? PROVENANCE_EXPLANATION[provenance] : undefined}
      className={cn(
        PROVENANCE_EMPHASIS[provenance] === 'intrusive' && 'font-semibold tracking-wide uppercase',
        className,
      )}
      {...props}
    >
      {PROVENANCE_LABEL[provenance]}
    </Badge>
  );
}

/**
 * A standing notice that nothing on the page is real.
 *
 * Shown whenever the active providers are fixtures. Deliberately not
 * dismissible and deliberately not subtle: a demo that looks like a product is
 * how someone ends up believing a price they cannot buy.
 */
export function DemoDataNotice({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        'border-critical-500/40 bg-critical-500/10 rounded-[--radius-card] border px-4 py-3',
        className,
      )}
    >
      <p className="text-critical-ink text-sm font-semibold">
        Demo data — these trips are not real
      </p>
      <p className="text-ink mt-1 text-sm">
        No travel provider is connected yet, so every flight, hotel and price below is generated
        sample data. Nothing here can be booked.
      </p>
    </div>
  );
}
