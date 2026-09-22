import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COUNTRIES, findCountry } from './countries';
import { describeRegions, hasRegions, REGION_COUNTS, regionCount, regionsUrl } from './regions';

/**
 * The shipped region data.
 *
 * Data tests, like the country ones: they pin the properties the globe relies
 * on, so a rebuild that lost a country's regions or changed a filename fails
 * here rather than on a map that quietly stops drawing them.
 */

interface RegionFile {
  readonly type: string;
  readonly features: readonly {
    readonly properties: { readonly name: string; readonly code: string | null };
    readonly geometry: { readonly type: string; readonly coordinates: unknown };
  }[];
}

function load(adm0: string): RegionFile {
  return JSON.parse(readFileSync(`public${regionsUrl(adm0)}`, 'utf8')) as RegionFile;
}

describe('the region index', () => {
  it('covers every country the globe can draw', () => {
    // Natural Earth's admin-1 set reaches every admin-0 country we ship, so a
    // country with no entry means the build lost it rather than that the
    // world has a country with no regions.
    for (const country of COUNTRIES) {
      expect(regionCount(country.adm0), country.name).toBeGreaterThan(0);
    }
  });

  it('names a file per country, versioned so a rebuild is never served stale', () => {
    expect(regionsUrl('esp')).toBe('/geo/regions/ESP.v2.json');
    expect(existsSync('public/geo/regions/ESP.v2.json')).toBe(true);
  });

  it('agrees with the geometry the browser fetches', () => {
    for (const adm0 of ['ESP', 'GEO', 'JPN', 'CYP']) {
      // An outline and the one point its name is written at, per region.
      expect(load(adm0).features).toHaveLength(REGION_COUNTS[adm0]! * 2);
    }
  });

  it('gives every region a name, an outline and exactly one label point', () => {
    const outlines = new Map<string, number>();
    const labels = new Map<string, number>();

    for (const feature of load('ESP').features) {
      const { name } = feature.properties;
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);

      const into = feature.geometry.type === 'Point' ? labels : outlines;
      into.set(name, (into.get(name) ?? 0) + 1);

      expect(['Polygon', 'MultiPolygon', 'Point']).toContain(feature.geometry.type);
    }

    // A region labelled twice is what a multi-part shape does when the
    // renderer is left to place the name, and it reads as a bug.
    expect([...labels.values()].every((count) => count === 1)).toBe(true);
    expect([...outlines.keys()].sort()).toEqual([...labels.keys()].sort());
  });

  it('puts every label point inside the region it names', () => {
    /*
     * Against the region's own outline rather than the country's. The country
     * box comes from the 1:110m coastline, which leaves out enclaves the
     * admin-1 set has - Ceuta sits in North Africa and falls outside Spain's
     * coarse outline entirely - so the country box would fail this for a
     * reason that says nothing about the label.
     */
    for (const adm0 of ['ESP', 'GRC', 'JPN']) {
      const outlines = new Map<string, number[]>();

      for (const feature of load(adm0).features) {
        if (feature.geometry.type === 'Point') continue;

        const rings =
          feature.geometry.type === 'Polygon'
            ? (feature.geometry.coordinates as number[][][])
            : (feature.geometry.coordinates as number[][][][]).flat();
        const points = rings.flat();

        outlines.set(feature.properties.name, [
          Math.min(...points.map((point) => point[0]!)),
          Math.min(...points.map((point) => point[1]!)),
          Math.max(...points.map((point) => point[0]!)),
          Math.max(...points.map((point) => point[1]!)),
        ]);
      }

      for (const feature of load(adm0).features) {
        if (feature.geometry.type !== 'Point') continue;

        const [lon, lat] = feature.geometry.coordinates as [number, number];
        const box = outlines.get(feature.properties.name)!;
        const where = `${feature.properties.name} in ${adm0}`;

        expect(lon, where).toBeGreaterThanOrEqual(box[0]!);
        expect(lon, where).toBeLessThanOrEqual(box[2]!);
        expect(lat, where).toBeGreaterThanOrEqual(box[1]!);
        expect(lat, where).toBeLessThanOrEqual(box[3]!);
      }
    }
  });

  it('lists regions in name order, so a reader can find one', () => {
    const names = load('GEO')
      .features.filter((feature) => feature.geometry.type !== 'Point')
      .map((feature) => feature.properties.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('keeps small places rather than letting them collapse', () => {
    // Ceuta is about twenty square kilometres. A build that rounded it away
    // would be drawing a map that disagrees with the world.
    const names = load('ESP')
      .features.filter((feature) => feature.geometry.type !== 'Point')
      .map((feature) => feature.properties.name);

    expect(names).toContain('Ceuta');
    expect(names).toContain('Melilla');
  });

  it('describes a count in words, or says nothing when there is nothing to say', () => {
    expect(describeRegions('ESP')).toBe('52 regions');
    expect(hasRegions('ESP')).toBe(true);

    expect(describeRegions('ZZZ')).toBeNull();
    expect(hasRegions('ZZZ')).toBe(false);
  });

  it('matches the country index it was built against', () => {
    for (const adm0 of Object.keys(REGION_COUNTS)) {
      expect(findCountry(adm0), adm0).not.toBeNull();
    }
  });
});
