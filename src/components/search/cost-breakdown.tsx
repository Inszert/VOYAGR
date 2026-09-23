import { format } from '@/core/money';
import { Badge, type BadgeTone } from '@/components/ui';
import type { TripCost } from '@/core/trip/cost';
import type { CostConfidence } from '@/core/trip/types';

/**
 * Cost breakdown.
 *
 * Every line the total is made of, with what we actually know about it. The
 * specification's rule (sections 10 and 31.11) is that an estimate must not
 * look like a quote, so confidence is carried by a worded badge rather than by
 * a colour, and excluded lines sit in their own section instead of vanishing.
 *
 * This component renders numbers; it never computes one. Everything shown comes
 * from the `TripCost` the engine produced.
 */

const CONFIDENCE_LABEL: Record<CostConfidence, string> = {
  known: 'Quoted',
  estimated: 'Estimated',
  excluded: 'Not included',
};

const CONFIDENCE_TONE: Record<CostConfidence, BadgeTone> = {
  known: 'positive',
  estimated: 'caution',
  excluded: 'neutral',
};

export interface CostBreakdownProps {
  cost: TripCost;
  passengers: number;
  nights: number;
}

export function CostBreakdown({ cost, passengers, nights }: CostBreakdownProps) {
  const counted = cost.lines.filter((line) => line.confidence !== 'excluded');

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full border-collapse text-sm">
        <caption className="text-ink-muted mb-2 text-left text-sm">
          What the {format(cost.total)} total is made of.
        </caption>
        <thead>
          <tr className="border-border border-b text-left">
            <th scope="col" className="text-ink py-2 pr-3 font-medium">
              Cost
            </th>
            <th scope="col" className="text-ink py-2 pr-3 font-medium">
              Confidence
            </th>
            <th scope="col" className="text-ink py-2 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {counted.map((line) => (
            <tr key={line.id} className="border-border border-b align-top last:border-0">
              <th scope="row" className="text-ink py-2 pr-3 text-left font-normal">
                {line.label}
                {line.conditions ? (
                  <span className="text-ink-muted block text-xs">{line.conditions}</span>
                ) : null}
                <span className="text-ink-muted block text-xs">via {line.source}</span>
              </th>
              <td className="py-2 pr-3">
                <Badge tone={CONFIDENCE_TONE[line.confidence]} srPrefix="Confidence">
                  {CONFIDENCE_LABEL[line.confidence]}
                </Badge>
              </td>
              <td className="text-ink py-2 text-right tabular-nums">{format(line.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-border border-t-2">
            <th scope="row" colSpan={2} className="text-ink py-2 pr-3 text-left font-semibold">
              Total for {passengers} {passengers === 1 ? 'traveller' : 'travellers'}, {nights}{' '}
              {nights === 1 ? 'night' : 'nights'}
            </th>
            <td className="text-ink py-2 text-right font-semibold tabular-nums">
              {format(cost.total)}
            </td>
          </tr>
          <tr>
            <th scope="row" colSpan={2} className="text-ink-muted py-1 pr-3 text-left font-normal">
              Of which quoted by a provider
            </th>
            <td className="text-ink-muted py-1 text-right tabular-nums">
              {format(cost.knownTotal)}
            </td>
          </tr>
          <tr>
            <th scope="row" colSpan={2} className="text-ink-muted py-1 pr-3 text-left font-normal">
              Of which our own estimate
            </th>
            <td className="text-ink-muted py-1 text-right tabular-nums">
              {format(cost.estimatedTotal)}
            </td>
          </tr>
        </tfoot>
      </table>

      {cost.excluded.length > 0 ? (
        <div className="border-border bg-surface-sunken rounded-(--radius-control) border p-3">
          <h5 className="text-ink text-sm font-medium">Not counted in this total</h5>
          <p className="text-ink-muted mt-1 text-sm">
            These are real costs we could not price. The trip will cost more than the figure above.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {cost.excluded.map((line) => (
              <li key={line.id} className="text-ink-muted text-sm">
                {line.label}
                {line.conditions ? ` — ${line.conditions}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
