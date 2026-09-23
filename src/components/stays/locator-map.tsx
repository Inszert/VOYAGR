import type { LocatorMap as LocatorMapData } from '@/discovery/locator';

/**
 * Where a place is, as a small map.
 *
 * Drawn from `buildLocator`: the coast and land around the place from the
 * product's own Natural Earth files, the named places nearby, a marker, and a
 * scale bar. Everything on it is decoration over the facts beside it, so the
 * SVG is one image with a label that says what it shows.
 *
 * In the palette rather than the globe's: the sea is the panel's own dark,
 * the land is the place's tint, and the marker is the tint's light end.
 */

export interface LocatorMapProps {
  readonly map: LocatorMapData;
  /** What the marker is, for the image's accessible name. */
  readonly label: string;
}

export function LocatorMap({ map, label }: LocatorMapProps) {
  const { width, height } = map;

  return (
    <svg
      role="img"
      aria-label={`Map of the area around ${label}`}
      viewBox={`0 0 ${width} ${height}`}
      className="bg-surface-sunken block h-auto w-full"
    >
      <defs>
        <pattern id="locator-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" className="stroke-(--color-hairline)" strokeWidth="1" />
        </pattern>
        <radialGradient id="locator-glow">
          <stop offset="0%" className="[stop-color:var(--color-tint-ink)]" stopOpacity="0.45" />
          <stop offset="100%" className="[stop-color:var(--color-tint-ink)]" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width={width} height={height} fill="url(#locator-grid)" />

      {map.land.map((d, index) => (
        <path
          key={index}
          d={d}
          className="fill-tint/25 stroke-tint/70"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      ))}

      {map.places.map((place) => (
        <g key={place.name}>
          <circle cx={place.x} cy={place.y} r="2.5" className="fill-ink-muted" />
          <text
            x={place.x + 6}
            y={place.y + 3.5}
            className="fill-ink-muted font-sans text-[11px]"
            style={{ paintOrder: 'stroke', stroke: 'var(--color-panel-2)', strokeWidth: 3 }}
          >
            {place.name}
          </text>
        </g>
      ))}

      <circle cx={map.marker.x} cy={map.marker.y} r="26" fill="url(#locator-glow)" />
      <circle
        cx={map.marker.x}
        cy={map.marker.y}
        r="6"
        className="fill-tint-ink stroke-(--color-panel-2)"
        strokeWidth="2.5"
      />

      <g transform={`translate(14 ${height - 16})`}>
        <line
          x1="0"
          x2={map.scale.pixels}
          y1="0"
          y2="0"
          className="stroke-ink-muted"
          strokeWidth="2"
        />
        <line x1="0" x2="0" y1="-4" y2="4" className="stroke-ink-muted" strokeWidth="2" />
        <line
          x1={map.scale.pixels}
          x2={map.scale.pixels}
          y1="-4"
          y2="4"
          className="stroke-ink-muted"
          strokeWidth="2"
        />
        <text x={map.scale.pixels + 6} y="4" className="fill-ink-muted font-sans text-[11px]">
          {map.scale.kilometres} km
        </text>
      </g>
    </svg>
  );
}
