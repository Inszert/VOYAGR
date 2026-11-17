import { add, money, sum, zero, type Money } from '../money';
import { perTraveller } from '../party';
import type { CostCategory, CostConfidence, CostLine, TripCandidate } from './types';

/**
 * True trip cost (specification section 10).
 *
 * Deterministic and pure. The total shown to a user is assembled here and
 * nowhere else, so any displayed figure can be traced back to the exact lines
 * that produced it.
 *
 * Three totals are produced rather than one, because they answer different
 * questions:
 *  - `knownTotal`    - what providers have actually quoted.
 *  - `estimatedTotal`- what our own models add on top.
 *  - `total`         - known + estimated, the realistic spend.
 * Excluded lines are reported separately and never silently folded into a total.
 */

export interface CostBreakdownEntry {
  readonly category: CostCategory;
  readonly amount: Money;
  readonly lines: readonly CostLine[];
}

export interface TripCost {
  readonly currency: string;
  /** Sum of provider-quoted lines. */
  readonly knownTotal: Money;
  /** Sum of our own estimates. */
  readonly estimatedTotal: Money;
  /** knownTotal + estimatedTotal: the figure to show as the trip total. */
  readonly total: Money;
  /** Knowingly uncounted costs, surfaced so the total is honest. */
  readonly excluded: readonly CostLine[];
  readonly perPerson: Money;
  readonly perNight: Money;
  readonly byCategory: readonly CostBreakdownEntry[];
  readonly lines: readonly CostLine[];
  /** Share of the total that is provider-quoted rather than estimated, 0-1. */
  readonly knownShare: number;
}

export class CostEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostEngineError';
  }
}

/**
 * Content-derived line id.
 *
 * Deliberately not a counter or a random id: the same trip must produce the same
 * line ids on every run, so that snapshots, price-history diffs and "what changed
 * since yesterday" comparisons line up.
 */
function lineId(category: CostCategory, label: string): string {
  const slug = label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
  return `${category}:${slug}`;
}

export interface BuildCostLineInput {
  category: CostCategory;
  label: string;
  amount: Money;
  confidence: CostConfidence;
  source: string;
  observedAt?: string;
  conditions?: string;
  /** Override the derived id when a trip legitimately has two similar lines. */
  id?: string;
}

export function buildCostLine(input: BuildCostLineInput): CostLine {
  return {
    id: input.id ?? lineId(input.category, input.label),
    category: input.category,
    label: input.label,
    amount: input.amount,
    confidence: input.confidence,
    source: input.source,
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
    ...(input.conditions ? { conditions: input.conditions } : {}),
  };
}

/**
 * Derive the cost lines implied by a trip candidate.
 *
 * Every component of the trip becomes an explicit, labelled, attributed line.
 * A missing transfer becomes an `excluded` line rather than a silent zero -
 * an omitted cost is exactly the kind of surprise section 31.5 exists to catch.
 */
export function deriveCostLines(candidate: TripCandidate): CostLine[] {
  const currency = candidate.flight.price.currency;
  const lines: CostLine[] = [];

  lines.push(
    buildCostLine({
      category: 'flight',
      label: `Flights ${candidate.origin} to ${candidate.destination}`,
      amount: candidate.flight.price,
      confidence: 'known',
      source: candidate.flight.providerId,
      observedAt: candidate.flight.observedAt,
      conditions: describeFlightConditions(candidate),
    }),
  );

  const { hotel } = candidate;

  if (hotel) {
    lines.push(
      buildCostLine({
        category: 'hotel',
        label: `${hotel.name}, ${candidate.dates.nights} nights`,
        amount: hotel.totalPrice,
        confidence: 'known',
        source: hotel.providerId,
        observedAt: hotel.observedAt,
        conditions: hotel.freeCancellation ? 'Free cancellation' : 'Non-refundable',
      }),
    );

    if (hotel.excludedFees && hotel.excludedFees.amount > 0) {
      lines.push(
        buildCostLine({
          category: 'hotel_fees',
          label: 'Payable at the hotel',
          amount: hotel.excludedFees,
          confidence: 'excluded',
          source: hotel.providerId,
          observedAt: hotel.observedAt,
          conditions: 'Paid to the hotel, not included in this price',
        }),
      );
    }
  } else {
    // Same rule as the transfer below: a stay nobody priced is a line the total
    // visibly leaves out, never a zero that reads as a free night.
    lines.push(
      buildCostLine({
        category: 'hotel',
        label: 'Stay not priced',
        amount: zero(currency),
        confidence: 'excluded',
        source: 'voyagr.cost-engine',
        conditions: 'No priced stay is available for these dates',
      }),
    );
  }

  if (candidate.transfer) {
    // Two directions: airport to hotel and back.
    const transferTotal = add(
      candidate.transfer.pricePerDirection,
      candidate.transfer.pricePerDirection,
    );

    lines.push(
      buildCostLine({
        category: 'transfer',
        label: `Airport transfer, return (${candidate.transfer.mode})`,
        amount: transferTotal,
        confidence: 'known',
        source: candidate.transfer.providerId,
        observedAt: candidate.transfer.observedAt,
      }),
    );
  } else {
    lines.push(
      buildCostLine({
        category: 'transfer',
        label: 'Airport transfer not priced',
        amount: zero(currency),
        confidence: 'excluded',
        source: 'voyagr.cost-engine',
        conditions: 'No transfer option was returned for this route',
      }),
    );
  }

  lines.push(...candidate.extraCosts);

  return lines;
}

/**
 * Combine a fact across both legs.
 *
 * `false` wins over `null` wins over `true`: a confirmed problem on either leg
 * is a problem, and an unreported allowance on either leg means the trip's
 * allowance is unknown even if the other leg was explicit.
 */
function acrossLegs(outbound: boolean | null, inbound: boolean | null): boolean | null {
  if (outbound === false || inbound === false) return false;
  if (outbound === null || inbound === null) return null;
  return true;
}

function describeFlightConditions(candidate: TripCandidate): string {
  const parts: string[] = [];
  const { outbound, inbound } = candidate.flight;

  const checkedBaggage = acrossLegs(
    outbound.checkedBaggageIncluded,
    inbound.checkedBaggageIncluded,
  );

  parts.push(
    checkedBaggage === true
      ? 'Checked baggage included'
      : checkedBaggage === false
        ? 'Cabin baggage only'
        : 'Baggage allowance not stated by the provider',
  );

  const selfTransfer = outbound.selfTransfer === true || inbound.selfTransfer === true;
  const selfTransferUnknown = outbound.selfTransfer === null || inbound.selfTransfer === null;

  if (selfTransfer) parts.push('Self-transfer connection');
  else if (selfTransferUnknown) parts.push('Connection ticketing not stated');

  return parts.join('; ');
}

/**
 * Compute the full cost of a trip from its cost lines.
 *
 * @throws CostEngineError when lines mix currencies. Mixed-currency trips must
 *   be converted with a dated rate before they reach this function, so the
 *   conversion is explicit and auditable rather than implicit here.
 */
export function computeTripCost(
  lines: readonly CostLine[],
  options: { passengers: number; nights: number; currency?: string },
): TripCost {
  const { passengers, nights } = options;

  if (!Number.isSafeInteger(passengers) || passengers <= 0) {
    throw new CostEngineError(`passengers must be a positive integer, received ${passengers}`);
  }
  if (!Number.isSafeInteger(nights) || nights <= 0) {
    throw new CostEngineError(`nights must be a positive integer, received ${nights}`);
  }

  const currency = options.currency ?? lines[0]?.amount.currency;
  if (!currency) {
    throw new CostEngineError(
      'computeTripCost() requires at least one line or an explicit currency',
    );
  }

  for (const line of lines) {
    if (line.amount.currency !== currency) {
      throw new CostEngineError(
        `Mixed currencies in trip cost: expected ${currency}, line ${line.id} is ${line.amount.currency}. ` +
          'Convert with a dated exchange rate before costing.',
      );
    }
  }

  const counted = lines.filter((line) => line.confidence !== 'excluded');
  const known = counted.filter((line) => line.confidence === 'known');
  const estimated = counted.filter((line) => line.confidence === 'estimated');
  const excluded = lines.filter((line) => line.confidence === 'excluded');

  const knownTotal = sum(
    known.map((line) => line.amount),
    currency,
  );
  const estimatedTotal = sum(
    estimated.map((line) => line.amount),
    currency,
  );
  const total = add(knownTotal, estimatedTotal);

  return {
    currency,
    knownTotal,
    estimatedTotal,
    total,
    excluded,
    // Rounded down to the minor unit by `perTraveller`, which documents the
    // remainder: a per-person figure is an indication, and the authoritative
    // number remains `total`.
    perPerson: perTraveller(total, passengers).each,
    perNight: money(Math.trunc(total.amount / nights), currency),
    byCategory: groupByCategory(counted, currency),
    lines,
    knownShare: total.amount === 0 ? 1 : knownTotal.amount / total.amount,
  };
}

function groupByCategory(lines: readonly CostLine[], currency: string): CostBreakdownEntry[] {
  const groups = new Map<CostCategory, CostLine[]>();

  for (const line of lines) {
    const existing = groups.get(line.category);
    if (existing) existing.push(line);
    else groups.set(line.category, [line]);
  }

  return [...groups.entries()]
    .map(([category, categoryLines]) => ({
      category,
      amount: sum(
        categoryLines.map((line) => line.amount),
        currency,
      ),
      lines: categoryLines,
    }))
    .sort((a, b) => b.amount.amount - a.amount.amount);
}

/** Convenience: derive the lines for a candidate and cost them in one step. */
export function costTripCandidate(candidate: TripCandidate): TripCost {
  return computeTripCost(deriveCostLines(candidate), {
    passengers: candidate.passengers,
    nights: candidate.dates.nights,
    currency: candidate.flight.price.currency,
  });
}
