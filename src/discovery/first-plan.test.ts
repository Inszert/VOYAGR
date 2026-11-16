import { describe, expect, it } from 'vitest';
import type { ThingKind, ThingToDo } from '@/providers/types';
import { buildFirstPlan, planDayCount } from './first-plan';

function place(id: string, latitude: number, longitude: number, kind: ThingKind = 'sights') {
  return {
    id,
    providerId: 'wikidata',
    name: `Place ${id}`,
    kind,
    description: null,
    latitude,
    longitude,
    distanceFromCentreMetres: 1000,
    notability: 10,
    wikipediaUrl: null,
    imageFile: null,
  } satisfies ThingToDo;
}

// Two clusters, 0.01 degrees apart inside each and a degree between them.
const NORTH = [place('N1', 41.9, 12.5), place('N2', 41.901, 12.501), place('N3', 41.902, 12.5)];
const SOUTH = [
  place('S1', 40.9, 12.5, 'museums'),
  place('S2', 40.901, 12.501),
  place('S3', 40.902, 12.5),
];

describe('planDayCount', () => {
  it('needs three places for a day and never more days than nights or a week', () => {
    expect(planDayCount(2, 5)).toBe(0);
    expect(planDayCount(9, 5)).toBe(3);
    expect(planDayCount(30, 3)).toBe(3);
    expect(planDayCount(60, 14)).toBe(7);
    expect(planDayCount(9, 0)).toBe(0);
  });
});

describe('buildFirstPlan', () => {
  it('is no plan when the list is too short to fill a day', () => {
    expect(
      buildFirstPlan({ things: NORTH.slice(0, 2), nights: 3, startDate: null, weather: [] }),
    ).toBeNull();
  });

  it('draws every stop from the real list and uses each place once', () => {
    const things = [...NORTH, ...SOUTH];
    const plan = buildFirstPlan({ things, nights: 4, startDate: null, weather: [] })!;

    const ids = plan.days.flatMap((day) => day.stops.map((stop) => stop.place.id));
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    for (const id of ids) expect(things.map((t) => t.id)).toContain(id);
  });

  it('keeps a day to one neighbourhood, even when the list interleaves them', () => {
    const interleaved = [NORTH[0]!, SOUTH[0]!, NORTH[1]!, SOUTH[1]!, NORTH[2]!, SOUTH[2]!];
    const plan = buildFirstPlan({ things: interleaved, nights: 2, startDate: null, weather: [] })!;

    for (const day of plan.days) {
      const prefixes = new Set(day.stops.map((stop) => stop.place.id[0]));
      expect(prefixes.size).toBe(1);
    }
  });

  it('measures each walk with the core distance, and none for the first stop', () => {
    const plan = buildFirstPlan({ things: NORTH, nights: 1, startDate: null, weather: [] })!;
    const [first, second, third] = plan.days[0]!.stops;

    expect(first.metresFromPrevious).toBeNull();
    expect(second.metresFromPrevious).toBeGreaterThan(0);
    expect(second.metresFromPrevious).toBeLessThan(300);
    expect(third.metresFromPrevious).toBeGreaterThan(0);
    expect(plan.days[0]!.stops.map((stop) => stop.slot)).toEqual([
      'morning',
      'afternoon',
      'evening',
    ]);
  });

  it('plans fewer days than nights when the list cannot fill them, and says how many', () => {
    const plan = buildFirstPlan({
      things: [...NORTH, ...SOUTH],
      nights: 7,
      startDate: null,
      weather: [],
    })!;

    expect(plan.nights).toBe(7);
    expect(plan.days).toHaveLength(2);
  });

  it('names the weekday from the date and flags a likely-rain day from the provider', () => {
    const plan = buildFirstPlan({
      things: [...NORTH, ...SOUTH],
      nights: 2,
      startDate: '2026-06-11',
      weather: [
        {
          date: '2026-06-12',
          basis: 'forecast',
          temperatureMinC: 15,
          temperatureMaxC: 22,
          precipitationProbability: 0.8,
          windKph: 10,
          seaTemperatureC: null,
          confidence: 0.9,
        } as never,
      ],
    })!;

    expect(plan.days.map((day) => day.weekday)).toEqual(['Thu', 'Fri']);
    expect(plan.days.map((day) => day.rainLikely)).toEqual([false, true]);
  });

  it('offers a roofed real place for a wet day, never one already in the day', () => {
    const roofed = place('M1', 41.9005, 12.5005, 'museums');
    const plan = buildFirstPlan({
      things: [
        ...NORTH,
        roofed,
        place('X1', 10, 10),
        place('X2', 10.01, 10),
        place('X3', 10.02, 10),
      ],
      nights: 1,
      startDate: null,
      weather: [],
    })!;

    // Four places were not enough for a second day, so the roofed one is spare.
    const day = plan.days[0]!;
    expect(day.stops.map((stop) => stop.place.id)).not.toContain('M1');
    expect(day.ifItRains?.place.id).toBe('M1');
    expect(day.stops.map((stop) => stop.place.id)).toContain(day.ifItRains!.replaces.id);
  });

  it('has no rain alternative when the list has no roofed place spare', () => {
    const plan = buildFirstPlan({ things: NORTH, nights: 1, startDate: null, weather: [] })!;

    expect(plan.days[0]!.ifItRains).toBeNull();
  });

  it('words a stop from the place’s own description, or a fixed phrase for its kind', () => {
    const described = { ...NORTH[0]!, name: 'Colosseum', description: 'amphitheatre in Rome' };
    const plan = buildFirstPlan({
      things: [described, NORTH[1]!, NORTH[2]!],
      nights: 1,
      startDate: null,
      weather: [],
    })!;

    expect(plan.days[0]!.stops[0]!.line).toBe('Amphitheatre in Rome.');
    expect(plan.days[0]!.stops[1]!.line).toBe('A sight to see.');
  });
});
