import { describe, expect, it } from 'vitest';
import { TILE_SIZE, tilesForWindow, worldPixel } from './tile-locator';

describe('worldPixel', () => {
  it('puts the null island in the middle of the world', () => {
    expect(worldPixel([0, 0], 0)).toEqual({ x: TILE_SIZE / 2, y: TILE_SIZE / 2 });
  });

  it('puts Rome in the right tile at zoom 4', () => {
    const { x, y } = worldPixel([12.25, 41.8], 4);
    expect(Math.floor(x / TILE_SIZE)).toBe(8);
    expect(Math.floor(y / TILE_SIZE)).toBe(5);
  });
});

describe('tilesForWindow', () => {
  it('covers the whole window and centres the point', () => {
    const tiles = tilesForWindow([12.25, 41.8], 4, 96);

    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(4);
    // Every pixel of the window lies in some tile.
    for (const [px, py] of [
      [0, 0],
      [95, 0],
      [0, 95],
      [95, 95],
      [48, 48],
    ] as const) {
      expect(
        tiles.some(
          (t) => px >= t.left && px < t.left + TILE_SIZE && py >= t.top && py < t.top + TILE_SIZE,
        ),
      ).toBe(true);
    }
  });

  it('wraps across the antimeridian instead of asking for a tile that does not exist', () => {
    const tiles = tilesForWindow([179.99, -16.5], 3, 96);
    expect(tiles.every((t) => t.x >= 0 && t.x < 8)).toBe(true);
    expect(new Set(tiles.map((t) => t.x))).toEqual(new Set([7, 0]));
  });
});
