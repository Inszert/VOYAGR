/**
 * Candidate departure airports for a hub / nearby-airport comparison.
 *
 * Everything here is DATA plus pure arithmetic. The airports' coordinates are
 * handed in by the caller (from `src/providers/reference/airports.ts`, which is
 * OurAirports data), so this module does no I/O and imports no provider code.
 *
 * ESTIMATE WARNING: the ground-transfer cost and time on every candidate are
 * STATIC ESTIMATES (see `TRANSFER_BANDS`), not quotes. They are labelled
 * `basis: 'estimate'` on every candidate and must be shown to a user as an
 * estimate. They are never a price from a provider.
 */
import { distanceMetres } from '@/core/distance';
import { money, type Money } from '@/core/money';

export interface AirportPoint {
  readonly code: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Only `large` airports are added by the distance search; listed hubs are always added. */
  readonly size: 'large' | 'medium' | 'small';
}

export interface TransferBand {
  /** Inclusive upper bound of straight-line distance in whole km. */
  readonly maxKm: number;
  /** Minor units of TRANSFER_CURRENCY (bus or train, one way). ESTIMATE. */
  readonly costMinor: number;
  /** Door to airport, one way, including waiting. ESTIMATE. */
  readonly minutes: number;
}

export const TRANSFER_CURRENCY = 'EUR';

/**
 * ESTIMATE: typical one-way coach/train fare and door-to-airport time for a
 * straight-line distance. Road distance is longer than the great circle, and
 * the bands absorb that. A candidate beyond the last band gets no estimate and
 * is left out, never given a guess.
 */
export const TRANSFER_BANDS: readonly TransferBand[] = [
  { maxKm: 60, costMinor: 1500, minutes: 60 },
  { maxKm: 120, costMinor: 2500, minutes: 105 },
  { maxKm: 180, costMinor: 3500, minutes: 150 },
  { maxKm: 250, costMinor: 4500, minutes: 200 },
  { maxKm: 400, costMinor: 6500, minutes: 290 },
];

export const DEFAULT_MAX_GROUND_KM = 250;

/** Origins we compare for, and the low-cost hubs listed for each (always candidates). */
export const ORIGIN_TABLE: Readonly<Record<string, { readonly hubs: readonly string[] }>> = {
  BUD: { hubs: ['VIE', 'BTS'] },
  VIE: { hubs: ['BTS', 'BUD'] },
  KSC: { hubs: ['BUD', 'KRK'] },
  FRA: { hubs: ['HHN'] },
  IST: { hubs: ['SAW'] },
  PRG: { hubs: ['DRS'] },
  WAW: { hubs: ['WMI'] },
  MUC: { hubs: ['FMM', 'SZG'] },
  MXP: { hubs: ['BGY', 'LIN'] },
  BCN: { hubs: ['GRO', 'REU'] },
};

export interface HubCandidate {
  readonly code: string;
  readonly distanceKm: number;
  /** Why it is a candidate. */
  readonly reason: 'origin' | 'listed_hub' | 'nearby';
  readonly transferCost: Money;
  readonly transferMinutes: number;
  /** `estimate` for every transfer figure: static, never a quote. */
  readonly basis: 'origin' | 'estimate';
}

export function transferBandFor(distanceKm: number): TransferBand | null {
  for (const band of TRANSFER_BANDS) if (distanceKm <= band.maxKm) return band;
  return null;
}

export interface CandidateOptions {
  readonly maxGroundKm?: number;
}

/**
 * The candidate set for `origin`: the origin itself first, then the rest sorted
 * by distance then code. Empty when the origin is not in the table or its
 * position is unknown. A listed hub whose position is unknown or that lies
 * beyond the last transfer band is skipped (no estimate, no guess).
 */
export function candidatesFor(
  origin: string,
  airports: readonly AirportPoint[],
  options: CandidateOptions = {},
): HubCandidate[] {
  const code = origin.toUpperCase();
  const entry = ORIGIN_TABLE[code];
  const maxKm = options.maxGroundKm ?? DEFAULT_MAX_GROUND_KM;
  const here = airports.find((a) => a.code === code);
  if (!entry || !here) return [];

  const self: HubCandidate = {
    code,
    distanceKm: 0,
    reason: 'origin',
    transferCost: money(0, TRANSFER_CURRENCY),
    transferMinutes: 0,
    basis: 'origin',
  };
  const others = new Map<string, HubCandidate>();

  const consider = (a: AirportPoint, reason: 'listed_hub' | 'nearby'): void => {
    if (a.code === code || others.has(a.code)) return;
    const km = Math.round(distanceMetres(here, a) / 1000);
    const band = transferBandFor(km);
    if (!band) return;
    others.set(a.code, {
      code: a.code,
      distanceKm: km,
      reason,
      transferCost: money(band.costMinor, TRANSFER_CURRENCY),
      transferMinutes: band.minutes,
      basis: 'estimate',
    });
  };

  for (const hub of entry.hubs) {
    const a = airports.find((p) => p.code === hub);
    if (a) consider(a, 'listed_hub');
  }
  for (const a of airports) {
    if (a.size !== 'large') continue;
    if (Math.round(distanceMetres(here, a) / 1000) <= maxKm) consider(a, 'nearby');
  }

  const rest = [...others.values()].sort(
    (a, b) => a.distanceKm - b.distanceKm || a.code.localeCompare(b.code),
  );
  return [self, ...rest];
}
