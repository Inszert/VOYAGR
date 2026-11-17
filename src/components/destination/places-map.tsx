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
/** The plan itself. The legend band sits below it, outside the maths. */
const HEIGHT = 280;
const LEGEND_HEIGHT = 80;
/** Dot radius runs from the least to the most covered place on the plan. */
const DOT_MIN = 3.5;
const DOT_MAX = 7;
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

/**
 * A dot's radius from its sitelink count (how many Wikipedia editions cover the
 * place), scaled across the places on the plan. Drawing only: the count itself is
 * the source's, and equal counts - or one place - get the middle size.
 */
export function dotRadius(notability: number, lowest: number, highest: number): number {
  if (highest <= lowest) return (DOT_MIN + DOT_MAX) / 2;
  const share = (Math.min(Math.max(notability, lowest), highest) - lowest) / (highest - lowest);

  return DOT_MIN + (DOT_MAX - DOT_MIN) * share;
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
  const counts = places.map((place) => place.notability);
  const lowest = Math.min(...counts);
  const highest = Math.max(...counts);
  const legend = focusId === null;
  const height = legend ? HEIGHT + LEGEND_HEIGHT : HEIGHT;
  const activePlace = placed.find(({ place }) => place.id === activeId && focusId === null);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      aria-hidden="true"
      focusable="false"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={WIDTH} height={height} className="fill-surface-sunken" rx="14" />
      {legend ? (
        <line x1="0" x2={WIDTH} y1={HEIGHT} y2={HEIGHT} className="stroke-border" strokeWidth="1" />
      ) : null}

      {/* The two axes through the centre: a plan needs a way to read bearing. */}
      <path
        d={`M${WIDTH / 2} 14V${HEIGHT - 14}M14 ${HEIGHT / 2}H${WIDTH - 14}`}
        className="stroke-border"
        strokeWidth="1"
      />
      {legend ? (
        <text
          x={WIDTH - 22}
          y="28"
          textAnchor="middle"
          className="fill-dim text-[13px] font-medium"
        >
          N
        </text>
      ) : null}

      {rings.map((ring) => (
        <g key={ring.label}>
          <circle
            cx={WIDTH / 2}
            cy={HEIGHT / 2}
            r={ring.radius}
            className="stroke-border-strong fill-none"
            strokeWidth="1.25"
            strokeDasharray="3 5"
          />
          <Pill
            x={WIDTH / 2 + ring.radius * 0.7071}
            y={HEIGHT / 2 - ring.radius * 0.7071}
            text={`${ring.label} from centre`}
            className="fill-ink-muted"
          />
        </g>
      ))}

      {/* A line from the centre to the place a card points at, so distance is visible. */}
      {activePlace ? (
        <line
          x1={WIDTH / 2}
          y1={HEIGHT / 2}
          x2={activePlace.x}
          y2={activePlace.y}
          className="stroke-ink"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          data-place-line=""
        />
      ) : null}

      {/* The centre, named. */}
      <g transform={`translate(${WIDTH / 2} ${HEIGHT / 2})`}>
        <circle r="10" className="stroke-ink fill-surface-sunken" strokeWidth="2" />
        <circle r="3.5" className="fill-ink" />
      </g>
      <Pill x={WIDTH / 2 + 14} y={HEIGHT / 2 + 22} text="City centre" className="fill-ink" strong />

      {placed.map(({ place, x, y }) => {
        const active = place.id === activeId || place.id === focusId;
        const faint = focusId !== null && place.id !== focusId;
        const dim = activePlace !== undefined && !active;
        const radius = focusId !== null ? 4.5 : dotRadius(place.notability, lowest, highest);

        return (
          <g
            key={place.id}
            data-place-dot={place.id}
            onPointerEnter={onActive ? () => onActive(place.id) : undefined}
            onPointerLeave={onActive ? () => onActive(null) : undefined}
            onClick={onSelect ? () => onSelect(place.id) : undefined}
            className={onSelect ? 'cursor-pointer' : undefined}
          >
            {/* A generous invisible target so a dot is easy to hit with a mouse. */}
            <circle cx={x} cy={y} r="12" fill="transparent" />
            {active ? (
              <>
                <circle cx={x} cy={y} r={radius + 9} className="fill-brand-ink" opacity="0.18" />
                <circle
                  cx={x}
                  cy={y}
                  r={radius + 5}
                  className="stroke-ink fill-none"
                  strokeWidth="2.5"
                />
              </>
            ) : null}
            <circle
              cx={x}
              cy={y}
              r={active ? radius + 1.5 : radius}
              className="voyagr-dot fill-brand-ink stroke-surface"
              strokeWidth="1.5"
              opacity={faint ? 0.35 : dim ? 0.4 : 1}
            />
          </g>
        );
      })}

      {/* The name of the place a card or a dot is pointing at, drawn last so nothing covers it. */}
      {activePlace ? (
        <>
          <Pill
            x={activePlace.x}
            y={activePlace.y - 22}
            text={activePlace.place.name}
            className="fill-ink"
            strong
            centred
            data-place-label=""
          />
          <Pill
            x={activePlace.x}
            y={activePlace.y + 28}
            text={`${formatKilometres(activePlace.place.distanceFromCentreMetres)} from centre`}
            className="fill-ink-muted"
            centred
            data-place-distance=""
          />
        </>
      ) : null}

      {legend ? (
        <g className="fill-ink-muted text-[14px]" data-legend="">
          <circle cx="22" cy={HEIGHT + 17} r={DOT_MIN} className="fill-brand-ink" />
          <circle cx="36" cy={HEIGHT + 17} r={DOT_MAX} className="fill-brand-ink" />
          <text x="52" y={HEIGHT + 22}>
            Each dot is a place. Bigger means more Wikipedia languages cover it.
          </text>
          <circle
            cx="29"
            cy={HEIGHT + 40}
            r="7"
            className="stroke-border-strong fill-none"
            strokeDasharray="2 3"
          />
          <text x="52" y={HEIGHT + 45}>
            Dashed rings show straight-line distance from the city centre.
          </text>
          <circle cx="29" cy={HEIGHT + 63} r="6" className="stroke-ink fill-none" strokeWidth="2" />
          <text x="52" y={HEIGHT + 68}>
            Point at a card, or tab to it, and its dot is ringed and named here.
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** A label on a pill of the plan's own surface, so text stays readable over rings and dots. */
function Pill({
  x,
  y,
  text,
  className,
  strong = false,
  centred = false,
  ...rest
}: {
  x: number;
  y: number;
  text: string;
  className: string;
  strong?: boolean;
  centred?: boolean;
} & Record<`data-${string}`, string>) {
  const width = Math.round(text.length * (strong ? 8.4 : 7.6) + 14);
  // Kept inside the plan: a label never runs off the edge.
  const left = Math.min(Math.max(centred ? x - width / 2 : x, 6), WIDTH - width - 6);

  return (
    <g>
      <rect
        x={left}
        y={y - 12}
        width={width}
        height="22"
        rx="11"
        className="fill-surface-raised stroke-border"
        strokeWidth="1"
        opacity="0.94"
      />
      <text
        x={left + width / 2}
        y={y + 3.5}
        textAnchor="middle"
        className={`${className} text-[13px] ${strong ? 'font-semibold' : ''}`}
        {...rest}
      >
        {text}
      </text>
    </g>
  );
}
