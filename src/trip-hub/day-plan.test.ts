import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import type { DayStopRecord, Repositories } from '@/db/repository';
import { AppError } from '@/lib/errors';
import { DAY_PLAN_LIMITS, DayPlanService, moveStop } from './day-plan';

let repositories: Repositories;
let plans: DayPlanService;

async function aUser() {
  return repositories.users.create({
    id: randomUUID(),
    email: `user-${randomUUID()}@example.invalid`,
    plan: 'free',
  });
}

const wiki = 'https://en.wikipedia.org/wiki/Sagrada_Fam%C3%ADlia';

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return 'OK';
}

function titles(view: { days: readonly { stops: readonly { title: string }[] }[] }) {
  return view.days.map((day) => day.stops.map((stop) => stop.title));
}

beforeEach(() => {
  repositories = createMemoryRepositories();
  plans = new DayPlanService({ repositories });
});

describe('starting a plan', () => {
  it('creates a trip holding the stops in order, by day', async () => {
    const user = await aUser();
    const view = await plans.startPlan(user.id, {
      destination: 'Barcelona',
      days: [
        [
          { title: 'Sagrada Familia', url: wiki },
          { title: 'Park Guell', url: null },
        ],
        [{ title: 'Beach', url: null }],
      ],
    });

    expect(view.tripName).toBe('Barcelona plan');
    expect(titles(view)).toEqual([['Sagrada Familia', 'Park Guell'], ['Beach']]);
    expect((await repositories.trips.listForUser(user.id)).map((trip) => trip.id)).toEqual([
      view.tripId,
    ]);
  });

  it('refuses a link that is not a place source, and a title with a control character', async () => {
    const user = await aUser();
    const start = (stop: { title: string; url: string | null }) =>
      plans.startPlan(user.id, { destination: 'Rome', days: [[stop]] });

    expect(await code(start({ title: 'Forum', url: 'https://evil.example/x' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(await code(start({ title: 'Fo\u0000rum', url: null }))).toBe('VALIDATION_ERROR');
    expect(await code(start({ title: '   ', url: null }))).toBe('VALIDATION_ERROR');
    expect(await repositories.trips.listForUser(user.id)).toEqual([]);
  });
});

describe('editing a plan', () => {
  it('adds a typed stop at the end of a day, and a new day past the last', async () => {
    const user = await aUser();
    const { tripId } = await plans.startPlan(user.id, {
      destination: 'Lisbon',
      days: [[{ title: 'Tram 28', url: null }]],
    });

    await plans.addStop(user.id, tripId, 1, { title: 'Pastel de nata', url: null });
    const view = await plans.addStop(user.id, tripId, 2, { title: 'Sunset', url: null });

    expect(titles(view)).toEqual([['Tram 28', 'Pastel de nata'], ['Sunset']]);
  });

  it('moves a stop up, down and across days, and refuses a move that goes nowhere', async () => {
    const user = await aUser();
    const start = await plans.startPlan(user.id, {
      destination: 'Lisbon',
      days: [
        [
          { title: 'A', url: null },
          { title: 'B', url: null },
        ],
        [{ title: 'C', url: null }],
      ],
    });
    const id = (title: string) =>
      start.days.flatMap((day) => day.stops).find((stop) => stop.title === title)!.id;

    let view = await plans.moveStop(user.id, start.tripId, id('B'), 'up');
    expect(titles(view)).toEqual([['B', 'A'], ['C']]);

    view = await plans.moveStop(user.id, start.tripId, id('B'), 'next-day');
    expect(titles(view)).toEqual([['A'], ['B', 'C']]);

    view = await plans.moveStop(user.id, start.tripId, id('A'), 'previous-day');
    expect(titles(view)).toEqual([['A'], ['B', 'C']]);

    view = await plans.moveStop(user.id, start.tripId, id('C'), 'down');
    expect(titles(view)).toEqual([['A'], ['B', 'C']]);
  });

  it('removes a stop and keeps the rest in order', async () => {
    const user = await aUser();
    const start = await plans.startPlan(user.id, {
      destination: 'Lisbon',
      days: [
        [
          { title: 'A', url: null },
          { title: 'B', url: null },
          { title: 'C', url: null },
        ],
      ],
    });

    const view = await plans.removeStop(user.id, start.tripId, start.days[0]!.stops[0]!.id);
    expect(titles(view)).toEqual([['B', 'C']]);
    const stops = await repositories.planItems.listStops(start.tripId);
    expect(stops.map((stop) => stop.position)).toEqual([0, 1]);
  });

  it('caps a day', async () => {
    const user = await aUser();
    const { tripId } = await plans.startPlan(user.id, { destination: 'Lisbon', days: [[]] });
    for (let index = 0; index < DAY_PLAN_LIMITS.stopsPerDay; index += 1) {
      await plans.addStop(user.id, tripId, 1, { title: `Stop ${index}`, url: null });
    }

    expect(await code(plans.addStop(user.id, tripId, 1, { title: 'One more', url: null }))).toBe(
      'VALIDATION_ERROR',
    );
  });
});

describe('who may read or change a plan', () => {
  it('treats a stranger as if the trip did not exist, for every operation', async () => {
    const owner = await aUser();
    const stranger = await aUser();
    const start = await plans.startPlan(owner.id, {
      destination: 'Lisbon',
      days: [[{ title: 'A', url: null }]],
    });
    const stopId = start.days[0]!.stops[0]!.id;

    expect(await code(plans.view(stranger.id, start.tripId))).toBe('NOT_FOUND');
    expect(await code(plans.addStop(stranger.id, start.tripId, 1, { title: 'x', url: null }))).toBe(
      'NOT_FOUND',
    );
    expect(await code(plans.moveStop(stranger.id, start.tripId, stopId, 'down'))).toBe('NOT_FOUND');
    expect(await code(plans.removeStop(stranger.id, start.tripId, stopId))).toBe('NOT_FOUND');
    expect(titles(await plans.view(owner.id, start.tripId))).toEqual([['A']]);
  });

  it('does not let a stop of one trip be reached through another trip the user owns', async () => {
    const owner = await aUser();
    const other = await aUser();
    const theirs = await plans.startPlan(other.id, {
      destination: 'Rome',
      days: [[{ title: 'Forum', url: null }]],
    });
    const mine = await plans.startPlan(owner.id, { destination: 'Lisbon', days: [[]] });

    const stopId = theirs.days[0]!.stops[0]!.id;
    expect(await code(plans.removeStop(owner.id, mine.tripId, stopId))).toBe('NOT_FOUND');
    expect(titles(await plans.view(other.id, theirs.tripId))).toEqual([['Forum']]);
  });

  it('lets a member of the trip edit it', async () => {
    const owner = await aUser();
    const member = await aUser();
    const start = await plans.startPlan(owner.id, { destination: 'Lisbon', days: [[]] });
    await repositories.trips.addMember({
      tripId: start.tripId,
      userId: member.id,
      name: 'Friend',
    });

    const view = await plans.addStop(member.id, start.tripId, 1, { title: 'Fado', url: null });
    expect(titles(view)).toEqual([['Fado']]);
  });
});

describe('moveStop (pure)', () => {
  const stop = (id: string, day: number, position: number): DayStopRecord => ({
    id,
    tripId: 't',
    title: id,
    url: null,
    day,
    position,
  });

  it('returns null at the edges', () => {
    const stops = [stop('a', 1, 0), stop('b', 1, 1)];
    expect(moveStop(stops, 'a', 'up')).toBeNull();
    expect(moveStop(stops, 'b', 'down')).toBeNull();
    expect(moveStop(stops, 'a', 'previous-day')).toBeNull();
    expect(moveStop(stops, 'missing', 'up')).toBeNull();
  });
});
