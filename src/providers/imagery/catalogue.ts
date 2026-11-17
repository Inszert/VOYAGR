import type { ImageryRef } from './types';

/**
 * Which article illustrates which destination.
 *
 * Hand-written, and that is the point. The alternative - searching an image
 * API for the destination's name - is how "Chania, Crete" becomes a photograph
 * of a different Chania, or how "Split" returns a picture of a banana. A photo
 * attached to the wrong place is the same class of error as a wrong price, and
 * this product does not make that class of error to save typing.
 *
 * One entry for every destination the product can price, each chosen by hand.
 * When the `destinations` table of specification section 21 exists, this column lives
 * there and this file goes away; a curated column in a real catalogue is the
 * same idea, stored properly.
 *
 * Titles are the English Wikipedia's own spelling, redirects included - the
 * API resolves those, so "Bali" does not have to be written as its canonical
 * form to work.
 */

const LANG = 'en';

/** Destination airport code to the article that pictures the place. */
const ARTICLES: Readonly<Record<string, string>> = {
  AYT: 'Antalya',
  CHQ: 'Chania',
  LCA: 'Larnaca',
  PMI: 'Palma de Mallorca',
  TBS: 'Tbilisi',
  BUS: 'Batumi',
  SPU: 'Split, Croatia',
  FAO: 'Faro, Portugal',
  LIS: 'Lisbon',
  KEF: 'Reykjavík',
  JFK: 'New York City',
  DXB: 'Dubai',
  BKK: 'Bangkok',
  NRT: 'Tokyo',
  CPT: 'Cape Town',
  // Tanah Lot, because the article for the island leads with a locator map and
  // the Maldives', Singapore's and Hong Kong's with a flag - none of them a
  // picture of the place. The place names still find these entries: see
  // `PLACE_ALIASES`.
  DPS: 'Tanah Lot',

  // Stay destinations. A hotel search names a city rather than an airport, so
  // these are keyed by the airport a traveller would land at, and reached by
  // `imageryCodeForPlace` from the city's name.
  BCN: 'Barcelona',
  CDG: 'Paris',
  FCO: 'Rome',
  LHR: 'London',
  AMS: 'Amsterdam',
  VIE: 'Vienna',
  ATH: 'Athens',
  PRG: 'Prague',
  BUD: 'Budapest',
  MAD: 'Madrid',
  // Every other destination the product can price. Each title is the city's
  // own article (the island's, where the airport is named for the island), not
  // a search - the same rule as above. `scripts` that audit this can fetch each
  // one; a title with no lead image simply gets the wash, as before.
  FRA: 'Frankfurt',
  IST: 'Istanbul',
  WAW: 'Warsaw',
  CPH: 'Copenhagen',
  DUB: 'Dublin',
  ZRH: 'Zürich',
  MUC: 'Munich',
  BER: 'Berlin',
  MXP: 'Milan',
  VCE: 'Venice',
  NAP: 'Naples',
  OPO: 'Porto',
  AGP: 'Málaga',
  ALC: 'Alicante',
  TFS: 'Tenerife',
  LPA: 'Gran Canaria',
  DBV: 'Dubrovnik',
  SKG: 'Thessaloniki',
  HER: 'Heraklion',
  RHO: 'Rhodes',
  CFU: 'Corfu',
  SOF: 'Sofia',
  OTP: 'Bucharest',
  RIX: 'Riga',
  TLL: 'Tallinn',
  VNO: 'Vilnius',
  KRK: 'Kraków',
  EDI: 'Edinburgh',
  MAN: 'Manchester',
  ARN: 'Stockholm',
  OSL: 'Oslo',
  HEL: 'Helsinki',
  BRU: 'Brussels',
  GVA: 'Geneva',
  NCE: 'Nice',
  LYS: 'Lyon',
  CAI: 'Cairo',
  SSH: 'Sharm El Sheikh',
  HRG: 'Hurghada',
  AUH: 'Abu Dhabi',
  DOH: 'Doha',
  TLV: 'Tel Aviv',
  AMM: 'Amman',
  LAX: 'Los Angeles',
  MIA: 'Miami',
  CUN: 'Cancún',
  GRU: 'São Paulo',
  MLE: 'Tourism in the Maldives',
  SIN: 'Marina Bay, Singapore',
  HKG: 'Tourism in Hong Kong',
  DEL: 'Delhi',
  BOM: 'Mumbai',
  SYD: 'Sydney',
  MEX: 'Mexico City',
  YYZ: 'Toronto',
  GIG: 'Rio de Janeiro',
  BSB: 'Brasília',
  EZE: 'Buenos Aires',
  SCL: 'Santiago',
  BOG: 'Bogotá',
  LIM: 'Lima',
  PTY: 'Panama City',
  NBO: 'Nairobi',
  JNB: 'Johannesburg',
  CMN: 'Casablanca',
  RAK: 'Marrakesh',
  TUN: 'Tunis',
  ADD: 'Addis Ababa',
  ACC: 'Accra',
  LOS: 'Lagos',
  SGN: 'Ho Chi Minh City',
  HAN: 'Hanoi',
  KUL: 'Kuala Lumpur',
  MNL: 'Manila',
  PEK: 'Beijing',
  PVG: 'Shanghai',
  ICN: 'Seoul',
  MEL: 'Melbourne',
  AKL: 'Auckland',
  JED: 'Jeddah',
  RUH: 'Riyadh',
  CMB: 'Colombo',
  KTM: 'Kathmandu',
  DAC: 'Dhaka',
  HAV: 'Havana',
  PUJ: 'Punta Cana',
  SJU: 'San Juan, Puerto Rico',
  MBJ: 'Montego Bay',
  DEN: 'Denver',
  SEA: 'Seattle',
  ATL: 'Atlanta',
  BOS: 'Boston',
  IAD: 'Washington, D.C.',
  YVR: 'Vancouver',
  YUL: 'Montreal',
  ORD: 'Chicago',
  SFO: 'San Francisco',
  LPB: 'La Paz',
  VVI: 'Santa Cruz de la Sierra',
  CBB: 'Cochabamba',
  SRE: 'Sucre',
  UIO: 'Quito',
  ASU: 'Asunción',
  MVD: 'Montevideo',
  GYE: 'Guayaquil',
  CUZ: 'Cusco',
  // Mdina, not Malta: the country's article leads with its flag and Valletta's
  // with a textile, so neither is a picture of the place. Mdina's lead is a
  // photograph taken in Malta. The name "Malta" still finds this entry, through
  // `PLACE_ALIASES`.
  MLA: 'Mdina',
};

/**
 * Names that mean a destination whose article is titled for something more
 * specific than the name - a flag is not a picture of Singapore, so the
 * article is one that has a photograph, and the name still has to find it.
 * Written out, never derived.
 */
const PLACE_ALIASES: Readonly<Record<string, string>> = {
  bali: 'DPS',
  singapore: 'SIN',
  'hong kong': 'HKG',
  maldives: 'MLE',
  malta: 'MLA',
};

/** The lookup for a destination, or null when nobody has chosen one. */
export function imageryRefFor(code: string): ImageryRef | null {
  const title = ARTICLES[code.toUpperCase()];
  if (!title) return null;

  return { code: code.toUpperCase(), title, lang: LANG };
}

/**
 * The curated code for a place a person typed, or null.
 *
 * **An exact match against this file, not a search.** "barcelona" finds the
 * Barcelona entry because somebody chose that article for that name; "Barc"
 * finds nothing, and neither does a Barcelona that is not this one. The
 * place is compared with the article title up to its first comma, so
 * "Split" matches "Split, Croatia".
 */
export function imageryCodeForPlace(place: string): string | null {
  const wanted = place.trim().toLowerCase();
  if (wanted.length === 0) return null;

  const alias = PLACE_ALIASES[wanted];
  if (alias) return alias;

  for (const [code, title] of Object.entries(ARTICLES)) {
    if (title.split(',')[0]!.trim().toLowerCase() === wanted) return code;
  }

  return null;
}

/** Every destination an image can be found for. */
export function illustratedDestinations(): readonly string[] {
  return Object.keys(ARTICLES);
}
