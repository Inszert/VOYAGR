'use client';

import * as React from 'react';
import { Dialog } from 'radix-ui';
import { Icon } from '@/components/ui';
import type { SnapshotStatus } from '@/liteapi-snapshot/read';
import { SnapshotStatusLine } from './snapshot-status';
import { StayMap } from './stay-map';
import { StayResultRow } from './stay-result-row';
import type { StayRow } from './stay-rows';

/**
 * The stays results step: the h1, how fresh the prices are, the list and the
 * city's map beside it.
 *
 * Priced rows come first (in the order the rows arrive, which is cheapest
 * first), then the places we only list. Nothing here computes a figure or
 * decides which row is cheapest: `cheapestId` is handed down. From 1024px the
 * map is a sticky column; on a phone a "Map" button opens it in a dialog.
 */

export interface StayResultsProps {
  readonly rows: readonly StayRow[];
  readonly nights: number;
  readonly city: string;
  readonly centre: { readonly latitude: number; readonly longitude: number };
  readonly area: {
    readonly south: number;
    readonly west: number;
    readonly north: number;
    readonly east: number;
  };
  /** The snapshot's status; its words come from `stalenessLine`. */
  readonly status: SnapshotStatus | null;
  /** The row `buildStayRows` marked cheapest, if any. */
  readonly cheapestId?: string | null;
  readonly credit: {
    readonly attribution: string;
    readonly licence: string;
    readonly retrievedAt: string;
    readonly copyrightUrl: string;
  };
  /** False when the city is not in the extract and only priced stays are shown. */
  readonly listed: boolean;
}

function useWide(): boolean {
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

/** What opens when a pin is focused: the row, in less room. */
function PinCard({ row }: { row: StayRow }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-ink font-medium">{row.name}</p>
      <p className="text-ink-muted text-sm">
        {row.stars !== null ? `${row.stars}-star · ` : ''}
        {row.distanceLabel}
      </p>
      <p className="text-ink text-sm tabular-nums">{row.priceLabel ?? 'No stored price'}</p>
    </div>
  );
}

function ShowOnMap({
  row,
  selected,
  onClick,
}: {
  row: StayRow;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="text-ink-muted hover:text-ink focus-visible:outline-accent-ink inline-flex min-h-11 items-center gap-1 rounded-sm px-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <Icon name="pin" size={0.9} aria-hidden="true" />
      {selected ? 'Selected on map' : 'Show on map'}
      <span className="sr-only"> {row.name}</span>
    </button>
  );
}

export function StayResults({
  rows,
  nights,
  city,
  centre,
  area,
  status,
  cheapestId = null,
  credit,
  listed,
}: StayResultsProps) {
  const wide = useWide();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [highlightedId, setHighlightedId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const priced = rows.filter((row) => row.price);
  const unpriced = rows.filter((row) => !row.price);
  const sandbox = status?.testPrices === true;

  const select = React.useCallback((id: string) => {
    setSelectedId(id);
    document.getElementById(`stay-row-${CSS.escape(id)}`)?.scrollIntoView({ block: 'nearest' });
  }, []);

  const mapProps = {
    rows,
    centre,
    area,
    city,
    activeId,
    highlightedId,
    selectedId,
    onActivate: setActiveId,
    onSelect: select,
  };

  const item = (row: StayRow) => (
    <li
      key={row.id}
      id={`stay-row-${row.id}`}
      onPointerEnter={() => setHighlightedId(row.id)}
      onPointerLeave={() => setHighlightedId(null)}
      className="flex flex-col"
    >
      <StayResultRow
        row={row}
        hotelHref={row.link?.kind === 'compare' ? row.link.href : `#stay-row-${row.id}`}
        sandbox={sandbox}
        cheapest={row.id === cheapestId}
        selected={row.id === selectedId}
      />
      <ShowOnMap
        row={row}
        selected={row.id === selectedId}
        onClick={() => {
          select(row.id);
          if (!wide) setSheetOpen(true);
        }}
      />
    </li>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-ink font-display text-display-sm">
            {rows.length} places for {nights} nights in {city}
          </h1>
          {status ? <SnapshotStatusLine status={status} /> : null}
        </div>

        {priced.length > 0 ? (
          <ol aria-label={`Priced places to stay in ${city}`} className="flex flex-col gap-3">
            {priced.map(item)}
          </ol>
        ) : null}

        {unpriced.length > 0 ? (
          <section aria-labelledby="stays-unpriced" className="flex flex-col gap-3">
            <h2 id="stays-unpriced" className="text-ink text-base font-medium">
              No stored price
            </h2>
            <ol
              aria-label={`Places to stay in ${city} without a stored price`}
              className="flex flex-col gap-3"
            >
              {unpriced.map(item)}
            </ol>
          </section>
        ) : null}

        <p className="text-dim text-xs">
          {listed ? (
            <>
              Hotel list from{' '}
              <a
                href={credit.copyrightUrl}
                className="underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                {credit.attribution}
              </a>{' '}
              ({credit.licence}), extracted {credit.retrievedAt}. Hotels open and close, so a listed
              place may have changed since.{' '}
            </>
          ) : null}
          A price appears only where a provider quoted one; the rest open a search on the
          partner&rsquo;s site.
        </p>
      </div>

      {/* From 1024px: the map, sticky beside the list. */}
      <div className="hidden lg:sticky lg:top-[72px] lg:block lg:h-[calc(100vh-72px-2rem)]">
        {wide ? (
          <StayMap
            {...mapProps}
            renderCard={(row) => <PinCard row={row} />}
            className="border-border relative h-full overflow-hidden rounded-(--radius-surface) border"
          />
        ) : null}
      </div>

      {/* On a phone: a Map button, and the map in a dialog. */}
      {!wide ? (
        <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="voyagr-cta fixed bottom-[calc(1.25rem+var(--consent-h,0px))] left-1/2 z-30 inline-flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-(--radius-pill) px-5 text-sm font-semibold shadow-lg"
            >
              <Icon name="map" size={1} aria-hidden="true" />
              Map
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Content className="bg-surface fixed inset-0 z-50 flex flex-col">
              <div className="border-border flex items-center justify-between border-b px-4 py-2">
                <Dialog.Title className="text-ink font-medium">
                  Places to stay in {city}
                </Dialog.Title>
                <Dialog.Close className="text-ink focus-visible:outline-accent-ink inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm focus-visible:outline-2">
                  Close
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">
                Each place to stay is a button on the map. Its details open beside it.
              </Dialog.Description>
              <StayMap
                {...mapProps}
                renderCard={(row) => <PinCard row={row} />}
                className="relative min-h-0 flex-1"
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
