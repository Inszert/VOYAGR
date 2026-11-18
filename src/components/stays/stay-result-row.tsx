import type { StayRow } from './stay-rows';

/**
 * One row of the stays list. Every figure arrives formatted on the row; this
 * component words and arranges it and computes nothing a user reads. The
 * amount payable at the hotel is kept on its own line and never joins the
 * headline price.
 */

export interface StayResultRowProps {
  readonly row: StayRow;
  /** Our page for this hotel. */
  readonly hotelHref: string;
  /** Guest rating out of ten as a provider stated it; null when nobody did. */
  readonly guestRating?: { readonly outOfTen: number; readonly reviewCount: number | null } | null;
  /** True when the price comes from a sandbox, not a live market. */
  readonly sandbox?: boolean;
  readonly cheapest?: boolean;
  readonly selected?: boolean;
}

/** A rating said in words, so the number is never the only signal. */
export function ratingWord(outOfTen: number): string {
  if (outOfTen >= 9) return 'Exceptional';
  if (outOfTen >= 8) return 'Very good';
  if (outOfTen >= 7) return 'Good';
  if (outOfTen >= 6) return 'Pleasant';
  return 'Fair';
}

const PAYABLE_PREFIX = 'Payable at the hotel';

export function StayResultRow({
  row,
  hotelHref,
  guestRating = null,
  sandbox = false,
  cheapest = false,
  selected = false,
}: StayResultRowProps) {
  const payable = row.rate?.taxLines.find((line) => line.startsWith(PAYABLE_PREFIX)) ?? null;
  const otherTaxLines = row.rate?.taxLines.filter((line) => line !== payable) ?? [];
  const outbound = row.link && row.link.kind !== 'compare' ? row.link : null;

  return (
    <article
      aria-current={selected ? 'true' : undefined}
      className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-muted flex flex-wrap gap-x-2 text-xs">
          {selected ? <span className="font-semibold">Selected</span> : null}
          {cheapest ? <span className="font-semibold">Cheapest</span> : null}
        </p>
        <h3 className="text-text font-display text-lg leading-tight">{row.name}</h3>
        <p className="text-muted mt-1 text-sm">
          {row.stars !== null ? `${row.stars}-star` : 'Stars not stated'}
          {' · '}
          {guestRating
            ? `${ratingWord(guestRating.outOfTen)}, ${guestRating.outOfTen.toFixed(1)} out of 10`
            : 'No guest rating'}
        </p>
        <p className="text-muted text-sm">{row.address ?? row.distanceLabel}</p>
        {row.rate ? (
          <ul className="text-text mt-2 text-sm">
            {row.rate.room ? <li>{row.rate.room}</li> : null}
            <li>{row.rate.board}</li>
            <li>{row.rate.cancellation}</li>
            {otherTaxLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
        {row.price && row.priceLabel ? (
          <>
            <p className="text-text text-lg font-semibold tabular-nums">{row.priceLabel}</p>
            {sandbox ? <p className="text-muted text-xs font-semibold">Test price</p> : null}
            {payable ? <p className="text-muted text-sm">{payable}</p> : null}
          </>
        ) : (
          <p className="text-muted text-sm">No stored price</p>
        )}
        {outbound ? (
          <a
            href={outbound.href}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="text-accent-ink inline-flex min-h-11 items-center underline"
          >
            See price on {outbound.host ?? 'the partner site'} (opens in a new tab)
          </a>
        ) : null}
        <a href={hotelHref} className="text-accent-ink inline-flex min-h-11 items-center underline">
          View {row.name}
        </a>
      </div>
    </article>
  );
}
