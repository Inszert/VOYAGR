import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { resolveDestinationNames } from '@/search/destination-names';

/**
 * Where the dates are for, in words: "From Vienna (VIE) to Palermo (PMO)".
 *
 * A calendar of prices means nothing until you know which journey they price,
 * so the route sits at the head of the dates, always, and each end is a labelled
 * control that goes to the search to change it. Changing a place is a new search
 * and is not pretended to be anything lighter: the controls are links to the
 * search form, which carries everything else across.
 *
 * Names come from the same catalogue as the rest of the page. A code the
 * catalogue does not know is shown as itself, never as an invented place.
 */

export interface JourneyLineProps {
  /** Airport codes the search leaves from. */
  origins: readonly string[];
  /** Airport codes it was asked about; none means "anywhere". */
  destinations: readonly string[];
  /** The search form, with this search in it. */
  changeHref: string;
}

const AIRPORT = /^[A-Z]{3}$/;

/** Upper-case three-letter codes out of a comma or space separated value. */
export function airportCodes(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((code) => code.toUpperCase())
    .filter((code) => AIRPORT.test(code));
}

/** "Vienna (VIE)", with "+1" when the search names more than one. */
function placeLabel(codes: readonly string[], names: Record<string, string>): string {
  const first = codes[0]!;
  const name = names[first];
  const one = name && name !== first ? `${name} (${first})` : first;

  return codes.length > 1 ? `${one} +${codes.length - 1}` : one;
}

function Place({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <a
      href={href}
      className={cn(
        'border-hairline flex min-h-14 min-w-0 flex-1 flex-col justify-center rounded-(--radius-card) border px-3.5 py-2',
        'ease-standard duration-quick hover:border-border-strong transition-colors',
        'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
      )}
    >
      <span className="text-dim text-[11px] font-semibold tracking-[0.1em] uppercase">{label}</span>{' '}
      <span className="text-ink truncate text-[15px] font-medium">
        {value}
        <span className="sr-only"> - change</span>
      </span>
    </a>
  );
}

export function JourneyLine({ origins, destinations, changeHref }: JourneyLineProps) {
  if (origins.length === 0) return null;

  const names = resolveDestinationNames([...origins, ...destinations]);
  const from = placeLabel(origins, names);
  const to = destinations.length > 0 ? placeLabel(destinations, names) : 'Anywhere';

  return (
    <div
      role="group"
      aria-label={`From ${from} to ${to === 'Anywhere' ? 'anywhere' : to}`}
      className="flex items-stretch gap-2"
    >
      <Place label="From" value={from} href={changeHref} />
      <span aria-hidden="true" className="text-dim flex items-center">
        <Icon name="arrow-right" size={1} />
      </span>
      <Place label="To" value={to} href={changeHref} />
    </div>
  );
}
