import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAUNCH_DESTINATIONS } from '@/liteapi-snapshot/targets';
import { coveredCities } from './start-cities';

describe('coveredCities', () => {
  it('lists every launch destination, with a photo only where the manifest has one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cities-'));
    const path = join(dir, 'manifest.json');
    writeFileSync(path, JSON.stringify({ LIS: { width: 1024, height: 688 } }));

    const cities = coveredCities(path);

    expect(cities.map((c) => c.code)).toEqual(LAUNCH_DESTINATIONS.map((d) => d.code));
    expect(cities.find((c) => c.code === 'LIS')?.photo).toBe('/img/destinations/LIS-768.webp');
    expect(cities.find((c) => c.code === 'BCN')?.photo).toBeNull();
  });

  it('gives no photos when the manifest does not exist', () => {
    const cities = coveredCities(join(tmpdir(), 'no-such-dir', 'manifest.json'));
    expect(cities).toHaveLength(LAUNCH_DESTINATIONS.length);
    expect(cities.every((c) => c.photo === null)).toBe(true);
  });

  it('reads the real manifest without throwing', () => {
    expect(coveredCities().length).toBe(LAUNCH_DESTINATIONS.length);
  });
});
