/**
 * Total-cost comparison across candidate departure airports.
 *
 * Integer minor units only, one currency. The flight price comes from a
 * provider, the transfer is a documented ESTIMATE (see `candidates.ts`). A
 * candidate with no flight price is reported as not compared and never guessed.
 */

export const DEFAULT_MIN_SAVING_MINOR = 1500;
export const DEFAULT_MIN_SAVING_PERCENT = 10;

export interface CandidateInput {
  readonly code: string;
  /** Minor units, or `null` when no price is known. */
  readonly flightMinor: number | null;
  /** Estimated ground transfer, minor units, same currency. */
  readonly transferMinor: number;
}

export interface CompareThresholds {
  readonly minSavingMinor?: number;
  readonly minSavingPercent?: number;
}

export interface ComparedCandidate {
  readonly code: string;
  readonly flightMinor: number;
  readonly transferMinor: number;
  readonly totalMinor: number;
}

export interface Comparison {
  readonly requested: ComparedCandidate | null;
  /** Compared candidates, cheapest first (ties by code). */
  readonly compared: readonly ComparedCandidate[];
  /** Codes with no price, left out. */
  readonly notCompared: readonly string[];
  readonly cheapest: ComparedCandidate | null;
  /** Requested total minus cheapest total, never negative; 0 when no requested price. */
  readonly savingMinor: number;
  readonly material: boolean;
}

function assertMinor(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}

export function compareCandidates(
  requestedCode: string,
  inputs: readonly CandidateInput[],
  thresholds: CompareThresholds = {},
): Comparison {
  const minMinor = thresholds.minSavingMinor ?? DEFAULT_MIN_SAVING_MINOR;
  const minPercent = thresholds.minSavingPercent ?? DEFAULT_MIN_SAVING_PERCENT;
  assertMinor(minMinor, 'minSavingMinor');
  assertMinor(minPercent, 'minSavingPercent');

  const compared: ComparedCandidate[] = [];
  const notCompared: string[] = [];
  for (const input of inputs) {
    if (input.flightMinor === null) {
      notCompared.push(input.code);
      continue;
    }
    assertMinor(input.flightMinor, 'flightMinor');
    assertMinor(input.transferMinor, 'transferMinor');
    compared.push({
      code: input.code,
      flightMinor: input.flightMinor,
      transferMinor: input.transferMinor,
      totalMinor: input.flightMinor + input.transferMinor,
    });
  }
  compared.sort((a, b) => a.totalMinor - b.totalMinor || a.code.localeCompare(b.code));

  const requested = compared.find((c) => c.code === requestedCode) ?? null;
  const cheapest = compared[0] ?? null;
  const savingMinor =
    requested && cheapest ? Math.max(0, requested.totalMinor - cheapest.totalMinor) : 0;
  // saving / requested >= percent / 100, cross-multiplied so the boundary is exact.
  const material =
    requested !== null &&
    cheapest !== null &&
    cheapest.code !== requested.code &&
    savingMinor > 0 &&
    savingMinor >= minMinor &&
    savingMinor * 100 >= requested.totalMinor * minPercent;

  return { requested, compared, notCompared, cheapest, savingMinor, material };
}
