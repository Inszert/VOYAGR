import { describe, expect, it } from 'vitest';
import { money, sum } from '../money';
import {
  buildCostLine,
  computeTripCost,
  costTripCandidate,
  CostEngineError,
  deriveCostLines,
} from './cost';
import { buildCandidate, buildFlightOffer, buildHotelOffer, buildLeg } from './test-support';

describe('deriveCostLines', () => {
  it('produces a line for every priced component', () => {
    const lines = deriveCostLines(buildCandidate());
    const categories = lines.map((line) => line.category);

    expect(categories).toContain('flight');
    expect(categories).toContain('hotel');
    expect(categories).toContain('transfer');
  });

  it('prices the transfer in both directions', () => {
    // A return transfer is two journeys; charging once understates the total.
    const candidate = buildCandidate();
    const lines = deriveCostLines(candidate);
    const transfer = lines.find((line) => line.category === 'transfer');

    expect(transfer?.amount.amount).toBe(candidate.transfer!.pricePerDirection.amount * 2);
  });

  it('marks a missing transfer as excluded rather than as zero', () => {
    // A silent zero would make the trip look cheaper than it is.
    const lines = deriveCostLines(buildCandidate({ transfer: null }));
    const transfer = lines.find((line) => line.category === 'transfer');

    expect(transfer?.confidence).toBe('excluded');
    expect(transfer?.amount.amount).toBe(0);
  });

  it('records excluded hotel fees as an estimate, not as quoted', () => {
    const candidate = buildCandidate({
      hotel: buildHotelOffer({ excludedFees: money(4000, 'EUR') }),
    });

    const fees = deriveCostLines(candidate).find((line) => line.category === 'hotel_fees');

    expect(fees?.confidence).toBe('estimated');
    expect(fees?.amount.amount).toBe(4000);
  });

  it('attributes every line to a source', () => {
    for (const line of deriveCostLines(buildCandidate())) {
      expect(line.source).toBeTruthy();
    }
  });

  it('generates stable ids across runs', () => {
    // Price-history diffing depends on the same trip yielding the same ids.
    const first = deriveCostLines(buildCandidate()).map((line) => line.id);
    const second = deriveCostLines(buildCandidate()).map((line) => line.id);

    expect(first).toEqual(second);
  });
});

describe('computeTripCost', () => {
  it('separates quoted totals from estimated ones', () => {
    const lines = [
      buildCostLine({
        category: 'flight',
        label: 'Flights',
        amount: money(29800, 'EUR'),
        confidence: 'known',
        source: 'mock-flights',
      }),
      buildCostLine({
        category: 'food',
        label: 'Food budget',
        amount: money(12000, 'EUR'),
        confidence: 'estimated',
        source: 'voyagr.food-model',
      }),
    ];

    const cost = computeTripCost(lines, { passengers: 2, nights: 5 });

    expect(cost.knownTotal.amount).toBe(29800);
    expect(cost.estimatedTotal.amount).toBe(12000);
    expect(cost.total.amount).toBe(41800);
  });

  it('never folds excluded lines into any total', () => {
    const lines = [
      buildCostLine({
        category: 'flight',
        label: 'Flights',
        amount: money(29800, 'EUR'),
        confidence: 'known',
        source: 'mock-flights',
      }),
      buildCostLine({
        category: 'car_rental',
        label: 'Car rental',
        amount: money(15000, 'EUR'),
        confidence: 'excluded',
        source: 'voyagr.cost-engine',
      }),
    ];

    const cost = computeTripCost(lines, { passengers: 2, nights: 5 });

    expect(cost.total.amount).toBe(29800);
    expect(cost.excluded).toHaveLength(1);
  });

  it('reports what share of the total is actually quoted', () => {
    const cost = costTripCandidate(buildCandidate());
    expect(cost.knownShare).toBeGreaterThan(0);
    expect(cost.knownShare).toBeLessThanOrEqual(1);
  });

  it('refuses to total a mixed-currency trip', () => {
    // Converting implicitly here would hide the exchange rate used.
    const lines = [
      buildCostLine({
        category: 'flight',
        label: 'Flights',
        amount: money(29800, 'EUR'),
        confidence: 'known',
        source: 'a',
      }),
      buildCostLine({
        category: 'hotel',
        label: 'Hotel',
        amount: money(34000, 'USD'),
        confidence: 'known',
        source: 'b',
      }),
    ];

    expect(() => computeTripCost(lines, { passengers: 2, nights: 5 })).toThrow(CostEngineError);
  });

  it('rejects nonsensical passenger and night counts', () => {
    const lines = [
      buildCostLine({
        category: 'flight',
        label: 'Flights',
        amount: money(100, 'EUR'),
        confidence: 'known',
        source: 'a',
      }),
    ];

    expect(() => computeTripCost(lines, { passengers: 0, nights: 5 })).toThrow(CostEngineError);
    expect(() => computeTripCost(lines, { passengers: 2, nights: 0 })).toThrow(CostEngineError);
    expect(() => computeTripCost(lines, { passengers: 2.5, nights: 5 })).toThrow(CostEngineError);
  });

  it('requires a currency when there are no lines to infer one from', () => {
    expect(() => computeTripCost([], { passengers: 2, nights: 5 })).toThrow(CostEngineError);
  });

  it('groups by category, largest first', () => {
    const cost = costTripCandidate(buildCandidate());
    const amounts = cost.byCategory.map((entry) => entry.amount.amount);

    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it('keeps the category breakdown equal to the counted total', () => {
    // If these ever diverge, a displayed breakdown would not add up to its own
    // total, which is precisely the bug this engine exists to prevent.
    const cost = costTripCandidate(buildCandidate());
    const breakdownTotal = sum(
      cost.byCategory.map((entry) => entry.amount),
      cost.currency,
    );

    expect(breakdownTotal.amount).toBe(cost.total.amount);
  });

  it('derives per-person and per-night figures from the total', () => {
    const cost = costTripCandidate(buildCandidate());

    expect(cost.perPerson.amount).toBe(Math.trunc(cost.total.amount / 2));
    expect(cost.perNight.amount).toBe(Math.trunc(cost.total.amount / 5));
  });
});

describe('flight conditions when a provider was terse', () => {
  const conditionsFor = (outbound: Partial<ReturnType<typeof buildLeg>>, inbound = outbound) =>
    deriveCostLines(
      buildCandidate({
        flight: buildFlightOffer({ outbound: buildLeg(outbound), inbound: buildLeg(inbound) }),
      }),
    ).find((line) => line.category === 'flight')?.conditions;

  it('states an included allowance as included', () => {
    expect(conditionsFor({ checkedBaggageIncluded: true })).toContain('Checked baggage included');
  });

  it('states an excluded allowance as excluded', () => {
    expect(conditionsFor({ checkedBaggageIncluded: false })).toContain('Cabin baggage only');
  });

  it('says the allowance was not stated rather than implying there is none', () => {
    // "Cabin baggage only" here would be a claim the provider never made, on a
    // line the user reads as a quoted condition.
    expect(conditionsFor({ checkedBaggageIncluded: null })).toContain('not stated by the provider');
  });

  it('notes unstated connection ticketing', () => {
    expect(conditionsFor({ selfTransfer: null })).toContain('Connection ticketing not stated');
  });
});

describe('a trip with no priced stay', () => {
  const withStay = buildCandidate();
  const withoutStay = buildCandidate({ hotel: null });

  it('emits an excluded stay line rather than a zero or nothing', () => {
    const stay = deriveCostLines(withoutStay).find((line) => line.category === 'hotel');

    expect(stay?.confidence).toBe('excluded');
    expect(stay?.amount.amount).toBe(0);
    expect(stay?.source).toBe('voyagr.cost-engine');
  });

  it('emits no hotel-fee line without a hotel', () => {
    expect(deriveCostLines(withoutStay).some((line) => line.category === 'hotel_fees')).toBe(false);
  });

  it('counts a quoted stay in the total and an excluded one not at all', () => {
    const known = costTripCandidate(withStay);
    const excluded = costTripCandidate(withoutStay);

    // The difference between the two totals is exactly the quoted stay.
    expect(known.total.amount - excluded.total.amount).toBe(withStay.hotel!.totalPrice.amount);
    expect(excluded.knownTotal.amount).toBe(
      withoutStay.flight.price.amount + withoutStay.transfer!.pricePerDirection.amount * 2,
    );
  });

  it('lists the stay as excluded only when there is no stay', () => {
    expect(costTripCandidate(withoutStay).excluded.map((line) => line.category)).toContain('hotel');
    expect(costTripCandidate(withStay).excluded.map((line) => line.category)).not.toContain(
      'hotel',
    );
  });

  it('keeps the stay out of every category total while it is excluded', () => {
    const cost = costTripCandidate(withoutStay);
    expect(cost.byCategory.some((entry) => entry.category === 'hotel')).toBe(false);
  });
});
