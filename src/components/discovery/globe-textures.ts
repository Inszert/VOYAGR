/**
 * Snow and sand, as textures.
 *
 * A latitude band filled with one flat colour does not look like snow. It
 * looks like the map has been tinted, which is exactly the complaint it
 * earned: whiter in the north, yellower over the Sahara, and nothing that
 * reads as ground.
 *
 * These are small tiling patterns, generated on a canvas at runtime and
 * handed to MapLibre with `addImage`. No file, no sprite sheet and no request:
 * the globe still reaches nobody, which is the property `docs/map-options.md`
 * is written to protect.
 *
 * **Deterministic, like the fixtures.** The speckle comes from an integer
 * hash, never `Math.random`, so the planet looks the same on every render and
 * in every screenshot. A texture that differed between two runs would make
 * every visual comparison a coin toss.
 */

/** The tile size. Small enough to be cheap, large enough not to read as a grid. */
const SIZE = 64;

/**
 * A deterministic number in 0 to 1 from an integer.
 *
 * A 32-bit integer hash, the same shape as the one the mock providers derive
 * their variation from. Cheap, well distributed, and identical on every
 * machine - which is the only property that matters here.
 */
function noise(seed: number): number {
  let value = seed + 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  value ^= value >>> 15;

  return (value >>> 0) / 4294967296;
}

function canvas(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;

  const element = document.createElement('canvas');
  element.width = SIZE;
  element.height = SIZE;

  return element.getContext('2d', { willReadFrequently: true });
}

/**
 * Snow: a pale base under bright grains and a few softer drifts.
 *
 * Three passes, because one is not enough to stop a speckle reading as film
 * grain: drifts give it large-scale structure, grains give it sparkle, and
 * the base keeps the shape solid where neither lands.
 */
export function snowTexture(): ImageData | null {
  const context = canvas();
  if (!context) return null;

  context.fillStyle = 'rgba(232, 238, 244, 0.72)';
  context.fillRect(0, 0, SIZE, SIZE);

  // Drifts: large, very soft, slightly blue in the hollows.
  for (let index = 0; index < 14; index += 1) {
    const x = noise(index * 3) * SIZE;
    const y = noise(index * 3 + 1) * SIZE;
    const radius = 6 + noise(index * 3 + 2) * 14;

    const drift = context.createRadialGradient(x, y, 0, x, y, radius);
    drift.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    drift.addColorStop(1, 'rgba(214, 225, 236, 0)');
    context.fillStyle = drift;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // Grains: the sparkle of sun on fresh snow.
  for (let index = 0; index < 360; index += 1) {
    const x = noise(index * 5 + 101) * SIZE;
    const y = noise(index * 5 + 102) * SIZE;
    const radius = 0.4 + noise(index * 5 + 103) * 1.1;

    context.fillStyle = `rgba(255, 255, 255, ${(0.35 + noise(index * 5 + 104) * 0.6).toFixed(3)})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  return context.getImageData(0, 0, SIZE, SIZE);
}

/**
 * Sand: warm ground under dunes running the way dunes run.
 *
 * Streaks rather than speckle. A desert seen from orbit is banded, not
 * stippled, and the bands are what stop the Sahara reading as a yellow
 * rectangle.
 */
export function sandTexture(): ImageData | null {
  const context = canvas();
  if (!context) return null;

  context.fillStyle = 'rgba(176, 162, 136, 0.78)';
  context.fillRect(0, 0, SIZE, SIZE);

  /*
   * Patches first, streaks second.
   *
   * The first version was streaks alone, and at the zoom somebody looks at a
   * whole planet from, parallel lines across the Sahara read as hatching on a
   * map rather than as dunes - the single most drawn-looking thing left on
   * the globe. A sand sea seen from orbit is mostly blotchy: lighter erg,
   * darker rock, with the grain of the dunes only faintly through it.
   */
  for (let index = 0; index < 22; index += 1) {
    const x = noise(index * 11 + 31) * SIZE;
    const y = noise(index * 11 + 32) * SIZE;
    const radius = 5 + noise(index * 11 + 33) * 17;
    const pale = noise(index * 11 + 34) > 0.5;
    const tone = pale ? '212, 198, 168' : '156, 136, 106';

    const patch = context.createRadialGradient(x, y, 0, x, y, radius);
    patch.addColorStop(0, `rgba(${tone}, ${(0.18 + noise(index * 11 + 35) * 0.22).toFixed(3)})`);
    patch.addColorStop(1, `rgba(${tone}, 0)`);

    context.fillStyle = patch;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.lineCap = 'round';

  for (let index = 0; index < 18; index += 1) {
    const offset = noise(index * 7 + 11) * SIZE * 2 - SIZE / 2;
    const length = SIZE * (0.5 + noise(index * 7 + 12));
    const width = 1.2 + noise(index * 7 + 13) * 4.5;
    const light = noise(index * 7 + 14) > 0.45;

    context.strokeStyle = light
      ? `rgba(216, 202, 174, ${(0.08 + noise(index * 7 + 15) * 0.12).toFixed(3)})`
      : `rgba(150, 130, 100, ${(0.07 + noise(index * 7 + 16) * 0.11).toFixed(3)})`;
    context.lineWidth = width;

    context.beginPath();
    // A shallow diagonal, and the same one each time, so the dunes lie in one
    // direction the way a sand sea does rather than crossing each other.
    context.moveTo(offset, -4);
    context.lineTo(offset + length * 0.55, SIZE + 4);
    context.stroke();
  }

  // A little grain over the top, so the streaks do not read as brush strokes.
  for (let index = 0; index < 220; index += 1) {
    const x = noise(index * 5 + 401) * SIZE;
    const y = noise(index * 5 + 402) * SIZE;

    context.fillStyle = `rgba(220, 208, 184, ${(noise(index * 5 + 403) * 0.28).toFixed(3)})`;
    context.fillRect(x, y, 1, 1);
  }

  return context.getImageData(0, 0, SIZE, SIZE);
}

/**
 * Land: mottle, not colour.
 *
 * Mostly transparent, so the country's own fill still decides whether it is
 * green or lit or hovered. What this adds is variation - patches of olive and
 * brown at the scale of a mountain range - because a continent painted in one
 * flat green is the single thing that makes a globe look like a diagram of a
 * planet rather than a planet.
 */
export function landTexture(): ImageData | null {
  const context = canvas();
  if (!context) return null;

  context.clearRect(0, 0, SIZE, SIZE);

  for (let index = 0; index < 26; index += 1) {
    const x = noise(index * 9 + 701) * SIZE;
    const y = noise(index * 9 + 702) * SIZE;
    const radius = 4 + noise(index * 9 + 703) * 16;
    const pick = noise(index * 9 + 704);

    // Three tones: a darker forest, a drier olive, and a bare brown. Enough
    // to break the flat without turning a continent into camouflage.
    const tone = pick < 0.38 ? '58, 82, 52' : pick < 0.72 ? '104, 108, 64' : '112, 92, 62';

    /*
     * Eight per cent, not thirty.
     *
     * The mottle is there to stop a continent being one flat shape, and at
     * the old contrast it did the opposite: the patches read as a pattern
     * printed on the land rather than as the land being uneven. What colour
     * the ground is now comes from its latitude belt; this only breaks it up.
     */
    const patch = context.createRadialGradient(x, y, 0, x, y, radius);
    patch.addColorStop(0, `rgba(${tone}, ${(0.04 + noise(index * 9 + 705) * 0.06).toFixed(3)})`);
    patch.addColorStop(1, `rgba(${tone}, 0)`);

    context.fillStyle = patch;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // A fine grain on top, which is what stops the patches reading as clouds.
  for (let index = 0; index < 280; index += 1) {
    const x = noise(index * 5 + 901) * SIZE;
    const y = noise(index * 5 + 902) * SIZE;
    const dark = noise(index * 5 + 903) > 0.5;

    context.fillStyle = dark
      ? `rgba(40, 56, 38, ${(noise(index * 5 + 904) * 0.07).toFixed(3)})`
      : `rgba(186, 198, 150, ${(noise(index * 5 + 905) * 0.06).toFixed(3)})`;
    context.fillRect(x, y, 1, 1);
  }

  return context.getImageData(0, 0, SIZE, SIZE);
}

/** Every texture the style asks for, by the name it asks for it under. */
export const GLOBE_TEXTURES: Readonly<Record<string, () => ImageData | null>> = {
  'snow-grain': snowTexture,
  'sand-grain': sandTexture,
  'land-grain': landTexture,
};
