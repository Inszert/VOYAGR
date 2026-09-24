import { format } from '@/core/money';
import { Badge, type BadgeTone } from '@/components/ui';
import type { TripCost } from '@/core/trip/cost';
import { budgetAllocation, type AllocationPart } from '@/core/trip/allocation';
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

const PART_LABEL: Record<AllocationPart, string> = {
  flights: 'Flights',
  stay: 'The stay',
  getting_around: 'Getting around',
  other: 'Everything else',
};

/** Four steps of the place's own colour, darkest first; the words carry the meaning. */
const PART_SWATCH: Record<AllocationPart, string> = {
  flights: 'bg-tint-ink',
  stay: 'bg-tint',
  getting_around: 'bg-tint/45',
  other: 'bg-ink-muted/50',
};

export interface CostBreakdownProps {
  cost: TripCost;
  passengers: number;
  nights: number;
  /** Rooms the stay was priced for, or null when the provider did not say. */
  rooms?: number | null;
}

/**
 * Where the money goes: the engine's lines grouped into shares of the total,
 * with anything left out named beneath. The bar is a picture of the list
 * beside it and is hidden from assistive technology; the list is the fact.
 */
function Allocation({ cost }: { cost: TripCost }) {
  const { shares, excluded } = budgetAllocation(cost);
  if (shares.length === 0) return null;

  return (
    <section aria-labelledby="allocation-heading" className="flex flex-col gap-3">
      <h5 id="allocation-heading" className="text-ink text-sm font-medium">
        Where the money goes
      </h5>
      <div
        aria-hidden="true"
        className="bg-surface-sunken flex h-2.5 overflow-hidden rounded-(--radius-pill)"
      >
        {shares.map((share) => (
          <span
            key={share.part}
            className={PART_SWATCH[share.part]}
            style={{ width: `${share.percent}%` }}
          />
        ))}
      </div>
      <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {shares.map((share) => (
          <li key={share.part} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-full ${PART_SWATCH[share.part]}`}
            />
            <span className="text-ink">{PART_LABEL[share.part]}</span>
            <span className="text-ink-muted ml-auto tabular-nums">
              {share.percent}% · {format(share.amount)}
            </span>
          </li>
        ))}
      </ul>
      {excluded.length > 0 ? (
        <p className="text-ink-muted text-xs">
          Not in these shares: {excluded.map((line) => line.label).join(', ')}.
        </p>
      ) : null}
    </section>
  );
}

/** For a group: what each person pays, and the rooms the stay assumed. */
function GroupLine({
  cost,
  passengers,
  rooms,
}: {
  cost: TripCost;
  passengers: number;
  rooms: number | null;
}) {
  if (passengers <= 1) return null;

  return (
    <p className="text-ink-muted text-sm">
      <span className="text-ink font-medium tabular-nums">{format(cost.perPerson)} each</span> for{' '}
      {passengers} travellers ·{' '}
      {rooms === null
        ? 'the hotel did not say how many rooms this covers'
        : `the stay is priced for ${rooms} ${rooms === 1 ? 'room' : 'rooms'}`}
    </p>
  );
}

export function CostBreakdown({ cost, passengers, nights, rooms = null }: CostBreakdownProps) {
  const counted = cost.lines.filter((line) => line.confidence !== 'excluded');

  return (
    <div className="flex flex-col gap-4">
      <Allocation cost={cost} />
      <GroupLine cost={cost} passengers={passengers} rooms={rooms} />
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
