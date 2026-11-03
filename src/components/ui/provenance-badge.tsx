import * as React from 'react';
import { cn } from '@/lib/cn';
import { Badge, type BadgeTone } from './badge';
import {
  PROVENANCE_EMPHASIS,
  PROVENANCE_EXPLANATION,
  PROVENANCE_LABEL,
  type DataProvenance,
  type SourceAttribution,
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
  // Test data is as loud as demo data: neither can be bought.
  test: 'critical',
  // Caution, not critical: a real price exists, it just was not quoted for
  // this exact search and cannot be relied on to still be there.
  indicative: 'caution',
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
 * A standing notice that what is below cannot be bought.
 *
 * Deliberately not dismissible and deliberately not subtle: a demo that looks
 * like a product is how someone ends up believing a price they cannot buy.
 *
 * **It says which parts.** The combined provenance takes the weakest claim,
 * so one fixture hotel makes a whole trip "demo data" - which is the right
 * verdict for the total and the wrong sentence to print underneath it once a
 * real flight provider is connected. "No travel provider is connected yet"
 * was true when it was written and became false the day Duffel was wired in,
 * while the flights on the page were coming back from an actual API.
 *
 * So the wording is derived from the sources rather than fixed. Nothing here
 * is a claim this component made up: every part it names came from an adapter
 * that reported how it ran.
 */
export function DemoDataNotice({
  sources = [],
  className,
}: {
  /** Who supplied each part. Empty means nothing is known, so say the most. */
  sources?: readonly SourceAttribution[];
  className?: string;
}) {
  const demo = [...new Set(sources.filter((s) => s.provenance === 'mock').map((s) => s.part))];
  const real = [...new Set(sources.filter((s) => s.provenance !== 'mock').map((s) => s.part))];
  const everything = sources.length === 0 || real.length === 0;

  return (
    <div
      role="note"
      className={cn(
        'border-critical-500/40 bg-critical-500/10 rounded-(--radius-card) border px-4 py-3',
        className,
      )}
    >
      <p className="text-critical-ink text-sm font-semibold">
        {everything ? 'Demo data — these trips are not real' : 'Part of this is demo data'}
      </p>
      <p className="text-ink mt-1 text-sm">
        {everything ? (
          <>
            No travel provider is connected yet, so every flight, hotel and price below is generated
            sample data. Nothing here can be booked.
          </>
        ) : (
          <>
            The {list(demo)} {demo.length === 1 ? 'is' : 'are'} generated sample data, so no total
            on this page can be booked. The {list(real)} came from a provider — each price says
            which one.
          </>
        )}
      </p>
    </div>
  );
}

/** `flights, hotels and transfers`. Oxford-free, because the rest of the copy is. */
function list(parts: readonly SourceAttribution['part'][]): string {
  const words = parts.map((part) => PART_NOUN[part]);

  if (words.length <= 1) return words[0] ?? 'data';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

const PART_NOUN: Record<SourceAttribution['part'], string> = {
  flights: 'flights',
  hotels: 'hotels',
  stays: 'stays',
  transfers: 'transfers',
};
