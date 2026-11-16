'use client';

import * as React from 'react';
import Link from 'next/link';
import { RemotePicture } from '@/components/home/remote-picture';
import { Icon } from '@/components/ui';
import { formatKilometres } from '@/core/distance';
import { THING_KINDS, type ThingKind, type ThingToDo } from '@/providers/types';
import { placeImageUrl } from '@/providers/places/image-url';
import { cn } from '@/lib/cn';
import { KIND_ICON, KIND_TINT, KIND_WORDS, sentenceCase } from './place-kinds';
import { PlacesMap } from './places-map';
import { usePlaces } from './places-context';
import { useReducedMotion as useReducedMotionOrNull } from './use-media';
import './destination.css';

/**
 * The places of "Things to do": a plan of where they are, the filter, the
 * pictured cards and, under them, the places with no photograph.
 *
 * **A card has a picture or it is not a card.** A place with no photograph is a
 * line in "More places": its name, its kind, how far it is. Never an empty
 * tile, never a generated picture standing in for a real one.
 *
 * Filtering is a link (`?kind=`) and works without JavaScript; with it, cards
 * that leave fade and shrink, and the rest glide to their new places (FLIP,
 * with the Web Animations API). Reduced motion: instant.
 */

type KindFilter = ThingKind | null;

const LEAVE_MS = 150;
const MOVE_MS = 220;
const OUT_QUART = 'cubic-bezier(0.25, 1, 0.5, 1)';

export interface ThingsExplorerProps {
  /** The address of each filter, by kind or `all`, with every other parameter carried over. */
  hrefs: Readonly<Record<string, string>>;
  /** How many places each group has, for the chips. */
  counts: Readonly<Record<ThingKind, number>>;
  /** The filter in force on arrival, already checked against `counts`. */
  initialKind: KindFilter;
  /** The most shown at once. */
  max: number;
  sample: boolean;
}

function PlaceCard({
  place,
  featured,
  leaving,
}: {
  place: ThingToDo;
  featured: boolean;
  leaving: boolean;
}) {
  const { open, hoverId, setHoverId } = usePlaces();
  const lit = hoverId === place.id;

  return (
    <li
      data-place-id={place.id}
      data-leaving={leaving ? 'true' : undefined}
      data-tint={KIND_TINT[place.kind]}
      onPointerEnter={(event) => event.pointerType === 'mouse' && setHoverId(place.id)}
      onPointerLeave={() => setHoverId(null)}
      onFocusCapture={() => setHoverId(place.id)}
      onBlurCapture={() => setHoverId(null)}
      className={cn(
        'voyagr-place-card border-border bg-surface-raised relative flex min-w-0 flex-col overflow-hidden rounded-(--radius-card) border',
        'has-[button:focus-visible]:outline-brand-500 has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2',
        lit ? 'border-ink-muted' : null,
        'max-sm:w-[68vw] max-sm:shrink-0 max-sm:snap-start',
        featured ? 'max-sm:first:w-[88vw] sm:col-span-3' : 'sm:col-span-3 lg:col-span-2',
      )}
    >
      <div
        className={cn(
          'bg-surface-sunken relative overflow-hidden',
          featured ? 'aspect-[16/10]' : 'aspect-[4/3]',
        )}
      >
        {/*
          The tile is never empty: the kind's own mark sits under the photograph, so while it
          loads - and if it never does - the card shows a neutral tile with that mark rather than
          a hole. A photograph that fails is removed, which leaves exactly that tile.
        */}
        <span
          aria-hidden="true"
          className="text-tint-ink absolute inset-0 grid place-items-center opacity-60"
        >
          <Icon name={KIND_ICON[place.kind]} size={2} />
        </span>
        {/* The name is the heading below, so the picture adds nothing a screen reader needs. */}
        <RemotePicture
          src={placeImageUrl(place.imageFile as string, 640)}
          srcSet={`${placeImageUrl(place.imageFile as string, 320)} 320w, ${placeImageUrl(place.imageFile as string, 640)} 640w, ${placeImageUrl(place.imageFile as string, 1280)} 1280w`}
          sizes={
            featured
              ? '(min-width: 1280px) 30rem, (min-width: 640px) 45vw, 88vw'
              : '(min-width: 1280px) 20rem, (min-width: 640px) 45vw, 68vw'
          }
          alt=""
          width={640}
          height={featured ? 400 : 480}
          fallback={null}
          className="voyagr-place-img absolute inset-0 size-full object-cover"
        />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="text-dim text-[11px] font-medium tracking-[0.18em] uppercase">
          {KIND_WORDS[place.kind]}
        </p>
        <h3 className="font-display text-ink text-[1.125rem] leading-snug">
          {/* The whole card is this button's target, so a tap anywhere opens the place. */}
          <button
            type="button"
            onClick={() => open(place.id)}
            className="text-left after:absolute after:inset-0 after:content-['']"
          >
            {place.name}
          </button>
        </h3>
        {place.description ? (
          <p className="text-ink-muted line-clamp-2 text-sm">{sentenceCase(place.description)}</p>
        ) : null}
        <p className="text-ink-muted text-sm tabular-nums">
          {formatKilometres(place.distanceFromCentreMetres)} from the centre
        </p>
        <span
          aria-hidden="true"
          className="voyagr-place-read text-tint-ink mt-auto flex items-center gap-1 pt-2 text-sm font-medium"
        >
          Read more <Icon name="arrow-right" size={0.9} />
        </span>
      </div>
    </li>
  );
}

export function ThingsExplorer({ hrefs, counts, initialKind, max, sample }: ThingsExplorerProps) {
  const { things, credits, centre, hoverId, setHoverId, open } = usePlaces();
  const reduced = useReducedMotionOrNull() === true;
  const [kind, setKind] = React.useState<KindFilter>(initialKind);
  const [leaving, setLeaving] = React.useState<ReadonlySet<string>>(new Set());
  const gridRef = React.useRef<HTMLUListElement>(null);
  const before = React.useRef<Map<string, DOMRect> | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const forKind = React.useCallback(
    (next: KindFilter) =>
      things.filter((thing) => next === null || thing.kind === next).slice(0, max),
    [things, max],
  );
  const shown = React.useMemo(() => forKind(kind), [forKind, kind]);
  const pictured = shown.filter((place) => place.imageFile !== null);
  const unpictured = shown.filter((place) => place.imageFile === null);

  const commit = React.useCallback((next: KindFilter) => {
    const rects = new Map<string, DOMRect>();
    gridRef.current?.querySelectorAll<HTMLElement>('[data-place-id]').forEach((element) => {
      rects.set(element.dataset.placeId as string, element.getBoundingClientRect());
    });
    before.current = rects;
    setLeaving(new Set());
    setKind(next);
  }, []);

  const choose = (next: KindFilter) => {
    if (next === kind) return;
    window.history.replaceState(window.history.state, '', hrefs[next ?? 'all']);

    if (reduced) {
      commit(next);
      return;
    }
    const staying = new Set(forKind(next).map((place) => place.id));
    const going = new Set(pictured.filter((place) => !staying.has(place.id)).map((p) => p.id));
    setLeaving(going);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), going.size > 0 ? LEAVE_MS : 0);
  };

  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // The rest move to their new places: the first-last-invert-play of FLIP.
  React.useLayoutEffect(() => {
    const first = before.current;
    before.current = null;
    if (!first || reduced || !gridRef.current) return;

    gridRef.current.querySelectorAll<HTMLElement>('[data-place-id]').forEach((element) => {
      const previous = first.get(element.dataset.placeId as string);
      const now = element.getBoundingClientRect();
      if (!element.animate) return;

      if (previous) {
        const dx = previous.left - now.left;
        const dy = previous.top - now.top;
        if (dx === 0 && dy === 0) return;
        element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          duration: MOVE_MS,
          easing: OUT_QUART,
        });
      } else {
        element.animate(
          [
            { opacity: 0, transform: 'scale(0.96)' },
            { opacity: 1, transform: 'none' },
          ],
          {
            duration: MOVE_MS,
            easing: OUT_QUART,
          },
        );
      }
    });
  }, [kind, reduced]);

  const creditsFor = pictured.filter((place) => place.imageFile);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-ink-muted text-sm tabular-nums">
        {shown.length} {shown.length === 1 ? 'place' : 'places'}
        {sample ? ' - samples for demonstration, not real places' : null}
      </p>

      <PlacesMap
        places={shown}
        centre={centre}
        activeId={hoverId}
        onActive={setHoverId}
        onSelect={open}
        className="h-auto w-full"
      />

      <nav aria-label="Filter things to do by kind">
        <ul className="flex flex-wrap gap-2">
          {[null, ...THING_KINDS.filter((group) => counts[group] > 0)].map((group) => {
            const current = group === kind;

            return (
              <li key={group ?? 'all'}>
                <Link
                  href={hrefs[group ?? 'all'] ?? '#'}
                  scroll={false}
                  aria-current={current ? 'true' : undefined}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                      return;
                    event.preventDefault();
                    choose(group);
                  }}
                  className={cn(
                    'ease-standard duration-quick inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors active:scale-[0.97] motion-reduce:active:scale-100',
                    current
                      ? 'bg-ink text-surface font-medium'
                      : 'border-border text-ink hover:bg-surface-sunken border',
                  )}
                >
                  {group === null ? 'All' : KIND_WORDS[group]}
                  {group !== null ? (
                    <span className="ml-1.5 tabular-nums opacity-70">
                      {Math.min(counts[group], max)}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {pictured.length > 0 ? (
        <ul ref={gridRef} className="voyagr-rail flex items-start gap-3 sm:grid sm:auto-rows-auto sm:grid-cols-6 sm:items-stretch sm:gap-4">
          {pictured.map((place, position) => (
            <PlaceCard
              key={place.id}
              place={place}
              featured={position < 2}
              leaving={leaving.has(place.id)}
            />
          ))}
        </ul>
      ) : null}

      {unpictured.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-ink text-sm font-semibold">
            {pictured.length > 0 ? 'More places' : 'Places'}
          </h3>
          <ul className="border-border divide-border divide-y border-y">
            {unpictured.map((place) => (
              <li
                key={place.id}
                data-tint={KIND_TINT[place.kind]}
                onPointerEnter={(event) => event.pointerType === 'mouse' && setHoverId(place.id)}
                onPointerLeave={() => setHoverId(null)}
              >
                <button
                  type="button"
                  onClick={() => open(place.id)}
                  onFocus={() => setHoverId(place.id)}
                  onBlur={() => setHoverId(null)}
                  className="hover:bg-surface-sunken flex min-h-11 w-full items-center gap-3 px-1 py-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="bg-tint/25 text-tint-ink grid size-8 shrink-0 place-items-center rounded-full"
                  >
                    <Icon name={KIND_ICON[place.kind]} size={0.95} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink block truncate text-sm font-medium">
                      {place.name}
                    </span>
                    <span className="text-dim block text-xs">{KIND_WORDS[place.kind]}</span>
                  </span>
                  <span className="text-ink-muted shrink-0 text-sm tabular-nums">
                    {formatKilometres(place.distanceFromCentreMetres)}
                    <span className="sr-only"> from the centre</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-dim text-xs">
        Places from Wikidata (CC0); photographs from Wikimedia Commons, credited below.
      </p>

      {creditsFor.length > 0 ? (
        <details className="text-ink-muted text-sm">
          <summary className="text-ink min-h-11 w-fit cursor-pointer py-2 text-sm font-medium">
            Photograph credits
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {creditsFor.map((place) => {
              const file = place.imageFile as string;
              const credit = credits[file];

              return (
                <li key={place.id}>
                  <span className="text-ink">{place.name}</span>:{' '}
                  {credit?.author ?? 'author not stated'}, {credit?.licence ?? 'licence not stated'}
                  .{' '}
                  <a
                    href={
                      credit?.pageUrl ??
                      `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`
                    }
                    target="_blank"
                    rel="noopener"
                    className="text-tint-ink inline-flex min-h-6 items-center underline underline-offset-4"
                  >
                    File page <span className="sr-only">for {place.name} (opens in a new tab)</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
