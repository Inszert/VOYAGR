/**
 * Where a figure came from (1.10.1 §4, "do not fake live data").
 *
 * A number on screen is meaningless without this. "€184" from a live airline
 * quote, "€184" from our own estimate, and "€184" from a deterministic fixture
 * are three different claims, and a user who cannot tell them apart is being
 * misled by omission.
 *
 * The product already tags every cost line `known` / `estimated` / `excluded`,
 * which answers "did someone quote this?". Provenance answers the prior
 * question: "is that someone real?". Both are needed. A quoted price from a
 * mock provider is still a fiction, however confidently it is tagged.
 *
 * Deterministic, and derived from configuration rather than guessed.
 */

export type DataProvenance =
  /** Quoted just now by a live provider. */
  | 'live'
  /** Quoted by a live provider, served from our cache since. */
  | 'cached'
  /** Our own arithmetic over known figures, not quoted by anyone. */
  | 'estimated'
  /** Recorded earlier and shown as a past observation. */
  | 'historical'
  /** A seasonal norm, not a forecast or a quote. */
  | 'typical'
  /** A deterministic fixture. Not a real offer, and must never look like one. */
  | 'mock'
  /** Written by a language model from facts computed elsewhere. */
  | 'ai-generated'
  /** We could not find out. */
  | 'unavailable';

/** Short label for a badge. Wording is deliberate; do not "tidy" it. */
export const PROVENANCE_LABEL: Record<DataProvenance, string> = {
  live: 'Live price',
  cached: 'Recently checked',
  estimated: 'Estimated',
  historical: 'Past price',
  typical: 'Typical',
  mock: 'Demo data',
  'ai-generated': 'Written by AI',
  unavailable: 'Unavailable',
};

/** One sentence a user can act on, for a tooltip or a caption. */
export const PROVENANCE_EXPLANATION: Record<DataProvenance, string> = {
  live: 'Quoted by the provider just now.',
  cached: 'Quoted by the provider recently and reused since. It may have moved.',
  estimated: 'Worked out by us from what we do know. Nobody has quoted this.',
  historical: 'A price we recorded earlier, shown for comparison.',
  typical: 'What this usually costs at this time of year. Not a quote or a forecast.',
  mock: 'Sample data for development. This is not a real offer and cannot be booked.',
  'ai-generated': 'Wording produced by a language model from figures calculated elsewhere.',
  unavailable: 'We could not get this from the provider.',
};

/**
 * How much attention the label deserves.
 *
 * `mock` is intrusive on purpose. Every other provenance qualifies a real
 * offer; this one says the offer is not real, and a user must not be able to
 * miss it.
 */
export type ProvenanceEmphasis = 'quiet' | 'notable' | 'intrusive';

export const PROVENANCE_EMPHASIS: Record<DataProvenance, ProvenanceEmphasis> = {
  live: 'quiet',
  cached: 'quiet',
  estimated: 'notable',
  historical: 'quiet',
  typical: 'notable',
  mock: 'intrusive',
  'ai-generated': 'notable',
  unavailable: 'notable',
};

/** True when a figure describes an offer someone could actually take. */
export function isRealOffer(provenance: DataProvenance): boolean {
  return provenance === 'live' || provenance === 'cached';
}

/**
 * Combine provenance across the parts of a total.
 *
 * The weakest claim wins, because a total is only as trustworthy as its least
 * trustworthy line. One mock component makes the whole total demo data - it
 * cannot be half-bookable.
 */
const WEAKNESS_ORDER: DataProvenance[] = [
  'mock',
  'unavailable',
  'typical',
  'ai-generated',
  'estimated',
  'historical',
  'cached',
  'live',
];

export function combineProvenance(parts: readonly DataProvenance[]): DataProvenance {
  if (parts.length === 0) return 'unavailable';

  for (const candidate of WEAKNESS_ORDER) {
    if (parts.includes(candidate)) return candidate;
  }

  return 'unavailable';
}

/** A provider's provenance, from whether its adapter serves fixtures. */
export function provenanceForProvider(isMock: boolean): DataProvenance {
  return isMock ? 'mock' : 'live';
}
