import type { DayStopPlacement, DayStopRecord, Repositories } from '@/db/repository';
import { AppError } from '@/lib/errors';
import { isPlaceSourceUrl } from './place-url';
import { TripHubService } from './service';

/**
 * A traveller's own day-by-day plan, kept on the trip hub's plan items.
 *
 * A stop is an `activity` idea with a day and a position in it. Nothing here is
 * money, and nothing is booked: a stop is a name and, for a real place, the
 * link to where it is described. Every operation goes through
 * `TripHubService.access`, so only the trip's owner or a member can read or
 * change it, and a trip id in a request is a claim, not an authorisation.
 */

export const DAY_PLAN_LIMITS = { days: 14, stopsPerDay: 12, stopsPerTrip: 80 } as const;

export const MOVE_DIRECTIONS = ['up', 'down', 'previous-day', 'next-day'] as const;
export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

export interface DayPlanStop {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
}

export interface DayPlanDay {
  readonly day: number;
  readonly stops: readonly DayPlanStop[];
}

export interface DayPlanView {
  readonly tripId: string;
  readonly tripName: string;
  /** Days 1..N with no gaps, at least one; a day may be empty. */
  readonly days: readonly DayPlanDay[];
}

export interface StopInput {
  readonly title: string;
  /** A Wikipedia or Wikidata link for a real place, or null for a stop typed by hand. */
  readonly url: string | null;
}

function invalid(publicMessage = 'That stop could not be saved.'): AppError {
  return new AppError('VALIDATION_ERROR', 'Invalid day plan input', { publicMessage });
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Plan stop not found', {
    publicMessage: 'That stop could not be found.',
  });
}

/** A short single-line name, and a link only to where a place is described. */
export function checkStop(input: StopInput): StopInput {
  const title = typeof input?.title === 'string' ? input.title.trim().replace(/\s+/g, ' ') : '';
  const url = input?.url ?? null;
  if (
    title === '' ||
    title.length > 140 ||
    /[\u0000-\u001f\u007f]/.test(title) ||
    (url !== null && (typeof url !== 'string' || !isPlaceSourceUrl(url)))
  ) {
    throw invalid();
  }

  return { title, url };
}

function checkDay(day: unknown): number {
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > DAY_PLAN_LIMITS.days) {
    throw invalid(`Choose a day between 1 and ${DAY_PLAN_LIMITS.days}.`);
  }

  return day;
}

/** Group stops into consecutive days, in order. */
export function groupDays(stops: readonly DayStopRecord[]): DayPlanDay[] {
  const last = stops.reduce((max, stop) => Math.max(max, stop.day), 1);
  const days: DayPlanDay[] = [];
  for (let day = 1; day <= last; day += 1) {
    days.push({
      day,
      stops: stops
        .filter((stop) => stop.day === day)
        .sort((a, b) => a.position - b.position)
        .map(({ id, title, url }) => ({ id, title, url })),
    });
  }

  return days;
}

/** Every stop's id, in order, per day: the shape a move edits. */
function toColumns(stops: readonly DayStopRecord[]): string[][] {
  const columns: string[][] = Array.from({ length: DAY_PLAN_LIMITS.days }, () => []);
  for (const stop of [...stops].sort((a, b) => a.day - b.day || a.position - b.position)) {
    columns[stop.day - 1]?.push(stop.id);
  }

  return columns;
}

function toPlacements(columns: readonly (readonly string[])[]): DayStopPlacement[] {
  return columns.flatMap((ids, dayIndex) =>
    ids.map((id, position) => ({ id, day: dayIndex + 1, position })),
  );
}

/**
 * Where the plan stands after moving one stop, or null when the move is not
 * possible (already first, already last, past the last day, a full day).
 * Pure, so every edge is a test.
 */
export function moveStop(
  stops: readonly DayStopRecord[],
  id: string,
  direction: MoveDirection,
): DayStopPlacement[] | null {
  const columns = toColumns(stops);
  const dayIndex = columns.findIndex((ids) => ids.includes(id));
  if (dayIndex < 0) return null;
  const column = columns[dayIndex]!;
  const at = column.indexOf(id);

  if (direction === 'up' || direction === 'down') {
    const to = direction === 'up' ? at - 1 : at + 1;
    if (to < 0 || to >= column.length) return null;
    [column[at], column[to]] = [column[to]!, column[at]!];
    return toPlacements(columns);
  }

  const target = direction === 'previous-day' ? dayIndex - 1 : dayIndex + 1;
  if (target < 0 || target >= columns.length) return null;
  if (columns[target]!.length >= DAY_PLAN_LIMITS.stopsPerDay) return null;

  column.splice(at, 1);
  // Earlier ends the day before; later opens the day after, so the order a
  // person read the plan in is kept across the boundary.
  if (direction === 'previous-day') columns[target]!.push(id);
  else columns[target]!.unshift(id);
  return toPlacements(columns);
}

export class DayPlanService {
  private readonly repositories: Repositories;
  private readonly hub: TripHubService;

  constructor(options: { readonly repositories: Repositories }) {
    this.repositories = options.repositories;
    this.hub = new TripHubService({ repositories: options.repositories });
  }

  /** The day plan of a trip the user owns or sits on. */
  async view(userId: string, tripId: string): Promise<DayPlanView> {
    const { trip } = await this.hub.access(userId, tripId);
    const stops = await this.repositories.planItems.listStops(tripId);

    return { tripId, tripName: trip.name, days: groupDays(stops) };
  }

  /** A new trip with a plan already in it: `days[0]` is day 1, and so on. */
  async startPlan(
    userId: string,
    input: { readonly destination: string; readonly days: readonly (readonly StopInput[])[] },
  ): Promise<DayPlanView> {
    const destination = typeof input.destination === 'string' ? input.destination.trim() : '';
    if (destination === '' || destination.length > 60 || !Array.isArray(input.days)) {
      throw invalid('That plan could not be started.');
    }

    const checked = input.days.slice(0, DAY_PLAN_LIMITS.days).map((day) => {
      if (!Array.isArray(day) || day.length > DAY_PLAN_LIMITS.stopsPerDay) throw invalid();
      return day.map(checkStop);
    });
    if (checked.flat().length > DAY_PLAN_LIMITS.stopsPerTrip) throw invalid();

    const trip = await this.hub.createTrip(userId, {
      name: `${destination} plan`,
      destination,
      destinationCountry: null,
      startDate: null,
      endDate: null,
      ownerName: 'Me',
    });

    for (const [dayIndex, stops] of checked.entries()) {
      for (const [position, stop] of stops.entries()) {
        await this.repositories.planItems.createStop({
          tripId: trip.id,
          title: stop.title,
          url: stop.url,
          day: dayIndex + 1,
          position,
        });
      }
    }

    return this.view(userId, trip.id);
  }

  async addStop(
    userId: string,
    tripId: string,
    day: number,
    stop: StopInput,
  ): Promise<DayPlanView> {
    await this.hub.access(userId, tripId);
    const checked = checkStop(stop);
    const where = checkDay(day);

    const stops = await this.repositories.planItems.listStops(tripId);
    const inDay = stops.filter((entry) => entry.day === where);
    if (
      inDay.length >= DAY_PLAN_LIMITS.stopsPerDay ||
      stops.length >= DAY_PLAN_LIMITS.stopsPerTrip
    ) {
      throw new AppError('VALIDATION_ERROR', 'Day plan limit reached', {
        publicMessage: 'That day is full. Move a stop to another day first.',
      });
    }

    await this.repositories.planItems.createStop({
      tripId,
      title: checked.title,
      url: checked.url,
      day: where,
      position: inDay.length,
    });
    return this.view(userId, tripId);
  }

  async removeStop(userId: string, tripId: string, itemId: string): Promise<DayPlanView> {
    await this.hub.access(userId, tripId);
    const stops = await this.repositories.planItems.listStops(tripId);
    if (!stops.some((entry) => entry.id === itemId)) throw notFound();

    await this.repositories.planItems.delete(itemId);
    // Close the gap, so positions stay 0..n-1.
    const rest = stops.filter((entry) => entry.id !== itemId);
    await this.repositories.planItems.placeStops(tripId, toPlacements(toColumns(rest)));
    return this.view(userId, tripId);
  }

  async moveStop(
    userId: string,
    tripId: string,
    itemId: string,
    direction: MoveDirection,
  ): Promise<DayPlanView> {
    await this.hub.access(userId, tripId);
    if (!MOVE_DIRECTIONS.includes(direction)) throw invalid('That move is not possible.');

    const stops = await this.repositories.planItems.listStops(tripId);
    if (!stops.some((entry) => entry.id === itemId)) throw notFound();

    const placements = moveStop(stops, itemId, direction);
    if (placements) await this.repositories.planItems.placeStops(tripId, placements);
    return this.view(userId, tripId);
  }
}
