/**
 * Deterministic hotel recommendations. Pure: no clock, no randomness. The
 * order is a function of the seed and the candidates alone.
 */

export interface RecommendCandidate {
  readonly hotelKey: string;
  readonly cityCode: string;
  readonly hasPhoto: boolean;
}

export interface RecommendOptions {
  readonly seed: string;
  readonly exclude?: readonly string[];
  readonly count: number;
}

/** 32-bit FNV-1a. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function pickRecommendations<T extends RecommendCandidate>(
  candidates: readonly T[],
  options: RecommendOptions,
): T[] {
  const { seed, count } = options;
  const excluded = new Set(options.exclude ?? []);
  if (!(count > 0)) return [];

  const seen = new Set<string>();
  const ranked = candidates
    .filter((c) => {
      if (excluded.has(c.hotelKey) || seen.has(c.hotelKey)) return false;
      seen.add(c.hotelKey);
      return true;
    })
    .map((c) => ({ c, h: fnv1a(`${seed}|${c.hotelKey}`) }))
    .sort((a, b) => {
      if (a.c.hasPhoto !== b.c.hasPhoto) return a.c.hasPhoto ? -1 : 1;
      if (a.h !== b.h) return a.h - b.h;
      return a.c.hotelKey < b.c.hotelKey ? -1 : a.c.hotelKey > b.c.hotelKey ? 1 : 0;
    })
    .map((r) => r.c);

  const cities = new Set(ranked.map((c) => c.cityCode));
  const picked: T[] = [];
  const usedCities = new Set<string>();
  const rest: T[] = [];

  for (const c of ranked) {
    if (picked.length >= count) break;
    if (cities.size >= 2 && usedCities.has(c.cityCode)) {
      rest.push(c);
      continue;
    }
    usedCities.add(c.cityCode);
    picked.push(c);
  }
  // Fewer distinct cities than `count`: fill from the leftovers, still ranked.
  for (const c of rest) {
    if (picked.length >= count) break;
    picked.push(c);
  }
  return picked;
}
