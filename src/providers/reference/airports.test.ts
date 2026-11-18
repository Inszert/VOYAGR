import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { airportReferenceCount, allAirports, resolveAirport } from './airports';

describe('resolveAirport', () => {
  it('resolves every one of the product home airports to a real position', () => {
    for (const code of ['KSC', 'BTS', 'PRG', 'VIE']) {
      const airport = resolveAirport(code);
      expect(airport).not.toBeNull();
      expect(airport?.position).toHaveLength(2);
      expect(airport?.position.every((n) => Number.isFinite(n))).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(resolveAirport('vie')?.code).toBe('VIE');
  });

  it('returns null rather than a guessed position for an unknown code', () => {
    expect(resolveAirport('ZZZ')).toBeNull();
  });

  it('covers a real-world number of airports, not a fixture-sized handful', () => {
    // The fixture files this complements cover a few dozen airports by hand.
    // This is built from a public dataset and should be two orders of
    // magnitude bigger, or the build silently filtered almost everything out.
    expect(airportReferenceCount()).toBeGreaterThan(1000);
  });
});

describe('airport catalogue', () => {
  it('covers a country with no hand-written airport, such as the Falkland Islands', () => {
    const fk = allAirports().filter((airport) => airport.country === 'FK');
    expect(fk.length).toBeGreaterThan(0);
    expect(resolveAirport('PSY')?.countryName).toMatch(/Falkland/);
  });

  it('records each airport size, with the big hubs marked large', () => {
    expect(resolveAirport('MXP')?.size).toBe('large');
    expect(resolveAirport('BGY')?.size).toBe('large');
    expect(resolveAirport('PSY')?.size).toBe('small');
    for (const airport of allAirports()) {
      expect(['large', 'medium', 'small']).toContain(airport.size);
    }
  });

  it('keeps a hand-written fixture name and still adds the size', () => {
    expect(resolveAirport('VIE')?.name).toBe('Vienna');
    expect(resolveAirport('VIE')?.size).toBe('large');
  });

  it('is stable: the generated file is sorted by IATA code', () => {
    const rows = JSON.parse(
      readFileSync(new URL('../fixtures/airports.generated.json', import.meta.url), 'utf8'),
    ) as { iata: string }[];
    const codes = rows.map((row) => row.iata);
    expect(codes).toEqual([...codes].sort());
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('rebuilding from the cached download gives the same bytes', () => {
    const file = new URL('../fixtures/airports.generated.json', import.meta.url);
    const before = readFileSync(file);
    try {
      execFileSync(process.execPath, ['scripts/build-airports.mjs'], { stdio: 'ignore' });
    } catch {
      return; // no cached download and no network: nothing to compare
    }
    expect(readFileSync(file).equals(before)).toBe(true);
  }, 60_000);
});
