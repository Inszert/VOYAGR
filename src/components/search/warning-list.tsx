import { Icon } from '@/components/ui';
import type { TravelWarning, WarningSeverity } from '@/core/trip/constraints';

/**
 * No-Surprise Travel Check (specification section 31.5), as a plain checklist.
 *
 * Warnings are shown before the user acts, never behind a disclosure they have
 * to think to open. Each is one line in ink with a quiet mark; whether it is a
 * fact ("Known") or something the provider did not state ("To check") is read
 * out ahead of the sentence, so the distinction is in words rather than in a
 * coloured badge. The trip builder's "Good to know" is the same idea with
 * shorter sentences (`src/search/trip-view.ts`).
 */

/** Confirmed problems first: they are the ones that are definitely true. */
const SEVERITY_ORDER: Record<WarningSeverity, number> = {
  confirmed: 0,
  needs_verification: 1,
  estimated: 2,
  possible: 3,
};

export interface WarningListProps {
  warnings: readonly TravelWarning[];
  headingId?: string;
}

export function WarningList({ warnings, headingId }: WarningListProps) {
  if (warnings.length === 0) {
    return (
      <p className="text-ink-muted text-sm">
        Nothing flagged by the No-Surprise check on this trip.
      </p>
    );
  }

  const ordered = [...warnings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return (
    <ul aria-labelledby={headingId} className="flex flex-col gap-2">
      {ordered.map((warning) => (
        <li key={warning.code} className="text-ink flex items-start gap-2.5 text-sm">
          <Icon
            name={warning.severity === 'confirmed' ? 'shield' : 'check'}
            size={1}
            aria-hidden="true"
            className="text-ink-muted mt-0.5 shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="sr-only">
              {warning.severity === 'confirmed' ? 'Known: ' : 'To check: '}
            </span>
            {warning.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
