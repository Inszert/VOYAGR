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
  /**
   * A real provider API in test mode. Real shapes, real carriers, no inventory.
   *
   * Its own case, and emphatically not `live`. A sandbox answers with genuine
   * itineraries at genuine-looking prices and none of it can be bought - so
   * labelling it "Live price" would be the exact misrepresentation the whole
   * of this module exists to prevent. It is not `mock` either: the request
   * really was made and the mapping really was exercised, which is worth
   * being able to see while an integration is being brought up.
   */
  | 'test'
  /**
   * A real figure from a real vendor, but not a quote for this search.
   *
   * A cached aggregate price point - "someone searched this route recently
   * and paid about this much" - names a real airline and a real fare that
   * existed, and is still neither `live` nor `cached`: both of those mean a
   * provider answered *this* query. An indicative price answers a different
   * one, on a timetable nobody here controls, and can move or vanish before
   * anyone acts on it. Calling it `cached` would borrow trust a real
   * quote-then-reuse earns; calling it `estimated` would deny that a real
   * market price sits underneath it. It needs its own word.
   */
  | 'indicative'
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
  test: 'Test data',
  indicative: 'Indicative price',
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
  test: 'From the provider’s sandbox. The itinerary and price are realistic but the seat does not exist and cannot be booked.',
  indicative:
    'A real price recently seen on this route, not a quote for this exact search. It can move before you act on it.',
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
  test: 'intrusive',
  indicative: 'notable',
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
  // Above mock, below everything real: a sandbox offer is more than a fixture
  // and still not something anybody can take.
  'test',
  'unavailable',
  'typical',
  'ai-generated',
  'estimated',
  // Stronger than arithmetic over known figures, weaker than anything that
  // was actually quoted for this search: a real market price, for a
  // different query than the one being answered.
  'indicative',
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

/**
 * How a provider runs, which is what decides the provenance of its answers.
 *
 * Four states rather than two. `isMock` alone cannot tell a live account
 * from a sandbox one, or either from a vendor that is real but answers a
 * different question than the one asked - and a cached-aggregate answer
 * that inherits "Live price" is a lie told by a boolean just as much as a
 * sandbox one would be.
 */
export type ProviderMode = 'mock' | 'test' | 'indicative' | 'live';

const MODE_PROVENANCE: Record<ProviderMode, DataProvenance> = {
  mock: 'mock',
  test: 'test',
  indicative: 'indicative',
  live: 'live',
};

export function provenanceForMode(mode: ProviderMode): DataProvenance {
  return MODE_PROVENANCE[mode];
}

/** A provider's provenance, from whether its adapter serves fixtures. */
export function provenanceForProvider(isMock: boolean): DataProvenance {
  return isMock ? 'mock' : 'live';
}

/**
 * Which provider answered, and what its answer is worth.
 *
 * Carried on the result rather than only in the diagnostics, because the
 * question "is this real?" is asked while looking at a price, not while
 * reading a log.
 */
export interface SourceAttribution {
  /**
   * Which part of the trip this provider supplied.
   *
   * Carried so a badge can sit on the line it describes. A card-level strip
   * says a Duffel was involved somewhere; the question being asked while
   * looking at "Hotel EUR 472.22" is whether *that* number is real.
   */
  readonly part: 'flights' | 'hotels' | 'stays' | 'transfers';
  /** Stable id, e.g. `duffel`. */
  readonly providerId: string;
  /** What a person should see, e.g. `Duffel`. */
  readonly displayName: string;
  readonly provenance: DataProvenance;
}
