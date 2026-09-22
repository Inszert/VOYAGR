import { cn } from '@/lib/cn';

/**
 * The weather of wherever the globe is looking.
 *
 * Turn the planet to the Arctic and it snows over the page; swing it across
 * the Sahara and dust drifts sideways; hold it over the tropics and something
 * greener falls slowly. It is set off by the same `data-biome` attribute the
 * globe already writes on the root when the middle of the view changes - by a
 * drag, a zoom, or clicking a country - so this component knows nothing about
 * maps and the globe knows nothing about weather.
 *
 * **It is decoration, and it is honest about that.** Nothing here is a
 * forecast, a claim about a place, or a figure: it is a tint and a drift keyed
 * to a band of latitude, the same sunlight model that colours the ice on the
 * globe. `aria-hidden`, out of the tab order, and unable to receive a pointer.
 *
 * Off entirely under `prefers-reduced-motion` - not slowed, off - and
 * invisible until the globe has drawn, so a page without one never snows.
 */

/**
 * A deterministic number in 0 to 1 from an integer.
 *
 * The same 32-bit hash the globe's textures and the mock providers use.
 * `Math.random` would put the motes somewhere different on the server and the
 * client, which React would report as a hydration mismatch - and would make
 * every screenshot of this page a different picture.
 */
function noise(seed: number): number {
  let value = seed + 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  value ^= value >>> 15;

  return (value >>> 0) / 4294967296;
}

/**
 * How many are falling.
 *
 * Few enough that the whole thing is a handful of composited transforms and
 * costs nothing on a phone, many enough to read as weather rather than as
 * four dots.
 */
const COUNT = 18;

const MOTES = Array.from({ length: COUNT }, (_, index) => ({
  /** Across the viewport. */
  left: `${(noise(index * 3 + 1) * 100).toFixed(2)}%`,
  /** How far it slides sideways on the way down, before the biome scales it. */
  sway: `${(noise(index * 3 + 2) * 2 - 1).toFixed(2)}`,
  size: `${(2 + noise(index * 3 + 3) * 4).toFixed(2)}px`,
  /** Slow, and all different, so the field never pulses in step. */
  duration: `${(11 + noise(index * 5 + 4) * 16).toFixed(1)}s`,
  delay: `${(noise(index * 5 + 5) * -22).toFixed(1)}s`,
}));

export function SeasonalAmbience({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('voyagr-ambience', className)}>
      {MOTES.map((mote, index) => (
        <span
          key={index}
          className="voyagr-mote"
          style={
            {
              left: mote.left,
              '--mote-size': mote.size,
              '--mote-sway': mote.sway,
              '--mote-duration': mote.duration,
              '--mote-delay': mote.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
