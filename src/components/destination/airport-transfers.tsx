import type { PartnerOffer } from '@/booking/partners';
import { PartnerOfferRow } from '@/components/partners';
import { Icon, type IconName } from '@/components/ui';
import { formatKilometres } from '@/core/distance';
import { format } from '@/core/money';
import { travellersLabel } from '@/core/party';
import type { TransferOffer } from '@/core/trip/types';
import { compareTransfers, type TransferRow } from '@/discovery/transfer-compare';
import type { Tint } from '@/lib/tint';
import './destination.css';

/**
 * "Getting in from the airport": one comparison, not four boxes.
 *
 * Each way in is a row with its journey time as a bar on a **shared scale**, so
 * the fastest is visibly the shortest, and its price per person and for the
 * party, each way. The cheapest and the fastest are named in words. Above it, a
 * plain route: airport, the straight-line distance from `src/core`, city centre.
 *
 * Every figure is the transfer provider's, or a share of it from `src/core`.
 * Production has no transfer provider yet: the section then shows the route,
 * the distance and the partner link, says plainly that there are no prices, and
 * invents none - and the trip total counts the transfer as an excluded cost,
 * not a zero.
 */

const MODE_WORDS: Record<TransferOffer['mode'], string> = {
  public: 'Public transport',
  shared: 'Shared shuttle',
  taxi: 'Taxi',
  private: 'Private transfer',
  walk: 'Walk',
};

const MODE_ICON: Record<TransferOffer['mode'], IconName> = {
  public: 'train',
  shared: 'bus',
  taxi: 'car',
  private: 'car',
  walk: 'pin',
};

const MODE_TINT: Record<TransferOffer['mode'], Tint> = {
  public: 'sage',
  shared: 'harbour',
  taxi: 'sand',
  private: 'clay',
  walk: 'leather',
};

function RouteDiagram({
  airport,
  city,
  metres,
}: {
  airport: string;
  city: string;
  metres: number | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <p className="text-ink flex shrink-0 items-center gap-2 text-sm font-medium">
        <Icon name="plane" size={1} className="text-tint-ink" aria-hidden="true" />
        <span>
          <span className="sr-only">Airport </span>
          {airport}
        </span>
      </p>
      <div aria-hidden="true" className="relative flex min-w-8 flex-1 items-center">
        <span className="border-border-strong w-full border-t border-dashed" />
        {metres !== null ? (
          <span className="bg-surface text-ink-muted absolute left-1/2 -translate-x-1/2 px-2 text-xs whitespace-nowrap tabular-nums">
            {formatKilometres(metres)}
          </span>
        ) : null}
      </div>
      <p className="text-ink flex shrink-0 items-center gap-2 text-sm font-medium">
        {city} centre
        <Icon name="pin" size={1} className="text-tint-ink" aria-hidden="true" />
      </p>
    </div>
  );
}

function Row({
  row,
  travellers,
  partner,
}: {
  row: TransferRow;
  travellers: number;
  partner: PartnerOffer | null;
}) {
  const { offer } = row;

  return (
    <li
      data-tint={MODE_TINT[offer.mode]}
      className="border-border grid gap-x-6 gap-y-3 border-b py-5 last:border-b-0 md:grid-cols-[11rem_minmax(0,1fr)_11rem] md:items-center"
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-ink flex items-center gap-2.5 text-sm font-medium">
          <span
            aria-hidden="true"
            className="bg-tint/25 text-tint-ink grid size-9 shrink-0 place-items-center rounded-full"
          >
            <Icon name={MODE_ICON[offer.mode]} size={1} />
          </span>
          {MODE_WORDS[offer.mode]}
        </p>
        {row.cheapest || row.fastest ? (
          <p className="flex flex-wrap gap-1.5">
            {row.cheapest ? (
              <span className="border-positive-500/30 bg-positive-500/10 text-positive-ink rounded-full border px-2 py-0.5 text-[11px] font-medium">
                Cheapest
              </span>
            ) : null}
            {row.fastest ? (
              <span className="border-border-strong text-ink rounded-full border px-2 py-0.5 text-[11px] font-medium">
                Fastest
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-ink text-sm tabular-nums">about {offer.durationMinutes} minutes</p>
        <div
          aria-hidden="true"
          className="bg-surface-sunken h-2.5 w-full overflow-hidden rounded-full"
        >
          <div
            className="voyagr-bar bg-tint h-full rounded-full"
            style={{ width: `${Math.round(row.barShare * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col md:items-end md:text-right">
        <p className="text-ink text-xl font-semibold tabular-nums">
          {format(row.each)}
          <span className="text-ink-muted text-sm font-normal"> per person</span>
        </p>
        <p className="text-ink-muted text-sm tabular-nums">
          {format(row.party)} for {travellersLabel(travellers)}, each way
        </p>
      </div>

      {offer.mode === 'private' && partner ? (
        <div className="md:col-span-3">
          <PartnerOfferRow offer={partner} />
        </div>
      ) : null}
    </li>
  );
}

export function AirportTransfers({
  offers,
  travellers,
  airport,
  city,
  distanceMetres,
  partner,
}: {
  offers: readonly TransferOffer[];
  travellers: number;
  /** The airport's IATA code. */
  airport: string;
  city: string;
  /** Straight-line metres from the airport to the centre, from core; null when unknown. */
  distanceMetres: number | null;
  /** The transfer partner, or null when there is none. */
  partner: PartnerOffer | null;
}) {
  const comparison = compareTransfers(offers, travellers);
  const hasPrivateRow = comparison?.rows.some((row) => row.offer.mode === 'private') ?? false;

  return (
    <section
      id="getting-there"
      aria-labelledby="transfers-heading"
      className="voyagr-anchor flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1">
        <p className="text-dim text-[11px] font-medium tracking-[0.18em] uppercase">Arrival</p>
        <h2 id="transfers-heading" className="font-display text-display-sm text-ink">
          Getting in from the airport
        </h2>
        <p className="text-ink-muted max-w-2xl text-sm">
          {comparison
            ? 'Priced each way, for the whole party and per person. A trip total in a search counts both directions - this is the half of it you would pay on arrival.'
            : 'We have no priced transfers for this airport yet, so none are shown. A trip total leaves the transfer out and says so, rather than counting it as free.'}
        </p>
      </div>

      <RouteDiagram airport={airport} city={city} metres={distanceMetres} />
      {distanceMetres !== null ? (
        <p className="text-dim -mt-3 text-xs">The distance is in a straight line, not by road.</p>
      ) : null}

      {comparison ? (
        <ul className="border-border border-y">
          {comparison.rows.map((row) => (
            <Row key={row.offer.id} row={row} travellers={travellers} partner={partner} />
          ))}
        </ul>
      ) : null}

      {partner && !hasPrivateRow ? (
        <div className="border-border border-t pt-4">
          <PartnerOfferRow offer={partner} />
        </div>
      ) : null}
    </section>
  );
}
