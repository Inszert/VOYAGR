'use client';

import * as React from 'react';
import { Dialog } from 'radix-ui';
import { Icon } from '@/components/ui';
import { format } from '@/core/money';
import { priceDifference } from '@/core/stay/listing';
import { cn } from '@/lib/cn';
import { StayMap } from './stay-map';
import { kindLabel, type StayRow } from './stay-rows';

/**
 * The stays results: a list, and the city's map beside it.
 *
 * From 1024px the list is on the left and the map on the right, sticky at the
 * height of the window under the header. On a phone the list comes first and a
 * floating "Map" button opens the map as a full-screen sheet, with the stay
 * that is open on it in a card that can be dragged away.
 *
 * Hovering a row lights its pin; hovering or focusing a pin opens its card;
 * selecting a stay (on the map or with "Show on map") makes it the one every
 * other price is compared with. The comparison is `priceDifference` from
 * `src/core` and appears only when both prices are known: a hotel without a
 * price is never "cheaper" than one with.
 */

export interface StayExplorerProps {
  readonly rows: readonly StayRow[];
  readonly centre: { readonly latitude: number; readonly longitude: number };
  readonly area: {
    readonly south: number;
    readonly west: number;
    readonly north: number;
    readonly east: number;
  };
  readonly city: string;
  /** Where the hotel list came from: recorded in the generated file itself. */
  readonly credit: {
    readonly attribution: string;
    readonly licence: string;
    readonly retrievedAt: string;
    readonly copyrightUrl: string;
  };
  /** False when the city is not in the extract and only priced stays are shown. */
  readonly listed: boolean;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Stars as glyphs for the eye and as a word for everyone. */
function Stars({ stars }: { stars: number | null }) {
  if (stars === null) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden="true" className="text-caution-ink tracking-[0.08em]">
        {'★'.repeat(Math.floor(stars))}
      </span>
      <span>{stars}-star</span>
    </span>
  );
}

function differenceText(selected: StayRow | null, row: StayRow): string | null {
  if (!selected || selected.id === row.id) return null;
  const difference = priceDifference(selected.price, row.price);
  if (!difference) return null;
  if (difference.kind === 'same') return 'Same price as your selected stay';
  return `${format(difference.amount)} ${difference.kind} than your selected stay`;
}

/** Where an unpriced stay sends somebody to see a price. */
function CheckPrice({ row, className }: { row: StayRow; className?: string }) {
  if (!row.link || row.link.kind === 'compare') {
    return <span className={cn('text-ink-muted text-sm', className)}>No price available</span>;
  }

  return (
    <a
      href={row.link.href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        'text-accent-ink focus-visible:outline-accent-ink inline-flex min-h-11 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2',
        className,
      )}
    >
      Check price
      <span className="sr-only">
        {' '}
        for {row.name}
        {row.link.host ? ` on ${row.link.host}` : ''} (opens in a new tab)
      </span>
      <Icon name="arrow-right" size={0.9} aria-hidden="true" />
    </a>
  );
}

/** The card on a pin: what a row says, in less room. */
export function StayCardBody({ row, selected }: { row: StayRow; selected: StayRow | null }) {
  const difference = differenceText(selected, row);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-ink font-medium">{row.name}</p>
      <p className="text-ink-muted flex flex-wrap gap-x-2 text-sm">
        <Stars stars={row.stars} />
        <span>{row.distanceLabel}</span>
      </p>
      {row.priceLabel ? (
        <p className="text-ink text-sm tabular-nums">{row.priceLabel}</p>
      ) : (
        <p className="text-ink-muted text-sm">Check price for today&rsquo;s rate</p>
      )}
      {difference ? <p className="text-ink-muted text-sm tabular-nums">{difference}</p> : null}
    </div>
  );
}

function useWide(): boolean {
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

export function StayExplorer({ rows, centre, area, city, credit, listed }: StayExplorerProps) {
  const wide = useWide();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [highlightedId, setHighlightedId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => rows.find((row) => row.price)?.id ?? null,
  );
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [cardId, setCardId] = React.useState<string | null>(null);

  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const select = React.useCallback((id: string) => {
    setSelectedId(id);
    setCardId(id);
    // The list follows the map: the selected row is brought into view.
    document
      .getElementById(`stay-row-${CSS.escape(id)}`)
      ?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
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
    renderCard: (row: StayRow) => <StayCardBody row={row} selected={selected} />,
  };

  const sheetCard = rows.find((row) => row.id === (cardId ?? activeId)) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-3">
        <ol aria-label={`Places to stay in ${city}`} className="flex flex-col gap-3">
          {rows.map((row) => {
            const difference = differenceText(selected, row);
            const kind = kindLabel(row.kind);
            return (
              <li key={row.id}>
                <article
                  id={`stay-row-${row.id}`}
                  aria-labelledby={`stay-name-${row.id}`}
                  data-selected={row.id === selectedId ? 'true' : undefined}
                  onPointerEnter={() => setHighlightedId(row.id)}
                  onPointerLeave={() => setHighlightedId(null)}
                  className={cn(
                    'border-border bg-surface-raised grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-(--radius-card) border p-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:p-4',
                    'ease-standard duration-quick transition-colors',
                    row.id === selectedId || row.id === highlightedId ? 'border-border-strong' : '',
                  )}
                >
                  {row.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.photo}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full rounded-(--radius-control) object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="bg-surface-sunken text-dim grid aspect-square w-full place-items-center rounded-(--radius-control)"
                    >
                      <Icon name="bed" size={1.4} />
                    </div>
                  )}

                  <div className="flex min-w-0 flex-col gap-1">
                    <h3 id={`stay-name-${row.id}`} className="text-ink font-medium text-pretty">
                      {row.link?.kind === 'compare' ? (
                        <a
                          href={row.link.href}
                          className="focus-visible:outline-accent-ink rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {row.name}
                        </a>
                      ) : (
                        row.name
                      )}
                    </h3>
                    <p className="text-ink-muted flex flex-wrap gap-x-2 text-sm">
                      <Stars stars={row.stars} />
                      {kind ? <span>{kind}</span> : null}
                    </p>
                    {row.address ? (
                      <p className="text-dim truncate text-sm">{row.address}</p>
                    ) : null}
                    <p className="text-ink-muted text-sm tabular-nums">{row.distanceLabel}</p>
                  </div>

                  <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 sm:col-span-1 sm:col-start-2">
                    {row.priceLabel ? (
                      <p className="text-ink font-medium tabular-nums">{row.priceLabel}</p>
                    ) : (
                      <CheckPrice row={row} />
                    )}
                    {difference ? (
                      <p className="text-ink-muted text-sm tabular-nums">{difference}</p>
                    ) : null}
                    <button
                      type="button"
                      aria-pressed={row.id === selectedId}
                      onClick={() => {
                        select(row.id);
                        if (!wide) setSheetOpen(true);
                      }}
                      className="text-ink-muted hover:text-ink focus-visible:outline-accent-ink inline-flex min-h-11 items-center gap-1 rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <Icon name="pin" size={0.9} aria-hidden="true" />
                      {row.id === selectedId ? 'Selected on map' : 'Show on map'}
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
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

      {/* From 1024px: the map, sticky beside the list at the window's height. */}
      <div className="hidden lg:sticky lg:top-[72px] lg:block lg:h-[calc(100vh-72px-2rem)]">
        {wide ? (
          <StayMap
            {...mapProps}
            className="border-border relative h-full overflow-hidden rounded-(--radius-surface) border"
          />
        ) : null}
      </div>

      {/* On a phone: a floating button, and the map as a full-screen sheet. */}
      {!wide ? (
        <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="voyagr-cta fixed bottom-[calc(1.25rem+var(--consent-h,0px))] left-1/2 z-30 inline-flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-(--radius-pill) px-5 text-sm font-semibold shadow-lg lg:hidden"
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
                Each place to stay is a button on the map. Its details open below it.
              </Dialog.Description>
              <StayMap {...mapProps} renderCard={undefined} className="relative min-h-0 flex-1" />
              {sheetCard ? (
                <DraggableCard key={sheetCard.id} onDismiss={() => setCardId(null)}>
                  <StayCardBody row={sheetCard} selected={selected} />
                  <div className="mt-2 flex flex-wrap items-center gap-x-4">
                    {sheetCard.link?.kind === 'compare' ? (
                      <a
                        href={sheetCard.link.href}
                        className="text-accent-ink inline-flex min-h-11 items-center text-sm font-medium"
                      >
                        Compare rates
                      </a>
                    ) : (
                      <CheckPrice row={sheetCard} />
                    )}
                  </div>
                </DraggableCard>
              ) : null}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}

/**
 * The stay that is open on the phone map, in a card at the bottom.
 *
 * Dragged down past a threshold it goes; dragged less it springs back. The
 * drag is a convenience and never the only way: the card has its own button
 * to dismiss it, so a keyboard or a switch can do the same thing.
 */
function DraggableCard({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  const [offset, setOffset] = React.useState(0);
  const start = React.useRef<number | null>(null);
  const [dragging, setDragging] = React.useState(false);

  return (
    <div
      className={cn(
        'border-border bg-surface-raised absolute inset-x-3 bottom-3 z-10 rounded-(--radius-surface) border p-4 pt-2 shadow-lg',
        !dragging && 'ease-standard duration-quick transition-transform',
      )}
      style={{ transform: `translateY(${offset}px)` }}
    >
      <div
        aria-hidden="true"
        className="mx-auto mb-2 h-6 w-16 cursor-grab touch-none"
        onPointerDown={(event) => {
          start.current = event.clientY;
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (start.current === null) return;
          setOffset(Math.max(0, event.clientY - start.current));
        }}
        onPointerUp={() => {
          const dragged = offset;
          start.current = null;
          setDragging(false);
          setOffset(0);
          if (dragged > 80) onDismiss();
        }}
      >
        <span className="bg-border-strong mx-auto mt-2 block h-1 w-10 rounded-full" />
      </div>
      {children}
      <button
        type="button"
        onClick={onDismiss}
        className="text-ink-muted hover:text-ink absolute top-1 right-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-sm"
      >
        <span aria-hidden="true">×</span>
        <span className="sr-only">Hide this stay&rsquo;s details</span>
      </button>
    </div>
  );
}
