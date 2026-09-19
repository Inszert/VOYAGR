import { format, money } from '@/core/money';
import { Badge, Disclosure } from '@/components/ui';
import type { Alternative } from '@/search/alternatives';

/**
 * Swapping a component, shown as whole trips rather than as parts.
 *
 * Every row states what the *trip* would cost and score with that component,
 * not what the component costs. A cheaper flight that lands at midnight often
 * makes the holiday worse, and a list of fares would quietly invite exactly
 * that mistake.
 *
 * The difference is given in both directions - money and score - because
 * neither answers the question alone.
 */

export interface SwapPanelProps {
  heading: string;
  alternatives: readonly Alternative[];
  currency: string;
}

function deltaLabel(minorUnits: number, currency: string): string {
  if (minorUnits === 0) return 'Same price';
  const formatted = format(money(Math.abs(minorUnits), currency));
  return minorUnits < 0 ? `${formatted} cheaper` : `${formatted} more`;
}

export function SwapPanel({ heading, alternatives, currency }: SwapPanelProps) {
  if (alternatives.length <= 1) return null;

  return (
    <Disclosure summary={heading}>
      <ul className="flex flex-col gap-3">
        {alternatives.map((alternative) => (
          <li
            key={alternative.offerId}
            className="border-border flex flex-wrap items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-ink flex flex-wrap items-center gap-2 text-sm font-medium">
                {alternative.label}
                {alternative.isCurrent ? (
                  <Badge tone="brand" srPrefix="Selection">
                    Chosen
                  </Badge>
                ) : null}
              </p>
              <p className="text-ink-muted text-sm">{alternative.detail}</p>
            </div>

            <div className="text-right text-sm">
              {/* The whole trip, not the component. */}
              <p className="text-ink tabular-nums">{format(alternative.trip.cost.total)} total</p>
              <p className="text-ink-muted tabular-nums">
                {alternative.isCurrent
                  ? `Score ${alternative.trip.score.score}`
                  : `${deltaLabel(alternative.totalDeltaMinorUnits, currency)} · score ${
                      alternative.trip.score.score
                    } (${alternative.scoreDelta >= 0 ? '+' : ''}${alternative.scoreDelta})`}
              </p>
              {alternative.trip.eligibility.eligible ? null : (
                <p className="text-critical-ink text-xs">Outside your limits</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
