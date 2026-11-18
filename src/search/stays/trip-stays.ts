/**
 * The hand-over between a trip and the stays step.
 *
 * The chosen flight rides in the query string, as words, together with the
 * address of the trip it came from. The stays page shows it and links back; it
 * carries no price, so there is nothing here to add up. Everything read back is
 * untrusted (anyone can edit a URL): the text is bounded and the return address
 * must be a path on our own explorer.
 */

export interface TripCarryInput {
  readonly destinationName: string;
  readonly destinationCode: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly currency: string;
  /** "Out 09:30 — 12:15 · 2h 45m · Direct". */
  readonly flightOut: string;
  readonly flightBack: string;
  /** The explorer address of the trip, so the way back restores it. */
  readonly tripHref: string;
}

export interface TripCarry {
  readonly flightOut: string;
  readonly flightBack: string;
  readonly tripHref: string;
}

const MAX_TEXT = 160;
const MAX_HREF = 2000;

/** A path on our own explorer, and nothing else (no scheme, no host, no protocol-relative). */
export function isExploreHref(value: string): boolean {
  if (value.length === 0 || value.length > MAX_HREF) return false;
  if (value !== '/explore' && !value.startsWith('/explore?')) return false;
  return !/[\\s]/.test(value);
}

export function tripStaysHref(input: TripCarryInput): string {
  const params = new URLSearchParams({
    destination: input.destinationName,
    destinationCode: input.destinationCode,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: String(input.adults),
    currency: input.currency,
    dates: 'confirmed',
    flightOut: input.flightOut,
    flightBack: input.flightBack,
    tripHref: input.tripHref,
  });
  return `/stays?${params.toString()}`;
}

export function parseTripCarry(
  params: Readonly<Record<string, string | undefined>>,
): TripCarry | null {
  const flightOut = (params.flightOut ?? '').trim().slice(0, MAX_TEXT);
  const tripHref = params.tripHref ?? '';
  if (flightOut === '' || !isExploreHref(tripHref)) return null;
  return { flightOut, flightBack: (params.flightBack ?? '').trim().slice(0, MAX_TEXT), tripHref };
}
