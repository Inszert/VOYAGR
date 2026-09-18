import { Badge, type BadgeTone } from '@/components/ui';
import type { TravelWarning, WarningSeverity } from '@/core/trip/constraints';

/**
 * No-Surprise Travel Check (specification section 31.5).
 *
 * Warnings are shown before the user acts, never behind a disclosure they have
 * to think to open. A self-transfer connection or a non-refundable rate is
 * exactly what someone discovers too late, so the list sits in the card itself.
 *
 * Severity is a word as well as a tone, because colour is never the only signal.
 */

const SEVERITY_LABEL: Record<WarningSeverity, string> = {
  confirmed: 'Confirmed',
  estimated: 'Estimated',
  possible: 'Possible',
  needs_verification: 'Check this',
};

const SEVERITY_TONE: Record<WarningSeverity, BadgeTone> = {
  confirmed: 'critical',
  estimated: 'caution',
  possible: 'caution',
  needs_verification: 'caution',
};

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
        <li key={warning.code} className="flex flex-wrap items-start gap-2 text-sm">
          <Badge tone={SEVERITY_TONE[warning.severity]} srPrefix="Severity">
            {SEVERITY_LABEL[warning.severity]}
          </Badge>
          <span className="text-ink min-w-0 flex-1">{warning.message}</span>
        </li>
      ))}
    </ul>
  );
}
