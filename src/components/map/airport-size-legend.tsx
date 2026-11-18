import { AIRPORT_SIZE_STYLES } from '@/components/discovery/airport-size-style';

const ORDER = ['large', 'medium', 'small'] as const;

/**
 * What the airport dots mean, in words under a map. Each size has its own colour and its own
 * dot size, so the key does not depend on colour alone.
 */
export function AirportSizeLegend({ className }: { className?: string }) {
  return (
    <ul
      aria-label="Airport sizes"
      data-airport-legend=""
      className={`text-ink-muted flex flex-wrap gap-x-4 gap-y-1 text-xs ${className ?? ''}`}
    >
      {ORDER.map((size) => {
        const style = AIRPORT_SIZE_STYLES[size];
        const px = Math.round(8 * style.radiusScale * 1.2);
        return (
          <li key={size} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              data-size={size}
              className="inline-block shrink-0 rounded-full"
              style={{
                width: px,
                height: px,
                background: `var(${style.cssVar})`,
                boxShadow: style.ring ? `0 0 0 ${style.ring}px var(--color-stage-chip)` : undefined,
              }}
            />
            {style.label}
          </li>
        );
      })}
    </ul>
  );
}
