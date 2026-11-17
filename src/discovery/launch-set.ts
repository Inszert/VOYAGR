/**
 * The launch set: the places the owner's themed collections name.
 *
 * It lives here, below both `snapshot.ts` and `cache/targets.ts`, so the discovery search can put
 * these places first without importing the worker's target list (which imports the snapshot).
 *
 * Themed collections, as airport codes. Narrowed to the places the catalogue can actually put on
 * the globe when a target is built: a code it does not know is dropped, never invented a place for.
 */
export const COLLECTIONS: Readonly<Record<string, readonly string[]>> = {
  'beach-escapes': ['AYT', 'PMI', 'FAO', 'HER', 'SPU', 'DBV', 'IBZ', 'NCE', 'CTA', 'MLA'],
  'city-breaks': ['LIS', 'BCN', 'PRG', 'BUD', 'ROM', 'VIE', 'CPH', 'KRK', 'ATH', 'AMS'],
  'winter-sun': ['TFS', 'LPA', 'ACE', 'FUE', 'SSH', 'HRG', 'DXB', 'AGA'],
};

/** Every code in every collection, once, in collection order. */
export const LAUNCH_SET: readonly string[] = [...new Set(Object.values(COLLECTIONS).flat())];

/**
 * `codes` with the launch set first.
 *
 * The discovery search keeps the first `maxDestinations` places it is given, so the order decides
 * which places a round prices. Only places in `codes` are kept; nothing is invented.
 */
export function launchSetFirst(codes: readonly string[]): string[] {
  const present = new Set(codes);
  const first = LAUNCH_SET.filter((code) => present.has(code));
  const rest = codes.filter((code) => !LAUNCH_SET.includes(code));
  return [...first, ...rest];
}
