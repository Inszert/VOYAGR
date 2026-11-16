'use client';

import * as React from 'react';
import { formatKilometres } from '@/core/distance';
import type { ThingToDo } from '@/providers/types';

/**
 * The places, placed: a plan of the city around its centre.
 *
 * Drawn from our own data and nothing else - no tiles, no request. The only
 * geography we hold at city scale is the places themselves (the globe's own
 * tiles stop at about ten kilometres a pixel), so this is a plan rather than a
 * street map: the centre, rings at round distances, and a dot per place at its
 * true bearing and distance. The cards beside it are the accessible version of
 * every fact here, which is why the plan hides from assistive technology and
 * its dots are not focusable: a focused card rings its dot instead.
 *
 * Positions are for drawing only. A distance that is shown in words comes from
 * `src/core/distance`.
 */

const WIDTH = 640;
const HEIGHT = 280;
const PAD = 36;
const RING_STEPS_METRES = [250, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000];

const METRES_PER_DEGREE_LAT = 110_574;
const METRES_PER_DEGREE_LON = 111_320;

interface Placed {
  readonly place: ThingToDo;
  readonly x: number;
  readonly y: number;
}

/** Offsets in metres east and north of the centre, good enough to draw a city. */
function offsets(centre: readonly [number, number], place: ThingToDo) {
  const [lon0, lat0] = centre;

  return {
    east: (place.longitude - lon0) * METRES_PER_DEGREE_LON * Math.cos((lat0 * Math.PI) / 180),
    north: (place.latitude - lat0) * METRES_PER_DEGREE_LAT,
  };
}

export function layoutPlaces(
  places: readonly ThingToDo[],
  centre: readonly [number, number],
  focusId: string | null = null,
): { placed: Placed[]; pixelsPerMetre: number; rings: { radius: number; label: string }[] } {
  const raw = places.map((place) => ({ place, ...offsets(centre, place) }));
  /*
   * What the plan has to fit. For the sheet's locator: the centre and the one
   * place, with room. For the list: the places that most of them are inside -
   * the nearest 85% - because one outlier ten kilometres out would shrink every
   * other dot into a corner. A place beyond the edge is clipped, and its card
   * and its sheet still say how far away it is.
   */
  const focus = focusId ? raw.find((item) => item.place.id === focusId) : undefined;
  const fitted = focus
    ? [focus]
    : [...raw]
        .sort((a, b) => Math.hypot(a.east, a.north) - Math.hypot(b.east, b.north))
        .slice(0, Math.max(1, Math.ceil(raw.length * 0.85)));
  const margin = focus ? 1.35 : 1.05;
  const reachX = Math.max(300, ...fitted.map((item) => Math.abs(item.east) * margin));
  const reachY = Math.max(300, ...fitted.map((item) => Math.abs(item.north) * margin));
  const pixelsPerMetre = Math.min((WIDTH / 2 - PAD) / reachX, (HEIGHT / 2 - PAD) / reachY);

  const placed = raw.map((item) => ({
    place: item.place,
    x: WIDTH / 2 + item.east * pixelsPerMetre,
    y: HEIGHT / 2 - item.north * pixelsPerMetre,
  }));

  // Rings that fit inside the plan, at most three, at round distances.
  const fitting = RING_STEPS_METRES.filter(
    (metres) => metres * pixelsPerMetre <= HEIGHT / 2 - 8 && metres * pixelsPerMetre >= 28,
  ).slice(-3);
  const rings = fitting.map((metres) => ({
    radius: metres * pixelsPerMetre,
    label: formatKilometres(metres),
  }));

  return { placed, pixelsPerMetre, rings };
}

export interface PlacesMapProps {
  places: readonly ThingToDo[];
  /** `[longitude, latitude]` of the city's centre. */
  centre: readonly [number, number];
  /** The place a card is hovering or focusing: its dot is ringed. */
  activeId?: string | null;
  onActive?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  /** The sheet's locator: this place is drawn large, the rest as faint dots. */
  focusId?: string | null;
  className?: string;
}

export function PlacesMap({
  places,
  centre,
  activeId = null,
  onActive,
  onSelect,
  focusId = null,
  className,
}: PlacesMapProps) {
  const { placed, rings } = React.useMemo(
    () => layoutPlaces(places, centre, focusId),
    [places, centre, focusId],
  );

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      focusable="false"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={WIDTH} height={HEIGHT} className="fill-surface-sunken" rx="14" />

      {rings.map((ring) => (
        <g key={ring.label}>
          <circle
            cx={WIDTH / 2}
            cy={HEIGHT / 2}
            r={ring.radius}
            className="stroke-border-strong fill-none"
            strokeDasharray="2 5"
          />
          <text
            x={WIDTH / 2 + ring.radius * 0.7071 + 4}
            y={HEIGHT / 2 - ring.radius * 0.7071 - 2}
            className="fill-dim text-[15px] tabular-nums"
          >
            {ring.label}
          </text>
        </g>
      ))}

      {/* The centre. */}
      <g transform={`translate(${WIDTH / 2} ${HEIGHT / 2})`}>
        <path d="M-6 0H6M0 -6V6" className="stroke-ink-muted" strokeWidth="1.5" />
        <text x="9" y="14" className="fill-ink-muted text-[15px]">
          Centre
        </text>
      </g>

      {placed.map(({ place, x, y }) => {
        const active = place.id === activeId || place.id === focusId;
        const faint = focusId !== null && place.id !== focusId;

        return (
          <g
            key={place.id}
            onPointerEnter={onActive ? () => onActive(place.id) : undefined}
            onPointerLeave={onActive ? () => onActive(null) : undefined}
            onClick={onSelect ? () => onSelect(place.id) : undefined}
            className={onSelect ? 'cursor-pointer' : undefined}
          >
            {/* A generous invisible target so a dot is easy to hit with a mouse. */}
            <circle cx={x} cy={y} r="12" fill="transparent" />
            {active ? (
              <circle cx={x} cy={y} r="11" className="stroke-ink fill-none" strokeWidth="2" />
            ) : null}
            <circle
              cx={x}
              cy={y}
              r={active ? 6 : 4.5}
              className="voyagr-dot fill-brand-ink stroke-surface"
              strokeWidth="1.5"
              opacity={faint ? 0.35 : 1}
            />
          </g>
        );
      })}
    </svg>
  );
}
